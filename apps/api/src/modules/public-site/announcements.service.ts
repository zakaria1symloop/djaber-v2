// ADM-08 announcements on the reader side (06 §8.1 `GET /announcements` · `POST /announcements/:id/dismiss`, route map §2
// layout hooks; tester report 2026-10-21 UX-005). An announcement reaches:
// - the merchant app (channel `banner`): one dismissible banner per live announcement whose target matches the workspace;
// - the public site (channel `web`): announcements meant for every workspace;
// - the notification `platform.announcement` (sent at publication, `CmsAdminService.doPublish`), which opens it by id.
// Target = `{ scope: all | paid | free | trial }` (admin editor) and / or `{ planSlugs[], workspaceIds[] }` (05 data model).
import { Injectable } from '@nestjs/common';
import type { AnnouncementView } from '@djaber/shared';
import { prisma, TenantContext, type Prisma } from '@djaber/db';
import { notFound } from '../../core/errors/app.exception';
import { prefsOf } from '../auth/me.service';

type Locale = 'fr' | 'ar' | 'en';
type Target = { scope?: string; planSlugs?: string[]; workspaceIds?: string[] };
const LIVE_SUBSCRIPTION = ['trial', 'active', 'dunning'] as const;
/** Dismissed ids kept per user (the oldest go first). */
const MAX_DISMISSED = 100;

/** Workspaces an announcement targets (`{}` = every workspace). */
export const announcementTargetWhere = (target: unknown): Prisma.WorkspaceWhereInput => {
  const t = (target && typeof target === 'object' ? target : {}) as Target;
  const and: Prisma.WorkspaceWhereInput[] = [];
  if (Array.isArray(t.workspaceIds) && t.workspaceIds.length) and.push({ id: { in: t.workspaceIds } });
  if (Array.isArray(t.planSlugs) && t.planSlugs.length) and.push({ subscriptions: { some: { status: { in: [...LIVE_SUBSCRIPTION] }, plan: { slug: { in: t.planSlugs } } } } });
  if (t.scope === 'trial') and.push({ subscriptions: { some: { status: 'trial' } } });
  if (t.scope === 'paid') and.push({ subscriptions: { some: { status: { in: ['active', 'dunning'] }, plan: { priceMonthly: { gt: 0 } } } } });
  if (t.scope === 'free') and.push({ subscriptions: { some: { status: { in: ['active', 'dunning'] }, plan: { priceMonthly: 0 } } } });
  return and.length ? { AND: and } : {};
};

/** An announcement for everybody (no scope / plan / workspace restriction): the only ones the public site shows. */
export const isForEveryone = (target: unknown) => Object.keys(announcementTargetWhere(target)).length === 0;

const include = { locales: true, versions: { orderBy: { version: 'desc' as const }, take: 1 } } as const satisfies Prisma.CmsEntryInclude;
type Row = Prisma.CmsEntryGetPayload<{ include: typeof include }>;

const live = (now: Date, channel: 'banner' | 'web'): Prisma.CmsEntryWhereInput => ({
  type: 'announcement',
  status: 'published',
  channels: { has: channel },
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});

@Injectable()
export class AnnouncementsService {
  private present(e: Row, locale: Locale, now: Date, dismissed: Set<string>): AnnouncementView | null {
    // a locale left out at publication ("replier sur FR") reads the French text; a withdrawn one keeps its French text
    const published = e.locales.filter((l) => l.status === 'published');
    const loc = published.find((l) => l.locale === locale) ?? published.find((l) => l.locale === 'fr') ?? e.locales.find((l) => l.locale === 'fr' && l.title.trim());
    if (!loc) return null;
    const state: AnnouncementView['state'] =
      e.status !== 'published' && e.status !== 'scheduled' ? 'withdrawn' : e.status === 'scheduled' || (e.startsAt && e.startsAt > now) ? 'scheduled' : e.endsAt && e.endsAt <= now ? 'ended' : 'live';
    return {
      id: e.id,
      key: e.key,
      title: loc.title,
      body: loc.body,
      link: e.link,
      locale: loc.locale as Locale,
      fallback: loc.locale !== locale,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      publishedAt: (e.versions[0]?.at ?? e.updatedAt).toISOString(),
      state,
      dismissed: dismissed.has(e.id),
    };
  }

  private async dismissedOf(userId: string) {
    const u = await TenantContext.runSystem(() => prisma.user.findUnique({ where: { id: userId }, select: { prefs: true } }));
    return new Set(prefsOf(u?.prefs).dismissedAnnouncementIds);
  }

  private async targets(workspaceId: string, target: unknown) {
    const where = announcementTargetWhere(target);
    if (!Object.keys(where).length) return true;
    return (await TenantContext.runSystem(() => prisma.workspace.count({ where: { id: workspaceId, ...where } }))) > 0;
  }

  /** `GET /announcements` — live banner announcements of my workspace, newest first, the dismissed ones left out. */
  async list(userId: string, locale: Locale): Promise<AnnouncementView[]> {
    const now = new Date();
    const workspaceId = TenantContext.workspaceId();
    const [rows, dismissed] = await Promise.all([TenantContext.runSystem(() => prisma.cmsEntry.findMany({ where: live(now, 'banner'), include, orderBy: [{ startsAt: 'desc' }, { updatedAt: 'desc' }], take: 20 })), this.dismissedOf(userId)]);
    const out: AnnouncementView[] = [];
    for (const r of rows) {
      if (dismissed.has(r.id) || !(await this.targets(workspaceId, r.target))) continue;
      const v = this.present(r, locale, now, dismissed);
      if (v) out.push(v);
    }
    return out;
  }

  /** `GET /announcements/:id` — the announcement a notification points to (published once), also when it is over or withdrawn (`state` tells why it is not shown any more). */
  async get(userId: string, id: string, locale: Locale): Promise<AnnouncementView> {
    const now = new Date();
    const r = await TenantContext.runSystem(() => prisma.cmsEntry.findFirst({ where: { id, type: 'announcement', currentVersion: { gt: 0 } }, include }));
    if (!r || !(await this.targets(TenantContext.workspaceId(), r.target))) throw notFound();
    const v = this.present(r, locale, now, await this.dismissedOf(userId));
    if (!v) throw notFound();
    return v;
  }

  /** `POST /announcements/:id/dismiss` — kept in `User.prefs.dismissedAnnouncementIds` (idempotent). */
  async dismiss(userId: string, id: string): Promise<void> {
    await this.get(userId, id, 'fr');
    await TenantContext.runSystem(async () => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { prefs: true } });
      const prefs = prefsOf(u.prefs);
      if (prefs.dismissedAnnouncementIds.includes(id)) return;
      const ids = [...prefs.dismissedAnnouncementIds, id].slice(-MAX_DISMISSED);
      await prisma.user.update({ where: { id: userId }, data: { prefs: { ...((u.prefs as Record<string, unknown> | null) ?? {}), ...prefs, dismissedAnnouncementIds: ids } } });
    });
  }

  /** `GET /cms/announcements` (public) — live `web` announcements meant for every workspace. */
  async publicList(locale: Locale): Promise<AnnouncementView[]> {
    const now = new Date();
    const rows = await TenantContext.runSystem(() => prisma.cmsEntry.findMany({ where: live(now, 'web'), include, orderBy: [{ startsAt: 'desc' }, { updatedAt: 'desc' }], take: 5 }));
    return rows.filter((r) => isForEveryone(r.target)).map((r) => this.present(r, locale, now, new Set())).filter((x): x is AnnouncementView => !!x);
  }
}
