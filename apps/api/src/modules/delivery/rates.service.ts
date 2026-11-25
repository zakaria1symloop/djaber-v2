// DLV-07 / 05-integrations §2.7 — courier live rates: informational (send dialog, margin analytics; the customer fee
// stays the merchant grid, D15). Cached 1 h in `CourierRateCache`; a missing or stale cache is refreshed by the worker
// (`courier.fetch-rates`, no courier call from the HTTP handler). "Copier les tarifs du transporteur dans ma grille"
// overwrites `homePrice / stopdeskPrice` of the chosen wilayas from the cache and returns the diff (dry run first).
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ALL_WILAYA_IDS, COURIER_WILAYA_COUNT, courierWilayaId, WILAYA_COUNT, WILAYA_PARENT, wilayasOfCourierCode, type CopyFeesDiffView, type CopyFeesFromCourierInput, type CourierRatesView } from '@djaber/shared';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { notFound } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { OutboxService } from '../../core/outbox/outbox.service';
import { CourierAdapters } from './adapters/courier-registry';
import { isCourierError } from './adapters/courier-adapter';
import { normalizeRaw } from './adapters/status-maps';
import { CourierAccountService } from './courier-account.service';
import { CourierLimiter } from './courier-limiter';
import { RedisService } from '../../core/redis/redis.provider';

const TTL_MS = 3_600_000;
/**
 * UX-101 (courier audit 25/11): ZR refused its price list (HTTP 400) and « Copier depuis un transporteur » stayed on
 * « Récupération des tarifs… » for ever, because a failed fetch left no trace. A failed or empty fetch is now remembered
 * for this long: the screens stop waiting and say the courier gave nothing; a new try is queued once it is over.
 */
const FAILED_TTL_S = 600;
const failedKey = (courierAccountId: string) => `rates:failed:${courierAccountId}`;

type Rate = { wilayaId: number; home: number | null; stopdesk: number | null };
/**
 * Couriers price the 58 historical wilaya codes: a wilaya of loi 26-06 (59–69) the courier does not list takes the rate
 * of its parent wilaya (the code it is shipped under, see `courierWilayaId`). A rate the courier gives for 59–69 wins.
 */
export const expandCourierRates = (rates: Rate[]): Rate[] => {
  const by = new Map(rates.map((r) => [r.wilayaId, r]));
  const extra = Object.entries(WILAYA_PARENT).flatMap(([id, parent]) => {
    const p = by.get(parent);
    return by.has(Number(id)) || !p ? [] : [{ wilayaId: Number(id), home: p.home, stopdesk: p.stopdesk }];
  });
  return [...rates, ...extra];
};

/**
 * Live ZR price list 25/11: Illizi, Tindouf, Bordj Badji Mokhtar and Djanet come back « home 0 DA, pickup 10 DA » — the
 * courier's way of writing a wilaya it does not serve. A price of 0 is not a price, and a row whose home price is 0 is not
 * served at all: copied as it is, it would have made the delivery free in the merchant's grid.
 */
export const realRate = <T extends { home: number | null; stopdesk: number | null }>(r: T): T =>
  r.home === 0 ? { ...r, home: null, stopdesk: null } : { ...r, home: r.home !== null && r.home > 0 ? r.home : null, stopdesk: r.stopdesk !== null && r.stopdesk > 0 ? r.stopdesk : null };

@Injectable()
export class RatesService implements OnModuleInit {
  constructor(
    private readonly accounts: CourierAccountService,
    private readonly adapters: CourierAdapters,
    private readonly limiter: CourierLimiter,
    private readonly queueOutbox: QueueOutbox,
    private readonly outbox: OutboxService,
    private readonly registry: ProcessorRegistry,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private async failed(courierAccountId: string): Promise<boolean> {
    return (await this.redis.client.exists(failedKey(courierAccountId))) === 1;
  }

  onModuleInit() {
    this.registry.register('courier', 'fetch-rates', (data: { courierAccountId: string; workspaceId: string }) => this.fetch(data), { concurrency: 2 });
    this.registry.register('courier', 'fetch-stopdesks', (data: { courierAccountId: string; workspaceId: string }) => this.fetchStopdesks(data), { concurrency: 1 });
  }

  /**
   * DLV-09 stop-desks of a provider (Yalidine `centers`) → `CourierStopdesk` (platform reference data, shared by every
   * workspace; read by `GET /delivery/stopdesks`). Communes matched by name inside the wilaya. Run when an account of a
   * provider with stop-desks is created.
   */
  async fetchStopdesks(data: { courierAccountId: string; workspaceId: string }) {
    await TenantContext.runAs(data.workspaceId, async () => {
      const a = await prisma.courierAccount.findFirst({ where: { id: data.courierAccountId } });
      if (!a) return;
      const adapter = this.adapters.get(a.provider, a.baseUrl);
      if (!adapter.listStopdesks) return;
      const creds = this.accounts.open(a);
      const norm = (s: string) => normalizeRaw(s);
      // the courier lists its centres under the 58 historical codes; a centre may sit in a wilaya carved out of it
      for (let w = 1; w <= COURIER_WILAYA_COUNT; w++) {
        await this.limiter.take(a.id, 'other');
        let desks;
        try {
          desks = await adapter.listStopdesks(creds, w);
        } catch (e) {
          if (isCourierError(e) && e.kind !== 'unavailable') return;
          throw e;
        }
        if (!desks.length) continue;
        // ordered: a centre whose commune name matches none falls back to the first commune of the wilaya — the same one every sync
        const communes = await prisma.commune.findMany({ where: { wilayaId: { in: wilayasOfCourierCode(w) } }, select: { id: true, nameFr: true }, orderBy: { id: 'asc' } });
        const byName = new Map(communes.map((c) => [norm(c.nameFr), c.id]));
        for (const d of desks) {
          const communeId = byName.get(norm(d.communeName)) ?? communes[0]?.id;
          if (!communeId) continue;
          await prisma.courierStopdesk.upsert({
            where: { provider_externalId: { provider: a.provider, externalId: d.id } },
            create: { provider: a.provider, externalId: d.id, name: d.name, address: d.address ?? null, communeId },
            update: { name: d.name, address: d.address ?? null, communeId },
          });
        }
      }
    });
  }

  private async refresh(courierAccountId: string) {
    // one try per failure window: a fetch that failed can be tried again without waiting for the hour
    const bucket = Math.floor(Date.now() / (FAILED_TTL_S * 1000));
    await prisma.$transaction((db) => this.queueOutbox.add(db as Tx, 'courier', 'fetch-rates', { courierAccountId, workspaceId: TenantContext.workspaceId() }, `rates:${courierAccountId}:${bucket}`, { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } }));
  }

  /** `GET /delivery/rates?courierAccountId&wilayaId?&stopdesk?`. */
  async get(q: { courierAccountId: string; wilayaId?: number; stopdesk?: boolean }): Promise<CourierRatesView> {
    const a = await prisma.courierAccount.findFirst({ where: { id: q.courierAccountId } });
    if (!a) throw notFound();
    const supported = this.adapters.get(a.provider, a.baseUrl).capabilities.rates;
    const rows = supported ? await prisma.courierRateCache.findMany({ where: { courierAccountId: a.id, ...(q.wilayaId ? { wilayaId: q.wilayaId } : {}) }, orderBy: { wilayaId: 'asc' } }) : [];
    const fetchedAt = rows.length ? new Date(Math.min(...rows.map((r) => r.fetchedAt.getTime()))) : null;
    const stale = supported && (!fetchedAt || Date.now() - fetchedAt.getTime() > TTL_MS || (!q.wilayaId && rows.length < WILAYA_COUNT));
    const failed = stale && (await this.failed(a.id));
    if (stale && !failed) await this.refresh(a.id);
    return {
      courierAccountId: a.id,
      provider: a.provider,
      rates: rows.map((r) => {
        const real = realRate({ home: r.homePrice, stopdesk: r.stopdeskPrice });
        return { wilayaId: r.wilayaId, homePrice: real.home, stopdeskPrice: real.stopdesk, price: q.stopdesk ? real.stopdesk : real.home, fetchedAt: r.fetchedAt.toISOString() };
      }),
      fetchedAt: fetchedAt?.toISOString() ?? null,
      stale,
      refreshing: stale && !failed,
      supported,
      ...(failed ? { failed: true } : {}),
    };
  }

  /** `courier.fetch-rates`: ZR Express in one call (`tarification`), Yalidine one call per wilaya (limited), cached 1 h. */
  async fetch(data: { courierAccountId: string; workspaceId: string }) {
    await TenantContext.runAs(data.workspaceId, async () => {
      const a = await prisma.courierAccount.findFirst({ where: { id: data.courierAccountId } });
      if (!a) return;
      const adapter = this.adapters.get(a.provider, a.baseUrl);
      const creds = this.accounts.open(a);
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { senderWilayaId: true } });
      const from = courierWilayaId(a.senderWilayaId ?? ws.senderWilayaId ?? 16);
      let rates: Rate[] = [];
      try {
        if (adapter.getAllRates) {
          await this.limiter.take(a.id, 'other');
          rates = await adapter.getAllRates(creds, from);
        } else if (adapter.getRates) {
          for (let w = 1; w <= COURIER_WILAYA_COUNT; w++) {
            await this.limiter.take(a.id, 'other');
            const r = await adapter.getRates(creds, from, w);
            if (r) rates.push({ wilayaId: w, home: r.home, stopdesk: r.stopdesk });
          }
        }
      } catch (e) {
        await this.redis.client.set(failedKey(a.id), isCourierError(e) ? e.kind : 'error', 'EX', FAILED_TTL_S);
        if (isCourierError(e) && e.kind !== 'unavailable') return;
        throw e;
      }
      rates = expandCourierRates(rates.map(realRate));
      if (!rates.length) {
        // the courier answered with no price at all: nothing to wait for either
        await this.redis.client.set(failedKey(a.id), 'empty', 'EX', FAILED_TTL_S);
        return;
      }
      await this.redis.client.del(failedKey(a.id));
      const now = new Date();
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        for (const r of rates) {
          await tx.courierRateCache.upsert({
            where: { courierAccountId_wilayaId: { courierAccountId: a.id, wilayaId: r.wilayaId } },
            create: { courierAccountId: a.id, wilayaId: r.wilayaId, homePrice: r.home, stopdeskPrice: r.stopdesk, fetchedAt: now },
            update: { homePrice: r.home, stopdeskPrice: r.stopdesk, fetchedAt: now },
          });
        }
        await this.outbox.ws(tx, `ws:${a.workspaceId}`, 'courier.updated', { id: a.id, reason: 'rates' }, `courier.updated:${a.id}:rates:${now.getTime()}`);
      });
    });
  }

  /** `POST /delivery/fees/copy-from-courier { courierAccountId, wilayaIds?, dryRun? }` (`delivery.manage`, audited). */
  async copyToGrid(input: CopyFeesFromCourierInput): Promise<CopyFeesDiffView> {
    const a = await prisma.courierAccount.findFirst({ where: { id: input.courierAccountId } });
    if (!a) throw notFound();
    const wanted = input.wilayaIds?.length ? input.wilayaIds : [...ALL_WILAYA_IDS];
    const [cache, rules, wilayas] = await Promise.all([
      prisma.courierRateCache.findMany({ where: { courierAccountId: a.id, wilayaId: { in: wanted } } }),
      prisma.deliveryFeeRule.findMany({ where: { wilayaId: { in: wanted } } }),
      prisma.wilaya.findMany({ where: { id: { in: wanted } }, select: { id: true, nameFr: true } }),
    ]);
    // rows cached before the rule above may still hold a 0
    const rate = new Map(cache.map((c) => [c.wilayaId, { ...c, ...(({ home, stopdesk }) => ({ homePrice: home, stopdeskPrice: stopdesk }))(realRate({ home: c.homePrice, stopdesk: c.stopdeskPrice })) }]));
    const rule = new Map(rules.map((r) => [r.wilayaId, r]));
    const names = new Map(wilayas.map((w) => [w.id, w.nameFr]));
    const rows: CopyFeesDiffView['rows'] = [];
    const missing: number[] = [];
    for (const w of wanted) {
      const r = rate.get(w);
      const cur = rule.get(w);
      if (!r || (r.homePrice === null && r.stopdeskPrice === null)) {
        missing.push(w);
        continue;
      }
      const before = { homePrice: cur?.homePrice ?? 0, stopdeskPrice: cur?.stopdeskPrice ?? 0 };
      const after = { homePrice: r.homePrice ?? before.homePrice, stopdeskPrice: r.stopdeskPrice ?? before.stopdeskPrice };
      rows.push({ wilayaId: w, nameFr: names.get(w) ?? String(w), before, after, changed: before.homePrice !== after.homePrice || before.stopdeskPrice !== after.stopdeskPrice });
    }
    let written = 0;
    if (!input.dryRun) {
      const workspaceId = TenantContext.workspaceId();
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        for (const r of rows.filter((x) => x.changed)) {
          await tx.deliveryFeeRule.upsert({
            where: { workspaceId_wilayaId: { workspaceId, wilayaId: r.wilayaId } },
            create: { workspaceId, wilayaId: r.wilayaId, homePrice: r.after.homePrice, stopdeskPrice: r.after.stopdeskPrice, source: 'custom' },
            update: { homePrice: r.after.homePrice, stopdeskPrice: r.after.stopdeskPrice, source: 'custom' },
          });
          written++;
        }
      });
      const t = TenantContext.get();
      await this.audit.write({ workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action: 'delivery.fees.copy_from_courier', entity: 'DeliveryFeeRule', entityId: null, after: { courierAccountId: a.id, wilayaIds: rows.filter((x) => x.changed).map((x) => x.wilayaId) } });
    }
    // a wilaya the courier does not price stays « missing » once the list is in the cache: only an empty cache is waited for
    const wanting = missing.length > 0 && cache.length === 0 && this.adapters.get(a.provider, a.baseUrl).capabilities.rates;
    const failed = wanting && (await this.failed(a.id));
    const refreshing = wanting && !failed;
    if (refreshing) await this.refresh(a.id);
    return { rows, missing, written, dryRun: input.dryRun, refreshing, ...(failed ? { failed: true } : {}) };
  }
}
