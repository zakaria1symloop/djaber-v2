// 04-ai-pipeline §6 — capability → model. `AiRoute` (ADM-06) names a primary and a fallback model per capability; a
// call that fails on the first model is retried once on the other one inside the same attempt. A per-model circuit
// breaker (Redis window counters) routes straight to the fallback for 5 minutes when the error rate passes the threshold.
// Provider keys: `AiProvider.apiKey` (AES-256-GCM) — the environment variables only bootstrap a provider without a key.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { prisma, TenantContext, type AiCapability, type AiModel, type AiProvider } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException } from '../../core/errors/app.exception';
import { RedisService } from '../../core/redis/redis.provider';
import { WsEmitter } from '../../core/ws/ws.emitter';
import { BREAKER_MIN_CALLS, BREAKER_OPEN_S, BREAKER_WINDOW_S, DEFAULT_CALL_TIMEOUT_S, VOICE_FALLBACK, VOICE_PRIMARY } from './ai.constants';
import { AI_GATEWAY, AiProviderError, type AiGateway, type AiModelRef, type AiProviderName } from './provider/ai.gateway';
import { AdminNotifier } from '../notifications/admin-notifier.service';

export type RoutedModel = {
  id: string;
  providerId: string;
  provider: AiProviderName;
  modelId: string;
  label: string;
  contextTokens: number | null;
  supportsTools: boolean;
  inputPricePerM: number;
  outputPricePerM: number;
  ref: AiModelRef;
};
export type Route = { capability: AiCapability; primary: RoutedModel; fallback: RoutedModel | null; timeoutMs: number; creditCost: number; errorThresholdPct: number; failoverActive: boolean };
export type Routed<T> = { value: T; model: RoutedModel; usedFallback: boolean };
type ModelRow = AiModel & { provider: AiProvider };

const ENV_KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_AI_API_KEY', groq: 'GROQ_API_KEY' } as const;

@Injectable()
export class RoutingService {
  private readonly log = new Logger(RoutingService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly ws: WsEmitter,
    private readonly admins: AdminNotifier,
  ) {}

  /** Ciphertext stored in `AiProvider.apiKey` (ADM-06 writes it in M10; the seed never does). */
  sealKey(key: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(Buffer.from(this.crypto.encrypt(key), 'utf8'));
  }
  private keyOf(p: AiProvider): string | null {
    if (p.apiKey?.length) {
      try {
        return this.crypto.decrypt(Buffer.from(p.apiKey).toString('utf8'));
      } catch {
        return null;
      }
    }
    return this.config.get(ENV_KEYS[p.key]) || null;
  }
  toRouted(m: ModelRow): RoutedModel {
    return {
      id: m.id,
      providerId: m.providerId,
      provider: m.provider.key,
      modelId: m.modelId,
      label: m.displayName,
      contextTokens: m.contextTokens,
      supportsTools: m.supportsTools,
      inputPricePerM: Number(m.inputPricePerM),
      outputPricePerM: Number(m.outputPricePerM),
      ref: { provider: m.provider.key, modelId: m.modelId, apiKey: this.keyOf(m.provider) },
    };
  }

  /** The route of a capability; `AGENT_MODEL_UNAVAILABLE` when the platform has none (nothing can answer). */
  async route(capability: AiCapability): Promise<Route> {
    const r = await TenantContext.runSystem(() => prisma.aiRoute.findUnique({ where: { capability }, include: { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } } }));
    if (!r) {
      if (capability === 'transcription') return this.voiceRoute();
      throw new AppException('AGENT_MODEL_UNAVAILABLE');
    }
    const fallbackOk = !!r.fallbackModel && r.fallbackModel.isActive && r.fallbackModel.provider.isActive;
    // ADM-06: a deactivated model (or provider) is skipped; nothing active left ⇒ nothing can answer
    if (!r.primaryModel.isActive || !r.primaryModel.provider.isActive) {
      if (!fallbackOk) throw new AppException('AGENT_MODEL_UNAVAILABLE');
      return { capability, primary: this.toRouted(r.fallbackModel!), fallback: null, timeoutMs: (r.timeoutSec || DEFAULT_CALL_TIMEOUT_S) * 1000, creditCost: r.creditCost, errorThresholdPct: r.errorThresholdPct, failoverActive: false };
    }
    return {
      capability,
      primary: this.toRouted(r.primaryModel),
      fallback: fallbackOk ? this.toRouted(r.fallbackModel!) : null,
      timeoutMs: (r.timeoutSec || DEFAULT_CALL_TIMEOUT_S) * 1000,
      creditCost: r.creditCost,
      errorThresholdPct: r.errorThresholdPct,
      failoverActive: r.failoverActive,
    };
  }

  /** §9: Groq `whisper-large-v3-turbo` then OpenAI `whisper-1` when no transcription route row exists. */
  private async voiceRoute(): Promise<Route> {
    const find = (v: { provider: AiProviderName; modelId: string }) => TenantContext.runSystem(() => prisma.aiModel.findFirst({ where: { modelId: v.modelId, provider: { key: v.provider } }, include: { provider: true } }));
    const [a, b] = await Promise.all([find(VOICE_PRIMARY), find(VOICE_FALLBACK)]);
    const primary = a ?? b;
    if (!primary) throw new AppException('AGENT_MODEL_UNAVAILABLE');
    return { capability: 'transcription', primary: this.toRouted(primary), fallback: a && b ? this.toRouted(b) : null, timeoutMs: DEFAULT_CALL_TIMEOUT_S * 1000, creditCost: 3, errorThresholdPct: 2, failoverActive: false };
  }

  /** Model an agent is saved with (R-H): the text route's primary, or its fallback while the failover is active. */
  async agentModelId(): Promise<string> {
    const r = await this.route('text');
    return r.failoverActive && r.fallback ? r.fallback.id : r.primary.id;
  }

  // --- circuit breaker ----------------------------------------------------------------------------------------------------
  private k = (modelId: string, s: string) => `ai:cb:${modelId}:${s}`;
  async isOpen(modelId: string) {
    return (await this.redis.client.exists(this.k(modelId, 'open'))) === 1;
  }
  private async record(model: RoutedModel, ok: boolean, thresholdPct: number) {
    const c = this.redis.client;
    const total = await c.incr(this.k(model.id, 'total'));
    if (total === 1) await c.expire(this.k(model.id, 'total'), BREAKER_WINDOW_S);
    if (ok) return;
    const errors = await c.incr(this.k(model.id, 'err'));
    if (errors === 1) await c.expire(this.k(model.id, 'err'), BREAKER_WINDOW_S);
    if (total >= BREAKER_MIN_CALLS && (errors / total) * 100 > thresholdPct) {
      const opened = await c.set(this.k(model.id, 'open'), '1', 'EX', BREAKER_OPEN_S, 'NX');
      if (opened) {
        this.log.warn({ model: model.modelId, provider: model.provider, errors, total }, 'ai circuit breaker opened');
        this.ws.emit('admin:platform', 'platform.alert', { kind: 'ai_error_rate', payload: { provider: model.provider, model: model.modelId, errors, total } });
        // owner request 09/11: in the admins' bell too (one per model and hour)
        await this.admins.notify(prisma, { kind: 'alert_ai_errors', key: `alert_ai_errors:${model.id}:${new Date().toISOString().slice(0, 13)}`, params: { provider: model.provider, model: model.modelId, errors, total } }).catch((e) => this.log.warn({ err: String(e) }, 'admin notification failed'));
      }
    }
  }
  /** Test / admin helper: forget the breaker state of a model. */
  async resetBreaker(modelId: string) {
    await this.redis.client.del(this.k(modelId, 'open'), this.k(modelId, 'total'), this.k(modelId, 'err'));
  }

  /**
   * Runs `fn` on the route's first usable model, then once on the other one when the provider failed (§6 failure
   * classes). Throws the last `AiProviderError` when both failed. `only`: restrict to models passing the predicate.
   */
  async call<T>(capability: AiCapability, fn: (model: RoutedModel, timeoutMs: number) => Promise<T>, o: { only?: (m: RoutedModel) => boolean; prefer?: string | null } = {}): Promise<Routed<T>> {
    const route = await this.route(capability);
    const live = this.gateway.driver === 'live';
    let order = [route.primary, ...(route.fallback ? [route.fallback] : [])].filter((m) => !o.only || o.only(m));
    if (!order.length) throw new AppException('AGENT_MODEL_UNAVAILABLE');
    if (order.length === 2 && (route.failoverActive || (await this.isOpen(order[0]!.id)))) order = [order[1]!, order[0]!];
    // a run that already got an answer from one model stays on it for its next steps
    if (o.prefer && order.length === 2 && order[1]!.id === o.prefer) order = [order[1]!, order[0]!];
    let last: unknown;
    for (const model of order) {
      if (live && !model.ref.apiKey) {
        last = new AiProviderError('no_key', model.provider, `${model.provider} no_key`);
        continue;
      }
      try {
        const value = await fn(model, route.timeoutMs);
        await this.record(model, true, route.errorThresholdPct);
        return { value, model, usedFallback: model.id !== route.primary.id };
      } catch (e) {
        if (!(e instanceof AiProviderError)) throw e;
        last = e;
        await this.record(model, false, route.errorThresholdPct);
        this.log.warn({ provider: model.provider, model: model.modelId, kind: e.kind, status: e.status, detail: e.detail }, 'ai provider call failed');
        if (e.kind === 'provider_rejected') {
          this.ws.emit('admin:platform', 'platform.alert', { kind: 'provider_down', payload: { provider: model.provider, code: 'AI_PROVIDER_KEY_REJECTED' } });
          // a key the provider refuses (revoked, or a user key without its workspace): once per provider and hour
          await this.admins.notify(prisma, { kind: 'alert_ai_key', key: `alert_ai_key:${model.provider}:${new Date().toISOString().slice(0, 13)}`, params: { provider: model.provider, model: model.modelId } }).catch((err) => this.log.warn({ err: String(err) }, 'admin notification failed'));
        }
      }
    }
    throw last;
  }

  /** `GET /ai/routes`: capability → model label of the read-only model badge. */
  async badges() {
    const rows = await TenantContext.runSystem(() => prisma.aiRoute.findMany({ include: { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } }, orderBy: { capability: 'asc' } }));
    return rows.map((r) => {
      const m = r.failoverActive && r.fallbackModel ? r.fallbackModel : r.primaryModel;
      return { capability: r.capability, model: { id: m.id, label: m.displayName, provider: m.provider.displayName }, failover: r.failoverActive };
    });
  }
}
