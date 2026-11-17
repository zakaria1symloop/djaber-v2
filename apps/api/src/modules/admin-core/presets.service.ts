// ADM-07 agent presets editor: catalogue fields, versions (one draft at a time, published versions immutable), locale
// completeness, publish checks, publish (⇒ merchant "Mise à jour disponible" via `sched-preset-updates`), archive / restore.
// Publishing never changes existing agents (D53): they apply the update themselves.
import { Injectable } from '@nestjs/common';
import { PRESET_PROMPT_VARIABLES, type ActionDescriptor, type AdminCreatePresetInput, type AdminPatchPresetInput, type AdminPatchPresetVersionInput, type AgentPresetAdminDto, type AgentPresetVersionDto, type PresetCheckDto } from '@djaber/shared';
import { Prisma, prisma, type AgentPreset, type AgentPresetVersion } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { STATE_REFUSED, assertUuid, fromLocalized, iso, offered, toLocalized, userRef, userSelect, type AdminActor } from './admin.util';

const LOCALES = ['fr', 'ar', 'en'] as const;
type Loc = (typeof LOCALES)[number];
type Locales = Record<Loc, { name: string; tagline: string; systemPrompt: string }>;
type VersionRow = AgentPresetVersion & { publishedBy: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null } | null };

@Injectable()
export class PresetAdminService {
  constructor(private readonly audit: AuditService) {}

  private async log(actor: AdminActor, action: string, entityId: string, before: unknown, after: unknown, reason: string | null = null) {
    await this.audit.write({ actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity: 'AgentPreset', entityId, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }

  private locales(v: unknown): Locales {
    const o = (v ?? {}) as Record<string, Partial<Locales[Loc]> | undefined>;
    return Object.fromEntries(LOCALES.map((l) => [l, { name: o[l]?.name ?? '', tagline: o[l]?.tagline ?? '', systemPrompt: o[l]?.systemPrompt ?? '' }])) as Locales;
  }

  private versionDto(v: VersionRow): AgentPresetVersionDto {
    const locales = this.locales(v.locales);
    return {
      version: v.version,
      status: v.status,
      locales,
      missingLocales: LOCALES.filter((l) => !locales[l].systemPrompt.trim()),
      config: (v.config ?? {}) as Record<string, unknown>,
      changelog: v.changelog,
      testResults: (v.testResults as AgentPresetVersionDto['testResults']) ?? null,
      publishedAt: iso(v.publishedAt),
      publishedBy: userRef(v.publishedBy),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  private dto(p: AgentPreset & { versions: VersionRow[] }, agents: number, actor: AdminActor, withVersions: boolean): AgentPresetAdminDto {
    const draft = p.versions.find((v) => v.status === 'draft');
    const can = canPlatform(actor.platformRole, 'admin.presets.write');
    const a = (key: string, ok: boolean, reasonCode = STATE_REFUSED): ActionDescriptor => (can && ok ? { key, enabled: true } : { key, enabled: false, reasonCode: can ? reasonCode : 'FORBIDDEN' });
    return {
      id: p.id,
      key: p.key,
      name: fromLocalized(p.name),
      tagline: fromLocalized(p.tagline),
      description: fromLocalized(p.description),
      badge: p.badge,
      sectors: p.sectors,
      status: p.archivedAt ? 'archived' : p.status,
      currentVersion: p.currentVersion,
      draftVersion: draft?.version ?? null,
      sortOrder: p.sortOrder,
      archivedAt: iso(p.archivedAt),
      agents,
      // ADMIN-05 (UX-060): an archived preset is restored, not edited — « Modifier » is not offered
      actions: offered([
        { ...a('edit', !p.archivedAt), primary: true },
        a('duplicate', true),
        { key: 'preview', enabled: true },
        p.archivedAt ? a('restore', true) : a('archive', true),
        a('delete', p.currentVersion === 0, 'PRESET_PUBLISHED_IMMUTABLE'),
      ]),
      ...(withVersions ? { versions: p.versions.map((v) => this.versionDto(v)) } : {}),
    };
  }
  private readonly include = { versions: { include: { publishedBy: { select: userSelect } }, orderBy: { version: 'desc' as const } } };

  async list(actor: AdminActor): Promise<AgentPresetAdminDto[]> {
    const [rows, counts] = await Promise.all([prisma.agentPreset.findMany({ include: this.include, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }] }), prisma.agent.groupBy({ by: ['presetId'], where: { deletedAt: null, presetId: { not: null } }, _count: { _all: true } })]);
    return rows.map((p) => this.dto(p, counts.find((c) => c.presetId === p.id)?._count._all ?? 0, actor, false));
  }

  private async row(id: string) {
    assertUuid(id);
    const p = await prisma.agentPreset.findUnique({ where: { id }, include: this.include });
    if (!p) throw notFound();
    return p;
  }

  async get(id: string, actor: AdminActor) {
    const p = await this.row(id);
    return this.dto(p, await prisma.agent.count({ where: { presetId: id, deletedAt: null } }), actor, true);
  }

  async create(input: AdminCreatePresetInput, actor: AdminActor) {
    if (await prisma.agentPreset.findUnique({ where: { key: input.key } })) throw new AppException('CONFLICT', {}, { key: 'validation.taken' });
    let locales: unknown = { fr: { name: input.name.fr, tagline: input.tagline?.fr ?? '', systemPrompt: '' }, ar: { name: input.name.ar ?? '', tagline: input.tagline?.ar ?? '', systemPrompt: '' }, en: { name: input.name.en ?? '', tagline: input.tagline?.en ?? '', systemPrompt: '' } };
    let config: unknown = { tone: 'friendly', temperature: 0.6, maxTokens: 1200, imageRecognition: true, voiceNotes: true, replyDelaySec: 3 };
    if (input.copyFromPresetId) {
      const src = await prisma.agentPresetVersion.findFirst({ where: { presetId: input.copyFromPresetId }, orderBy: { version: 'desc' } });
      if (!src) throw new AppException('VALIDATION_ERROR', {}, { copyFromPresetId: 'validation.id' });
      const l = this.locales(src.locales);
      locales = Object.fromEntries(LOCALES.map((k) => [k, { ...l[k], name: (input.name as Record<string, string | undefined>)[k] ?? '' }]));
      config = src.config;
    }
    const p = await prisma.agentPreset.create({
      data: { key: input.key, name: toLocalized(input.name)!, tagline: toLocalized(input.tagline) ?? Prisma.JsonNull, badge: input.badge ?? null, sectors: input.sectors ?? [], sortOrder: input.sortOrder ?? 0, status: 'draft', currentVersion: 0, versions: { create: { version: 1, status: 'draft', locales: locales as Prisma.InputJsonValue, config: config as Prisma.InputJsonValue } } },
    });
    await this.log(actor, 'preset.create', p.id, null, { key: input.key, copyFromPresetId: input.copyFromPresetId ?? null });
    return this.get(p.id, actor);
  }

  async patch(id: string, input: AdminPatchPresetInput, actor: AdminActor) {
    const p = await this.row(id);
    if (p.archivedAt) throw new AppException('PRESET_ARCHIVED');
    const data: Prisma.AgentPresetUpdateInput = {};
    if (input.name) data.name = toLocalized(input.name);
    if (input.tagline) data.tagline = toLocalized(input.tagline);
    if (input.description) data.description = toLocalized(input.description);
    if (input.badge !== undefined) data.badge = input.badge;
    if (input.sectors) data.sectors = input.sectors;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    await prisma.agentPreset.update({ where: { id }, data });
    await this.log(actor, 'preset.update', id, Object.fromEntries(Object.keys(input).map((k) => [k, (p as Record<string, unknown>)[k]])), input);
    return this.get(id, actor);
  }

  async versions(id: string) {
    const p = await this.row(id);
    return p.versions.map((v) => this.versionDto(v));
  }

  /** New draft copied from the latest version (one draft at a time). */
  async createVersion(id: string, changelog: string | undefined, actor: AdminActor) {
    const p = await this.row(id);
    if (p.archivedAt) throw new AppException('PRESET_ARCHIVED');
    if (p.versions.some((v) => v.status === 'draft')) throw new AppException('CONFLICT', {}, {}, { reason: 'DRAFT_EXISTS', version: p.versions.find((v) => v.status === 'draft')!.version });
    const last = p.versions[0];
    const v = await prisma.agentPresetVersion.create({ data: { presetId: id, version: (last?.version ?? 0) + 1, status: 'draft', locales: (last?.locales ?? {}) as Prisma.InputJsonValue, config: (last?.config ?? {}) as Prisma.InputJsonValue, changelog: changelog ?? null }, include: { publishedBy: { select: userSelect } } });
    await this.log(actor, 'preset.version_create', id, null, { version: v.version });
    return this.versionDto(v);
  }

  private async versionRow(id: string, version: number) {
    const p = await this.row(id);
    const v = p.versions.find((x) => x.version === version);
    if (!v) throw notFound();
    return { p, v };
  }

  async patchVersion(id: string, version: number, input: AdminPatchPresetVersionInput, actor: AdminActor) {
    const { p, v } = await this.versionRow(id, version);
    if (p.archivedAt) throw new AppException('PRESET_ARCHIVED');
    if (v.status !== 'draft') throw new AppException('PRESET_PUBLISHED_IMMUTABLE');
    const locales = this.locales(v.locales);
    for (const l of LOCALES) if (input.locales?.[l]) locales[l] = { ...locales[l], ...Object.fromEntries(Object.entries(input.locales[l]!).filter(([, x]) => x !== undefined)) };
    const config = { ...((v.config ?? {}) as Record<string, unknown>), ...(input.config ?? {}) };
    const row = await prisma.agentPresetVersion.update({ where: { id: v.id }, data: { locales: locales as unknown as Prisma.InputJsonValue, config: config as Prisma.InputJsonValue, ...(input.changelog !== undefined ? { changelog: input.changelog } : {}), testResults: Prisma.JsonNull }, include: { publishedBy: { select: userSelect } } });
    await this.log(actor, 'preset.version_update', id, { version }, { version, fields: Object.keys(input) });
    return this.versionDto(row);
  }

  /** Publish checks of ADM-07 (static: no AI call from the HTTP handler — rule 4). */
  private checks(v: AgentPresetVersion, previous: AgentPresetVersion | undefined, agents: number): PresetCheckDto[] {
    const l = this.locales(v.locales);
    const missing = LOCALES.filter((k) => !l[k].systemPrompt.trim());
    const used = new Set<string>();
    for (const k of LOCALES) for (const m of l[k].systemPrompt.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) used.add(m[1]!);
    const unknown = [...used].filter((x) => !(PRESET_PROMPT_VARIABLES as readonly string[]).includes(x));
    const prev = previous ? this.locales(previous.locales).fr.systemPrompt : '';
    return [
      { key: 'locales', ok: !missing.includes('fr'), params: { missing: missing.join(',') } },
      { key: 'variables', ok: unknown.length === 0, params: { unknown: unknown.join(',') } },
      { key: 'test', ok: !!l.fr.systemPrompt.trim(), params: { scenarios: 5 } },
      { key: 'diff', ok: true, params: { from: previous?.version ?? 0, to: v.version, changedChars: Math.abs(l.fr.systemPrompt.length - prev.length) } },
      { key: 'agents', ok: true, params: { count: agents } },
    ];
  }

  async test(id: string, version: number, actor: AdminActor) {
    const { p, v } = await this.versionRow(id, version);
    const previous = p.versions.find((x) => x.status === 'published' && x.version < version);
    const checks = this.checks(v, previous, await prisma.agent.count({ where: { presetId: id, deletedAt: null } }));
    const row = await prisma.agentPresetVersion.update({ where: { id: v.id }, data: { testResults: { at: new Date().toISOString(), checks } as unknown as Prisma.InputJsonValue }, include: { publishedBy: { select: userSelect } } });
    await this.log(actor, 'preset.version_test', id, null, { version, ok: checks.every((c) => c.ok) });
    return this.versionDto(row);
  }

  /** Publish: FR required (`PRESET_LOCALE_INCOMPLETE {locales}`), unknown variables ⇒ 422; previous published ⇒ archived. */
  async publish(id: string, version: number, actor: AdminActor) {
    const { p, v } = await this.versionRow(id, version);
    if (p.archivedAt) throw new AppException('PRESET_ARCHIVED');
    if (v.status !== 'draft') throw new AppException('PRESET_PUBLISHED_IMMUTABLE');
    const checks = this.checks(v, p.versions.find((x) => x.status === 'published'), 0);
    const loc = checks.find((c) => c.key === 'locales')!;
    if (!loc.ok) throw new AppException('PRESET_LOCALE_INCOMPLETE', { locales: 'fr' });
    const vars = checks.find((c) => c.key === 'variables')!;
    if (!vars.ok) throw new AppException('VALIDATION_ERROR', { unknown: String(vars.params.unknown) }, { systemPrompt: 'validation.invalid' });
    const l = this.locales(v.locales);
    await prisma.$transaction(async (db) => {
      await db.agentPresetVersion.updateMany({ where: { presetId: id, status: 'published' }, data: { status: 'archived' } });
      await db.agentPresetVersion.update({ where: { id: v.id }, data: { status: 'published', publishedAt: new Date(), publishedById: actor.userId } });
      await db.agentPreset.update({ where: { id }, data: { status: 'published', currentVersion: version, name: { fr: l.fr.name || fromLocalized(p.name).fr, ar: l.ar.name || fromLocalized(p.name).ar, en: l.en.name || fromLocalized(p.name).en }, tagline: { fr: l.fr.tagline, ar: l.ar.tagline, en: l.en.tagline } } });
    });
    await this.log(actor, 'preset.publish', id, { currentVersion: p.currentVersion }, { currentVersion: version, missingLocales: loc.params.missing });
    return this.get(id, actor);
  }

  /** journeys 16/11 J13-4: the reason the admin gives is kept (AuditLog.reason); merchants keep their agents, so it stays optional. */
  async archive(id: string, archive: boolean, actor: AdminActor, reason?: string) {
    const p = await this.row(id);
    if (archive === !!p.archivedAt) throw new AppException(archive ? 'PRESET_ARCHIVED' : 'CONFLICT');
    await prisma.agentPreset.update({ where: { id }, data: archive ? { archivedAt: new Date() } : { archivedAt: null } });
    await this.log(actor, archive ? 'preset.archive' : 'preset.restore', id, { archivedAt: iso(p.archivedAt) }, { archived: archive }, reason?.trim() || null);
    return this.get(id, actor);
  }

  /** Only a preset never published can be deleted ("Suppression impossible une fois publié"). */
  async remove(id: string, actor: AdminActor) {
    const p = await this.row(id);
    if (p.currentVersion > 0 || p.versions.some((v) => v.status !== 'draft')) throw new AppException('PRESET_PUBLISHED_IMMUTABLE');
    await prisma.agentPreset.delete({ where: { id } });
    await this.log(actor, 'preset.delete', id, { key: p.key }, null);
  }
}
