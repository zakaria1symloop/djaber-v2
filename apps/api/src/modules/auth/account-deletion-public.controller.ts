// PUB-06 / FL-22 1b / 06 §12 — public account deletion (`/account/deletion`): e-mail link (24 h, single use), confirmation,
// cancel, export during the grace (UX-047). Every route is public; the request is rate limited 3 / h / IP (api-contract §1.9), sends at most one e-mail per address per 24 h and none while a link is valid (UX-061, in the service), and always answers the same.
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AccountDeletionConfirmSchema, AccountDeletionPublicRequestSchema } from '@djaber/shared';
import { Public, RateLimit } from '../../core/auth/decorators';
import { AccountDeletionService } from './account-deletion.service';
import { clientOf } from './session.service';

class RequestDto extends createZodDto(AccountDeletionPublicRequestSchema) {}
class ConfirmDto extends createZodDto(AccountDeletionConfirmSchema) {}
class EmptyDto extends createZodDto(z.object({}).strict()) {}

@Controller('account-deletion')
export class AccountDeletionPublicController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Public()
  @Post('request')
  @HttpCode(200)
  @RateLimit({ name: 'account-deletion-public', max: 3, windowSeconds: 3600, by: 'ip' })
  request(@Body() dto: RequestDto, @Req() req: any) {
    return this.deletion.publicRequest(dto.email, dto.locale, clientOf(req));
  }

  @Public()
  @Get('confirm/:token')
  state(@Param('token') token: string) {
    return this.deletion.publicState(token);
  }

  @Public()
  @Post('confirm/:token')
  @HttpCode(200)
  confirm(@Param('token') token: string, @Body() dto: ConfirmDto, @Req() req: any) {
    return this.deletion.publicConfirm(token, dto, clientOf(req));
  }

  /** UX-047: « Exporter mes données » during the grace (the cancel token of the confirmation e-mail / page). */
  @Public()
  @Post('export/:token')
  @HttpCode(200)
  @RateLimit({ name: 'account-deletion-export', max: 5, windowSeconds: 3600, by: 'ip' })
  exportData(@Param('token') token: string, @Body() _dto: EmptyDto, @Req() req: any) {
    return this.deletion.publicExport(token, clientOf(req));
  }

  @Public()
  @Post('cancel/:token')
  @HttpCode(200)
  cancel(@Param('token') token: string, @Body() _dto: EmptyDto, @Req() req: any) {
    return this.deletion.publicCancel(token, clientOf(req));
  }
}
