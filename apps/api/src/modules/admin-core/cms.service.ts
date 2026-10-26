// ADM-08 CMS per locale (D26): entries by type, FR / AR / EN statuses, scheduling window (`sched-cms-publish`), publish with
// `CMS_LOCALE_MISSING` unless "replier sur FR", versions, signed preview link, AI translation from FR (worker job).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ActionDescriptor, AdminCmsCounts, AdminCmsQuery, AdminCreateCmsInput, AdminPatchCmsInput, AdminPutCmsLocaleInput, CmsEntryAdminDto, CmsPreviewLinkDto, CmsVersionDto } from '@djaber/shared';
import { Prisma, prisma, TenantContext, type CmsEntry, type CmsEntryLocale, type Job, type Locale, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { TokenService } from '../../core/auth/token.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { AI_GATEWAY, type AiGateway } from '../ai/provider/ai.gateway';
import { RoutingService } from '../ai/routing.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { announcementTargetWhere } from '../public-site/announcements.service';
import { AdminJobsService } from './admin-jobs.service';
import { assertUuid, iso, userRef, userSelect, type AdminActor } from './admin.util';

/** Types with a public page (`/legal/:key`, `/help/:key`, `/preview/cms/:key` ⇒ page): only they get a signed preview link. */
const PREVIEWABLE: readonly string[] = ['legal', 'help', 'page'];

const LOCALES: Locale[] = ['fr', 'ar', 'en'];
const SLUG = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const TYPES = ['announcement', 'legal', 'help', 'email', 'plan_text', 'system_message_default', 'page'] as const;
type Full = CmsEntry & { locales: (CmsEntryLocale & { updatedBy: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null } | null })[]; versions: { version: number; at: Date; createdBy: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null } | null }[]; createdBy: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null } | null };

@Injectable()
export class CmsAdminService implements OnModuleInit {
  constructor(
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly registry: ProcessorRegistry,
    private readonly jobs: AdminJobsService,
    private readonly notifications: NotificationProducer,
    private readonly routing: RoutingService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-cms-publish', '*/5 * * * *', () => this.publishDue());
    this.jobs.handle('cms-translate', (job) => this.runTranslate(job));
  }

  private async log(actor: AdminActor, action: string, id: string, before: unknown, after: unknown, reason: string | null = null) {
    await this.audit.write({ actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity: 'CmsEntry', entityId: id, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }
  private readonly include = { locales: { include: { updatedBy: { select: userSelect } } }, versions: { include: { createdBy: { select: userSelect } }, orderBy: { version: 'desc' as const } }, createdBy: { select: userSelect } };

  private filled(l: CmsEntryLocale | undefined) {
    return !!l && !!l.title.trim() && !!l.body.trim();
  }

  private dto(e: Full, actor: AdminActor): CmsEntryAdminDto {
    const can = canPlatform(actor.platformRole, 'admin.cms.write');
    const a = (key: string, ok = true): ActionDescriptor => (can && ok ? { key, enabled: true } : { key, enabled: false, reasonCode: can ? 'CONFLICT' : 'FORBIDDEN' });
    const missing = LOCALES.filter((l) => !this.filled(e.locales.find((x) => x.locale === l)));
    const last = [...e.locales].sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())[0];
    return {
      id: e.id,
      key: e.key,
      type: e.type,
      category: e.category,
      target: (e.target ?? {}) as Record<string, unknown>,
      channels: e.channels,
      startsAt: iso(e.startsAt),
      endsAt: iso(e.endsAt),
      link: e.link,
      sortOrder: e.sortOrder,
      status: e.status,
      currentVersion: e.currentVersion,
      locales: LOCALES.map((loc) => {
        const l = e.locales.find((x) => x.locale === loc);
        return { locale: loc, title: l?.title ?? '', body: l?.body ?? '', status: this.filled(l) ? l!.status : 'missing', fallbackToFr: l?.fallbackToFr ?? false, updatedBy: userRef(l?.updatedBy ?? null), updatedAt: iso(l?.updatedAt ?? null) };
      }),
      versions: e.versions.map((v) => ({ version: v.version, publishedAt: v.at.toISOString(), publishedBy: userRef(v.createdBy) })),
      createdBy: userRef(e.createdBy),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      updatedBy: userRef(last?.updatedBy ?? null) ?? userRef(e.createdBy),
      actions: [
        { ...a('edit', e.status !== 'archived'), primary: true },
        a('publish', e.status !== 'published' && !missing.includes('fr')),
        a('schedule', e.status !== 'published'),
        a('unpublish', e.status === 'published' || e.status === 'scheduled'),
        a('translate', !missing.includes('fr')),
        // tester report 22/10 UX-025: the signed 24 h link is for the entries with a public page only (03 PUB-03); an
        // announcement is previewed as its banner in the editor, e-mails / plan texts / system messages have no page
        ...(PREVIEWABLE.includes(e.type) ? [{ key: 'preview', enabled: true }] : []),
        { key: 'versions', enabled: e.currentVersion > 0 },
      ],
    };
  }

  async list(q: AdminCmsQuery, actor: AdminActor): Promise<Page<CmsEntryAdminDto> & { meta: { counts: AdminCmsCounts } }> {
    const and: Prisma.CmsEntryWhereInput[] = [];
    if (q.type?.length) and.push({ type: { in: q.type as never } });
    if (q.status?.length) and.push({ status: { in: q.status as never } });
    if (q.missingLocale) and.push({ NOT: { locales: { some: { locale: q.missingLocale, title: { not: '' }, body: { not: '' } } } } });
    if (q.target) and.push({ target: { path: ['scope'], equals: q.target } });
    if (q.updatedById) and.push({ locales: { some: { updatedById: q.updatedById } } });
    if (q.q) and.push({ OR: [{ key: { contains: q.q, mode: 'insensitive' } }, { locales: { some: { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }] } } }] });
    const where: Prisma.CmsEntryWhereInput = and.length ? { AND: and } : {};
    const [total, rows, counts] = await Promise.all([
      prisma.cmsEntry.count({ where }),
      prisma.cmsEntry.findMany({ where, include: this.include, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.cmsEntry.groupBy({ by: ['type'], _count: { _all: true } }),
    ]);
    return { ...page(rows.map((e) => this.dto(e as Full, actor)), total, q), meta: { counts: Object.fromEntries(TYPES.map((t) => [t, counts.find((c) => c.type === t)?._count._all ?? 0])) as AdminCmsCounts } };
  }

  private async full(id: string): Promise<Full> {
    assertUuid(id);
    const e = await prisma.cmsEntry.findUnique({ where: { id }, include: this.include });
    if (!e) throw notFound();
    return e as Full;
  }

  async get(id: string, actor: AdminActor) {
    return this.dto(await this.full(id), actor);
  }

  private window(startsAt?: string | null, endsAt?: string | null) {
    const s = startsAt ? new Date(startsAt) : null;
    const e = endsAt ? new Date(endsAt) : null;
    if (s && e && e <= s) throw new AppException('VALIDATION_ERROR', {}, { endsAt: 'validation.range' });
    return { s, e };
  }

  async create(input: AdminCreateCmsInput, actor: AdminActor) {
    const key = input.key.trim().toLowerCase();
    if (!SLUG.test(key) || key.length > 80) throw new AppException('CMS_SLUG_INVALID', {}, { key: 'validation.slug' });
    if (await prisma.cmsEntry.findUnique({ where: { key } })) throw new AppException('CMS_SLUG_TAKEN', {}, { key: 'validation.taken' });
    const { s, e } = this.window(input.startsAt, input.endsAt);
    const row = await prisma.$transaction(async (db) => {
      const entry = await db.cmsEntry.create({ data: { key, type: input.type, category: input.category ?? null, target: (input.target ?? {}) as Prisma.InputJsonValue, channels: input.channels ?? [], startsAt: s, endsAt: e, link: input.link ?? null, sortOrder: input.sortOrder ?? 0, createdById: actor.userId } });
      for (const loc of LOCALES) {
        const l = input.locales?.[loc as 'fr' | 'ar' | 'en'];
        await db.cmsEntryLocale.create({ data: { entryId: entry.id, locale: loc, title: l?.title ?? '', body: l?.body ?? '', status: l && l.title && l.body ? 'draft' : 'missing', fallbackToFr: l?.fallbackToFr ?? false, updatedById: actor.userId } });
      }
      return entry;
    });
    await this.log(actor, 'cms.create', row.id, null, { key, type: input.type });
    return this.get(row.id, actor);
  }

  async patch(id: string, input: AdminPatchCmsInput, actor: AdminActor) {
    const e = await this.full(id);
    const { s, e: end } = this.window(input.startsAt === undefined ? iso(e.startsAt) : input.startsAt, input.endsAt === undefined ? iso(e.endsAt) : input.endsAt);
    await prisma.cmsEntry.update({
      where: { id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.target !== undefined ? { target: input.target as Prisma.InputJsonValue } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.startsAt !== undefined ? { startsAt: s } : {}),
        ...(input.endsAt !== undefined ? { endsAt: end } : {}),
        ...(input.link !== undefined ? { link: input.link } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await this.log(actor, 'cms.update', id, Object.fromEntries(Object.keys(input).map((k) => [k, (e as Record<string, unknown>)[k]])), input);
    return this.get(id, actor);
  }

  async putLocale(id: string, locale: string, input: AdminPutCmsLocaleInput, actor: AdminActor) {
    if (!LOCALES.includes(locale as Locale)) throw notFound();
    const e = await this.full(id);
    const filled = !!input.title.trim() && !!input.body.trim();
    await prisma.cmsEntryLocale.upsert({
      where: { entryId_locale: { entryId: id, locale: locale as Locale } },
      create: { entryId: id, locale: locale as Locale, title: input.title, body: input.body, status: filled ? 'draft' : 'missing', fallbackToFr: input.fallbackToFr ?? false, updatedById: actor.userId },
      update: { title: input.title, body: input.body, status: filled ? 'draft' : 'missing', ...(input.fallbackToFr !== undefined ? { fallbackToFr: input.fallbackToFr } : {}), updatedById: actor.userId },
    });
    await prisma.cmsEntry.update({ where: { id }, data: { updatedAt: new Date() } });
    await this.log(actor, 'cms.locale_update', id, { locale, title: e.locales.find((l) => l.locale === locale)?.title ?? null }, { locale, title: input.title, bodyChars: input.body.length });
    return this.get(id, actor);
  }

  /** Locale rule: FR always required; AR / EN required unless "replier sur FR" (`CMS_LOCALE_MISSING {locales}`). */
  private checkLocales(e: Full, fallbackToFr: boolean | undefined) {
    const missing = LOCALES.filter((l) => !this.filled(e.locales.find((x) => x.locale === l)));
    if (missing.includes('fr')) throw new AppException('CMS_LOCALE_MISSING', { locales: missing.join(', ') });
    const unresolved = missing.filter((l) => !fallbackToFr && !e.locales.find((x) => x.locale === l)?.fallbackToFr);
    if (unresolved.length) throw new AppException('CMS_LOCALE_MISSING', { locales: unresolved.join(', ') });
    return missing;
  }

  private async doPublish(tx: Tx, e: Full, missing: Locale[], byId: string) {
    const version = e.currentVersion + 1;
    for (const l of LOCALES) {
      if (missing.includes(l)) await tx.cmsEntryLocale.updateMany({ where: { entryId: e.id, locale: l }, data: { fallbackToFr: true, status: 'missing' } });
      else await tx.cmsEntryLocale.updateMany({ where: { entryId: e.id, locale: l }, data: { status: 'published' } });
    }
    await tx.cmsEntry.update({ where: { id: e.id }, data: { status: 'published', currentVersion: version, ...(e.startsAt && e.startsAt > new Date() ? {} : {}) } });
    await tx.cmsEntryVersion.create({ data: { entryId: e.id, version, createdById: byId, snapshot: { type: e.type, target: e.target, channels: e.channels, startsAt: iso(e.startsAt), endsAt: iso(e.endsAt), link: e.link, locales: e.locales.map((l) => ({ locale: l.locale, title: l.title, body: l.body, fallbackToFr: missing.includes(l.locale) || l.fallbackToFr })) } as Prisma.InputJsonValue } });
    // 03-events §5.1 `platform.announcement`: in-app to the targeted workspaces (target.scope paid / free / trial and / or
    // target.planSlugs / target.workspaceIds; none = all) — the same rule as the merchant banner (`GET /announcements`)
    if (e.type === 'announcement' && (e.channels.length === 0 || e.channels.some((c) => c === 'in_app' || c === 'banner' || c === 'email' || c === 'push'))) {
      const wss = await tx.workspace.findMany({
        where: { deletedAt: null, status: 'active', ...announcementTargetWhere(e.target) },
        select: { id: true },
        take: 10_000,
      });
      for (const w of wss) {
        await TenantContext.runAs(w.id, () => this.notifications.emit(tx, { type: 'platform_announcement', workspaceId: w.id, target: { owner: true }, key: `platform_announcement:${e.id}:${version}:${w.id}`, data: { cmsEntryId: e.id, title: e.locales.find((l) => l.locale === 'fr')?.title ?? '' } }));
      }
    }
    return version;
  }

  async publish(id: string, fallbackToFr: boolean | undefined, actor: AdminActor) {
    const e = await this.full(id);
    const missing = this.checkLocales(e, fallbackToFr);
    const version = await prisma.$transaction((db) => this.doPublish(db as Tx, e, missing, actor.userId), { timeout: 60_000 });
    await this.log(actor, 'cms.publish', id, { status: e.status, version: e.currentVersion }, { status: 'published', version, fallbackLocales: missing });
    return this.get(id, actor);
  }

  async schedule(id: string, input: { startsAt: string; endsAt?: string | null; fallbackToFr?: boolean }, actor: AdminActor) {
    const e = await this.full(id);
    this.checkLocales(e, input.fallbackToFr);
    const { s, e: end } = this.window(input.startsAt, input.endsAt === undefined ? iso(e.endsAt) : input.endsAt);
    if (!s || s <= new Date()) throw new AppException('VALIDATION_ERROR', {}, { startsAt: 'validation.range' });
    await prisma.$transaction(async (db) => {
      await db.cmsEntry.update({ where: { id }, data: { status: 'scheduled', startsAt: s, endsAt: end } });
      if (input.fallbackToFr) await db.cmsEntryLocale.updateMany({ where: { entryId: id, OR: [{ title: '' }, { body: '' }] }, data: { fallbackToFr: true } });
    });
    await this.log(actor, 'cms.schedule', id, { status: e.status, startsAt: iso(e.startsAt) }, { status: 'scheduled', startsAt: s.toISOString(), endsAt: iso(end) });
    return this.get(id, actor);
  }

  async unpublish(id: string, actor: AdminActor) {
    const e = await this.full(id);
    if (e.status !== 'published' && e.status !== 'scheduled') throw new AppException('CONFLICT', {}, {}, { status: e.status });
    await prisma.$transaction(async (db) => {
      await db.cmsEntry.update({ where: { id }, data: { status: 'draft' } });
      await db.cmsEntryLocale.updateMany({ where: { entryId: id, status: 'published' }, data: { status: 'draft' } });
    });
    await this.log(actor, 'cms.unpublish', id, { status: e.status }, { status: 'draft' });
    return this.get(id, actor);
  }

  /** `sched-cms-publish` (every 5 min): scheduled entries whose `startsAt` is reached are published (version +1). */
  async publishDue(now = new Date()): Promise<number> {
    return TenantContext.runSystem(async () => {
      const due = await prisma.cmsEntry.findMany({ where: { status: 'scheduled', startsAt: { lte: now } }, include: this.include });
      let n = 0;
      for (const e of due) {
        const missing = LOCALES.filter((l) => !this.filled(e.locales.find((x) => x.locale === l)));
        if (missing.includes('fr')) continue;
        await prisma.$transaction((db) => this.doPublish(db as Tx, e as Full, missing, e.createdById), { timeout: 60_000 });
        await this.audit.write({ actorType: 'system', action: 'cms.publish', entity: 'CmsEntry', entityId: e.id, after: { scheduled: true } });
        n++;
      }
      return n;
    });
  }

  async versions(id: string): Promise<CmsVersionDto[]> {
    await this.full(id);
    const rows = await prisma.cmsEntryVersion.findMany({ where: { entryId: id }, include: { createdBy: { select: userSelect } }, orderBy: { version: 'desc' } });
    return rows.map((v) => ({ version: v.version, snapshot: v.snapshot as Record<string, unknown>, createdBy: userRef(v.createdBy), at: v.at.toISOString() }));
  }

  /** Signed preview URL, 24 h (the public CMS pages accept `?preview=<token>`). */
  async previewLink(id: string): Promise<CmsPreviewLinkDto> {
    const e = await this.full(id);
    if (!PREVIEWABLE.includes(e.type)) throw notFound();
    const ttl = 24 * 3600;
    const token = await this.tokens.signPurpose('cms_preview', { entryId: e.id, key: e.key }, ttl);
    const base = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    const path = e.type === 'legal' ? `/legal/${e.key}` : e.type === 'help' ? `/help/${e.key}` : `/preview/cms/${e.key}`;
    return { url: `${base}${path}?preview=${encodeURIComponent(token)}`, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }

  /** `POST /admin/cms/:id/translate { to }` → 202 `{ jobId }` (AI never called from the HTTP handler). */
  async translate(id: string, to: ('ar' | 'en')[], actor: AdminActor) {
    const e = await this.full(id);
    if (!this.filled(e.locales.find((l) => l.locale === 'fr'))) throw new AppException('CMS_LOCALE_MISSING', { locales: 'fr' });
    const job = await this.jobs.create('translate', 'cms-translate', { entryId: id, to }, actor.userId);
    await this.log(actor, 'cms.translate', id, null, { to, jobId: job.id });
    return { jobId: job.id };
  }

  private async runTranslate(job: Job) {
    const p = job.payload as { entryId: string; to: ('ar' | 'en')[] };
    const e = await prisma.cmsEntry.findUnique({ where: { id: p.entryId }, include: { locales: true } });
    if (!e) throw new AppException('NOT_FOUND');
    const fr = e.locales.find((l) => l.locale === 'fr')!;
    const done: string[] = [];
    for (const loc of p.to) {
      const translate = async (text: string) => {
        if (!text.trim()) return text;
        if (this.gateway.driver !== 'live') return `[${loc.toUpperCase()}] ${text}`;
        const r = await this.routing.call('text', (model, timeoutMs) => this.gateway.generate({ model: model.ref, purpose: 'reply', system: `Translate the user's text from French to ${loc === 'ar' ? 'Arabic (Modern Standard, Algerian audience)' : 'English'}. Keep Markdown, links and {placeholders} unchanged. Answer with the translation only.`, messages: [{ role: 'user', content: text }], maxTokens: 4000, timeoutMs }));
        return r.value.text.trim();
      };
      const [title, body] = [await translate(fr.title), await translate(fr.body)];
      await prisma.cmsEntryLocale.upsert({ where: { entryId_locale: { entryId: e.id, locale: loc } }, create: { entryId: e.id, locale: loc, title, body, status: 'draft', updatedById: job.createdById! }, update: { title, body, status: 'draft', updatedById: job.createdById! } });
      done.push(loc);
    }
    return { result: { entryId: e.id, locales: done } };
  }
}
