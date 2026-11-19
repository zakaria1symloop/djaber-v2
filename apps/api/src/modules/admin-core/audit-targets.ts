// ADM-09 audit log — the readable target of every audited record type (12 §Audit log « target — readable », J13-6 /
// J13r-10 / journey J13v-5). One entry per `AuditLog.entity` written anywhere in the API / worker; the unit test
// `audit-targets.spec.ts` lists the entity names of the code and fails on a type that has no entry here.
//
// An entry names the record by a DB lookup of the live rows (`load`), and / or from the audit row itself (`fromRow`: an id
// that is not a UUID — a day, a key, a capability —, or the before / after snapshot of a record that is gone). `special`
// rows (Workspace, User) are named by the list itself; `identifier` rows are named by their id (an impersonation session,
// a queue). The short id is shown only when nothing names the record any more.
import { formatDate, formatNumber, renderStoredTextIn, textIn } from '@djaber/shared';
import { prisma } from '@djaber/db';
import { maskName, maskPhone } from '../../core/privacy/mask';
import { maskEmail, pickLocal } from './admin.util';

type Locale = 'fr' | 'ar' | 'en';
export type AuditRowLike = { id: string; entity: string; entityId: string | null; workspaceId: string | null; at: Date; before: unknown; after: unknown };
type Named = { id: string; name: string | null | undefined };
export type AuditTargetSpec =
  /** named by the list itself: the shop name (Workspace), the account e-mail (User) */
  | { kind: 'special' }
  /** the id is the record's name (impersonation session, queue, fake checkout) */
  | { kind: 'identifier' }
  | { kind: 'named'; load?: (ids: string[], locale: Locale) => Promise<Named[]>; fromRow?: (r: AuditRowLike, locale: Locale) => string | null | Promise<string | null> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID.test(v);
const where = (ids: string[]) => ({ where: { id: { in: ids } } });
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const host = (url: string) => url.replace(/^https?:\/\//, '').slice(0, 60);
/** « ENTRÉE » (a pill label) inside a label reads « Entrée ». */
const inSentence = (label: string) => (label === label.toUpperCase() && label !== label.toLowerCase() ? label.charAt(0) + label.slice(1).toLowerCase() : label);
const words = (key: string, locale: Locale, fallback: string | null = null) => textIn(key, locale) ?? fallback;
/** `-2000` ⇒ « −2 000 DA » (the screens' minus sign). */
const signedDzd = (n: number) => `${n < 0 ? '−' : ''}${formatNumber(Math.abs(n))} DA`;
const dayLabel = (d: Date | string, locale: Locale) => formatDate(typeof d === 'string' && DAY.test(d) ? `${d}T12:00:00Z` : d, locale);
/** Wilaya « 16 · Alger » in the reader's script. */
const wilayaLabel = (w: { code: string; nameFr: string; nameAr: string }, locale: Locale) => `${w.code} · ${locale === 'ar' ? w.nameAr : w.nameFr}`;
const jobKind = (kind: string, locale: Locale) => words(`notification.value.jobKind.${kind}`, locale) ?? words('notification.value.jobKind.other', locale);
const userName = (u: { firstName: string; lastName: string; email: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() || maskEmail(u.email) : null);

/**
 * The name a before / after snapshot gives a record that is gone (deleted webhook, removed member…): its name / title /
 * label, a code or number, a masked e-mail / phone, a URL host. Null when the snapshot holds none.
 */
export const snapshotName = (before: unknown, after: unknown): string | null => {
  for (const s of [obj(after), obj(before)]) {
    const n = str(s.displayName) ?? str(s.name) ?? str(s.title) ?? str(s.label) ?? str(s.key) ?? str(s.code) ?? str(s.number) ?? str(s.word) ?? str(s.planName);
    if (n) return n.slice(0, 80);
    if (str(s.email)) return maskEmail(str(s.email)!);
    if (str(s.url)) return host(str(s.url)!);
    if (str(s.phone)) return maskPhone(str(s.phone));
  }
  return null;
};

const byId = <T extends { id: string }>(rows: T[], name: (x: T) => string | null | undefined): Named[] => rows.map((x) => ({ id: x.id, name: name(x) }));

export const AUDIT_TARGETS: Record<string, AuditTargetSpec> = {
  Workspace: { kind: 'special' },
  User: { kind: 'special' },
  ImpersonationSession: { kind: 'identifier' },
  Queue: { kind: 'identifier' },
  FakeCheckout: { kind: 'identifier' },

  // platform catalogue
  Plan: { kind: 'named', load: async (i) => byId(await prisma.plan.findMany({ ...where(i), select: { id: true, slug: true, name: true } }), (p) => `${pickLocal(p.name)} (${p.slug})`) },
  CreditPack: { kind: 'named', load: async (i) => byId(await prisma.creditPack.findMany({ ...where(i), select: { id: true, slug: true, name: true } }), (p) => `${pickLocal(p.name)} (${p.slug})`) },
  CreditPricing: { kind: 'named', load: async (i, l) => byId(await prisma.creditPricing.findMany({ ...where(i), select: { id: true, version: true, effectiveAt: true } }), (p) => `v${p.version} · ${formatDate(p.effectiveAt, l)}`) },
  PromoCode: { kind: 'named', load: async (i) => byId(await prisma.promoCode.findMany({ ...where(i), select: { id: true, code: true } }), (c) => c.code) },
  AgentPreset: { kind: 'named', load: async (i) => byId(await prisma.agentPreset.findMany({ ...where(i), select: { id: true, key: true, name: true } }), (p) => `${pickLocal(p.name)} (${p.key})`) },
  CmsEntry: { kind: 'named', load: async (i) => byId(await prisma.cmsEntry.findMany({ ...where(i), select: { id: true, key: true } }), (c) => c.key) },
  LegalDocument: { kind: 'named', load: async (i, l) => byId(await prisma.legalDocument.findMany({ ...where(i), select: { id: true, key: true, version: true } }), (d) => `${words(`legal.doc.${d.key}`, l, d.key)} v${d.version}`) },
  AiModel: { kind: 'named', load: async (i) => byId(await prisma.aiModel.findMany({ ...where(i), select: { id: true, displayName: true } }), (m) => m.displayName) },
  AiProvider: { kind: 'named', load: async (i) => byId(await prisma.aiProvider.findMany({ ...where(i), select: { id: true, displayName: true } }), (p) => p.displayName) },
  // the id is the capability (`text`, `vision`…)
  AiRoute: { kind: 'named', fromRow: (r, l) => (r.entityId ? words(`admin.ai.capLong.${r.entityId}`, l, r.entityId) : null) },
  // the id is the setting key (`maintenance`, `meta_app`…)
  PlatformSetting: { kind: 'named', fromRow: (r) => (r.entityId && !isUuid(r.entityId) ? r.entityId : null), load: async (i) => byId(await prisma.platformSetting.findMany({ ...where(i), select: { id: true, key: true } }), (s) => s.key) },
  PlatformProvider: { kind: 'named', load: async (i) => byId(await prisma.platformProvider.findMany({ ...where(i), select: { id: true, key: true } }), (p) => p.key) },
  // an account deletion request: the account (masked e-mail — it may be anonymised already)
  AccountDeletionRequest: { kind: 'named', load: async (i) => { const rows = await prisma.accountDeletionRequest.findMany({ ...where(i), select: { id: true, userId: true } }); const users = rows.length ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true } }) : []; return byId(rows, (r) => { const u = users.find((x) => x.id === r.userId); return u ? maskEmail(u.email) : null; }); } },
  PlatformInvitation: { kind: 'named', load: async (i) => byId(await prisma.platformInvitation.findMany({ ...where(i), select: { id: true, email: true } }), (x) => maskEmail(x.email)) },
  PlatformBlacklist: { kind: 'named', load: async (i) => byId(await prisma.platformBlacklist.findMany({ ...where(i), select: { id: true, phone: true } }), (x) => maskPhone(x.phone)) },
  // the id is the Meta permission scope
  MetaPermission: { kind: 'named', fromRow: (r) => (r.entityId && !isUuid(r.entityId) ? r.entityId : null), load: async (i) => byId(await prisma.metaPermission.findMany({ ...where(i), select: { id: true, scope: true } }), (x) => x.scope) },
  FeatureFlag: { kind: 'named', load: async (i) => byId(await prisma.featureFlag.findMany({ ...where(i), select: { id: true, key: true } }), (x) => x.key) },
  AppVersion: { kind: 'named', load: async (i) => byId(await prisma.appVersion.findMany({ ...where(i), select: { id: true, platform: true, latestVersion: true } }), (x) => `${x.platform} ${x.latestVersion}`) },
  Incident: { kind: 'named', load: async (i) => byId(await prisma.incident.findMany({ ...where(i), select: { id: true, title: true } }), (x) => pickLocal(x.title)) },
  ModerationRule: { kind: 'named', load: async (i) => byId(await prisma.moderationRule.findMany({ ...where(i), select: { id: true, value: true } }), (x) => `« ${x.value.slice(0, 60)} »`), fromRow: (r) => { const v = str(obj(r.before).value) ?? str(obj(r.after).value); return v ? `« ${v.slice(0, 60)} »` : null; } },
  ModerationItem: {
    kind: 'named',
    load: async (i, l) =>
      byId(await prisma.moderationItem.findMany({ ...where(i), select: { id: true, type: true, product: { select: { name: true } }, agent: { select: { name: true, displayName: true } }, category: { select: { name: true } } } }), (m) => {
        const n = m.product?.name ?? m.agent?.displayName ?? m.agent?.name ?? m.category?.name;
        // journey J13r-10: the item type in words (« Produit », « Nom d'agent »), never the stored value `agent_name`
        const type = words(`adminMod.type.${m.type}`, l, m.type)!;
        return n ? `${type} « ${n} »` : type;
      }),
  },
  ModerationAppeal: { kind: 'named', load: async (i, l) => byId(await prisma.moderationAppeal.findMany({ ...where(i), select: { id: true, item: { select: { type: true, product: { select: { name: true } }, agent: { select: { name: true } } } } } }), (a) => { const n = a.item.product?.name ?? a.item.agent?.name; const type = words(`adminMod.type.${a.item.type}`, l, a.item.type)!; return n ? `${type} « ${n} »` : type; }) },
  Report: { kind: 'named', load: async (i, l) => byId(await prisma.report.findMany({ ...where(i), select: { id: true, reason: true, client: { select: { name: true } } } }), (x) => [words(`adminSafety.reason.${x.reason}`, l, null), x.client ? maskName(x.client.name) : null].filter(Boolean).join(' · ') || null) },
  BlockedWord: { kind: 'named', load: async (i) => byId(await prisma.blockedWord.findMany({ ...where(i), select: { id: true, word: true } }), (x) => `« ${x.word} »`) },

  // billing
  Subscription: { kind: 'named', load: async (i) => byId(await prisma.subscription.findMany({ ...where(i), select: { id: true, plan: { select: { name: true, slug: true } } } }), (s) => `${pickLocal(s.plan.name)} (${s.plan.slug})`) },
  Invoice: { kind: 'named', load: async (i) => byId(await prisma.invoice.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  BillingPayment: { kind: 'named', load: async (i) => byId(await prisma.billingPayment.findMany({ ...where(i), select: { id: true, amount: true, reference: true, invoice: { select: { number: true } } } }), (x) => [x.invoice?.number ?? x.reference, `${formatNumber(x.amount)} DA`].filter(Boolean).join(' · ')) },

  // shop records — by their human reference (customer names / phones / e-mails masked as in the viewers)
  Product: { kind: 'named', load: async (i) => byId(await prisma.product.findMany({ ...where(i), select: { id: true, name: true } }), (x) => x.name) },
  Category: { kind: 'named', load: async (i) => byId(await prisma.category.findMany({ ...where(i), select: { id: true, name: true } }), (x) => x.name) },
  Unit: { kind: 'named', load: async (i) => byId(await prisma.unit.findMany({ ...where(i), select: { id: true, name: true } }), (x) => x.name) },
  StockMovement: { kind: 'named', load: async (i, l) => byId(await prisma.stockMovement.findMany({ ...where(i), select: { id: true, type: true, product: { select: { name: true } } } }), (x) => `${x.product.name} · ${inSentence(words(`enum.StockMovement.type.${x.type}`, l, x.type)!)}`) },
  Recommendation: { kind: 'named', load: async (i) => byId(await prisma.recommendation.findMany({ ...where(i), select: { id: true, product: { select: { name: true } }, recommended: { select: { name: true } } } }), (x) => `${x.product.name} → ${x.recommended.name}`) },
  Agent: { kind: 'named', load: async (i) => byId(await prisma.agent.findMany({ ...where(i), select: { id: true, name: true, displayName: true } }), (a) => a.displayName || a.name) },
  AgentInsight: { kind: 'named', load: async (i, l) => byId(await prisma.agentInsight.findMany({ ...where(i), select: { id: true, type: true, agent: { select: { name: true, displayName: true } } } }), (x) => `${x.agent.displayName || x.agent.name} · ${words(`agents.insights.type.${x.type}`, l, x.type)}`) },
  Channel: { kind: 'named', load: async (i) => byId(await prisma.channel.findMany({ ...where(i), select: { id: true, name: true } }), (x) => x.name) },
  Conversation: { kind: 'named', load: async (i) => byId(await prisma.conversation.findMany({ ...where(i), select: { id: true, client: { select: { name: true } }, channel: { select: { name: true } } } }), (x) => [x.client ? maskName(x.client.name) : null, x.channel.name].filter(Boolean).join(' · ')) },
  QuickReply: { kind: 'named', load: async (i) => byId(await prisma.quickReply.findMany({ ...where(i), select: { id: true, title: true, shortcut: true } }), (x) => (x.shortcut ? `${x.shortcut} · ${x.title}` : x.title)) },
  CannedReply: { kind: 'named', load: async (i) => byId(await prisma.cannedReply.findMany({ ...where(i), select: { id: true, title: true } }), (x) => x.title) },
  SavedView: { kind: 'named', load: async (i, l) => byId(await prisma.savedView.findMany({ ...where(i), select: { id: true, name: true, page: true } }), (x) => `${x.name} (${words(`nav.${x.page}`, l, x.page)})`) },
  Client: { kind: 'named', load: async (i) => byId(await prisma.client.findMany({ ...where(i), select: { id: true, name: true } }), (x) => maskName(x.name)) },
  CustomerBlock: { kind: 'named', load: async (i) => byId(await prisma.customerBlock.findMany({ ...where(i), select: { id: true, phone: true, client: { select: { name: true } } } }), (x) => maskPhone(x.phone) ?? (x.client ? maskName(x.client.name) : null)) },
  Order: { kind: 'named', load: async (i) => byId(await prisma.order.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  Sale: { kind: 'named', load: async (i) => byId(await prisma.sale.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  Purchase: { kind: 'named', load: async (i) => byId(await prisma.purchase.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  Supplier: { kind: 'named', load: async (i) => byId(await prisma.supplier.findMany({ ...where(i), select: { id: true, name: true } }), (x) => x.name) },
  InventoryCount: { kind: 'named', load: async (i) => byId(await prisma.inventoryCount.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  // a cash row: its label (typed, or the stored sentence in the reader's language) else its category, and its amount
  CashTransaction: {
    kind: 'named',
    load: async (i, l) => byId(await prisma.cashTransaction.findMany({ ...where(i), select: { id: true, description: true, category: true, type: true, amount: true } }), (x) => cashRowName(x, l)),
    fromRow: (r, l) => {
      const s = { ...obj(r.before), ...obj(r.after) };
      return typeof s.amount === 'number' ? cashRowName({ description: str(s.description), category: str(s.category) ?? 'other', type: str(s.type) ?? 'expense', amount: s.amount }, l) : null;
    },
  },
  // a closing: its day (`cash.reopen` stores the day itself; rows of before 19/11 hold no id — matched by the closing time)
  CashClosing: {
    kind: 'named',
    load: async (i, l) => byId(await prisma.cashClosing.findMany({ ...where(i), select: { id: true, day: true } }), (c) => dayLabel(c.day, l)),
    fromRow: async (r, l) => {
      if (r.entityId && DAY.test(r.entityId)) return dayLabel(r.entityId, l);
      if (r.entityId || !r.workspaceId) return null;
      const c = await prisma.cashClosing.findFirst({ where: { workspaceId: r.workspaceId, closedAt: { gte: new Date(r.at.getTime() - 60_000), lte: new Date(r.at.getTime() + 5_000) } }, orderBy: { closedAt: 'desc' }, select: { day: true } });
      return c ? dayLabel(c.day, l) : null;
    },
  },
  // a fee rule: its wilaya; a grid-wide write (fill missing / reset all, copy from the courier) names « Toutes les wilayas »
  DeliveryFeeRule: {
    kind: 'named',
    load: async (i, l) => byId(await prisma.deliveryFeeRule.findMany({ ...where(i), select: { id: true, wilaya: { select: { code: true, nameFr: true, nameAr: true } } } }), (x) => wilayaLabel(x.wilaya, l)),
    fromRow: async (r, l) => {
      const wilayaId = obj(r.after).wilayaId;
      if (typeof wilayaId === 'number') {
        const w = await prisma.wilaya.findUnique({ where: { id: wilayaId }, select: { code: true, nameFr: true, nameAr: true } });
        if (w) return wilayaLabel(w, l);
      }
      return r.entityId ? null : words('admin.audit.target.allWilayas', l);
    },
  },
  CourierAccount: { kind: 'named', load: async (i) => byId(await prisma.courierAccount.findMany({ ...where(i), select: { id: true, displayName: true } }), (x) => x.displayName) },
  Invitation: { kind: 'named', load: async (i, l) => byId(await prisma.invitation.findMany({ ...where(i), select: { id: true, email: true, role: true } }), (x) => `${maskEmail(x.email)} (${words(`enum.Membership.role.${x.role}`, l, x.role)})`) },
  // a member: the person and the role; a removed member is named from the stored `userId`
  Membership: {
    kind: 'named',
    load: async (i, l) => byId(await prisma.membership.findMany({ ...where(i), select: { id: true, role: true, user: { select: { firstName: true, lastName: true, email: true } } } }), (m) => `${userName(m.user)} (${words(`enum.Membership.role.${m.role}`, l, m.role)})`),
    fromRow: async (r) => {
      const userId = str(obj(r.before).userId) ?? str(obj(r.after).userId);
      if (!isUuid(userId)) return null;
      return userName(await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }));
    },
  },
  ApiKey: { kind: 'named', load: async (i) => byId(await prisma.apiKey.findMany({ ...where(i), select: { id: true, name: true } }), (k) => k.name) },
  WebhookEndpoint: { kind: 'named', load: async (i) => byId(await prisma.webhookEndpoint.findMany({ ...where(i), select: { id: true, url: true } }), (w) => host(w.url)) },
  WebhookDelivery: { kind: 'named', load: async (i) => byId(await prisma.webhookDelivery.findMany({ ...where(i), select: { id: true, event: true, endpoint: { select: { url: true } } } }), (d) => `${d.event} → ${host(d.endpoint.url)}`) },
  SheetsConnection: { kind: 'named', load: async (i) => byId(await prisma.sheetsConnection.findMany({ ...where(i), select: { id: true, spreadsheetTitle: true, googleEmail: true } }), (s) => s.spreadsheetTitle ?? maskEmail(s.googleEmail)), fromRow: (r) => { const s = { ...obj(r.before), ...obj(r.after) }; return str(s.spreadsheetTitle) ?? (str(s.googleEmail) ? maskEmail(str(s.googleEmail)!) : null); } },
  // a report schedule: the report in words (`report.unschedule` stores the report key)
  ReportSchedule: {
    kind: 'named',
    load: async (i, l) => byId(await prisma.reportSchedule.findMany({ ...where(i), select: { id: true, reportKey: true, email: true } }), (s) => `${words(`report.${s.reportKey}.title`, l, s.reportKey)} → ${maskEmail(s.email)}`),
    fromRow: (r, l) => (r.entityId && !isUuid(r.entityId) ? words(`report.${r.entityId}.title`, l, null) : null),
  },
  SupportTicket: { kind: 'named', load: async (i) => byId(await prisma.supportTicket.findMany({ ...where(i), select: { id: true, number: true } }), (x) => x.number) },
  // a background job: its kind in words (« Export du journal d'audit »), never `audit_export`
  Job: { kind: 'named', load: async (i, l) => byId(await prisma.job.findMany({ ...where(i), select: { id: true, kind: true } }), (j) => jobKind(j.kind, l)) },
};

function cashRowName(x: { description: string | null; category: string; type: string; amount: number }, l: Locale): string {
  const label = renderStoredTextIn(x.description, l) || words(`enum.Cash.category.${x.category}`, l, x.category)!;
  return `${label} · ${signedDzd(x.type === 'expense' && x.amount > 0 ? -x.amount : x.amount)}`;
}

/**
 * `Entity:id` / `row:<audit row id>` ⇒ readable name, for every row of the page. Live records first (one query per
 * entity type), then the row itself for the others. Runs inside `TenantContext.runSystem` (the caller's).
 */
export async function auditTargetNames(rows: AuditRowLike[], locale: Locale): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const entities = [...new Set(rows.map((r) => r.entity))];
  await Promise.all(
    entities.map(async (entity) => {
      const spec = AUDIT_TARGETS[entity];
      if (!spec || spec.kind !== 'named' || !spec.load) return;
      const ids = [...new Set(rows.filter((r) => r.entity === entity && isUuid(r.entityId)).map((r) => r.entityId!))];
      if (!ids.length) return;
      for (const x of await spec.load(ids, locale)) {
        const n = x.name?.trim();
        if (n) out.set(`${entity}:${x.id}`, n);
      }
    }),
  );
  for (const r of rows) {
    if (out.has(`${r.entity}:${r.entityId}`)) continue;
    const spec = AUDIT_TARGETS[r.entity];
    if (!spec || spec.kind !== 'named') continue;
    const n = ((await spec.fromRow?.(r, locale)) ?? snapshotName(r.before, r.after))?.trim();
    if (n) out.set(`row:${r.id}`, n);
  }
  return out;
}
