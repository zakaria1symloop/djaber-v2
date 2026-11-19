// 06-api "Auth & account" + §8.1 — /me: profile, preferences, password, e-mail change, sessions, deletion request.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '../../core/auth/decorators';
import { AppException } from '../../core/errors/app.exception';
import { impersonating, maskIp, viewerUserId } from '../../core/privacy/mask';
import { ImageUploadService, type UploadedFile as Incoming } from '../uploads/image-upload.service';
import { imageInterceptor } from '../uploads/uploads.controller';
import { AccountDeletionService } from './account-deletion.service';
import { DataExportService } from './data-export.service';
import { ChangePasswordDto, DeletionRequestDto, EmailChangeDto, PrefsDto, UpdateMeDto } from './dto';
import { MeService } from './me.service';
import { clientOf } from './session.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly deletion: AccountDeletionService,
    private readonly images: ImageUploadService,
    private readonly exports: DataExportService,
  ) {}

  @Get()
  @Authenticated()
  get(@CurrentUser() user: AuthUser, @Req() req: any) {
    return this.me.me(user.id, req.headers['x-workspace-id'], req.headers['accept-language'] || req.query?.lang ? req.locale : undefined);
  }

  @Patch()
  @Authenticated()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto, @Req() req: any) {
    return this.me.update(user.id, dto, req.headers['x-workspace-id']);
  }

  /** Direct avatar upload (multipart `file`); the two-step flow `POST /uploads` + `PATCH /me { avatarUploadId }` also works. */
  @Post('avatar')
  @Authenticated()
  @HttpCode(200)
  @UseInterceptors(imageInterceptor())
  async avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Incoming | undefined) {
    const upload = await this.images.store(file, 'avatar', user.id, null);
    await this.me.setAvatar(user.id, upload.url);
    return { avatarUrl: upload.url, upload };
  }

  /** journey J13v-1: the identity the merchant shell shows as « me » — the shop owner during a read-only impersonation. */
  @Get('viewer')
  @Authenticated()
  viewer(@CurrentUser() user: AuthUser) {
    return this.me.viewer(viewerUserId() ?? user.id);
  }

  @Get('prefs')
  @Authenticated()
  getPrefs(@CurrentUser() user: AuthUser) {
    return this.me.getPrefs(viewerUserId() ?? user.id);
  }

  @Patch('prefs')
  @Authenticated()
  patchPrefs(@CurrentUser() user: AuthUser, @Body() dto: PrefsDto) {
    return this.me.patchPrefs(user.id, dto);
  }

  @Patch('password')
  @Authenticated()
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.me.changePassword(user.id, dto.currentPassword, dto.newPassword, user.sessionId, clientOf(req));
  }

  @Post('email-change')
  @Authenticated()
  @HttpCode(202)
  emailChange(@CurrentUser() user: AuthUser, @Body() dto: EmailChangeDto, @Req() req: any) {
    return this.me.requestEmailChange(user.id, dto.email, dto.password, clientOf(req));
  }

  @Get('sessions')
  @Authenticated()
  async sessions(@CurrentUser() user: AuthUser) {
    // J13r-1: a read-only impersonation shows the shop owner's devices (IP masked), never the admin's own sessions
    if (impersonating()) return (await this.me.listSessions(viewerUserId() ?? user.id)).map((r) => ({ ...r, ip: maskIp(r.ip), current: false }));
    return this.me.listSessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @Authenticated()
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.me.revokeSession(user.id, id, clientOf(req));
  }

  @Post('deletion-request')
  @Authenticated()
  @HttpCode(202)
  requestDeletion(@CurrentUser() user: AuthUser, @Body() dto: DeletionRequestDto, @Req() req: any) {
    return this.deletion.request(user.id, dto, clientOf(req));
  }

  @Get('deletion-request')
  @Authenticated()
  getDeletion(@CurrentUser() user: AuthUser) {
    return this.deletion.current(viewerUserId() ?? user.id);
  }

  @Delete('deletion-request')
  @Authenticated()
  @HttpCode(200)
  cancelDeletion(@CurrentUser() user: AuthUser, @Req() req: any) {
    return this.deletion.cancel(user.id, clientOf(req));
  }

  /** DEL-01 "Exporter mes données" (06 §8.1): 202 { jobId } — an export of the last hour is reused. */
  @Get('data-export')
  @Authenticated()
  @HttpCode(202)
  dataExport(@CurrentUser() user: AuthUser) {
    // starts a job: an action, refused like every write during a read-only impersonation (D21-bis)
    if (impersonating()) throw new AppException('ADMIN_IMPERSONATION_FORBIDDEN_ACTION');
    return this.exports.start(user.id);
  }

  @Get('data-export/:jobId')
  @Authenticated()
  dataExportStatus(@CurrentUser() user: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.exports.get(user.id, jobId);
  }
}
