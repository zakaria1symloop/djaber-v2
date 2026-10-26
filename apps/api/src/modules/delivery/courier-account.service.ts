// DLV-03 — courier accounts: per-provider required fields (shared zod), AES-256-GCM credentials (never returned: masked
// hints only), connection test (the one synchronous courier call, 10 s timeout — 03-events §7), default account
// (`CourierAccount.isDefault` + `Workspace.defaultCourierAccountId` kept in sync), active toggle, delete blocked while
// parcels are in flight (`409 COURIER_HAS_ACTIVE_SHIPMENTS {count}`). Every change is audited (01-nest-module-map §3.4).
import { Injectable } from '@nestjs/common';
import { ZR_APP_BASE_URL, type CourierAccountView, type CourierProviderView, type CourierTestResultView, type CreateCourierAccountInput, type UpdateCourierAccountInput, type ZrPlatform } from '@djaber/shared';
import { Prisma, prisma, TenantContext, type CourierAccount, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, conflict, notFound } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { can } from '../../core/rbac/permission-matrix';
import { CourierAdapters } from './adapters/courier-registry';
import { capabilitiesOf, PROVIDER_CAPABILITIES, PROVIDER_NAMES, wireCapabilities, ZR_APP_CAPABILITIES, zrPlatformOf, type AnyCredentials, type CourierProvider } from './adapters/courier-adapter';

const DAY = 86_400_000;
/** Parcels still with the courier (delete guard, stats). */
export const IN_FLIGHT = ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed'] as const;

const FIELD_DEFS: Record<'zrexpress' | 'ecotrack' | 'yalidine', CourierProviderView['fields']> = {
  zrexpress: [
    { key: 'token', type: 'secret', required: true, labelKey: 'couriers.field.token', placeholder: null },
    { key: 'key', type: 'secret', required: true, labelKey: 'couriers.field.key', placeholder: null },
  ],
  ecotrack: [
    { key: 'baseUrl', type: 'url', required: true, labelKey: 'couriers.field.baseUrl', placeholder: 'https://votre-societe.ecotrack.dz' },
    { key: 'token', type: 'secret', required: true, labelKey: 'couriers.field.token', placeholder: null },
  ],
  yalidine: [
    { key: 'apiId', type: 'text', required: true, labelKey: 'couriers.field.apiId', placeholder: null },
    { key: 'apiToken', type: 'secret', required: true, labelKey: 'couriers.field.apiToken', placeholder: null },
  ],
};
/** ZR Express new platform (api.zrexpress.app): API key + tenant id, from the merchant's ZR Express space. */
const ZR_APP_FIELDS: CourierProviderView['fields'] = [
  { key: 'apiKey', type: 'secret', required: true, labelKey: 'couriers.field.apiKey', placeholder: null },
  { key: 'tenantId', type: 'text', required: true, labelKey: 'couriers.field.tenantId', placeholder: null },
];
const PORTALS: Record<CourierProvider, string | null> = { zrexpress: 'https://procolis.com', ecotrack: null, yalidine: 'https://yalidine.app', manual: null };
/** Credential fields of an account (ZR Express: per platform). */
const fieldsOf = (provider: 'zrexpress' | 'ecotrack' | 'yalidine', platform: ZrPlatform | null) => (platform === 'app' ? ZR_APP_FIELDS : FIELD_DEFS[provider]);

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

export type AccountWithCreds = CourierAccount & { creds: AnyCredentials };

@Injectable()
export class CourierAccountService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly adapters: CourierAdapters,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly queueOutbox: QueueOutbox,
  ) {}

  // --- providers ------------------------------------------------------------------------------------------------------------
  providers(): CourierProviderView[] {
    const list: CourierProviderView[] = (['zrexpress', 'ecotrack', 'yalidine'] as const).map((p) => ({
      provider: p,
      name: PROVIDER_NAMES[p],
      account: true,
      fields: FIELD_DEFS[p],
      capabilities: wireCapabilities(PROVIDER_CAPABILITIES[p]),
      portalUrl: PORTALS[p],
      labelSource: PROVIDER_CAPABILITIES[p].label ? 'courier' : 'djaber',
      simulated: this.adapters.driver === 'fake',
    }));
    // ZR Express: two platforms, the new one first (default of the dialog); the top-level fields stay Procolis'
    const i = list.findIndex((p) => p.provider === 'zrexpress');
    const procolis = list[i]!;
    list[i] = {
      ...procolis,
      platforms: [
        { key: 'app', name: 'ZR Express', fields: ZR_APP_FIELDS, capabilities: wireCapabilities(ZR_APP_CAPABILITIES), portalUrl: null, labelSource: 'courier' },
        { key: 'procolis', name: 'ZR Express (Procolis)', fields: procolis.fields, capabilities: procolis.capabilities, portalUrl: procolis.portalUrl, labelSource: procolis.labelSource },
      ],
    };
    list.push({ provider: 'manual', name: PROVIDER_NAMES.manual, account: false, fields: [], capabilities: { ...wireCapabilities(PROVIDER_CAPABILITIES.manual), tracking: false }, portalUrl: null, labelSource: 'djaber' });
    return list;
  }

  // --- credentials ----------------------------------------------------------------------------------------------------------
  seal(creds: Record<string, string>): Uint8Array<ArrayBuffer> {
    return bytes(this.crypto.encryptJson(creds));
  }
  open(a: Pick<CourierAccount, 'credentials'>): AnyCredentials {
    return this.crypto.decryptJson<AnyCredentials>(Buffer.from(a.credentials).toString('utf8'));
  }
  webhookSecretOf(a: Pick<CourierAccount, 'webhookSecret'>): string | null {
    return a.webhookSecret ? this.crypto.decrypt(Buffer.from(a.webhookSecret).toString('utf8')) : null;
  }
  private hint(field: string, value: string | undefined) {
    if (!value) return '';
    if (field === 'baseUrl') return value;
    return value.length > 6 ? `••••${value.slice(-4)}` : '••••';
  }

  // --- reads ------------------------------------------------------------------------------------------------------------------
  /** Account of this workspace (404 across workspaces), with its decrypted credentials (server side only). */
  async load(id: string, db: Tx | typeof prisma = prisma): Promise<AccountWithCreds> {
    const a = await db.courierAccount.findFirst({ where: { id } });
    if (!a) throw notFound();
    return { ...a, creds: this.open(a) };
  }

  /** The account a send uses: the given one, else the workspace default, else the only active one. */
  async resolveForSend(courierAccountId: string | null | undefined, db: Tx | typeof prisma = prisma): Promise<AccountWithCreds> {
    let a: CourierAccount | null = null;
    if (courierAccountId) {
      a = await db.courierAccount.findFirst({ where: { id: courierAccountId } });
      if (!a) throw new AppException('VALIDATION_ERROR', {}, { courierAccountId: 'validation.invalid' });
    } else {
      const active = await db.courierAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      a = active.find((x) => x.isDefault) ?? (active.length === 1 ? active[0]! : (active[0] ?? null));
    }
    if (!a || !a.isActive) throw new AppException('DELIVERY_NO_COURIER');
    return { ...a, creds: this.open(a) };
  }

  private async stats(ids: string[]) {
    if (!ids.length) return new Map<string, { sent: number; failed30d: number; activeShipments: number }>();
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await prisma.$queryRaw<{ id: string; sent: bigint; failed30d: bigint; active: bigint }[]>`
      SELECT "courierAccountId" AS id,
             count(*) FILTER (WHERE "trackingNumber" IS NOT NULL) AS sent,
             count(*) FILTER (WHERE "status" = 'failed' AND "updatedAt" >= ${since}) AS "failed30d",
             count(*) FILTER (WHERE "status" IN ('pending','sent','picked_up','in_transit','out_for_delivery','failed')) AS active
      FROM "Shipment" WHERE "workspaceId" = ${TenantContext.workspaceId()}::uuid AND "courierAccountId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})
      GROUP BY "courierAccountId"`;
    return new Map(rows.map((r) => [r.id, { sent: Number(r.sent), failed30d: Number(r.failed30d), activeShipments: Number(r.active) }]));
  }

  present(a: CourierAccount, stats: { sent: number; failed30d: number; activeShipments: number } | undefined): CourierAccountView {
    const provider = a.provider as 'zrexpress' | 'ecotrack' | 'yalidine';
    const platform = zrPlatformOf(provider, a.baseUrl);
    const caps = capabilitiesOf(provider, a.baseUrl);
    let creds: AnyCredentials = {};
    try {
      creds = this.open(a);
    } catch {
      creds = {};
    }
    const credentialHints: CourierAccountView['credentialHints'] = {};
    for (const f of fieldsOf(provider, platform)) credentialHints[f.key] = this.hint(f.key, creds[f.key]);
    const s = stats ?? { sent: 0, failed30d: 0, activeShipments: 0 };
    const role = TenantContext.get().role;
    const manage = can(role, 'delivery.manage');
    const act = (key: string, reasonCode: string | null = null) => {
      const code = !manage ? 'FORBIDDEN' : reasonCode;
      return { key, enabled: !code, ...(code ? { reasonCode: code } : {}) };
    };
    return {
      id: a.id,
      provider,
      displayName: a.displayName,
      baseUrl: a.baseUrl,
      platform,
      isActive: a.isActive,
      isDefault: a.isDefault,
      sender: { name: a.senderName, phone: a.senderPhone, address: a.senderAddress, wilayaId: a.senderWilayaId },
      capabilities: wireCapabilities(caps),
      lastTest: a.lastTestedAt ? { at: a.lastTestedAt.toISOString(), ok: !!a.lastTestOk, latencyMs: a.lastTestLatencyMs, error: (a.lastTestError as 'COURIER_CREDENTIALS_INVALID' | 'COURIER_UNAVAILABLE' | null) ?? null } : null,
      stats: s,
      credentialsSet: true,
      credentialHints,
      webhookUrl: caps.webhook ? `${this.config.get('PUBLIC_API_URL').replace(/\/$/, '')}/api/v1/webhooks/couriers/${a.id}` : null,
      webhookSecretSet: !!a.webhookSecret,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      actions: [
        act('edit'),
        act('test'),
        act('set_default', a.isDefault ? 'CONFLICT' : !a.isActive ? 'DELIVERY_NO_COURIER' : null),
        act(a.isActive ? 'deactivate' : 'activate'),
        act('delete', s.activeShipments > 0 ? 'COURIER_HAS_ACTIVE_SHIPMENTS' : null),
      ],
    };
  }

  async list(): Promise<CourierAccountView[]> {
    const rows = await prisma.courierAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const stats = await this.stats(rows.map((r) => r.id));
    return rows.map((r) => this.present(r, stats.get(r.id)));
  }

  async get(id: string): Promise<CourierAccountView> {
    const a = await prisma.courierAccount.findFirst({ where: { id } });
    if (!a) throw notFound();
    return this.present(a, (await this.stats([id])).get(id));
  }

  capabilities(id: string) {
    return this.get(id).then((a) => ({ provider: a.provider, capabilities: a.capabilities }));
  }

  // --- writes -----------------------------------------------------------------------------------------------------------------
  private async setDefault(tx: Tx, id: string | null) {
    const workspaceId = TenantContext.workspaceId();
    await tx.courierAccount.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    if (id) await tx.courierAccount.update({ where: { id }, data: { isDefault: true } });
    await tx.workspace.update({ where: { id: workspaceId }, data: { defaultCourierAccountId: id } });
  }

  /** Keeps exactly one default among the active accounts (none when there is no active account). */
  private async ensureDefault(tx: Tx) {
    const active = await tx.courierAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, isDefault: true } });
    const current = active.find((a) => a.isDefault);
    if (current) return;
    await this.setDefault(tx, active[0]?.id ?? null);
  }

  private auditCourier(action: string, entityId: string, after: unknown, before?: unknown) {
    const t = TenantContext.get();
    return this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action, entity: 'CourierAccount', entityId, before, after });
  }

  private emit(tx: Tx, id: string, reason: string) {
    return this.outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'courier.updated', { id, reason }, `courier.updated:${id}:${reason}:${Date.now()}`);
  }

  async create(input: CreateCourierAccountInput): Promise<CourierAccountView> {
    const workspaceId = TenantContext.workspaceId();
    // EcoTrack: the merchant instance; ZR Express: the platform (API key + tenant id = api.zrexpress.app, else Procolis)
    const baseUrl = input.provider === 'ecotrack' ? input.credentials.baseUrl : input.provider === 'zrexpress' && 'apiKey' in input.credentials ? ZR_APP_BASE_URL : '';
    const caps = capabilitiesOf(input.provider, baseUrl);
    const secret = input.webhookSecret ?? (caps.webhook ? this.crypto.randomToken(24) : null);
    let id = '';
    try {
      id = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const a = await tx.courierAccount.create({
          data: {
            workspaceId,
            provider: input.provider,
            baseUrl,
            displayName: input.displayName ?? PROVIDER_NAMES[input.provider],
            credentials: this.seal(input.credentials as Record<string, string>),
            isActive: input.isActive ?? true,
            senderName: input.sender?.name ?? null,
            senderPhone: input.sender?.phone ?? null,
            senderAddress: input.sender?.address ?? null,
            senderWilayaId: input.sender?.wilayaId ?? null,
            webhookSecret: secret ? bytes(this.crypto.encrypt(secret)) : null,
          },
        });
        if (input.isDefault && a.isActive) await this.setDefault(tx, a.id);
        else await this.ensureDefault(tx);
        await this.emit(tx, a.id, 'created');
        // stop-desk reference data of the provider (Yalidine centers), fetched by the worker
        if (caps.stopdesks) await this.queueOutbox.add(tx, 'courier', 'fetch-stopdesks', { courierAccountId: a.id, workspaceId }, `stopdesks:${a.id}`, { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } });
        return a.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict({ provider: input.provider, baseUrl });
      throw e;
    }
    await this.auditCourier('courier.create', id, { provider: input.provider, baseUrl, displayName: input.displayName ?? null, sender: input.sender ?? null });
    return this.get(id);
  }

  async update(id: string, input: UpdateCourierAccountInput): Promise<CourierAccountView> {
    const before = await this.load(id);
    if (input.credentials) {
      const keys = Object.keys(input.credentials).sort().join(',');
      // same platform only (a ZR account keeps its platform: its parcels are tracked there)
      const want = fieldsOf(before.provider as 'zrexpress', zrPlatformOf(before.provider, before.baseUrl)).map((f) => f.key).sort().join(',');
      if (keys !== want) throw new AppException('VALIDATION_ERROR', {}, { credentials: 'validation.required' });
    }
    const baseUrl = before.provider === 'ecotrack' && input.credentials && 'baseUrl' in input.credentials ? (input.credentials as { baseUrl: string }).baseUrl : before.baseUrl;
    try {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const data: Prisma.CourierAccountUncheckedUpdateInput = {
            ...(input.displayName ? { displayName: input.displayName } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.credentials ? { credentials: this.seal(input.credentials as Record<string, string>), baseUrl, lastTestedAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null } : {}),
            ...(input.sender
              ? { senderName: input.sender.name ?? null, senderPhone: input.sender.phone ?? null, senderAddress: input.sender.address ?? null, senderWilayaId: input.sender.wilayaId ?? null }
              : {}),
            ...(input.webhookSecret ? { webhookSecret: bytes(this.crypto.encrypt(input.webhookSecret)) } : {}),
        };
        await tx.courierAccount.update({ where: { id }, data });
        if (input.isDefault === true) {
          if (input.isActive === false || (input.isActive === undefined && !before.isActive)) throw new AppException('DELIVERY_NO_COURIER');
          await this.setDefault(tx, id);
        } else if (input.isActive === false && before.isDefault) {
          await tx.courierAccount.update({ where: { id }, data: { isDefault: false } });
          await tx.workspace.update({ where: { id: TenantContext.workspaceId() }, data: { defaultCourierAccountId: null } });
        }
        await this.ensureDefault(tx);
        await this.emit(tx, id, 'updated');
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict({ provider: before.provider, baseUrl });
      throw e;
    }
    await this.auditCourier('courier.update', id, { displayName: input.displayName, isActive: input.isActive, isDefault: input.isDefault, sender: input.sender, credentialsChanged: !!input.credentials, webhookSecretChanged: !!input.webhookSecret }, { displayName: before.displayName, isActive: before.isActive, isDefault: before.isDefault });
    return this.get(id);
  }

  async remove(id: string) {
    const a = await this.load(id);
    const count = await prisma.shipment.count({ where: { courierAccountId: id, status: { in: [...IN_FLIGHT] } } });
    if (count > 0) throw new AppException('COURIER_HAS_ACTIVE_SHIPMENTS', { count });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (a.isDefault) await tx.workspace.update({ where: { id: TenantContext.workspaceId() }, data: { defaultCourierAccountId: null } });
      await tx.courierAccount.delete({ where: { id } });
      await this.ensureDefault(tx);
      await this.emit(tx, id, 'deleted');
    });
    await this.auditCourier('courier.delete', id, null, { provider: a.provider, displayName: a.displayName });
    return { id, deleted: true };
  }

  /** `POST /delivery/couriers/:id/test` — allowed synchronous courier call (03-events §7, 10 s timeout in the transport). */
  async test(id: string): Promise<CourierTestResultView> {
    const a = await this.load(id);
    const adapter = this.adapters.get(a.provider, a.baseUrl);
    const r = await adapter.testCredentials(a.creds);
    const at = new Date();
    await prisma.courierAccount.update({
      where: { id },
      data: { lastTestedAt: at, lastTestOk: r.ok, lastTestLatencyMs: r.latencyMs ?? null, lastTestError: r.ok ? null : r.code },
    });
    await this.auditCourier('courier.test', id, { ok: r.ok, error: r.ok ? null : r.code });
    return {
      at: at.toISOString(),
      ok: r.ok,
      latencyMs: r.latencyMs ?? null,
      error: r.ok ? null : r.code,
      message: r.ok ? null : r.message,
      accountName: r.ok ? (r.accountName ?? null) : null,
      wilayasServed: r.ok ? (r.wilayasServed ?? null) : null,
      account: await this.get(id),
    };
  }

  /** A courier answered 401 on a send / sync: the account is flagged (last test failed) until it is tested again. */
  async flagCredentials(tx: Tx, id: string) {
    await tx.courierAccount.update({ where: { id }, data: { lastTestedAt: new Date(), lastTestOk: false, lastTestError: 'COURIER_CREDENTIALS_INVALID' } });
  }
}
