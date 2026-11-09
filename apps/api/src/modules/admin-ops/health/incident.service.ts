// OPS-05 (03 §27, 03-events §3.2): incidents declared from ADM-14 feed the public status page, the optional incident
// banner (PlatformSetting `incident_banner`, PFS-03) and the e-mails to the verified status subscribers (outbox).
import { Injectable } from '@nestjs/common';
import { prisma, Prisma, type Incident, type Tx } from '@djaber/db';
import type { IncidentCreateInput, IncidentDto, IncidentUpdateInput, OpsLocalizedText } from '@djaber/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { ConfigService } from '../../../core/config/config.service';
import { notFound } from '../../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../../core/http/pagination';
import { MailOutbox } from '../../../core/mail/mail.outbox';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { auditAdmin, iso, pick, sys, sysTx, toUserRef, userRefSelect, type PlatformActor } from '../admin-ops.util';
import { unsubscribeToken } from './status-page.service';
import { AdminNotifier } from '../../notifications/admin-notifier.service';

const include = {
  createdBy: userRefSelect,
  updates: { orderBy: { at: 'desc' }, include: { author: userRefSelect } },
  _count: { select: { tickets: true } },
} as const satisfies Prisma.IncidentInclude;
type Row = Prisma.IncidentGetPayload<{ include: typeof include }>;
export type IncidentBannerValue = { visible: boolean; text: OpsLocalizedText | null; incidentId?: string | null };

const RESOLVED_TEXT: OpsLocalizedText = { fr: 'Incident résolu.', ar: 'تم حل الحادث.', en: 'Incident resolved.' };
const STATUS_LABEL: Record<string, Record<string, string>> = {
  open: { fr: 'En cours', ar: 'جارٍ', en: 'Ongoing' },
  identified: { fr: 'Cause identifiée', ar: 'تم تحديد السبب', en: 'Identified' },
  monitoring: { fr: 'Sous surveillance', ar: 'تحت المراقبة', en: 'Monitoring' },
  resolved: { fr: 'Résolu', ar: 'تم الحل', en: 'Resolved' },
};

/** Versioned write of a platform setting (PlatformSetting + PlatformSettingVersion), as ADM-13 does. */
export const writeSetting = async (tx: Tx, key: string, value: unknown, actorId: string, reason: string | null) => {
  const json = value as Prisma.InputJsonValue;
  const current = await tx.platformSetting.findUnique({ where: { key } });
  const row = current
    ? await tx.platformSetting.update({ where: { key }, data: { value: json, version: current.version + 1, updatedById: actorId } })
    : await tx.platformSetting.create({ data: { key, value: json, version: 1, updatedById: actorId } });
  await tx.platformSettingVersion.create({ data: { settingId: row.id, version: row.version, value: json, changedById: actorId, reason } });
  return row;
};

@Injectable()
export class IncidentService {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly mail: MailOutbox,
    private readonly config: ConfigService,
    private readonly admins: AdminNotifier,
  ) {}

  present(r: Row, bannerIncidentId: string | null): IncidentDto {
    const end = r.resolvedAt?.getTime() ?? null;
    return {
      id: r.id,
      title: r.title as OpsLocalizedText,
      status: r.status,
      severity: r.severity,
      components: r.components,
      startedAt: r.startedAt.toISOString(),
      identifiedAt: iso(r.identifiedAt),
      resolvedAt: iso(r.resolvedAt),
      durationMinutes: end ? Math.max(0, Math.round((end - r.startedAt.getTime()) / 60_000)) : null,
      affectedWorkspaces: r.affectedWorkspaces,
      bannerVisible: bannerIncidentId === r.id,
      postMortem: r.postMortem,
      createdBy: toUserRef(r.createdBy)!,
      updates: r.updates.map((u) => ({ id: u.id, status: u.status, body: u.body as OpsLocalizedText, author: toUserRef(u.author)!, at: u.at.toISOString() })),
      tickets: r._count.tickets,
    };
  }

  private async bannerIncident(db: Tx | typeof prisma = prisma): Promise<string | null> {
    const s = await db.platformSetting.findUnique({ where: { key: 'incident_banner' } });
    const v = s?.value as IncidentBannerValue | null;
    return v?.visible && v.incidentId ? v.incidentId : null;
  }

  async list(q: { page: number; pageSize: number; status?: string[] }): Promise<Page<IncidentDto>> {
    return sys(async () => {
      const where: Prisma.IncidentWhereInput = q.status?.length ? { status: { in: q.status as Incident['status'][] } } : {};
      const [rows, total, banner] = await Promise.all([prisma.incident.findMany({ where, include, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }), prisma.incident.count({ where }), this.bannerIncident()]);
      return page(rows.map((r) => this.present(r, banner)), total, q);
    });
  }

  async get(id: string): Promise<IncidentDto> {
    return sys(async () => {
      const r = await prisma.incident.findUnique({ where: { id }, include });
      if (!r) throw notFound();
      return this.present(r, await this.bannerIncident());
    });
  }

  /** E-mails of an incident event to every verified, still subscribed address (one outbox row per subscriber). */
  private async notifySubscribers(tx: Tx, incident: Pick<Incident, 'id' | 'title'>, status: string, body: OpsLocalizedText | null, eventKey: string) {
    const subs = await tx.statusSubscriber.findMany({ where: { verifiedAt: { not: null }, unsubscribedAt: null }, take: 10_000 });
    const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    for (const s of subs) {
      await this.mail.send(
        {
          to: s.email,
          template: 'status/incident',
          locale: s.locale,
          key: `status-incident:${incident.id}:${eventKey}:${s.id}`,
          params: { title: pick(incident.title, s.locale), status: STATUS_LABEL[status]?.[s.locale] ?? status, body: body ? pick(body, s.locale) : '', url: `${web}/${s.locale}/status` },
          secret: { unsubscribeUrl: `${web}/${s.locale}/status/unsubscribe/${unsubscribeToken(s)}` },
        },
        tx,
      );
    }
  }

  async create(input: IncidentCreateInput, actor: PlatformActor): Promise<IncidentDto> {
    const created = await sysTx(async (tx) => {
      const now = new Date();
      const inc = await tx.incident.create({
        data: {
          title: input.title as Prisma.InputJsonValue,
          severity: input.severity,
          status: input.status,
          components: input.components,
          affectedWorkspaces: input.affectedWorkspaces ?? null,
          identifiedAt: input.status === 'identified' ? now : null,
          createdById: actor.userId,
        },
      });
      const body = input.body ?? input.title;
      await tx.incidentUpdate.create({ data: { incidentId: inc.id, status: input.status, body: body as Prisma.InputJsonValue, authorId: actor.userId } });
      if (input.banner) await writeSetting(tx, 'incident_banner', { visible: true, text: input.title, incidentId: inc.id } satisfies IncidentBannerValue, actor.userId, `incident:${inc.id}`);
      await this.outbox.ws(tx, 'admin:platform', 'platform.alert', { kind: 'incident', payload: { id: inc.id, severity: inc.severity, title: input.title.fr } }, `platform.alert:incident:${inc.id}`);
      await this.admins.notify(tx, { kind: 'alert_incident', key: `alert_incident:${inc.id}`, params: { title: input.title.fr, severity: inc.severity } });
      await this.notifySubscribers(tx, inc, input.status, body, 'created');
      return inc;
    });
    await auditAdmin(this.audit, actor, { action: 'incident.create', entity: 'Incident', entityId: created.id, after: { title: input.title.fr, severity: input.severity, components: input.components, banner: input.banner } });
    return this.get(created.id);
  }

  async patch(id: string, input: { title?: OpsLocalizedText; severity?: Incident['severity']; components?: string[]; affectedWorkspaces?: number | null }, actor: PlatformActor): Promise<IncidentDto> {
    const before = await sys(() => prisma.incident.findUnique({ where: { id } }));
    if (!before) throw notFound();
    await sys(() =>
      prisma.incident.update({
        where: { id },
        data: {
          ...(input.title ? { title: input.title as Prisma.InputJsonValue } : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.components ? { components: input.components } : {}),
          ...(input.affectedWorkspaces !== undefined ? { affectedWorkspaces: input.affectedWorkspaces } : {}),
        },
      }),
    );
    await auditAdmin(this.audit, actor, { action: 'incident.update', entity: 'Incident', entityId: id, before: { severity: before.severity, components: before.components }, after: input });
    return this.get(id);
  }

  async addUpdate(id: string, input: IncidentUpdateInput, actor: PlatformActor): Promise<IncidentDto> {
    if (input.status === 'resolved') return this.resolve(id, { body: input.body }, actor);
    await sysTx(async (tx) => {
      const inc = await tx.incident.findUnique({ where: { id } });
      if (!inc) throw notFound();
      const u = await tx.incidentUpdate.create({ data: { incidentId: id, status: input.status, body: input.body as Prisma.InputJsonValue, authorId: actor.userId } });
      await tx.incident.update({ where: { id }, data: { status: input.status, ...(input.status === 'identified' && !inc.identifiedAt ? { identifiedAt: new Date() } : {}), ...(inc.status === 'resolved' ? { resolvedAt: null } : {}) } });
      await this.notifySubscribers(tx, inc, input.status, input.body, u.id);
    });
    await auditAdmin(this.audit, actor, { action: 'incident.status', entity: 'Incident', entityId: id, after: { status: input.status } });
    return this.get(id);
  }

  async resolve(id: string, input: { postMortem?: string; body?: OpsLocalizedText }, actor: PlatformActor): Promise<IncidentDto> {
    await sysTx(async (tx) => {
      const inc = await tx.incident.findUnique({ where: { id } });
      if (!inc) throw notFound();
      const body = input.body ?? RESOLVED_TEXT;
      const u = await tx.incidentUpdate.create({ data: { incidentId: id, status: 'resolved', body: body as Prisma.InputJsonValue, authorId: actor.userId } });
      await tx.incident.update({ where: { id }, data: { status: 'resolved', resolvedAt: inc.resolvedAt ?? new Date(), ...(input.postMortem !== undefined ? { postMortem: input.postMortem } : {}) } });
      if ((await this.bannerIncident(tx)) === id) await writeSetting(tx, 'incident_banner', { visible: false, text: null, incidentId: null } satisfies IncidentBannerValue, actor.userId, `incident:${id}:resolved`);
      await this.notifySubscribers(tx, inc, 'resolved', body, u.id);
    });
    await auditAdmin(this.audit, actor, { action: 'incident.resolve', entity: 'Incident', entityId: id, after: { status: 'resolved', postMortem: !!input.postMortem } });
    return this.get(id);
  }
}
