// Simulation of billing (PAYMENT_DRIVER=fake and IAP_DRIVER=fake only; development, test and the staging test site,
// never in production — every route answers 404 otherwise). Nothing here talks to Chargily, Google or Apple: the fake Chargily backend and the fake
// stores produce the same signed webhooks / receipts as the real ones and they enter through the real code paths.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DevPaymentOutcome } from '@djaber/shared';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { CreditService } from '../credits/credit.service';
import { addMonths, currentSub, DAY_MS, isPaid, lockBilling, priceOf } from './billing.util';
import { DunningService } from './dunning.service';
import { FakeChargilyBackend } from './gateway/fake-chargily';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import { fakeAppStoreNotification, fakeAppStoreTransaction, fakeGoogleOrderId, fakeGooglePubSub, FAKE_PUBSUB_TOKEN } from './iap/fake-stores';
import { IapService } from './iap.service';
import { PaymentService } from './payment.service';
import { PlanService } from './plan.service';
import { SubscriptionService } from './subscription.service';

export const FAKE_CHARGILY = Symbol('FAKE_CHARGILY');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class DevBillingService {
  private readonly log = new Logger(DevBillingService.name);
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(FAKE_CHARGILY) private readonly fake: FakeChargilyBackend | null,
    private readonly payments: PaymentService,
    private readonly subs: SubscriptionService,
    private readonly dunning: DunningService,
    private readonly plans: PlanService,
    private readonly iap: IapService,
    private readonly credits: CreditService,
    private readonly tenants: TenantResolver,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private assertFakePay(): FakeChargilyBackend {
    if (!this.config.simulatorsAllowed || this.gateway.driver !== 'fake' || !this.fake) throw notFound();
    return this.fake;
  }
  /** The shortcuts (clock, subscription states, packs, store refunds) stay development / test only, also on staging. */
  private assertFakeAll() {
    if (this.config.isProd) throw notFound();
    this.assertFakePay();
    if (this.iap.stores.driver !== 'fake') throw notFound();
  }

  // --- the fake checkout page -------------------------------------------------------------------------------------------
  async page(id: string, locale: string): Promise<string> {
    const fake = this.assertFakePay();
    const c = await fake.get(id);
    if (!c) throw notFound();
    const amount = `${c.amount.toLocaleString('fr-FR').replace(/\s/g, ' ')} DA`;
    const btn = (outcome: DevPaymentOutcome, label: string, color: string) =>
      `<form method="post" action="${esc(id)}" style="display:inline"><input type="hidden" name="outcome" value="${outcome}">${outcome === 'failed' ? '<input type="hidden" name="reason" id="reason-field" value="card_declined">' : ''}<button data-testid="dev-pay-${outcome}" style="background:${color}">${label}</button></form>`;
    const title = locale === 'ar' ? 'دفع تجريبي (بدون أموال حقيقية)' : locale === 'en' ? 'Simulated payment (no real money)' : 'Paiement simulé (aucun argent réel)';
    return `<!doctype html><html lang="${esc(locale)}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#111}h1{font-size:20px}.card{border:1px solid #ddd;border-radius:12px;padding:20px}.amt{font-size:32px;font-weight:700;margin:8px 0}button{color:#fff;border:0;border-radius:8px;padding:10px 14px;margin:6px 6px 0 0;font-size:15px;cursor:pointer}.muted{color:#666;font-size:13px}select{margin-top:12px;padding:6px}</style></head>
<body><h1>${esc(title)}</h1><div class="card"><div class="muted">Chargily Pay (CIB / Edahabia) — PAYMENT_DRIVER=fake</div><div class="amt" data-testid="dev-pay-amount">${esc(amount)}</div><div>${esc(c.description)}</div><div class="muted">Statut : <b data-testid="dev-pay-status">${esc(c.status)}</b> · ${esc(c.id)}</div>
<div style="margin-top:16px">${btn('paid', 'Payé', '#16a34a')}${btn('failed', 'Échoué', '#dc2626')}${btn('expired', 'Expiré', '#6b7280')}${btn('pending', 'En attente', '#d97706')}</div>
<label class="muted">Motif bancaire (échec) <select data-testid="dev-pay-reason" onchange="var f=document.getElementById('reason-field');if(f)f.value=this.value"><option value="card_declined">card_declined</option><option value="insufficient_funds">insufficient_funds</option><option value="expired_card">expired_card</option><option value="otp_failed">otp_failed</option></select></label>
<p class="muted">Aucun argent réel. Le choix envoie le webhook signé comme Chargily puis revient sur la page de retour.</p></div></body></html>`;
  }

  async decide(id: string, outcome: DevPaymentOutcome, reason: string | undefined, ip: string | null) {
    const fake = this.assertFakePay();
    const r = await fake.decide(id, outcome, reason);
    if (!r) throw notFound();
    this.log.log({ checkoutId: id, outcome, reason: reason ?? null }, 'fake checkout decided');
    await this.audit.write({ workspaceId: r.checkout.metadata.workspaceId && /^[0-9a-f-]{36}$/i.test(r.checkout.metadata.workspaceId) ? r.checkout.metadata.workspaceId : null, actorType: 'system', action: 'dev_payment.decided', entity: 'FakeCheckout', entityId: null, after: { checkoutId: id, outcome, reason: reason ?? null, amount: r.checkout.amount }, ip });
    if (r.webhook) {
      // the real entry point: signature check, InboundEvent dedup, job; then processed at once for a snappy dev loop
      await this.payments.ingestWebhook({ signature: r.webhook.signature, 'content-type': 'application/json' }, r.webhook.rawBody);
      const eventId = (JSON.parse(r.webhook.rawBody.toString('utf8')) as { id: string }).id;
      const ev = await TenantContext.runSystem(() => prisma.inboundEvent.findUnique({ where: { externalId: `chargily:${eventId}` } }));
      if (ev) await this.payments.processWebhook(ev.id);
    }
    return { checkoutId: id, outcome, status: r.checkout.status, redirectUrl: r.redirectUrl };
  }

  // --- subscription states ---------------------------------------------------------------------------------------------
  async subscription(dto: { action: 'expire' | 'expiring' | 'dunning' | 'trial_end' | 'renew'; stage?: 'd_minus_7' | 'd0' | 'd_plus_3'; planSlug?: string }, locale: string) {
    this.assertFakeAll();
    const workspaceId = TenantContext.workspaceId();
    const now = new Date();
    const db = prisma as unknown as Tx;
    let cur = await currentSub(db, workspaceId);
    const shift = async (data: { currentPeriodStart?: Date; currentPeriodEnd?: Date; trialEndsAt?: Date | null; dunningStage?: null }) => {
      await prisma.subscription.update({ where: { id: cur!.id }, data });
      await this.tenants.invalidate(workspaceId);
    };
    if (dto.action === 'renew' || ((dto.action === 'dunning' || (dto.action === 'expiring' && cur?.status !== 'trial')) && !isPaid(cur))) {
      const plan = (await this.plans.bySlug(dto.planSlug ?? 'pro')) ?? (await this.plans.bySlug('pro'))!;
      await prisma.$transaction(async (t) => {
        const tx = t as Tx;
        await lockBilling(tx, workspaceId);
        await this.payments.activateManually(tx, { intent: { kind: 'subscription', mode: 'new_period', planId: plan.id, cycle: 'monthly', amount: priceOf(plan, 'monthly'), amountBeforePromo: priceOf(plan, 'monthly'), prorataDays: null, promoId: null, userId: TenantContext.get().userId ?? null }, amount: priceOf(plan, 'monthly'), method: 'manual_transfer', reference: 'dev' });
      });
      await this.tenants.invalidate(workspaceId);
      cur = await currentSub(db, workspaceId);
      if (dto.action === 'renew') return this.subs.dto(locale);
    }
    if (!cur) throw new AppException('CONFLICT');
    if (dto.action === 'expire') {
      await this.inTx(workspaceId, (tx) => this.subs.expire(tx, cur!, cur!.status === 'trial' ? 'trial' : cur!.status === 'dunning' ? 'dunning' : 'cancelled', now));
    } else if (dto.action === 'trial_end') {
      if (cur.status !== 'trial') throw new AppException('CONFLICT', {}, {}, { status: cur.status });
      await shift({ trialEndsAt: new Date(now.getTime() - 60_000), currentPeriodEnd: new Date(now.getTime() - 60_000) });
      await this.dunning.runExpiry(now);
    } else if (dto.action === 'expiring') {
      const end = new Date(now.getTime() + 7 * DAY_MS - 60_000);
      if (cur.status === 'trial') {
        await shift({ trialEndsAt: end, currentPeriodEnd: end });
        await this.dunning.runExpiry(now);
      } else {
        await shift({ currentPeriodStart: addMonths(end, -1), currentPeriodEnd: end, dunningStage: null });
        await this.dunning.runDunning(now);
      }
    } else if (dto.action === 'dunning') {
      const stage = dto.stage ?? 'd0';
      const end = stage === 'd_minus_7' ? new Date(now.getTime() + 6 * DAY_MS) : stage === 'd0' ? new Date(now.getTime() - 3600_000) : new Date(now.getTime() - 3 * DAY_MS - 3600_000);
      await shift({ currentPeriodStart: addMonths(end, -1), currentPeriodEnd: end });
      await this.dunning.runDunning(now);
    }
    await this.tenants.invalidate(workspaceId);
    return this.subs.dto(locale);
  }

  private async inTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>) {
    const r = await prisma.$transaction(async (t) => {
      await lockBilling(t as Tx, workspaceId);
      return fn(t as Tx);
    });
    await this.tenants.invalidate(workspaceId);
    return r;
  }

  /** Moves the current subscription `days` back in time, then runs the daily jobs (expiry, dunning, credit period). */
  async clock(days: number, run: boolean, locale: string) {
    this.assertFakeAll();
    const workspaceId = TenantContext.workspaceId();
    const cur = await currentSub(prisma as unknown as Tx, workspaceId);
    if (!cur) throw new AppException('CONFLICT');
    const back = (d: Date | null) => (d ? new Date(d.getTime() - days * DAY_MS) : d);
    await prisma.subscription.update({ where: { id: cur.id }, data: { currentPeriodStart: back(cur.currentPeriodStart)!, currentPeriodEnd: back(cur.currentPeriodEnd)!, trialEndsAt: back(cur.trialEndsAt) } });
    await this.tenants.invalidate(workspaceId);
    if (run) {
      await this.dunning.runExpiry();
      await this.dunning.runDunning();
      await this.credits.openPeriods();
    }
    await this.tenants.invalidate(workspaceId);
    return this.subs.dto(locale);
  }

  // --- store simulation ----------------------------------------------------------------------------------------------------
  async pack(dto: { packId?: string; platform?: 'google_play' | 'app_store' }) {
    this.assertFakeAll();
    const platform = dto.platform ?? 'google_play';
    const pack = await TenantContext.runSystem(() => prisma.creditPack.findFirst({ where: { isActive: true, visibleMobile: true, ...(dto.packId ? { id: dto.packId } : {}) }, orderBy: { sortOrder: 'asc' } }));
    if (!pack) throw notFound();
    const productId = (platform === 'google_play' ? pack.googleProductId : pack.appleProductId) ?? '';
    if (platform === 'google_play') {
      const purchaseToken = `dev-${randomUUID()}`;
      const transactionId = fakeGoogleOrderId(purchaseToken);
      return { ...(await this.iap.validate({ platform, productId, transactionId, purchaseToken })), transactionId };
    }
    const transactionId = `2000000${Date.now()}`;
    const receipt = await fakeAppStoreTransaction({ transactionId, productId, bundleId: this.config.get('APPLE_IAP_BUNDLE_ID') });
    return { ...(await this.iap.validate({ platform, productId, transactionId, receipt })), transactionId };
  }

  async storeRefund(transactionId?: string) {
    this.assertFakeAll();
    const p = await prisma.creditPackPurchase.findFirst({ where: { channel: { in: ['google_play', 'app_store'] }, status: 'credited', ...(transactionId ? { storeTransactionId: transactionId } : {}) }, orderBy: { creditedAt: 'desc' }, include: { pack: true } });
    if (!p) throw notFound();
    const receipt = (p.receipt ?? {}) as { purchaseToken?: string; productId?: string };
    const body =
      p.channel === 'google_play'
        ? fakeGooglePubSub({ messageId: `dev-${randomUUID()}`, voided: { purchaseToken: receipt.purchaseToken ?? '', orderId: p.storeOrderId ?? p.storeTransactionId ?? '' } })
        : await fakeAppStoreNotification({ type: 'REFUND', transactionId: p.storeTransactionId ?? '', productId: receipt.productId ?? '', uuid: `dev-${randomUUID()}` });
    const r = await this.iap.ingestNotification(p.channel as 'google_play' | 'app_store', { headers: { 'content-type': 'application/json' }, query: { token: FAKE_PUBSUB_TOKEN }, rawBody: Buffer.from(JSON.stringify(body)) });
    const evs = await TenantContext.runSystem(() => prisma.inboundEvent.findMany({ where: { provider: p.channel === 'google_play' ? 'google_play' : 'app_store', processedAt: null }, orderBy: { receivedAt: 'desc' }, take: 5 }));
    for (const ev of evs) await this.iap.processNotification(ev.id);
    return { received: r.received, balance: await this.credits.summary() };
  }

  help() {
    this.assertFakePay();
    return {
      driver: { payments: this.gateway.driver, stores: this.iap.stores.driver },
      checkout: 'Every checkoutUrl opens /api/v1/dev-payments/:checkoutId: Payé / Échoué / Expiré / En attente (POST the same URL with { outcome } from scripts).',
      subscription: 'POST /dev/billing/subscription { action: expire | expiring | dunning (+ stage d_minus_7|d0|d_plus_3) | trial_end | renew (+ planSlug) }',
      clock: 'POST /dev/billing/clock { days } moves the current subscription back in time and runs the daily jobs',
      packs: 'POST /dev/billing/pack { packId?, platform? } credits a pack through the fake store; POST /dev/billing/store-refund { transactionId? } refunds it',
    };
  }
}
