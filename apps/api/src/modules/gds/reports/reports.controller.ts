// 06 "GDS operations" `GET /reports`, `GET /reports/:key`, §8.6 `POST|DELETE /reports/:key/schedule`, `GET
// /reports/schedules` (FIG ANA-03 / ANA-04). Reports are Owner + Admin (`reports.read`, Operators 403); schedules
// `reports.schedule` + plan feature `scheduled_reports`.
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ReportQuerySchema, ReportScheduleSchema, type ReportQuery, type ReportScheduleInput } from '@djaber/shared';
import { Audited, RequirePermission, ApiScopes } from '../../../core/auth/decorators';
import { ReportScheduleService } from './report-schedule.service';
import { ReportService } from './report.service';

export class ReportQueryDto extends createZodDto(ReportQuerySchema) {}
export class ReportScheduleDto extends createZodDto(ReportScheduleSchema) {}
/** DELETE body `{ email }` — or `?email=` (some clients cannot send a DELETE body). */
export class ReportUnscheduleDto extends createZodDto(z.preprocess((v) => v ?? {}, z.object({ email: z.string().trim().max(254).optional() }))) {}

type Lang = 'fr' | 'ar' | 'en';
const langOf = (req: any, q?: { lang?: Lang }): Lang => q?.lang ?? (req.locale === 'ar' || req.locale === 'en' ? req.locale : 'fr');

@ApiScopes({ read: 'analytics:read' })
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportService,
    private readonly schedules: ReportScheduleService,
  ) {}

  @Get()
  @RequirePermission('reports.read')
  hub() {
    return this.reports.hub();
  }

  @Get('schedules')
  @RequirePermission('reports.read')
  listSchedules() {
    return this.schedules.list();
  }

  @Get(':key')
  @RequirePermission('reports.read')
  async report(@Param('key') key: string, @Query() q: ReportQueryDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const query = q as ReportQuery;
    const locale = langOf(req, query);
    if (query.format === 'json') return this.reports.data(key, query, locale);
    const out = await this.reports.export(key, query, locale);
    if ('jobId' in out) {
      res.status(202);
      return out;
    }
    return out.file;
  }

  @Post(':key/schedule')
  @RequirePermission('reports.schedule')
  @Audited({ entity: 'ReportSchedule', action: 'report.schedule', idFrom: 'result.id' })
  async schedule(@Param('key') key: string, @Body() dto: ReportScheduleDto, @Res({ passthrough: true }) res: any) {
    const out = await this.schedules.upsert(key, dto as ReportScheduleInput);
    res.status(out.created ? 201 : 200);
    return out.view;
  }

  @Delete(':key/schedule')
  @RequirePermission('reports.schedule')
  @HttpCode(204)
  @Audited({ entity: 'ReportSchedule', action: 'report.unschedule', idFrom: 'params.key' })
  async unschedule(@Param('key') key: string, @Body() dto: ReportUnscheduleDto, @Query('email') email?: string) {
    await this.schedules.remove(key, (dto as { email?: string }).email ?? email);
  }
}
