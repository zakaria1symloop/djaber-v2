// Simulators of M11:
//  - simulated Google (SHEETS_DRIVER=fake; development, test and the staging test site, 404 in production): consent page
//    + read / re-sort / revoke the simulated spreadsheets;
//  - local receiver of outbound webhooks (404 in staging / production): register `http://<api>/api/v1/dev/webhook-receiver/<name>` as an endpoint URL.
import { Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { prisma, TenantContext } from '@djaber/db';
import { TokenService } from '../../core/auth/token.service';
import { Public } from '../../core/auth/decorators';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { notFound } from '../../core/errors/app.exception';
import { RawResponse } from '../../core/http/envelope.interceptor';
import { RedisService } from '../../core/redis/redis.provider';
import { FAKE_SHEETS } from './integrations.tokens';
import { FakeSheetsGateway } from './sheets/fake-sheets.gateway';
import { verifyWebhookSignature } from './webhook-signing';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#111}a.btn{display:inline-block;padding:10px 18px;border-radius:8px;border:1px solid #111;margin-inline-end:8px;text-decoration:none;color:#111}a.primary{background:#111;color:#fff}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:4px 6px}.note{color:#666;font-size:13px}</style></head><body>${body}</body></html>`;

@Controller('dev/google')
export class DevGoogleController {
  constructor(
    @Inject(FAKE_SHEETS) private readonly fake: FakeSheetsGateway | null,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
  ) {}

  private guard() {
    if (!this.config.simulatorsAllowed || !this.fake) throw notFound();
    return this.fake;
  }

  private callbackUrl(params: Record<string, string>) {
    return `${this.config.get('PUBLIC_API_URL').replace(/\/$/, '')}/api/v1/integrations/google-sheets/callback?${new URLSearchParams(params)}`;
  }

  /** Simulated Google consent screen: "Autoriser" / "Refuser" are plain links back to the OAuth callback. */
  @Public()
  @Get('consent')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async consent(@Query('state') state: string, @Query('email') emailQ: string | undefined) {
    this.guard();
    let email = typeof emailQ === 'string' && /^[^@\s]+@[^@\s]+$/.test(emailQ) ? emailQ.toLowerCase() : '';
    if (!email) {
      const st = await this.tokens.verifyPurpose<{ uid: string | null }>(state ?? '', 'sheets_oauth').catch(() => null);
      const u = st?.uid ? await TenantContext.runSystem(() => prisma.user.findUnique({ where: { id: st.uid! }, select: { email: true } })) : null;
      email = u?.email ?? 'marchand@gmail.com';
    }
    const allow = this.callbackUrl({ code: `fake-code.${Buffer.from(email).toString('base64url')}`, state: state ?? '' });
    const deny = this.callbackUrl({ error: 'access_denied', state: state ?? '' });
    return new RawResponse(
      page(
        'Google (simulé)',
        `<h2>Google — connexion simulée</h2><p>Djaber demande l'accès à vos feuilles Google Sheets (<code>spreadsheets</code>, <code>drive.file</code>) pour le compte <b>${esc(email)}</b>.</p>` +
          `<p><a class="btn primary" href="${esc(allow)}">Autoriser</a><a class="btn" href="${esc(deny)}">Refuser</a></p>` +
          `<p class="note">SHEETS_DRIVER=fake : aucun appel à Google. Autre compte : ajoutez <code>&amp;email=…</code> à l'adresse.</p>`,
      ),
    );
  }

  @Public()
  @Get('spreadsheets/:id')
  async sheet(@Param('id') id: string) {
    const s = await this.guard().dump(id);
    if (!s) throw notFound();
    return s;
  }

  @Public()
  @Get('spreadsheets/:id/view')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async view(@Param('id') id: string) {
    const s = await this.guard().dump(id);
    if (!s) throw notFound();
    const tabs = Object.entries(s.tabs)
      .map(([name, rows]) => `<h3>${esc(name)}</h3><table>${rows.map((r, i) => `<tr><th>${i + 1}</th>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</table>`)
      .join('');
    return new RawResponse(page(s.title, `<h2>${esc(s.title)}</h2><p class="note">Feuille simulée (${esc(s.owner)}). Column R = djaber_id.</p>${tabs}`));
  }

  /** Re-sorts the data rows of a tab (GSH-04 check: the next update still finds its row by `djaber_id`). */
  @Public()
  @Post('spreadsheets/:id/shuffle')
  @HttpCode(200)
  async shuffle(@Param('id') id: string, @Query('tab') tab = 'Commandes') {
    return { shuffled: await this.guard().shuffle(id, tab) };
  }

  @Public()
  @Post('spreadsheets/:id/delete')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    await this.guard().deleteSpreadsheet(id);
    return { deleted: true };
  }

  /** The merchant removes Djaber from his Google account: every token of that e-mail stops working. */
  @Public()
  @Post('accounts/:email/revoke')
  @HttpCode(200)
  async revoke(@Param('email') email: string) {
    await this.guard().revokeAccount(email.toLowerCase());
    return { revoked: true };
  }
}

type Received = { at: string; event: string | null; deliveryId: string | null; signatureValid: boolean; status: number; body: unknown };

@Controller('dev/webhook-receiver')
export class DevWebhookReceiverController {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  private guard() {
    if (this.config.isProd) throw notFound();
  }

  /** Stores what it receives (last 50 per name). `?fail=<status>` answers that status; `?delayMs=` waits (timeout tests). */
  @Public()
  @Post(':name')
  async receive(@Param('name') name: string, @Query('fail') fail: string | undefined, @Query('delayMs') delayMs: string | undefined, @Req() req: any, @Res({ passthrough: true }) res: any) {
    this.guard();
    const raw: string = req.rawBody ? Buffer.from(req.rawBody).toString('utf8') : JSON.stringify(req.body ?? {});
    const endpoints = await TenantContext.runSystem(() => prisma.webhookEndpoint.findMany({ where: { url: { contains: `/dev/webhook-receiver/${name}` } }, select: { secret: true } }));
    const signature = typeof req.headers['x-djaber-signature'] === 'string' ? req.headers['x-djaber-signature'] : null;
    const signatureValid = endpoints.some((e) => verifyWebhookSignature(this.crypto.decrypt(Buffer.from(e.secret).toString('utf8')), raw, signature));
    const status = fail && /^\d{3}$/.test(fail) ? Number(fail) : 200;
    if (delayMs && /^\d+$/.test(delayMs)) await new Promise((r) => setTimeout(r, Math.min(Number(delayMs), 15_000)));
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* kept as text */
    }
    const entry: Received = { at: new Date().toISOString(), event: req.headers['x-djaber-event'] ?? null, deliveryId: req.headers['x-djaber-delivery'] ?? null, signatureValid, status, body };
    await this.redis.client.lpush(`dev-webhooks:${name}`, JSON.stringify(entry));
    await this.redis.client.ltrim(`dev-webhooks:${name}`, 0, 49);
    await this.redis.client.expire(`dev-webhooks:${name}`, 7 * 86_400);
    res.status(status);
    return new RawResponse({ received: status < 300 });
  }

  @Public()
  @Get(':name')
  async list(@Param('name') name: string) {
    this.guard();
    const rows = await this.redis.client.lrange(`dev-webhooks:${name}`, 0, 49);
    return rows.map((r) => JSON.parse(r) as Received);
  }
}
