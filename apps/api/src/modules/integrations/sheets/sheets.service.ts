// GSH-01 / GSH-02 / GSH-05 / GSH-06 — HTTP side of Google Sheets (06 §2 "Integrations", §8.10; 05-integrations §3).
// Google is called from these handlers only where the merchant waits for the answer in the dialog (OAuth callback, sheet
// validation / creation, Picker token), with 10 s timeouts — the exceptions of 03-events §7 (extended in M11).
import { Inject, Injectable } from '@nestjs/common';
import { SHEETS_DEFAULT_TAB, SPREADSHEET_URL_RE, SheetsFiltersSchema, type PutSheetsInput, type SheetsBackfillInput, type SheetsFilters, type SheetsIntegrationDto, type SheetsPickerTokenDto, type SheetsStatusDto } from '@djaber/shared';
import { prisma, TenantContext, type SheetsConnection } from '@djaber/db';
import { AuditService } from '../../../core/audit/audit.service';
import { TokenService } from '../../../core/auth/token.service';
import { ConfigService } from '../../../core/config/config.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { AppException } from '../../../core/errors/app.exception';
import { I18nService } from '../../../core/i18n/i18n.service';
import { QueueOutbox } from '../../../core/queue/queue.outbox';
import { MAX_RANGE_DAYS } from '../../../core/time/period';
import { JobService } from '../../jobs/job.service';
import { act, auditActor, iso, planAllowance } from '../integrations.util';
import { SheetsSyncService } from './sheets-sync.service';
import { SHEETS_ERROR_CODE, SHEETS_GATEWAY, SheetsApiError, spreadsheetUrlOf, type SheetsGateway } from './sheets.gateway';

const STATE_TTL_S = 600;
const OPEN_JOB = ['queued', 'running'] as const;

@Injectable()
export class SheetsService {
  constructor(
    @Inject(SHEETS_GATEWAY) private readonly gateway: SheetsGateway,
    private readonly sync: SheetsSyncService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly jobs: JobService,
    private readonly queue: QueueOutbox,
  ) {}

  private redirectUri() {
    return `${this.config.get('PUBLIC_API_URL').replace(/\/$/, '')}/api/v1/integrations/google-sheets/callback`;
  }

  private connection() {
    return prisma.sheetsConnection.findFirst({});
  }

  private async requireConnection(): Promise<SheetsConnection> {
    const c = await this.connection();
    if (!c || c.status === 'disconnected') throw new AppException('SHEETS_NOT_CONNECTED');
    return c;
  }

  private async assertFeature() {
    const plan = await planAllowance(TenantContext.workspaceId());
    if (!plan.features.includes('google_sheets')) throw new AppException('PLAN_FEATURE_REQUIRED', { feature: 'google_sheets' });
  }

  /** Maps a Google failure to its catalogue code; a revoked token or a vanished sheet also puts the card in error. */
  private async fail(c: SheetsConnection | null, e: unknown): Promise<never> {
    if (!(e instanceof SheetsApiError)) throw e;
    const code = SHEETS_ERROR_CODE[e.kind];
    if (c && e.kind === 'revoked') await this.sync.markError(c.id, code);
    throw new AppException(code === 'INTERNAL' ? 'SHEETS_SPREADSHEET_NOT_FOUND' : code);
  }

  // --- reads -------------------------------------------------------------------------------------------------------------------------
  async view(locale: string): Promise<SheetsIntegrationDto> {
    const ws = TenantContext.workspaceId();
    const [c, plan, workspace] = await Promise.all([this.connection(), planAllowance(ws), TenantContext.runSystem(() => prisma.workspace.findUnique({ where: { id: ws }, select: { locale: true } }))]);
    const featureEnabled = plan.features.includes('google_sheets');
    const connected = !!c && c.status !== 'disconnected';
    const state: SheetsIntegrationDto['state'] = !connected ? 'not_connected' : c.status === 'error' ? 'error' : !c.spreadsheetId ? 'pick_sheet' : 'active';
    const [rowsSynced, job] = connected
      ? await Promise.all([
          prisma.sheetsRow.count({ where: { connectionId: c.id } }),
          prisma.job.findFirst({ where: { workspaceId: ws, kind: 'backfill', createdAt: { gt: new Date(Date.now() - 86_400_000) } }, orderBy: { createdAt: 'desc' } }),
        ])
      : [0, null];
    const errCode = connected && c.status === 'error' ? (c.lastError ?? 'INTERNAL') : null;
    const header = SheetsSyncService.header(workspace?.locale ?? 'fr');
    const hasSheet = connected && !!c.spreadsheetId;
    return {
      state,
      status: c?.status ?? null,
      driver: this.gateway.driver,
      featureEnabled,
      verificationPending: !this.config.get('GOOGLE_OAUTH_VERIFIED'),
      googleEmail: connected ? c.googleEmail : null,
      spreadsheetId: hasSheet ? c.spreadsheetId : null,
      spreadsheetTitle: hasSheet ? c.spreadsheetTitle : null,
      spreadsheetUrl: hasSheet ? spreadsheetUrlOf(c.spreadsheetId!) : null,
      sheetName: connected ? c.sheetName : SHEETS_DEFAULT_TAB,
      filters: SheetsFiltersSchema.parse(connected ? (c.filters ?? {}) : {}),
      columns: header.slice(0, 17),
      lastSyncAt: connected ? iso(c.lastSyncAt) : null,
      lastError: errCode ? { code: errCode, message: this.i18n.t(locale, `error.${errCode}`) } : null,
      rowsSynced,
      backfill: job ? { jobId: job.id, status: job.status, progress: job.progress } : null,
      connectedAt: connected ? c.createdAt.toISOString() : null,
      actions: [
        act('connect', featureEnabled && !connected, featureEnabled ? 'CONFLICT' : 'PLAN_FEATURE_REQUIRED', !connected),
        act('change_sheet', connected && c.lastError !== 'SHEETS_TOKEN_REVOKED', connected ? 'SHEETS_TOKEN_REVOKED' : 'SHEETS_NOT_CONNECTED', state === 'pick_sheet'),
        act('edit_filters', hasSheet, 'SHEETS_NOT_CONNECTED'),
        // full-test 15/11 SETTINGS-05: the true reason (token revoked / sheet missing / export running), never the generic CONFLICT
        act('backfill', hasSheet && state === 'active' && !(job && (OPEN_JOB as readonly string[]).includes(job.status)), !hasSheet ? 'SHEETS_NOT_CONNECTED' : state !== 'active' ? (errCode ?? 'SHEETS_NOT_CONNECTED') : 'SHEETS_BACKFILL_RUNNING'),
        act('disconnect', connected, 'SHEETS_NOT_CONNECTED'),
        act('reconnect', connected && c.status === 'error' && c.lastError === 'SHEETS_TOKEN_REVOKED', 'CONFLICT', true),
      ],
    };
  }

  async status(locale: string): Promise<SheetsStatusDto> {
    const v = await this.view(locale);
    const c = await this.connection();
    let pendingRows = 0;
    if (c?.spreadsheetId && c.status !== 'disconnected') {
      const [r] = await TenantContext.runSystem(() =>
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM "Order" o LEFT JOIN "SheetsRow" r ON r."orderId" = o."id"
          WHERE o."workspaceId" = ${c.workspaceId}::uuid AND o."updatedAt" > ${c.createdAt}
            AND (r."id" IS NULL OR o."updatedAt" > r."syncedAt")`,
      );
      pendingRows = Number(r?.n ?? 0);
    }
    return { state: v.state, status: v.status, lastSyncAt: v.lastSyncAt, lastError: v.lastError, rowsSynced: v.rowsSynced, pendingRows };
  }

  // --- OAuth (GSH-01) ----------------------------------------------------------------------------------------------------------------
  async connectUrl(returnTo?: string) {
    await this.assertFeature();
    const t = TenantContext.get();
    const state = await this.tokens.signPurpose('sheets_oauth', { wid: t.workspaceId, uid: t.userId ?? null, returnTo: returnTo ?? '/settings/integrations/sheets' }, STATE_TTL_S);
    return { url: this.gateway.authUrl(state, this.redirectUri()) };
  }

  /** `GET /integrations/google-sheets/callback?code&state` ⇒ web URL to redirect the browser to. */
  async callback(q: { code?: string; state?: string; error?: string }): Promise<string> {
    const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    let st: { wid: string; uid: string | null; returnTo: string };
    try {
      st = await this.tokens.verifyPurpose(q.state ?? '', 'sheets_oauth');
    } catch {
      return `${web}/settings/integrations/sheets?sheets=error&code=SHEETS_NOT_CONNECTED`;
    }
    const back = (params: string) => `${web}${st.returnTo.startsWith('/') ? st.returnTo : '/settings/integrations/sheets'}${st.returnTo.includes('?') ? '&' : '?'}${params}`;
    if (q.error || !q.code) return back('sheets=error&code=SHEETS_NOT_CONNECTED');
    let grant: { refreshToken: string; email: string };
    try {
      grant = await this.gateway.exchangeCode(q.code, this.redirectUri());
    } catch (e) {
      return back(`sheets=error&code=${e instanceof SheetsApiError ? SHEETS_ERROR_CODE[e.kind] : 'INTERNAL'}`);
    }
    const sealed = Buffer.from(this.crypto.encrypt(grant.refreshToken), 'utf8');
    const ws = await TenantContext.runSystem(() => prisma.workspace.findFirst({ where: { id: st.wid, deletedAt: null }, select: { id: true } }));
    if (!ws) return back('sheets=error&code=NOT_FOUND');
    const previous = await TenantContext.runSystem(() => prisma.sheetsConnection.findUnique({ where: { workspaceId: ws.id } }));
    const row = await TenantContext.runSystem(() =>
      prisma.sheetsConnection.upsert({
        where: { workspaceId: ws.id },
        // reconnecting keeps the chosen sheet (token revoked ⇒ new consent, same sheet); another Google account starts over
        update: { googleEmail: grant.email, refreshToken: sealed, status: 'active', lastError: null, ...(previous && previous.googleEmail !== grant.email ? { spreadsheetId: null, spreadsheetTitle: null } : {}) },
        create: { workspaceId: ws.id, googleEmail: grant.email, refreshToken: sealed, status: 'active' },
      }),
    );
    if (previous && previous.googleEmail !== grant.email) {
      await TenantContext.runSystem(() => prisma.sheetsRow.deleteMany({ where: { connectionId: row.id } }));
    }
    if (previous && previous.refreshToken && Buffer.compare(Buffer.from(previous.refreshToken), sealed) !== 0) {
      await this.queueRevoke(ws.id, previous);
    }
    await this.audit.write({ workspaceId: ws.id, actorType: 'user', actorId: st.uid, action: previous ? 'sheets.reconnect' : 'sheets.connect', entity: 'SheetsConnection', entityId: row.id, after: { googleEmail: grant.email } });
    return back('sheets=connected');
  }

  private async queueRevoke(workspaceId: string, c: Pick<SheetsConnection, 'refreshToken'>) {
    const sealed = this.crypto.encrypt(this.sync.refreshToken(c));
    await TenantContext.runSystem(() => prisma.$transaction((tx) => this.queue.add(tx, 'outbox', 'sheets-revoke', { sealed, workspaceId }, `sheets-revoke:${this.crypto.sha256(sealed).slice(0, 32)}`, { attempts: 3, backoff: { type: 'fixed', delay: 60_000 } })));
  }

  async pickerToken(): Promise<SheetsPickerTokenDto> {
    const c = await this.requireConnection();
    const rt = this.sync.refreshToken(c);
    try {
      const [{ accessToken, expiresAt }, files] = await Promise.all([this.gateway.accessToken(rt), this.gateway.listFiles(rt)]);
      return { driver: this.gateway.driver, accessToken, expiresAt: expiresAt.toISOString(), developerKey: this.config.get('GOOGLE_PICKER_KEY') ?? null, appId: this.config.get('GOOGLE_PICKER_APP_ID') ?? null, files };
    } catch (e) {
      return this.fail(c, e);
    }
  }

  // --- sheet choice + filters (GSH-02 / GSH-06) ---------------------------------------------------------------------------------------
  async choose(input: PutSheetsInput, locale: string): Promise<SheetsIntegrationDto> {
    await this.assertFeature();
    const c = await this.requireConnection();
    const rt = this.sync.refreshToken(c);
    const filters: SheetsFilters = input.filters ? SheetsFiltersSchema.parse(input.filters) : SheetsFiltersSchema.parse(c.filters ?? {});
    if (filters.channelIds.length) {
      const n = await prisma.channel.count({ where: { id: { in: filters.channelIds } } });
      if (n !== filters.channelIds.length) throw new AppException('VALIDATION_ERROR', {}, { 'filters.channelIds': 'validation.invalid' });
    }
    const pickedId = input.spreadsheetId ?? (input.spreadsheetUrl ? SPREADSHEET_URL_RE.exec(input.spreadsheetUrl)?.[1] : undefined);
    const wantsSheet = !!pickedId || input.createNew === true;
    if (!wantsSheet && !c.spreadsheetId) throw new AppException('VALIDATION_ERROR', {}, { spreadsheetId: 'validation.required' });
    const tab = input.sheetName || SHEETS_DEFAULT_TAB;
    let sheet: { id: string; title: string } | null = null;
    if (wantsSheet) {
      const ws = await TenantContext.runSystem(() => prisma.workspace.findUniqueOrThrow({ where: { id: c.workspaceId }, select: { name: true, locale: true } }));
      try {
        const info = input.createNew ? await this.gateway.createSpreadsheet(rt, `Djaber · Commandes ${ws.name}`.slice(0, 100), tab) : await this.gateway.getSpreadsheet(rt, pickedId!);
        await this.gateway.ensureTab(rt, info.id, tab, SheetsSyncService.header(ws.locale));
        sheet = { id: info.id, title: info.title };
      } catch (e) {
        return this.fail(c, e);
      }
    } else if (tab !== c.sheetName) {
      try {
        const ws = await TenantContext.runSystem(() => prisma.workspace.findUniqueOrThrow({ where: { id: c.workspaceId }, select: { locale: true } }));
        await this.gateway.ensureTab(rt, c.spreadsheetId!, tab, SheetsSyncService.header(ws.locale));
      } catch (e) {
        return this.fail(c, e);
      }
    }
    const changed = (sheet && sheet.id !== c.spreadsheetId) || tab !== c.sheetName;
    await prisma.$transaction(async (tx) => {
      await tx.sheetsConnection.update({
        where: { id: c.id },
        data: { ...(sheet ? { spreadsheetId: sheet.id, spreadsheetTitle: sheet.title } : {}), sheetName: tab, filters, status: 'active', lastError: null },
      });
      if (changed) await TenantContext.runSystem(() => tx.sheetsRow.deleteMany({ where: { connectionId: c.id } }));
    });
    await this.audit.write({ ...auditActor(), action: sheet ? 'sheets.choose_sheet' : 'sheets.update_filters', entity: 'SheetsConnection', entityId: c.id, before: { spreadsheetId: c.spreadsheetId, sheetName: c.sheetName, filters: c.filters }, after: { spreadsheetId: sheet?.id ?? c.spreadsheetId, sheetName: tab, filters } });
    return this.view(locale);
  }

  // --- backfill (GSH-05) -----------------------------------------------------------------------------------------------------------
  async backfill(input: SheetsBackfillInput) {
    const c = await this.requireConnection();
    if (!c.spreadsheetId) throw new AppException('SHEETS_NOT_CONNECTED');
    if (c.status === 'error') throw new AppException((c.lastError as 'SHEETS_TOKEN_REVOKED') ?? 'SHEETS_TOKEN_REVOKED');
    const days = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_RANGE_DAYS) throw new AppException('REPORT_RANGE_TOO_LONG');
    const open = await prisma.job.findFirst({ where: { workspaceId: c.workspaceId, kind: 'backfill', status: { in: [...OPEN_JOB] } } });
    if (open) return { jobId: open.id };
    const job = await this.jobs.create({ kind: 'backfill', name: 'sheets-backfill', payload: { connectionId: c.id, from: input.from, to: input.to } });
    await this.audit.write({ ...auditActor(), action: 'sheets.backfill', entity: 'SheetsConnection', entityId: c.id, after: { from: input.from, to: input.to, jobId: job.id } });
    return { jobId: job.id };
  }

  // --- disconnect ------------------------------------------------------------------------------------------------------------------------
  /** Token revoked at Google (worker job), connection deleted; the spreadsheet itself is untouched (one-way). */
  async disconnect(locale: string): Promise<SheetsIntegrationDto> {
    const c = await this.connection();
    if (c) {
      await this.queueRevoke(c.workspaceId, c);
      await prisma.sheetsConnection.delete({ where: { id: c.id } });
      await this.audit.write({ ...auditActor(), action: 'sheets.disconnect', entity: 'SheetsConnection', entityId: c.id, before: { googleEmail: c.googleEmail, spreadsheetId: c.spreadsheetId } });
    }
    return this.view(locale);
  }
}
