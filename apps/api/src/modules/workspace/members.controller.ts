// FL-13 — members & invitations. Reads: `members.read` (every member); writes: `members.write` (Owner).
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Authenticated, CurrentUser, Public, RateLimit, RequirePermission, type AuthUser } from '../../core/auth/decorators';
import { clientOf } from '../auth/session.service';
import { ChangeRoleDto, InviteDto, MembersQueryDto } from './dto';
import { InvitationService } from './invitation.service';
import { MembershipService } from './membership.service';

@Controller('workspace')
export class MembersController {
  constructor(
    private readonly members: MembershipService,
    private readonly invitations: InvitationService,
  ) {}

  @Get('members')
  @RequirePermission('members.read')
  list(@Query() q: MembersQueryDto) {
    return this.members.list(q);
  }

  @Patch('members/:id')
  @RequirePermission('members.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRoleDto, @Req() req: any) {
    return this.members.update(id, dto, clientOf(req));
  }

  @Delete('members/:id')
  @RequirePermission('members.write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.members.remove(id, clientOf(req));
  }

  @Get('invitations')
  @RequirePermission('members.read')
  listInvitations() {
    return this.invitations.list();
  }

  @Post('invitations')
  @RequirePermission('members.write')
  invite(@Body() dto: InviteDto, @Req() req: any) {
    return this.invitations.create(dto, clientOf(req));
  }

  @Post('invitations/:id/resend')
  @RequirePermission('members.write')
  @HttpCode(200)
  resend(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.invitations.resend(id, clientOf(req));
  }

  @Delete('invitations/:id')
  @RequirePermission('members.write')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.invitations.revoke(id, clientOf(req));
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  /** Public preview of the invitation page; with a valid access token the e-mail is compared (INVITATION_EMAIL_MISMATCH). */
  @Public()
  @Get(':token')
  @RateLimit({ name: 'invitation-preview', max: 60, windowSeconds: 60, by: 'ip' })
  preview(@Param('token') token: string, @Req() req: any) {
    return this.invitations.preview(token, req.user?.id);
  }

  @Post(':token/accept')
  @Authenticated()
  @HttpCode(200)
  accept(@Param('token') token: string, @CurrentUser() user: AuthUser, @Req() req: any) {
    return this.invitations.accept(token, user.id, clientOf(req));
  }
}
