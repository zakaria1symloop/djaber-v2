// System messages (11 §9.1, D43) and onboarding (ONB-01 / ONB-02).
import { Injectable } from '@nestjs/common';
import { DEFAULT_SYSTEM_MESSAGES, prisma, TenantContext, type Localized } from '@djaber/db';
import { notFound, validationError } from '../../core/errors/app.exception';
import { SYSTEM_MESSAGE_KEYS, type SystemMessageKey, type SystemMessagesInput } from './dto';

type SystemMessages = Record<SystemMessageKey, Localized>;
const LOCALES = ['fr', 'ar', 'en'] as const;

@Injectable()
export class SystemMessagesService {
  private async workspace() {
    const ws = await prisma.workspace.findFirst({ where: { id: TenantContext.workspaceId(), deletedAt: null } });
    if (!ws) throw notFound();
    return ws;
  }

  /** Stored value completed with the defaults: always exactly 4 keys × 3 locales. */
  static complete(stored: unknown): SystemMessages {
    const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, Record<string, unknown>>;
    const out = {} as SystemMessages;
    for (const key of SYSTEM_MESSAGE_KEYS) {
      out[key] = { ...DEFAULT_SYSTEM_MESSAGES[key] };
      for (const l of LOCALES) {
        const v = s[key]?.[l];
        if (typeof v === 'string') out[key][l] = v;
      }
    }
    return out;
  }

  async get() {
    return SystemMessagesService.complete((await this.workspace()).systemMessages);
  }

  /**
   * `PUT /workspace/system-messages` — the keys and locales present in the body replace the stored ones.
   * Only `welcome` may be empty (empty ⇒ not sent); an empty text elsewhere falls back to the default.
   */
  async put(input: SystemMessagesInput) {
    // full-test 15/11 SETTINGS-02: a variable is matched whatever its case ({PRODUCT} ⇒ {product}); an unknown one is refused
    // inline — it reached customers raw (« Désolé, {PRODUCT} est épuisé … {inconnu} »)
    const fields: Record<string, string> = {};
    for (const key of SYSTEM_MESSAGE_KEYS) {
      const allowed = key === 'out_of_stock' ? ['product', 'shop'] : ['shop'];
      for (const l of LOCALES) {
        const v = input[key]?.[l];
        if (v === undefined) continue;
        const fixed = v.replace(/\{\s*([a-zA-Z_]+)\s*\}/g, (m, name: string) => (allowed.includes(name.toLowerCase()) ? `{${name.toLowerCase()}}` : m));
        if (/\{[^}]*\}/.test(allowed.reduce((t, n) => t.split(`{${n}}`).join(''), fixed))) fields[`${key}.${l}`] = 'validation.invalid';
        (input[key] as Record<string, string>)[l] = fixed;
      }
    }
    if (Object.keys(fields).length) throw validationError(fields);
    const ws = await this.workspace();
    const next = SystemMessagesService.complete(ws.systemMessages);
    for (const key of SYSTEM_MESSAGE_KEYS) {
      for (const l of LOCALES) {
        const v = input[key]?.[l];
        if (v === undefined) continue;
        next[key][l] = v === '' && key !== 'welcome' ? DEFAULT_SYSTEM_MESSAGES[key][l] : v;
      }
    }
    await prisma.workspace.update({ where: { id: ws.id }, data: { systemMessages: next } });
    return next;
  }

  /** "Réinitialiser": restores the 3 default locales of one key. */
  async reset(key: SystemMessageKey) {
    const ws = await this.workspace();
    const next = SystemMessagesService.complete(ws.systemMessages);
    next[key] = { ...DEFAULT_SYSTEM_MESSAGES[key] };
    await prisma.workspace.update({ where: { id: ws.id }, data: { systemMessages: next } });
    return next;
  }
}

@Injectable()
export class OnboardingService {
  /**
   * ONB-02 "Démarrer" checklist, computed from real rows on every call (never stored):
   * ≥ 1 active channel · ≥ 1 active product · ≥ 1 active agent linked to a channel · ≥ 1 delivered order or completed sale.
   */
  async get() {
    const ws = await prisma.workspace.findFirst({ where: { id: TenantContext.workspaceId(), deletedAt: null } });
    if (!ws) throw notFound();
    const [channels, products, agents, orders, sales] = await Promise.all([
      prisma.channel.count({ where: { status: 'active' } }),
      prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      prisma.agent.count({ where: { status: 'active', deletedAt: null, channels: { some: {} } } }),
      prisma.order.count({ where: { status: 'delivered' } }),
      prisma.sale.count({ where: { status: 'completed' } }),
    ]);
    const checklist = { channel: channels > 0, product: products > 0, agent: agents > 0, order: orders + sales > 0 };
    return {
      step: ws.onboardingStep,
      checklist,
      done: Object.values(checklist).filter(Boolean).length,
      total: 4,
    };
  }

  /** `PATCH /workspace/onboarding { step }` — resumable tunnel (1–6), 99 = skipped. */
  async setStep(step: number) {
    const id = TenantContext.workspaceId();
    await prisma.workspace.update({ where: { id }, data: { onboardingStep: step } });
    return this.get();
  }
}
