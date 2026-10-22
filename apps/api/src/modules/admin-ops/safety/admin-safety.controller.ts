// ADM-11 — `/admin/reports*`, `/admin/blacklist*`, `/admin/blocked-words`, `/admin/safety/*` (06 §8.11, §9: read every
// platform role, write moderator + super_admin).
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AdminBlockedWordsSchema, AdminReportsQuerySchema, AssignSchema, BlacklistCreateSchema, BlacklistQuerySchema, BlacklistRevokeSchema, ReportDecideSchema, SafetyExportQuerySchema } from '@djaber/shared';
import { Platform, RequirePlatformRole } from '../../../core/auth/decorators';
import { canPlatform } from '../../../core/rbac/permission-matrix';
import { actorOf } from '../admin-ops.util';
import { AdminSafetyService } from './admin-safety.service';

class ReportsQueryDto extends createZodDto(AdminReportsQuerySchema) {}
class DecideDto extends createZodDto(ReportDecideSchema) {}
class AssignDto extends createZodDto(AssignSchema) {}
class BlacklistQueryDto extends createZodDto(BlacklistQuerySchema) {}
class BlacklistCreateDto extends createZodDto(BlacklistCreateSchema) {}
class BlacklistRevokeDto extends createZodDto(BlacklistRevokeSchema) {}
class BlockedWordsDto extends createZodDto(AdminBlockedWordsSchema) {}
class ExportQueryDto extends createZodDto(SafetyExportQuerySchema) {}

const canWrite = (req: any) => canPlatform(req.user?.platformRole, 'admin.safety.write');

@Controller('admin')
@Platform()
export class AdminSafetyController {
  constructor(private readonly safety: AdminSafetyService) {}

  @Get('reports')
  @RequirePlatformRole('admin.safety.read')
  list(@Query() q: ReportsQueryDto, @Req() req: any) {
    return this.safety.list(q, actorOf(req), canWrite(req));
  }

  @Get('reports/stats')
  @RequirePlatformRole('admin.safety.read')
  stats() {
    return this.safety.stats();
  }

  @Get('reports/blocks')
  @RequirePlatformRole('admin.safety.read')
  merchantBlocks() {
    return this.safety.merchantBlocks();
  }

  @Get('reports/:id')
  @RequirePlatformRole('admin.safety.read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.safety.get(id, canWrite(req));
  }

  @Post('reports/:id/decide')
  @HttpCode(200)
  @RequirePlatformRole('admin.safety.write')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto, @Req() req: any) {
    return this.safety.decide(id, dto, actorOf(req));
  }

  @Post('reports/:id/assign')
  @HttpCode(200)
  @RequirePlatformRole('admin.safety.write')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @Req() req: any) {
    return this.safety.assign(id, dto.assigneeId, actorOf(req));
  }

  @Get('blacklist')
  @RequirePlatformRole('admin.safety.read')
  blacklist(@Query() q: BlacklistQueryDto) {
    return this.safety.blacklist(q);
  }

  @Post('blacklist')
  @HttpCode(201)
  @RequirePlatformRole('admin.safety.write')
  addBlacklist(@Body() dto: BlacklistCreateDto, @Req() req: any) {
    return this.safety.addBlacklist(dto, actorOf(req));
  }

  @Delete('blacklist/:id')
  @RequirePlatformRole('admin.safety.write')
  revokeBlacklist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlacklistRevokeDto, @Req() req: any) {
    return this.safety.revokeBlacklist(id, dto.reason, actorOf(req));
  }

  @Get('blocked-words')
  @RequirePlatformRole('admin.safety.read')
  blockedWords() {
    return this.safety.blockedWords();
  }

  @Put('blocked-words')
  @RequirePlatformRole('admin.safety.write')
  setBlockedWords(@Body() dto: BlockedWordsDto, @Req() req: any) {
    return this.safety.setBlockedWords(dto, actorOf(req));
  }

  @Get('safety/auto-rules')
  @RequirePlatformRole('admin.safety.read')
  autoRules() {
    return this.safety.autoRuleStatus();
  }

  @Get('safety/export')
  @HttpCode(202)
  @RequirePlatformRole('admin.safety.write')
  export(@Query() q: ExportQueryDto, @Req() req: any) {
    return this.safety.requestExport(q.month, actorOf(req));
  }

  @Get('safety/export/:jobId')
  @RequirePlatformRole('admin.safety.read')
  exportStatus(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.safety.exportStatus(jobId);
  }
}
