// AI-07 / 04-ai-pipeline §9 "Voice" — `media / transcribe` (job id `stt:<messageId>`), scheduled when the audio file of a
// customer voice note is in our storage. Groq `whisper-large-v3-turbo`, OpenAI `whisper-1` on error (inside one attempt).
// Success ⇒ `Message.transcript` and the reply job is released at once; failure of both ⇒ FL-01 F-5: the fixed text
// `voiceFailed` once per conversation per 24 h and no credits. Safe to run twice (`transcriptStatus`).
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { BatchingService } from '../messaging/batching.service';
import { attachmentsOf } from '../messaging/messaging.presenter';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from './ai.constants';
import { AI_GATEWAY, AiProviderError, type AiGateway } from './provider/ai.gateway';
import { RoutingService } from './routing.service';

type TranscribeJob = { workspaceId: string; messageId: string };
export type TranscribeOutcome = 'done' | 'failed' | 'too_long' | 'noop';

/** The languages a customer of an Algerian shop speaks in a voice note (provider names or ISO codes); unknown ⇒ trusted. */
export const spokenHere = (language: string | null | undefined): boolean => !language || /^(ar|fr|en|arabic|french|english)$/i.test(language.trim());

@Injectable()
export class TranscriptionService implements OnModuleInit {
  private readonly log = new Logger(TranscriptionService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly outbound: OutboundSendService,
    private readonly batching: BatchingService,
  ) {}

  onModuleInit() {
    this.registry.register('media', 'transcribe', (d: TranscribeJob) => this.process(d), { concurrency: 4 });
  }

  /** Transcribes an audio buffer through the transcription route (primary, then fallback). */
  async transcribe(audio: Buffer, mime: string) {
    const r = await this.routing.call('transcription', (m, timeoutMs) => this.gateway.transcribe({ model: m.ref, audio, mime, timeoutMs }));
    // owner 23/11 (« voice didn't work »): a 3-second darija voice note came back as « Azerbaijani » gibberish — the model guesses the
    // language of short Algerian audio badly. A guess outside the languages customers speak here is transcribed again as Arabic.
    if (!spokenHere(r.value.language)) {
      const again = await this.routing.call('transcription', (m, timeoutMs) => this.gateway.transcribe({ model: m.ref, audio, mime, timeoutMs, language: 'ar' })).catch(() => null);
      if (again?.value.text.trim()) return { ...again.value, language: 'ar', model: again.model, usedFallback: again.usedFallback };
    }
    return { ...r.value, model: r.model, usedFallback: r.usedFallback };
  }

  async process(d: TranscribeJob): Promise<TranscribeOutcome> {
    const tenant = await this.tenants.forWorker(d.workspaceId);
    return TenantContext.run(tenant, async () => {
      const m = await prisma.message.findFirst({ where: { id: d.messageId }, include: { conversation: true } });
      if (!m || m.direction !== 'in' || (m.transcriptStatus && m.transcriptStatus !== 'pending')) return 'noop';
      const conv = m.conversation;
      const link = await prisma.agentChannel.findUnique({ where: { channelId: conv.channelId }, include: { agent: true } });
      const agent = link?.agent;
      // nobody will answer this voice note with the AI: nothing to transcribe
      if (!agent || agent.status !== 'active' || agent.deletedAt || !agent.voiceTranscription || conv.status === 'needs_human' || conv.aiPaused) return 'noop';
      const audio = attachmentsOf(m).find((a) => a.type === 'audio');
      if (!audio) return 'noop';

      let outcome: TranscribeOutcome = 'failed';
      let transcript: string | null = null;
      if (audio.storageKey && !audio.error) {
        try {
          const file = await this.storage.get(audio.storageKey);
          if (file.body.length > VOICE_MAX_BYTES) outcome = 'too_long';
          else {
            const r = await this.transcribe(file.body, file.mime || audio.mime || 'audio/mp4');
            if ((r.durationSec ?? 0) > VOICE_MAX_SECONDS) outcome = 'too_long';
            else if (r.text.trim()) {
              transcript = r.text.trim().slice(0, 4000);
              outcome = 'done';
            }
          }
        } catch (e) {
          if (!(e instanceof AiProviderError)) this.log.warn({ messageId: m.id, err: e instanceof Error ? e.message : String(e) }, 'voice note unreadable');
        }
      }

      const stored = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const r = await tx.message.updateMany({ where: { id: m.id, OR: [{ transcriptStatus: null }, { transcriptStatus: 'pending' }] }, data: { transcript, transcriptStatus: outcome === 'done' ? 'done' : outcome === 'too_long' ? 'too_long' : 'failed' } });
        if (!r.count) return false;
        await this.outbox.ws(tx, `ws:${d.workspaceId}`, 'message.updated', { id: m.id, conversationId: m.conversationId, messageId: m.id, deliveryStatus: m.deliveryStatus, transcript, transcriptStatus: outcome === 'done' ? 'done' : outcome }, `message.updated:${m.id}:stt`);
        // F-5 / "> 2 min": fixed platform texts, once per conversation per 24 h, never charged
        if (outcome === 'failed') await this.outbound.sendSystemText(conv.id, 'voiceFailed', {}, { tx, oncePer24h: true });
        if (outcome === 'too_long') await this.outbound.sendSystemText(conv.id, 'unsupportedMedia', {}, { tx, oncePer24h: true });
        return true;
      });
      if (!stored) return 'noop';
      // the reply job was parked for the transcript (≤ 30 s): release it now
      // (a failed voice note without text leaves nothing to answer: the reply job ends on its own)
      await this.batching.schedule({ workspaceId: d.workspaceId, conversationId: conv.id, messageId: m.id, delaySec: 0 });
      return outcome;
    });
  }
}
