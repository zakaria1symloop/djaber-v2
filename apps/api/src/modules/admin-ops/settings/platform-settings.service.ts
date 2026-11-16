// ADM-13 — platform settings (03 §26 PFS-01…07, 04 §15, D39/D58; 06 §8.11 "Platform settings"): versioned key/value
// settings (limits, legal contacts, sensitive categories, maintenance, incident banner, Meta app), app versions with the
// force-update 2FA re-check and its pushes, feature flags, legal document versions + re-acceptance, Meta permissions,
// technical providers (config, encrypted secret, test). Every write is audited (`AuditLog.reason` when given).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { prisma, type AppPlatform, type LegalDocKey, type PlatformProvider, type Prisma, type Tx } from '@djaber/db';
import {
  PROVIDER_KEYS,
  SETTING_KEYS,
  SETTING_SCHEMAS,
  type AdminSettingsDto,
  type AppVersionDto,
  type AppVersionUpdateInput,
  type FeatureFlagCreateInput,
  type FeatureFlagDto,
  type FeatureFlagEvaluationDto,
  type IncidentBannerDto,
  type IncidentBannerInput,
  type LegalAcceptanceStatsDto,
  type LegalDocumentDto,
  type LegalPublishInput,
  type MaintenanceDto,
  type MaintenanceInput,
  type MetaAppDto,
  type MetaPermissionDto,
  type MetaPermissionPatchInput,
  type OpsLocalizedText,
  type PlatformProviderDto,
  type PlatformSettingDto,
  type PlatformSettingVersionDto,
  type ProviderKey,
  type ProviderTestResultDto,
  type ProviderUpdateInput,
  type SettingKey,
} from '@djaber/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { ConfigService } from '../../../core/config/config.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { AppException, conflict, notFound, validationError } from '../../../core/errors/app.exception';
import { FlagsService } from '../../../core/flags/flags.service';
import { isMaintenanceActive, resetMaintenanceCache, type MaintenanceValue } from '../../../core/platform/maintenance';
import { compareVersions, resetAppVersionCache } from '../../../core/platform/platform.guards';
import { ProcessorRegistry } from '../../../core/queue/processor.registry';
import { QueueOutbox } from '../../../core/queue/queue.outbox';
import { TwoFactorService } from '../../auth/two-factor.service';
import { ChannelJobs } from '../../channels/channel-jobs.service';
import { renderNotification } from '../../notifications/notification.catalog';
import { NotificationProducer } from '../../notifications/notification.producer';
import { PUSH_GATEWAY, type PushGateway } from '../../notifications/push/push.gateway';
import { LegalService } from '../../workspace/legal.service';
import { auditAdmin, iso, sys, sysTx, toUserRef, userRefSelect, type PlatformActor } from '../admin-ops.util';

/** Settings shown by `GET /admin/settings` (the Meta app row carries an encrypted secret: never listed). */
const LISTED_KEYS = [...SETTING_KEYS, 'maintenance', 'incident_banner'] as const;
const INSTAGRAM_SCOPES = new Set(['instagram_manage_messages', 'instagram_business_manage_messages']);
/** Providers whose local driver is the fake adapter: the test passes without credentials. */
const FAKE_DRIVER: Partial<Record<ProviderKey, (c: ConfigService) => boolean>> = {
  email: (c) => c.get('MAIL_DRIVER') === 'file',
  sms: (c) => c.get('SMS_DRIVER') === 'fake',
  push: (c) => c.get('PUSH_DRIVER') === 'fake',
  chargily: (c) => c.get('PAYMENT_DRIVER' as never) === 'fake',
  courier_zr: (c) => c.get('COURIER_DRIVER') === 'fake',
  courier_ecotrack: (c) => c.get('COURIER_DRIVER') === 'fake',
  courier_yalidine: (c) => c.get('COURIER_DRIVER') === 'fake',
};
const SMS_BALANCE_WARN = 1000;
const APNS_WARN_DAYS = 30;
const LEGAL_BATCH = 500;

/** zod issues → `{ field: i18n key }` of a 422 VALIDATION_ERROR. */
const parseOr422 = <T>(schema: ZodTypeAny, value: unknown, prefix = 'value'): T => {
  const r = schema.safeParse(value);
  if (r.success) return r.data as T;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[[prefix, ...i.path].join('.')] = i.message.startsWith('validation.') ? i.message : 'validation.invalid';
  throw validationError(fields);
};
const lt = (o: Record<string, string | undefined> | null | undefined): OpsLocalizedText | null => (o && typeof o === 'object' && o.fr ? { fr: o.fr, ...(o.ar ? { ar: o.ar } : {}), ...(o.en ? { en: o.en } : {}) } : null);

@Injectable()
export class PlatformSettingsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly flags: FlagsService,
    private readonly queue: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly twoFactor: TwoFactorService,
    private readonly channels: ChannelJobs,
    private readonly notifications: NotificationProducer,
    private readonly legal: LegalService,
    @Inject(PUSH_GATEWAY) private readonly push: PushGateway,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', 'app-update-push', (d: { platform: AppPlatform; kind: 'required' | 'recommended'; version: string; storeUrl: string }) => this.appUpdatePush(d), { concurrency: 1 });
    this.registry.register('jobs', 'legal-reacceptance-fanout', (d: { legalDocumentId: string }) => this.legalFanout(d.legalDocumentId), { concurrency: 1 });
  }

  // --- versioned settings ----------------------------------------------------------------------------------------------
  private presentSetting(s: Prisma.PlatformSettingGetPayload<{ include: { updatedBy: typeof userRefSelect } }>): PlatformSettingDto {
    return { key: s.key, value: s.key === 'meta_app' ? { appId: (s.value as { appId?: string })?.appId ?? null } : s.value, version: s.version, updatedBy: toUserRef(s.updatedBy), updatedAt: s.updatedAt.toISOString() };
  }

  /** Writes a setting value + its `PlatformSettingVersion` row (inside the caller's transaction). */
  private async writeSetting(tx: Tx, key: string, value: unknown, actor: PlatformActor, reason: string | null) {
    const current = await tx.platformSetting.findUnique({ where: { key } });
    const version = (current?.version ?? 0) + 1;
    const row = current
      ? await tx.platformSetting.update({ where: { key }, data: { value: value as Prisma.InputJsonValue, version, updatedById: actor.userId } })
      : await tx.platformSetting.create({ data: { key, value: value as Prisma.InputJsonValue, version, updatedById: actor.userId } });
    await tx.platformSettingVersion.create({ data: { settingId: row.id, version, value: value as Prisma.InputJsonValue, changedById: actor.userId, reason } });
    return { row, before: current?.value ?? null };
  }

  async updateSetting(key: string, value: unknown, reason: string | undefined, actor: PlatformActor): Promise<PlatformSettingDto> {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) throw notFound();
    const r = (reason ?? '').trim();
    if (r.length < 10) throw new AppException('ADMIN_REASON_REQUIRED', {}, { reason: 'validation.length' });
    const parsed = parseOr422(SETTING_SCHEMAS[key as SettingKey], value);
    const { before } = await sysTx((tx) => this.writeSetting(tx, key, parsed, actor, r));
    await auditAdmin(this.audit, actor, { action: 'setting.update', entity: 'PlatformSetting', entityId: key, before, after: parsed, reason: r });
    return sys(async () => this.presentSetting(await prisma.platformSetting.findUniqueOrThrow({ where: { key }, include: { updatedBy: userRefSelect } })));
  }

  async versions(key: string): Promise<PlatformSettingVersionDto[]> {
    return sys(async () => {
      const s = await prisma.platformSetting.findUnique({ where: { key } });
      if (!s) throw notFound();
      const rows = await prisma.platformSettingVersion.findMany({ where: { settingId: s.id }, orderBy: { version: 'desc' }, take: 100, include: { changedBy: userRefSelect } });
      return rows.map((v) => ({ version: v.version, value: key === 'meta_app' ? { appId: (v.value as { appId?: string })?.appId ?? null } : v.value, changedBy: toUserRef(v.changedBy), reason: v.reason, at: v.at.toISOString() }));
    });
  }

  async getAll(): Promise<AdminSettingsDto> {
    const [settings, maintenance, incidentBanner, appVersions, flags, metaPermissions, providers, legal] = await Promise.all([
      sys(() => prisma.platformSetting.findMany({ where: { key: { in: [...LISTED_KEYS] } }, include: { updatedBy: userRefSelect }, orderBy: { key: 'asc' } })),
      this.maintenance(),
      this.incidentBanner(),
      this.appVersions(),
      this.listFlags(),
      this.metaPermissions(),
      this.providers(),
      this.legalDocuments(),
    ]);
    return { settings: settings.map((s) => this.presentSetting(s)), maintenance, incidentBanner, appVersions, flags, metaPermissions, providers, legal };
  }

  // --- maintenance & incident banner (admin.health.write) -------------------------------------------------------------
  private presentMaintenance(v: MaintenanceValue | null): MaintenanceDto {
    return { enabled: !!(v?.enabled ?? v?.from), active: isMaintenanceActive(v), scheduledFrom: v?.from ?? null, scheduledTo: v?.to ?? null, scope: v?.scope ?? 'all', text: lt(v?.text ?? null) };
  }
  async maintenance(): Promise<MaintenanceDto> {
    const row = await sys(() => prisma.platformSetting.findUnique({ where: { key: 'maintenance' } }));
    return this.presentMaintenance((row?.value ?? null) as MaintenanceValue | null);
  }
  async setMaintenance(input: MaintenanceInput, actor: PlatformActor): Promise<MaintenanceDto> {
    if (input.scheduledFrom && input.scheduledTo && new Date(input.scheduledTo) <= new Date(input.scheduledFrom)) throw validationError({ scheduledTo: 'validation.end_before_start' });
    const value: MaintenanceValue = { enabled: input.enabled, from: input.scheduledFrom ?? (input.enabled ? new Date().toISOString() : null), to: input.scheduledTo ?? null, scope: input.scope, text: input.text ?? null };
    const { before } = await sysTx((tx) => this.writeSetting(tx, 'maintenance', value, actor, input.reason ?? null));
    resetMaintenanceCache();
    await auditAdmin(this.audit, actor, { action: 'maintenance.update', entity: 'PlatformSetting', entityId: 'maintenance', before, after: value, reason: input.reason ?? null });
    return this.presentMaintenance(value);
  }
  async incidentBanner(): Promise<IncidentBannerDto> {
    const row = await sys(() => prisma.platformSetting.findUnique({ where: { key: 'incident_banner' } }));
    const v = (row?.value ?? null) as { visible?: boolean; text?: Record<string, string> | null } | null;
    return { visible: !!v?.visible, text: lt(v?.text ?? null) };
  }
  async setIncidentBanner(input: IncidentBannerInput, actor: PlatformActor): Promise<IncidentBannerDto> {
    if (input.visible && !input.text) throw validationError({ text: 'validation.required' });
    const value = { visible: input.visible, text: input.text ?? null };
    const { before } = await sysTx((tx) => this.writeSetting(tx, 'incident_banner', value, actor, null));
    await auditAdmin(this.audit, actor, { action: 'incident_banner.update', entity: 'PlatformSetting', entityId: 'incident_banner', before, after: value });
    return { visible: value.visible, text: lt(value.text) };
  }

  // --- app versions (PFS-01, force update) ------------------------------------------------------------------------------
  private async impact(platform: AppPlatform, minVersion: string) {
    const devices = await prisma.deviceToken.findMany({ where: { platform, appVersion: { not: null } }, select: { appVersion: true } });
    const below = devices.filter((d) => /^\d+(\.\d+){0,3}$/.test(d.appVersion!) && compareVersions(d.appVersion!, minVersion) < 0).length;
    return { count: below, pct: devices.length ? Math.round((below / devices.length) * 100) : 0 };
  }
  private async presentVersion(r: Prisma.AppVersionGetPayload<object>): Promise<AppVersionDto> {
    return {
      platform: r.platform,
      latestVersion: r.latestVersion,
      latestBuild: r.latestBuild,
      minVersion: r.minVersion,
      recommendedVersion: r.recommendedVersion,
      storeStatus: r.storeStatus,
      rolloutPct: r.rolloutPct,
      storeUrl: r.storeUrl,
      updateMessage: lt(r.updateMessage as Record<string, string>) ?? { fr: '' },
      forceUpdateAt: iso(r.forceUpdateAt),
      devicesBelowMin: await this.impact(r.platform, r.minVersion),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  async appVersions(): Promise<AppVersionDto[]> {
    return sys(async () => Promise.all((await prisma.appVersion.findMany({ orderBy: { platform: 'asc' } })).map((r) => this.presentVersion(r))));
  }
  async appVersion(platform: AppPlatform): Promise<AppVersionDto> {
    return sys(async () => {
      const r = await prisma.appVersion.findUnique({ where: { platform } });
      if (!r) throw notFound();
      return this.presentVersion(r);
    });
  }

  /** `PUT /admin/app-versions/:platform` — 04 §15 "Force update": a rising `minVersion` needs a valid 2FA code. */
  async updateAppVersion(platform: AppPlatform, input: AppVersionUpdateInput, actor: PlatformActor): Promise<AppVersionDto> {
    const current = await sys(() => prisma.appVersion.findUnique({ where: { platform } }));
    if (compareVersions(input.recommendedVersion, input.minVersion) < 0) throw validationError({ recommendedVersion: 'validation.range' });
    if (compareVersions(input.latestVersion, input.recommendedVersion) < 0) throw validationError({ latestVersion: 'validation.range' });
    const storeStatus = input.storeStatus ?? current?.storeStatus ?? 'published';
    // a version still in review / rejected / rolling out cannot be forced beyond what the store already serves (AT-PFS-02)
    if (storeStatus !== 'published' && current && compareVersions(input.minVersion, current.latestVersion) > 0) throw validationError({ minVersion: 'validation.range' });
    const rising = !current || compareVersions(input.minVersion, current.minVersion) > 0;
    if (rising) {
      const user = await sys(() => prisma.user.findUnique({ where: { id: actor.userId } }));
      if (!user?.totpEnabled || !input.totpCode || !this.twoFactor.verify(user, input.totpCode)) {
        throw new AppException('TWO_FA_CONFIRMATION_REQUIRED', {}, { totpCode: input.totpCode ? 'validation.invalid' : 'validation.required' });
      }
    }
    const recommendedRising = !current || compareVersions(input.recommendedVersion, current.recommendedVersion) > 0;
    const data = {
      latestVersion: input.latestVersion,
      latestBuild: input.latestBuild ?? current?.latestBuild ?? null,
      minVersion: input.minVersion,
      recommendedVersion: input.recommendedVersion,
      storeStatus,
      rolloutPct: input.rolloutPct === undefined ? (current?.rolloutPct ?? null) : input.rolloutPct,
      storeUrl: input.storeUrl,
      updateMessage: input.updateMessage as Prisma.InputJsonValue,
      ...(rising ? { forceUpdateAt: new Date() } : {}),
      updatedById: actor.userId,
    };
    const row = await sysTx(async (tx) => {
      const r = await tx.appVersion.upsert({ where: { platform }, create: { platform, ...data }, update: data });
      // push only, every device of the platform, once per (platform, version) — sent by the worker (03-events §5.1)
      if (rising) await this.queue.add(tx, 'jobs', 'app-update-push', { platform, kind: 'required', version: input.minVersion, storeUrl: input.storeUrl }, `app-update:${platform}:required:${input.minVersion}`, { attempts: 3 });
      else if (recommendedRising) await this.queue.add(tx, 'jobs', 'app-update-push', { platform, kind: 'recommended', version: input.recommendedVersion, storeUrl: input.storeUrl }, `app-update:${platform}:recommended:${input.recommendedVersion}`, { attempts: 3 });
      return r;
    });
    resetAppVersionCache();
    const before = current ? { minVersion: current.minVersion, recommendedVersion: current.recommendedVersion, latestVersion: current.latestVersion } : null;
    const after = { minVersion: row.minVersion, recommendedVersion: row.recommendedVersion, latestVersion: row.latestVersion, storeStatus: row.storeStatus };
    await auditAdmin(this.audit, actor, { action: rising ? 'app_version.force_update' : 'app_version.update', entity: 'AppVersion', entityId: platform, before, after, reason: input.reason ?? null });
    return this.appVersion(platform);
  }

  /** Job `jobs / app-update-push`: one push per device token of the platform (invalid tokens pruned). */
  async appUpdatePush(d: { platform: AppPlatform; kind: 'required' | 'recommended'; version: string; storeUrl: string }) {
    return sys(async () => {
      const type = d.kind === 'required' ? 'app_update_required' : 'app_update_recommended';
      const params = d.kind === 'required' ? { platform: d.platform, minVersion: d.version, storeUrl: d.storeUrl } : { platform: d.platform, recommendedVersion: d.version, version: d.version, storeUrl: d.storeUrl };
      let sent = 0;
      let cursor: string | undefined;
      for (;;) {
        const tokens = await prisma.deviceToken.findMany({ where: { platform: d.platform }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
        if (!tokens.length) break;
        for (const t of tokens) {
          const locale = t.locale === 'ar' || t.locale === 'en' ? t.locale : 'fr';
          const { title, body } = renderNotification(type, params, locale);
          const r = await this.push.send({ token: t.token, title, body, data: { type, path: '', workspaceId: '', storeUrl: d.storeUrl, params: JSON.stringify(params) } });
          if (r.ok) sent++;
          else if (r.error === 'UNREGISTERED' || r.error === 'INVALID_ARGUMENT') await prisma.deviceToken.deleteMany({ where: { id: t.id } });
        }
        cursor = tokens[tokens.length - 1]!.id;
      }
      return { sent };
    });
  }

  // --- feature flags (PFS-02) -------------------------------------------------------------------------------------------
  private presentFlag(f: Prisma.FeatureFlagGetPayload<{ include: { updatedBy: typeof userRefSelect; _count: { select: { overrides: true } } } }>): FeatureFlagDto {
    return { key: f.key, description: f.description, webPct: f.webPct, mobilePct: f.mobilePct, targeting: (f.targeting ?? {}) as FeatureFlagDto['targeting'], isActive: f.isActive, overrides: f._count.overrides, updatedBy: toUserRef(f.updatedBy), updatedAt: f.updatedAt.toISOString() };
  }
  private flagInclude = { updatedBy: userRefSelect, _count: { select: { overrides: true } } } as const;
  async listFlags(): Promise<FeatureFlagDto[]> {
    return sys(async () => (await prisma.featureFlag.findMany({ include: this.flagInclude, orderBy: { key: 'asc' } })).map((f) => this.presentFlag(f)));
  }
  async createFlag(input: FeatureFlagCreateInput, actor: PlatformActor): Promise<FeatureFlagDto> {
    const f = await sys(async () => {
      if (await prisma.featureFlag.findUnique({ where: { key: input.key } })) throw new AppException('CONFLICT', {}, { key: 'validation.taken' });
      return prisma.featureFlag.create({ data: { key: input.key, description: input.description ?? null, webPct: input.webPct, mobilePct: input.mobilePct, targeting: input.targeting as Prisma.InputJsonValue, isActive: input.isActive, updatedById: actor.userId }, include: this.flagInclude });
    });
    await this.flags.invalidate();
    await auditAdmin(this.audit, actor, { action: 'feature_flag.create', entity: 'FeatureFlag', entityId: f.key, after: { webPct: f.webPct, mobilePct: f.mobilePct, targeting: f.targeting, isActive: f.isActive }, reason: input.reason ?? null });
    return this.presentFlag(f);
  }
  async updateFlag(key: string, input: Partial<FeatureFlagCreateInput>, actor: PlatformActor): Promise<FeatureFlagDto> {
    const { before, f } = await sys(async () => {
      const b = await prisma.featureFlag.findUnique({ where: { key } });
      if (!b) throw notFound();
      const updated = await prisma.featureFlag.update({
        where: { key },
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.webPct !== undefined ? { webPct: input.webPct } : {}),
          ...(input.mobilePct !== undefined ? { mobilePct: input.mobilePct } : {}),
          ...(input.targeting !== undefined ? { targeting: input.targeting as Prisma.InputJsonValue } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedById: actor.userId,
        },
        include: this.flagInclude,
      });
      return { before: b, f: updated };
    });
    await this.flags.invalidate();
    await auditAdmin(this.audit, actor, { action: 'feature_flag.update', entity: 'FeatureFlag', entityId: key, before: { webPct: before.webPct, mobilePct: before.mobilePct, targeting: before.targeting, isActive: before.isActive }, after: { webPct: f.webPct, mobilePct: f.mobilePct, targeting: f.targeting, isActive: f.isActive }, reason: input.reason ?? null });
    return this.presentFlag(f);
  }
  async deleteFlag(key: string, actor: PlatformActor) {
    const before = await sys(async () => {
      const b = await prisma.featureFlag.findUnique({ where: { key } });
      if (!b) throw notFound();
      await prisma.featureFlag.delete({ where: { key } });
      return b;
    });
    await this.flags.invalidate();
    await auditAdmin(this.audit, actor, { action: 'feature_flag.delete', entity: 'FeatureFlag', entityId: key, before: { webPct: before.webPct, mobilePct: before.mobilePct, isActive: before.isActive } });
    return { key };
  }
  async evaluateFlag(key: string, workspaceId: string, platform: 'web' | 'mobile'): Promise<FeatureFlagEvaluationDto> {
    const exists = await sys(() => prisma.featureFlag.findUnique({ where: { key } }));
    if (!exists) throw notFound();
    const ws = await sys(() => prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }));
    if (!ws) throw notFound();
    return { key, workspaceId, platform, ...(await this.flags.evaluate(key, workspaceId, platform)) };
  }

  // --- legal documents (PFS-04) -----------------------------------------------------------------------------------------
  private async requiredUsers(key: LegalDocKey): Promise<number> {
    if (key === 'account_deletion') return 0;
    if (key === 'content_rules') return (await prisma.membership.findMany({ where: { role: { in: ['owner', 'admin'] }, user: { deletedAt: null } }, distinct: ['userId'], select: { userId: true } })).length;
    return prisma.user.count({ where: { deletedAt: null } });
  }
  async legalDocuments(): Promise<LegalDocumentDto[]> {
    return sys(async () => {
      const docs = await prisma.legalDocument.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }], include: { publishedBy: userRefSelect, _count: { select: { acceptances: true } } } });
      const required = new Map<string, number>();
      const out: LegalDocumentDto[] = [];
      for (const d of docs) {
        if (!required.has(d.key)) required.set(d.key, await this.requiredUsers(d.key));
        const req = required.get(d.key)!;
        const accepted = d._count.acceptances;
        out.push({ id: d.id, key: d.key, version: d.version, isMajor: d.isMajor, requiresReacceptance: d.requiresReacceptance, cmsEntryId: d.cmsEntryId, publishedAt: d.publishedAt.toISOString(), publishedBy: toUserRef(d.publishedBy), acceptance: { accepted, required: req, pct: req ? Math.min(100, Math.round((accepted / req) * 100)) : 0 } });
      }
      return out;
    });
  }

  /** `POST /admin/legal-documents/:key/publish` — a major version forces re-acceptance + `legal.reacceptance_required`. */
  async publishLegal(key: LegalDocKey, input: LegalPublishInput, actor: PlatformActor): Promise<LegalDocumentDto> {
    const doc = await sysTx(async (tx) => {
      const entry = await tx.cmsEntry.findUnique({ where: { id: input.cmsEntryId } });
      if (!entry || entry.type !== 'legal') throw validationError({ cmsEntryId: 'validation.invalid' });
      const last = await tx.legalDocument.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      if (last && input.version <= last.version) throw conflict({ currentVersion: last.version });
      const requiresReacceptance = input.isMajor && key !== 'account_deletion';
      const d = await tx.legalDocument.create({ data: { key, version: input.version, isMajor: input.isMajor, requiresReacceptance, cmsEntryId: entry.id, publishedById: actor.userId } });
      if (requiresReacceptance) await this.queue.add(tx, 'jobs', 'legal-reacceptance-fanout', { legalDocumentId: d.id }, `legal-fanout:${d.id}`, { attempts: 3 });
      return d;
    });
    await this.legal.invalidate();
    await auditAdmin(this.audit, actor, { action: 'legal.publish', entity: 'LegalDocument', entityId: doc.id, after: { key, version: doc.version, isMajor: doc.isMajor }, reason: input.reason ?? null });
    return (await this.legalDocuments()).find((d) => d.id === doc.id)!;
  }

  /** Job `jobs / legal-reacceptance-fanout`: one in-app + e-mail notification per concerned user (in their first workspace). */
  async legalFanout(legalDocumentId: string) {
    return sys(async () => {
      const doc = await prisma.legalDocument.findUnique({ where: { id: legalDocumentId } });
      if (!doc || !doc.requiresReacceptance) return { notified: 0 };
      const roles = doc.key === 'content_rules' ? (['owner', 'admin'] as const) : undefined;
      let notified = 0;
      let cursor: string | undefined;
      for (;;) {
        const users = await prisma.user.findMany({
          where: { deletedAt: null, memberships: { some: roles ? { role: { in: [...roles] } } : {} } },
          select: { id: true, memberships: { where: roles ? { role: { in: [...roles] } } : {}, orderBy: { createdAt: 'asc' }, take: 1, select: { workspaceId: true } } },
          orderBy: { id: 'asc' },
          take: LEGAL_BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (!users.length) break;
        await prisma.$transaction(async (db) => {
          for (const u of users) {
            const ws = u.memberships[0]?.workspaceId;
            if (!ws) continue;
            await this.notifications.emit(db as Tx, { type: 'legal_reacceptance_required', workspaceId: ws, userIds: [u.id], key: `legal_reacceptance_required:${u.id}:${doc.key}:${doc.version}`, data: { key: doc.key, version: doc.version } });
            notified++;
          }
        });
        cursor = users[users.length - 1]!.id;
      }
      return { notified };
    });
  }

  async acceptanceStats(key: LegalDocKey): Promise<LegalAcceptanceStatsDto> {
    return sys(async () => {
      const doc = await prisma.legalDocument.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      if (!doc) throw notFound();
      const [accepted, byClient, required] = await Promise.all([
        prisma.legalAcceptance.count({ where: { legalDocumentId: doc.id } }),
        prisma.legalAcceptance.groupBy({ by: ['client'], where: { legalDocumentId: doc.id }, _count: { _all: true } }),
        this.requiredUsers(key),
      ]);
      return { key, version: doc.version, accepted, required, pct: required ? Math.min(100, Math.round((accepted / required) * 100)) : 0, byClient: byClient.map((g) => ({ client: g.client, count: g._count._all })) };
    });
  }

  // --- Meta app & permissions (PFS-05) ----------------------------------------------------------------------------------
  private presentPermission(p: Prisma.MetaPermissionGetPayload<object>): MetaPermissionDto {
    return { id: p.id, scope: p.scope, status: p.status, feature: p.feature, submittedAt: iso(p.submittedAt), decidedAt: iso(p.decidedAt), daysInReview: p.status === 'in_review' && p.submittedAt ? Math.floor((Date.now() - p.submittedAt.getTime()) / 86400_000) : null, notes: p.notes, updatedAt: p.updatedAt.toISOString() };
  }
  async metaPermissions(): Promise<MetaPermissionDto[]> {
    return sys(async () => (await prisma.metaPermission.findMany({ orderBy: { scope: 'asc' } })).map((p) => this.presentPermission(p)));
  }
  /** Informational statuses (manual, 04 §15); `instagram_*_messages` approved ⇒ pending Instagram channels activated. */
  async updateMetaPermission(scope: string, input: MetaPermissionPatchInput, actor: PlatformActor): Promise<MetaPermissionDto> {
    const { before, after } = await sys(async () => {
      const b = await prisma.metaPermission.findUnique({ where: { scope } });
      if (!b) throw notFound();
      const now = new Date();
      const a = await prisma.metaPermission.update({
        where: { scope },
        data: {
          status: input.status,
          ...(input.feature ? { feature: input.feature } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          submittedAt: input.submittedAt !== undefined ? (input.submittedAt ? new Date(input.submittedAt) : null) : input.status === 'in_review' && !b.submittedAt ? now : b.submittedAt,
          decidedAt: input.decidedAt !== undefined ? (input.decidedAt ? new Date(input.decidedAt) : null) : (input.status === 'approved' || input.status === 'rejected') && b.status !== input.status ? now : b.decidedAt,
        },
      });
      return { before: b, after: a };
    });
    await auditAdmin(this.audit, actor, { action: 'meta.permission', entity: 'MetaPermission', entityId: scope, before: { status: before.status }, after: { status: after.status } });
    // DB-only activation (no Meta call): the same routine as `sched-meta-review-poll`
    if (after.status === 'approved' && before.status !== 'approved' && INSTAGRAM_SCOPES.has(scope)) await this.channels.applyApprovals();
    return this.presentPermission(after);
  }
  async metaApp(): Promise<MetaAppDto> {
    return sys(async () => {
      const [row, pending] = await Promise.all([prisma.platformSetting.findUnique({ where: { key: 'meta_app' } }), prisma.channel.count({ where: { platform: 'instagram', status: 'pending_review' } })]);
      const v = (row?.value ?? {}) as { appId?: string; secret?: string };
      return {
        appId: v.appId ?? null,
        secretSet: !!v.secret,
        webhookUrl: `${this.config.get('PUBLIC_API_URL').replace(/\/$/, '')}/api/v1/webhooks/meta`,
        verifyTokenSet: !!this.config.get('META_VERIFY_TOKEN'),
        ackRate24hPct: null,
        mode: this.config.get('META_DRIVER' as never) === 'graph' ? 'live' : 'development',
        pendingInstagramChannels: pending,
      };
    });
  }
  /** Stored for reference only (the secret encrypted, never returned); it never changes anything at Meta. */
  async setMetaApp(input: { appId: string; appSecret?: string }, actor: PlatformActor): Promise<MetaAppDto> {
    await sysTx(async (tx) => {
      const current = await tx.platformSetting.findUnique({ where: { key: 'meta_app' } });
      const prev = (current?.value ?? {}) as { secret?: string };
      const value = { appId: input.appId, ...(input.appSecret ? { secret: this.crypto.encrypt(input.appSecret) } : prev.secret ? { secret: prev.secret } : {}) };
      await this.writeSetting(tx, 'meta_app', value, actor, null);
    });
    await auditAdmin(this.audit, actor, { action: 'meta.app', entity: 'PlatformSetting', entityId: 'meta_app', after: { appId: input.appId, secretReplaced: !!input.appSecret } });
    return this.metaApp();
  }

  // --- technical providers (PFS-06) -------------------------------------------------------------------------------------
  private warnings(p: PlatformProvider): string[] {
    const w: string[] = [];
    const balance = Number((p.quota as { balance?: unknown } | null)?.balance);
    if (p.key === 'sms' && Number.isFinite(balance) && balance < SMS_BALANCE_WARN) w.push('sms_balance_low');
    if (p.key === 'push' && p.expiresAt && p.expiresAt.getTime() - Date.now() < APNS_WARN_DAYS * 86400_000) w.push('apns_expiring');
    return w;
  }
  private presentProvider(p: PlatformProvider): PlatformProviderDto {
    return { key: p.key as ProviderKey, kind: p.kind, config: (p.config ?? {}) as Record<string, unknown>, secretSet: !!p.secret, status: p.status, lastCheckedAt: iso(p.lastCheckedAt), lastError: p.lastError, quota: (p.quota ?? null) as Record<string, unknown> | null, expiresAt: iso(p.expiresAt), warnings: this.warnings(p), updatedAt: p.updatedAt.toISOString() };
  }
  async providers(): Promise<PlatformProviderDto[]> {
    return sys(async () => {
      const rows = await prisma.platformProvider.findMany();
      return PROVIDER_KEYS.map((k) => rows.find((r) => r.key === k)).filter((r): r is PlatformProvider => !!r).map((r) => this.presentProvider(r));
    });
  }
  private assertKey(key: string): asserts key is ProviderKey {
    if (!(PROVIDER_KEYS as readonly string[]).includes(key)) throw notFound();
  }
  async updateProvider(key: string, input: ProviderUpdateInput, actor: PlatformActor): Promise<PlatformProviderDto> {
    this.assertKey(key);
    const cfg = input.config as Record<string, unknown>;
    const expires = typeof cfg.apnsExpiresAt === 'string' && !Number.isNaN(Date.parse(cfg.apnsExpiresAt)) ? new Date(cfg.apnsExpiresAt) : undefined;
    const balance = typeof cfg.balance === 'number' ? cfg.balance : undefined;
    const row = await sys(() =>
      prisma.platformProvider.upsert({
        where: { key },
        create: { key, kind: key.split('_')[0]!, config: cfg as Prisma.InputJsonValue, ...(input.secret ? { secret: Buffer.from(this.crypto.encrypt(input.secret), 'utf8') } : {}), ...(expires ? { expiresAt: expires } : {}), ...(balance !== undefined ? { quota: { balance } } : {}) },
        update: { config: cfg as Prisma.InputJsonValue, ...(input.secret ? { secret: Buffer.from(this.crypto.encrypt(input.secret), 'utf8') } : {}), ...(expires ? { expiresAt: expires } : {}), ...(balance !== undefined ? { quota: { balance } } : {}) },
      }),
    );
    await auditAdmin(this.audit, actor, { action: 'provider.update', entity: 'PlatformProvider', entityId: key, after: { config: cfg, secretReplaced: !!input.secret }, reason: input.reason ?? null });
    return this.presentProvider(row);
  }

  /**
   * `POST /admin/providers/:key/test` — minimal check through the local driver (every driver is fake here: no external call).
   * `config.simulate ∈ ok|rejected|unreachable` forces a state (dev); otherwise ok when the driver is fake or a secret is set,
   * rejected when credentials are missing. Writes status / lastCheckedAt / lastError.
   */
  async testProvider(key: string, actor: PlatformActor): Promise<ProviderTestResultDto> {
    this.assertKey(key);
    const started = Date.now();
    const p = await sys(() => prisma.platformProvider.findUnique({ where: { key } }));
    if (!p) throw notFound();
    const cfg = (p.config ?? {}) as Record<string, unknown>;
    const simulate = cfg.simulate === 'rejected' || cfg.simulate === 'unreachable' || cfg.simulate === 'ok' ? cfg.simulate : null;
    const hasCredentials = !!p.secret || (key === 'google_oauth' && !!(cfg.clientId || this.config.get('GOOGLE_CLIENT_ID')));
    const fake = FAKE_DRIVER[key]?.(this.config) ?? false;
    const state: ProviderTestResultDto['state'] = simulate ?? (fake || hasCredentials ? 'ok' : 'rejected');
    const latencyMs = Math.max(1, Date.now() - started + (typeof cfg.latencyMs === 'number' ? cfg.latencyMs : 0));
    const error = state === 'ok' ? null : state === 'rejected' ? 'credentials_rejected' : 'PROVIDER_UNAVAILABLE';
    const quota = key === 'sms' && state === 'ok' ? { balance: typeof cfg.balance === 'number' ? cfg.balance : Number((p.quota as { balance?: number } | null)?.balance ?? 5000) } : undefined;
    const updated = await sys(() =>
      prisma.platformProvider.update({ where: { key }, data: { status: state === 'ok' ? 'ok' : 'error', lastCheckedAt: new Date(), lastError: error, ...(quota ? { quota } : {}) } }),
    );
    const status = state === 'ok' && this.warnings(updated).length ? 'warning' : updated.status;
    if (status !== updated.status) await sys(() => prisma.platformProvider.update({ where: { key }, data: { status } }));
    await auditAdmin(this.audit, actor, { action: 'provider.test', entity: 'PlatformProvider', entityId: key, after: { state, latencyMs } });
    return { key, state, latencyMs, status, error, checkedAt: (updated.lastCheckedAt ?? new Date()).toISOString() };
  }
}
