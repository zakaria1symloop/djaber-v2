// 02 §6 / 04-ai-pipeline §7 — credits. `CreditLedger` is append-only and every row stores `balanceAfter`.
//   plan part  = rows `bucket = plan` of the current monthly credit period (opening `renewal` row, or the trial `grant`,
//                + grants − debits − open reservations); `monthlyCredits = -1` ⇒ unlimited
//   pack part  = rows `bucket = pack` (never expires; purchases arrive with billing in M9)
// A run reserves its planned cost at job start, then either settles it (debit + compensating un-reserve) or releases it.
// Every write is idempotent on `idempotencyKey` (`run:<id>:reserve|debit|unreserve|release`), so a retried job never
// debits twice. Callers must be inside the workspace's tenant context.
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { CREDIT_COST, type CreditLedgerRowDto, type CreditsCalculatorDto, type CreditsDto, type CreditsUpdatedEvent, type LedgerQuery } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type CreditAction, type CreditBucket, type Tx } from '@djaber/db';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { MetricsService } from '../../core/metrics/metrics.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { NotificationProducer } from '../notifications/notification.producer';

export type Balance = { periodStart: Date; periodEnd: Date; planLimit: number; planUsed: number; plan: number; pack: number; total: number; reserved: number; unlimited: boolean; exhausted: boolean };
export type SettleAction = Extract<CreditAction, 'text_reply' | 'image_recognition' | 'voice_transcription'>;
type RunRef = { id: string; workspaceId: string; agentId?: string | null; conversationId?: string | null; channelId?: string | null };

const DAY = 86_400_000;
/** `from` + n months, clamped to the month length (31 Jan + 1 month = 28/29 Feb). */
const addMonths = (from: Date, n: number) => {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + n, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(from.getUTCDate(), last));
  return d;
};
/** Monthly credit period containing `now`, anchored on the subscription's `currentPeriodStart` (02 §6). */
export const creditPeriod = (anchor: Date, now = new Date()): { start: Date; end: Date } => {
  if (anchor > now) return { start: anchor, end: addMonths(anchor, 1) };
  let n = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  while (n > 0 && addMonths(anchor, n) > now) n--;
  return { start: addMonths(anchor, n), end: addMonths(anchor, n + 1) };
};

@Injectable()
export class CreditService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-credit-periods', '0 0 * * *', () => this.openPeriods());
    this.registry.cron('sched-credits-exhausted-daily', '0 9 * * *', () => this.remindExhausted());
  }

  /** The per-workspace credits lock, for a caller that reads the balance before writing in the same transaction. */
  lockIn(tx: Tx, workspaceId: string) {
    return this.lock(tx, workspaceId);
  }
  private lock(tx: Tx, workspaceId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId} || ':credits', 0))`;
  }

  private async anchor(tx: Tx, workspaceId: string) {
    const sub = await tx.subscription.findFirst({ where: { workspaceId, status: { in: ['trial', 'active', 'dunning'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, currentPeriodStart: true } });
    if (sub) return { key: sub.id, trial: sub.status === 'trial', at: sub.currentPeriodStart };
    // expired / none ⇒ free plan: months anchored on the workspace creation day
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { createdAt: true } });
    return { key: `ws-${workspaceId}`, trial: false, at: ws.createdAt };
  }

  /**
   * Opens the current credit period when it has no opening row yet (`action = renewal`); a trial period is opened by its
   * `grant` row at sign-up. Returns the period and whether a row was written. Idempotent (`renewal:<sub>:<start>`).
   */
  async ensurePeriod(tx: Tx, workspaceId: string, monthlyCredits = TenantContext.get().limits.monthlyCredits, now = new Date()) {
    const a = await this.anchor(tx, workspaceId);
    const period = creditPeriod(a.at, now);
    let opened = false;
    if (monthlyCredits >= 0) {
      const first = period.start.getTime() === a.at.getTime();
      const has = await tx.creditLedger.findFirst({ where: { workspaceId, bucket: 'plan', periodStart: period.start, kind: 'credit', action: { in: a.trial && first ? ['renewal', 'grant'] : ['renewal'] } }, select: { id: true } });
      if (!has) {
        const pack = await this.sum(tx, workspaceId, { bucket: 'pack' });
        const r = await tx.creditLedger.createMany({
          data: [{ workspaceId, periodStart: period.start, bucket: 'plan', action: 'renewal', kind: 'credit', credits: monthlyCredits, balanceAfter: monthlyCredits + pack, reason: 'renewal', idempotencyKey: `renewal:${a.key}:${period.start.toISOString()}` }],
          skipDuplicates: true,
        });
        opened = r.count > 0;
      }
    }
    return { ...period, opened };
  }

  private async sum(tx: Tx, workspaceId: string, where: Prisma.CreditLedgerWhereInput) {
    const r = await tx.creditLedger.aggregate({ where: { workspaceId, ...where }, _sum: { credits: true } });
    return r._sum.credits ?? 0;
  }

  /** Balance inside a transaction (after `ensurePeriod`). */
  async balanceIn(tx: Tx, workspaceId: string, monthlyCredits = TenantContext.get().limits.monthlyCredits): Promise<Balance> {
    const period = await this.ensurePeriod(tx, workspaceId, monthlyCredits);
    const inPeriod = { bucket: 'plan' as CreditBucket, periodStart: period.start };
    const [planNet, planLimit, planDebits, pack, reservedRows, unreserved] = await Promise.all([
      this.sum(tx, workspaceId, inPeriod),
      this.sum(tx, workspaceId, { ...inPeriod, kind: 'credit' }),
      this.sum(tx, workspaceId, { ...inPeriod, kind: 'debit' }),
      this.sum(tx, workspaceId, { bucket: 'pack' }),
      this.sum(tx, workspaceId, { kind: 'reserved', OR: [{ periodStart: period.start }, { bucket: 'pack' }] }),
      this.sum(tx, workspaceId, { kind: 'release', OR: [{ periodStart: period.start }, { bucket: 'pack' }] }),
    ]);
    const unlimited = monthlyCredits < 0;
    const plan = unlimited ? Number.MAX_SAFE_INTEGER : planNet;
    const total = unlimited ? Number.MAX_SAFE_INTEGER : planNet + pack;
    return { periodStart: period.start, periodEnd: period.end, planLimit: unlimited ? -1 : planLimit, planUsed: 0 - planDebits, plan, pack, total, reserved: Math.max(0, -(reservedRows + unreserved)), unlimited, exhausted: !unlimited && total <= 0 };
  }

  balance(workspaceId: string = TenantContext.workspaceId()): Promise<Balance> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.lock(tx, workspaceId);
      return this.balanceIn(tx, workspaceId);
    });
  }

  private event(b: Balance): CreditsUpdatedEvent {
    return { planUsed: b.planUsed, planLimit: b.planLimit, packBalance: b.pack, exhausted: b.exhausted };
  }
  private async emit(tx: Tx, workspaceId: string, b: Balance, key: string) {
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'credits.updated', this.event(b) as unknown as Record<string, unknown>, `credits.updated:${key}`);
  }

  /** 03-events §5.1 `credits.exhausted`: Owner, once per day per workspace. */
  async notifyExhausted(tx: Tx, workspaceId: string, b: Pick<Balance, 'planUsed' | 'planLimit'>) {
    await this.notifications.emit(tx, { type: 'credits_exhausted', workspaceId, target: { owner: true }, key: `credits_exhausted:${workspaceId}:${algiersDay()}`, data: { used: b.planUsed, limit: b.planLimit } });
  }

  /**
   * Reserves `cost` credits for a run at job start. False when the balance (plan + packs) cannot cover it — nothing is
   * written then. A second call for the same run returns true without writing.
   */
  async reserve(run: RunRef, cost: number): Promise<boolean> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.lock(tx, run.workspaceId);
      if (await tx.creditLedger.findUnique({ where: { idempotencyKey: `run:${run.id}:reserve` }, select: { id: true } })) return true;
      const b = await this.balanceIn(tx, run.workspaceId);
      if (!b.unlimited && b.total < cost) return false;
      // D40: plan credits first, packs once the plan part cannot cover the turn
      const bucket: CreditBucket = b.unlimited || b.plan >= cost ? 'plan' : 'pack';
      await tx.creditLedger.create({
        data: { workspaceId: run.workspaceId, periodStart: bucket === 'plan' ? b.periodStart : null, bucket, action: 'reserve', kind: 'reserved', credits: -cost, balanceAfter: b.unlimited ? 0 : b.total - cost, aiRunId: run.id, agentId: run.agentId ?? null, conversationId: run.conversationId ?? null, channelId: run.channelId ?? null, idempotencyKey: `run:${run.id}:reserve` },
      });
      return true;
    });
  }

  /**
   * Turns the reservation of a run into a debit (`text_reply` | `image_recognition` | `voice_transcription`). Safe to call
   * twice; a run without an open reservation is left alone. Returns the credits charged by this call.
   * `amount` (≤ the reservation) charges less than what was reserved: a turn reserved for an image (5) whose photo
   * could not be analysed pays the text reply (1) only.
   */
  async settle(run: RunRef, action: SettleAction, o: { tx?: Tx; amount?: number } = {}): Promise<number> {
    const outer = o.tx;
    const work = async (tx: Tx) => {
      await this.lock(tx, run.workspaceId);
      const reserve = await tx.creditLedger.findUnique({ where: { idempotencyKey: `run:${run.id}:reserve` } });
      if (!reserve) return 0;
      const closed = await tx.creditLedger.findFirst({ where: { idempotencyKey: { in: [`run:${run.id}:debit`, `run:${run.id}:release`] } }, select: { id: true } });
      if (closed) return 0;
      const reserved = -reserve.credits;
      const cost = Math.max(0, Math.min(reserved, o.amount ?? reserved));
      const before = await this.balanceIn(tx, run.workspaceId);
      const base = { workspaceId: run.workspaceId, periodStart: reserve.periodStart, bucket: reserve.bucket, aiRunId: run.id, agentId: reserve.agentId, conversationId: reserve.conversationId, channelId: reserve.channelId };
      const total = before.unlimited ? 0 : before.total;
      await tx.creditLedger.create({ data: { ...base, action: 'release', kind: 'release', credits: reserved, balanceAfter: total + reserved, idempotencyKey: `run:${run.id}:unreserve` } });
      await tx.creditLedger.create({ data: { ...base, action, kind: 'debit', credits: -cost, balanceAfter: total + reserved - cost, idempotencyKey: `run:${run.id}:debit` } });
      this.metrics?.creditsDebited.inc(cost);
      await tx.aiRun.updateMany({ where: { id: run.id }, data: { creditsCharged: cost } });
      const after = await this.balanceIn(tx, run.workspaceId);
      await this.emit(tx, run.workspaceId, after, `${run.id}:debit`);
      if (!after.unlimited && after.planLimit > 0) {
        const was = before.planUsed / after.planLimit;
        const is = after.planUsed / after.planLimit;
        // once per credit period (the key carries the period)
        if (was < 0.8 && is >= 0.8) await this.notifications.emit(tx, { type: 'credits_80', workspaceId: run.workspaceId, key: `credits_80:${run.workspaceId}:${after.periodStart.toISOString()}`, data: { used: after.planUsed, limit: after.planLimit } });
      }
      if (after.exhausted) await this.notifyExhausted(tx, run.workspaceId, after);
      return cost;
    };
    return outer ? work(outer) : prisma.$transaction((db) => work(db as Tx));
  }

  /** Gives the reservation of a run back (provider error, malformed output, aborted or reaped run). Safe to call twice. */
  async release(run: Pick<RunRef, 'id' | 'workspaceId'>, outer?: Tx): Promise<number> {
    const work = async (tx: Tx) => {
      await this.lock(tx, run.workspaceId);
      const reserve = await tx.creditLedger.findUnique({ where: { idempotencyKey: `run:${run.id}:reserve` } });
      if (!reserve) return 0;
      const closed = await tx.creditLedger.findFirst({ where: { idempotencyKey: { in: [`run:${run.id}:debit`, `run:${run.id}:release`] } }, select: { id: true } });
      if (closed) return 0;
      const cost = -reserve.credits;
      const b = await this.balanceIn(tx, run.workspaceId);
      await tx.creditLedger.create({
        data: { workspaceId: run.workspaceId, periodStart: reserve.periodStart, bucket: reserve.bucket, action: 'release', kind: 'release', credits: cost, balanceAfter: b.unlimited ? 0 : b.total + cost, aiRunId: run.id, agentId: reserve.agentId, conversationId: reserve.conversationId, channelId: reserve.channelId, idempotencyKey: `run:${run.id}:release` },
      });
      return cost;
    };
    return outer ? work(outer) : prisma.$transaction((db) => work(db as Tx));
  }

  /**
   * Adds credits to the plan part of the current period (`action = grant`): admin grants (M10), promo codes (M9) and the
   * development top-up. Idempotent on `key`.
   */
  async grant(workspaceId: string, credits: number, o: { key: string; reason: string; grantedById?: string | null; bucket?: CreditBucket }): Promise<Balance> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.lock(tx, workspaceId);
      const b = await this.balanceIn(tx, workspaceId);
      const bucket = o.bucket ?? 'plan';
      if (!(await tx.creditLedger.findUnique({ where: { idempotencyKey: o.key }, select: { id: true } }))) {
        await tx.creditLedger.create({
          data: { workspaceId, periodStart: bucket === 'plan' ? b.periodStart : null, bucket, action: credits >= 0 ? 'grant' : 'adjustment', kind: credits >= 0 ? 'credit' : 'debit', credits, balanceAfter: (b.unlimited ? 0 : b.total) + credits, reason: o.reason, grantedById: o.grantedById ?? null, idempotencyKey: o.key },
        });
      }
      const after = await this.balanceIn(tx, workspaceId);
      await this.emit(tx, workspaceId, after, o.key);
      return after;
    });
  }

  /**
   * One ledger row inside the caller's transaction (M9: pack purchase `pack_purchase`, store refund `store_refund`, promo /
   * upgrade / admin `grant`). Idempotent on `key`; emits `credits.updated`. `monthlyCredits` = the plan that applies when
   * it just changed in this transaction (the tenant context still holds the old limits).
   */
  async writeIn(
    tx: Tx,
    workspaceId: string,
    row: { bucket: CreditBucket; action: CreditAction; credits: number; key: string; reason?: string | null; grantedById?: string | null; creditPackPurchaseId?: string | null },
    o: { monthlyCredits?: number } = {},
  ): Promise<{ balance: Balance; entryId: string; created: boolean }> {
    await this.lock(tx, workspaceId);
    const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: row.key }, select: { id: true } });
    if (existing) return { balance: await this.balanceIn(tx, workspaceId, o.monthlyCredits), entryId: existing.id, created: false };
    const b = await this.balanceIn(tx, workspaceId, o.monthlyCredits);
    const entry = await tx.creditLedger.create({
      data: {
        workspaceId,
        periodStart: row.bucket === 'plan' ? b.periodStart : null,
        bucket: row.bucket,
        action: row.action,
        kind: row.credits >= 0 ? 'credit' : 'debit',
        credits: row.credits,
        balanceAfter: (b.unlimited ? 0 : b.total) + row.credits,
        reason: row.reason ?? null,
        grantedById: row.grantedById ?? null,
        creditPackPurchaseId: row.creditPackPurchaseId ?? null,
        idempotencyKey: row.key,
      },
    });
    const after = await this.balanceIn(tx, workspaceId, o.monthlyCredits);
    await this.emit(tx, workspaceId, after, row.key);
    return { balance: after, entryId: entry.id, created: true };
  }

  // --- conversation quota (02 §5 `maxConversationsPerMonth`, same monthly period) ------------------------------------------
  /** Conversations with a customer message in the current period; `-1` = unlimited. */
  async quota(workspaceId: string = TenantContext.workspaceId()): Promise<{ used: number; limit: number; exceeded: boolean; periodStart: Date }> {
    const limit = TenantContext.get().limits.maxConversationsPerMonth;
    const period = await prisma.$transaction((db) => this.anchor(db as Tx, workspaceId)).then((a) => creditPeriod(a.at));
    const used = await prisma.conversation.count({ where: { workspaceId, lastCustomerMessageAt: { gte: period.start } } });
    return { used, limit, exceeded: limit >= 0 && used > limit, periodStart: period.start };
  }

  // --- reads (HTTP) ---------------------------------------------------------------------------------------------------------
  /** `GET /credits` (also the header pill). */
  async summary(): Promise<CreditsDto> {
    const workspaceId = TenantContext.workspaceId();
    const b = await this.balance(workspaceId);
    const since = new Date(Date.now() - 7 * DAY);
    const week = await prisma.creditLedger.aggregate({ where: { workspaceId, kind: 'debit', createdAt: { gte: since } }, _sum: { credits: true } });
    const burn = Math.round((-(week._sum.credits ?? 0) / 7) * 10) / 10;
    const pricing = await TenantContext.runSystem(() => prisma.creditPricing.findFirst({ where: { effectiveAt: { lte: new Date() } }, orderBy: { version: 'desc' } }));
    const pack = await TenantContext.runSystem(() => prisma.creditPack.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }).catch(() => null));
    return {
      plan: { used: b.planUsed, limit: b.planLimit, remaining: b.unlimited ? -1 : Math.max(0, b.plan), periodStart: b.periodStart.toISOString(), periodEnd: b.periodEnd.toISOString() },
      packs: { remaining: Math.max(0, b.pack) },
      total: b.unlimited ? -1 : b.total,
      reserved: b.reserved,
      negative: !b.unlimited && b.total < 0,
      exhausted: b.exhausted,
      burnRatePerDay: burn,
      exhaustedEta: !b.unlimited && burn > 0 && b.total > 0 ? new Date(Date.now() + (b.total / burn) * DAY).toISOString() : null,
      pricePerCreditDzd: pricing ? Number(pricing.creditPriceDzd) : 0,
      packPricePerCreditDzd: pack && pack.credits > 0 ? Math.round((pack.priceWebDzd / pack.credits) * 100) / 100 : null,
    };
  }

  /** `GET /credits/ledger` — reservations and their compensations are bookkeeping: the list shows credits and debits. */
  async ledger(q: LedgerQuery): Promise<Page<CreditLedgerRowDto>> {
    const where: Prisma.CreditLedgerWhereInput = {
      workspaceId: TenantContext.workspaceId(),
      kind: { in: ['credit', 'debit'] },
      ...(q.action?.length ? { action: { in: q.action } } : {}),
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...(q.bucket ? { bucket: q.bucket } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: algiersDayStart(q.from) } : {}), ...(q.to ? { lt: algiersDayEnd(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([prisma.creditLedger.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }), prisma.creditLedger.count({ where })]);
    const agentIds = [...new Set(rows.map((r) => r.agentId).filter((x): x is string => !!x))];
    const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, status: true } }) : [];
    const byId = new Map(agents.map((a) => [a.id, a]));
    return page(
      rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), action: r.action, kind: r.kind, bucket: r.bucket, credits: r.credits, balanceAfter: r.balanceAfter, detail: r.reason ?? r.action, agent: r.agentId ? (byId.get(r.agentId) ?? null) : null, conversationId: r.conversationId, aiRunId: r.aiRunId })),
      total,
      q,
    );
  }

  /**
   * `GET /credits/calculator` (V1 modal, PCK-05). AT-PCK-04 fixes the formula: every AI message costs the text credit, a
   * conversation with a photo adds the image cost, one with a voice note adds the voice cost
   * (1 200 conv × 4 msgs, 15 % photo, 8 % voice ⇒ 4 800 + 180 × 5 + 96 × 3 = 5 988 credits). Suggestion: the cheapest plan
   * whose monthly credits cover the estimate, else the largest plan + the fewest packs covering the rest (one pack when a
   * single pack is enough — the smallest such pack).
   */
  async calculator(q: { conversations: number; photoPct: number; voicePct: number; msgsPerConv: number }): Promise<CreditsCalculatorDto> {
    const textTurns = Math.round(q.conversations * q.msgsPerConv);
    const imageTurns = Math.round(q.conversations * (q.photoPct / 100));
    const voiceTurns = Math.round(q.conversations * (q.voicePct / 100));
    const credits = textTurns * CREDIT_COST.text + imageTurns * CREDIT_COST.image + voiceTurns * CREDIT_COST.voice;
    const [pricing, plans, packs] = await TenantContext.runSystem(() =>
      Promise.all([
        prisma.creditPricing.findFirst({ where: { effectiveAt: { lte: new Date() } }, orderBy: { version: 'desc' } }),
        prisma.plan.findMany({ where: { isActive: true, isVisible: true, archivedAt: null }, orderBy: [{ priceMonthly: 'asc' }, { sortOrder: 'asc' }] }),
        prisma.creditPack.findMany({ where: { isActive: true, visibleWeb: true }, orderBy: [{ credits: 'asc' }] }),
      ]),
    );
    const locale = TenantContext.maybe()?.locale ?? 'fr';
    const pick = (v: unknown) => (v && typeof v === 'object' ? String((v as Record<string, string>)[locale] ?? (v as Record<string, string>).fr ?? '') : String(v ?? ''));
    const rows = plans.map((p) => ({ planId: p.id, slug: p.slug, name: pick(p.name), monthlyCredits: p.monthlyCredits, priceMonthly: p.priceMonthly, coversPct: p.monthlyCredits < 0 ? 100 : credits === 0 ? 100 : Math.min(100, Math.round((p.monthlyCredits / credits) * 1000) / 10), missingCredits: p.monthlyCredits < 0 ? 0 : Math.max(0, credits - p.monthlyCredits) }));
    let suggestion: CreditsCalculatorDto['suggestion'] = null;
    const covering = rows.find((r) => r.missingCredits === 0);
    const top = rows.filter((r) => r.monthlyCredits >= 0).sort((a, b) => b.monthlyCredits - a.monthlyCredits)[0];
    const chosen = covering ?? top;
    if (chosen) {
      const missing = chosen.missingCredits;
      const chosenPacks: NonNullable<CreditsCalculatorDto['suggestion']>['packs'] = [];
      if (missing > 0 && packs.length) {
        const single = packs.find((p) => p.credits >= missing);
        if (single) chosenPacks.push({ packId: single.id, slug: single.slug, name: pick(single.name), credits: single.credits, quantity: 1, priceWebDzd: single.priceWebDzd });
        else {
          const biggest = packs[packs.length - 1]!;
          chosenPacks.push({ packId: biggest.id, slug: biggest.slug, name: pick(biggest.name), credits: biggest.credits, quantity: Math.ceil(missing / biggest.credits), priceWebDzd: biggest.priceWebDzd });
        }
      }
      suggestion = { planId: chosen.planId, planSlug: chosen.slug, planName: chosen.name, packs: chosenPacks, totalMonthlyDzd: chosen.priceMonthly + chosenPacks.reduce((n, p) => n + p.priceWebDzd * p.quantity, 0) };
    }
    return { conversations: q.conversations, textTurns, imageTurns, voiceTurns, credits, estimatedCostDzd: Math.round(credits * (pricing ? Number(pricing.creditPriceDzd) : 0)), plans: rows, suggestion };
  }

  // --- scheduled ------------------------------------------------------------------------------------------------------------
  private async eachWorkspace(fn: (workspaceId: string) => Promise<unknown>) {
    const rows = await TenantContext.runSystem(() => prisma.workspace.findMany({ where: { deletedAt: null, status: { not: 'deletion_scheduled' } }, select: { id: true } }));
    let n = 0;
    for (const ws of rows) {
      const tenant = await this.tenants.forWorker(ws.id).catch(() => null);
      if (!tenant) continue;
      if (await TenantContext.run(tenant, () => fn(ws.id))) n++;
    }
    return n;
  }

  /** `sched-credit-periods` (00:00 Africa/Algiers): opens the new period of every workspace whose period day is today. */
  openPeriods() {
    return this.eachWorkspace((workspaceId) =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await this.lock(tx, workspaceId);
        const p = await this.ensurePeriod(tx, workspaceId);
        if (p.opened) await this.emit(tx, workspaceId, await this.balanceIn(tx, workspaceId), `renewal:${p.start.toISOString()}`);
        return p.opened;
      }),
    );
  }

  /** `sched-credits-exhausted-daily` (09:00): Owner reminded once a day while the balance is 0. */
  remindExhausted() {
    return this.eachWorkspace((workspaceId) =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await this.lock(tx, workspaceId);
        const b = await this.balanceIn(tx, workspaceId);
        if (b.exhausted) await this.notifyExhausted(tx, workspaceId, b);
        return b.exhausted;
      }),
    );
  }
}
