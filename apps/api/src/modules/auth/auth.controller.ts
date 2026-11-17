// 06-api "Auth & account" — public auth endpoints + the authenticated 2FA management endpoints.
// Web: refresh token in the `djaber_rt` cookie (HttpOnly; Secure in prod; SameSite=Lax; Path=/api/v1/auth).
// Mobile (`device.platform` android | ios, or `X-App-Platform`): refresh token in the body, no cookie.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { DevicePlatform } from '@djaber/db';
import { isAppLocale } from '@djaber/shared';
import { AuditService } from '../../core/audit/audit.service';
import { Authenticated, CurrentUser, Public, RateLimit, type AuthUser } from '../../core/auth/decorators';
import { AppException } from '../../core/errors/app.exception';
import { AuthService, type AuthClient, type AuthResult } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  PasswordConfirmDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  TwoFaEnableDto,
  TwoFaVerifyDto,
  VerifyEmailDto,
} from './dto';
import { ReauthService } from './reauth.service';
import { clientOf, SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

const platformOf = (req: any, device?: { platform?: string }): DevicePlatform => {
  const p = String(device?.platform ?? req.headers?.['x-app-platform'] ?? '').toLowerCase();
  return p === 'android' || p === 'ios' ? p : 'web';
};
const authClient = (req: any, device?: { platform?: string }): AuthClient => ({
  ...clientOf(req),
  platform: platformOf(req, device),
  locale: isAppLocale(req.locale) ? req.locale : 'fr',
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly reauth: ReauthService,
    private readonly audit: AuditService,
  ) {}

  /** LoginResult (api-contract §3.1): `{ accessToken, refreshToken? (mobile only), expiresIn, user }` or `{ mfaToken }`. */
  private respond(result: AuthResult, client: AuthClient, res: any) {
    if (result.kind === 'mfa') return { mfaToken: result.mfaToken };
    const body: Record<string, unknown> = { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn, user: result.user };
    if (client.platform === 'web') this.sessions.setCookie(res, result.tokens.refreshToken);
    else body.refreshToken = result.tokens.refreshToken;
    return body;
  }

  @Public()
  @Post('register')
  @RateLimit({ name: 'auth-register', max: 20, windowSeconds: 3600, by: 'ip' })
  async register(@Body() dto: RegisterDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const client = authClient(req, dto.device);
    return this.respond(await this.auth.register(dto, client), client, res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const client = authClient(req, dto.device);
    return this.respond(await this.auth.login(dto, client), client, res);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyMfa(@Body() dto: TwoFaVerifyDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const client = authClient(req, dto.device);
    return this.respond(await this.auth.verifyMfa(dto, client), client, res);
  }

  /** Rotation on every call; a rotated token presented again revokes the whole family (AUTH_REFRESH_REUSED). */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const fromBody = dto.refreshToken;
    const raw = fromBody ?? this.sessions.readCookie(req);
    // journeys 16/11 J12 PUBLIC-12: a browser without any session (a visitor's first page) is not an error — 204, no body,
    // so the visitor's console shows no « 401 » (a presented token that is refused stays 401)
    if (!raw) {
      res.status(204);
      return undefined;
    }
    try {
      const { tokens } = await this.auth.refresh(raw, clientOf(req));
      const body: Record<string, unknown> = { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
      if (fromBody) body.refreshToken = tokens.refreshToken;
      else this.sessions.setCookie(res, tokens.refreshToken);
      return body;
    } catch (e) {
      if (!fromBody) this.sessions.clearCookie(res);
      throw e;
    }
  }

  /** `POST /auth/logout?all` — works with the cookie, a body token or only the access token; always 204. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Query('all') all: string | undefined, @Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout({
      rawToken: dto.refreshToken ?? this.sessions.readCookie(req),
      userId: req.user?.id,
      sessionId: req.user?.sessionId,
      all: all !== undefined && all !== 'false' && all !== '0',
    });
    this.sessions.clearCookie(res);
  }

  /** Always 200 with the same body (AUTH-03); 3 / h / e-mail. */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit({ name: 'auth-forgot', max: 3, windowSeconds: 3600, by: 'email' })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { sent: true };
  }

  @Public()
  @Get('reset-password/:token')
  @RateLimit({ name: 'auth-reset-check', max: 30, windowSeconds: 60, by: 'ip' })
  checkReset(@Param('token') token: string) {
    return this.auth.checkResetToken(token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @RateLimit({ name: 'auth-reset', max: 30, windowSeconds: 3600, by: 'ip' })
  async reset(@Body() dto: ResetPasswordDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const client = authClient(req, dto.device);
    return this.respond(await this.auth.resetPassword(dto.token, dto.password, client), client, res);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @RateLimit({ name: 'auth-verify', max: 30, windowSeconds: 3600, by: 'ip' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: any) {
    return this.auth.verifyEmail(dto.token, clientOf(req));
  }

  @Post('verify-email/resend')
  @Authenticated()
  @HttpCode(200)
  @RateLimit({ name: 'verify-resend-hour', max: 3, windowSeconds: 3600, by: 'user' })
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  // --- AUTH-05: 2FA management (own account) ----------------------------------------------------------------------------
  /** Step 1: secret + otpauth URL (the client renders the QR code); 2FA stays off until `enable`. */
  @Post('2fa/setup')
  @Authenticated()
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.id);
  }

  /** Step 2: valid code ⇒ `{ recoveryCodes }` (10 codes, shown once). */
  @Post('2fa/enable')
  @Authenticated()
  @HttpCode(200)
  async enable(@CurrentUser() user: AuthUser, @Body() dto: TwoFaEnableDto, @Req() req: any) {
    const out = await this.twoFactor.enable(user.id, dto.code);
    await this.audit.write({ actorType: 'user', actorId: user.id, action: 'auth.2fa_enable', entity: 'User', entityId: user.id, ...clientOf(req) });
    return out;
  }

  /** Password required; users with a platform role cannot disable 2FA (TWO_FA_REQUIRED_FOR_ROLE). */
  @Post('2fa/disable')
  @Authenticated()
  @HttpCode(200)
  async disable(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto, @Req() req: any) {
    const u = await this.reauth.assertPassword(user.id, dto.password, 'AUTH_CURRENT_PASSWORD_INCORRECT');
    if (u.platformRole !== 'none') throw new AppException('TWO_FA_REQUIRED_FOR_ROLE');
    await this.twoFactor.disable(user.id);
    await this.audit.write({ actorType: 'user', actorId: user.id, action: 'auth.2fa_disable', entity: 'User', entityId: user.id, ...clientOf(req) });
    return { totpEnabled: false };
  }

  /** Regeneration needs the password; the previous codes stop working. */
  @Post('2fa/recovery-codes')
  @Authenticated()
  @HttpCode(200)
  async recoveryCodes(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto, @Req() req: any) {
    const u = await this.reauth.assertPassword(user.id, dto.password, 'AUTH_CURRENT_PASSWORD_INCORRECT');
    if (!u.totpEnabled) throw new AppException('CONFLICT');
    const out = await this.twoFactor.regenerateRecoveryCodes(user.id);
    await this.audit.write({ actorType: 'user', actorId: user.id, action: 'auth.2fa_recovery_regenerate', entity: 'User', entityId: user.id, ...clientOf(req) });
    return out;
  }
}
