// 06 "Agents & AI" + §8.7. Permissions (01-nest-module-map §3.2): `agents.read` — every member; `agents.manage` — Admin+
// (wizard, activation, pause / resume, delete, versions, FAQ, test links, generation, bulk); `agents.test` — every member
// (playground, scenarios); `insights.manage` — every member; `channels.manage` — Admin+ (agent of a page, analysis).
// Literal sub-paths (`presets`, `generate`, `bulk/*`) are declared before `:id`.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AgentsQuery, AnalysisImportInput, CreateAgentInput, InsightsQuery, PlaygroundTurnInput, ResolveInsightInput, SetChannelAgentInput, UpdateAgentInput } from '@djaber/shared';
import { Audited, Public, RateLimit, RequirePermission, RequireVerifiedEmail } from '../../core/auth/decorators';
import { PlaygroundService, serverTiming } from '../ai/playground.service';
import type { UploadedFile as Incoming } from '../uploads/image-upload.service';
import { AgentService } from './agent.service';
import {
  ActivateAgentDto,
  AgentBulkDto,
  AgentFaqDto,
  AgentFaqUpdateDto,
  AgentMetricsQueryDto,
  AgentsQueryDto,
  AgentVersionDiffQueryDto,
  AnalysisImportDto,
  ApplyGenerationDto,
  ApplyPresetUpdateDto,
  BulkDismissInsightsDto,
  CreateAgentDto,
  FaqExtractDto,
  GenerateAgentDto,
  IcebreakerDto,
  InsightsQueryDto,
  PauseAgentDto,
  PlaygroundExportQueryDto,
  PlaygroundFlagDto,
  PlaygroundTurnDto,
  ResolveInsightDto,
  SetChannelAgentDto,
  SharedTestMessageDto,
  TestLinkDto,
  UpdateAgentDto,
} from './dto';
import { KnowledgeService } from './knowledge.service';
import { PageService } from './page.service';
import { TestLinkService } from './test-link.service';

const Id = () => Param('id', ParseUUIDPipe);
const locale = (req: any): string => req.locale ?? 'fr';
const bulkCtx = (req: any) => ({ locale: locale(req), ref: req.id ?? 'unknown' });

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentService,
    private readonly knowledge: KnowledgeService,
    private readonly pages: PageService,
    private readonly playground: PlaygroundService,
    private readonly links: TestLinkService,
  ) {}

  @Get()
  @RequirePermission('agents.read')
  async list(@Query() q: AgentsQueryDto, @Req() req: any) {
    return this.agents.list(q as AgentsQuery, locale(req));
  }

  @Get('presets')
  @RequirePermission('agents.read')
  presets(@Req() req: any) {
    return this.agents.presets(locale(req));
  }

  @Post()
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.create', idFrom: 'result.id' })
  create(@Body() dto: CreateAgentDto, @Req() req: any) {
    return this.agents.create(dto as CreateAgentInput, locale(req));
  }

  // --- generate from page (AGT-03) ---------------------------------------------------------------------------------------
  @Post('generate')
  @HttpCode(202)
  @RequirePermission('agents.manage')
  generate(@Body() dto: GenerateAgentDto) {
    return this.pages.startGeneration(dto.channelId, dto.days);
  }

  @Post('generate/:jobId/apply')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.generation_apply', idFrom: 'result.id' })
  applyGeneration(@Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: ApplyGenerationDto, @Req() req: any) {
    return this.pages.applyGeneration(jobId, dto, locale(req));
  }

  // --- bulk [FIG MECH Agents multi-select] ---------------------------------------------------------------------------------
  @Post('bulk/pause')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  bulkPause(@Body() dto: AgentBulkDto, @Req() req: any) {
    return this.agents.bulk('pause', dto.ids, dto.confirm === true, bulkCtx(req));
  }
  @Post('bulk/resume')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  bulkResume(@Body() dto: AgentBulkDto, @Req() req: any) {
    return this.agents.bulk('resume', dto.ids, false, bulkCtx(req));
  }
  @Post('bulk/delete')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  bulkDelete(@Body() dto: AgentBulkDto, @Req() req: any) {
    return this.agents.bulk('delete', dto.ids, false, bulkCtx(req));
  }

  // --- one agent ---------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @RequirePermission('agents.read')
  get(@Id() id: string, @Req() req: any) {
    return this.agents.get(id, locale(req));
  }

  @Patch(':id')
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.update', idFrom: 'params.id' })
  update(@Id() id: string, @Body() dto: UpdateAgentDto, @Req() req: any) {
    return this.agents.update(id, dto as unknown as UpdateAgentInput, locale(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.delete', idFrom: 'params.id' })
  async remove(@Id() id: string) {
    await this.agents.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @RequireVerifiedEmail()
  @Audited({ entity: 'Agent', action: 'agent.activate', idFrom: 'params.id' })
  activate(@Id() id: string, @Body() dto: ActivateAgentDto, @Req() req: any) {
    return this.agents.activate(id, dto.at, locale(req));
  }

  /** Cancels a scheduled activation (`scheduledActivateAt` → null); the draft stays a draft. */
  @Delete(':id/activate')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.unschedule', idFrom: 'params.id' })
  unschedule(@Id() id: string, @Req() req: any) {
    return this.agents.unschedule(id, locale(req));
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.pause', idFrom: 'params.id' })
  pause(@Id() id: string, @Body() dto: PauseAgentDto, @Req() req: any) {
    return this.agents.pause(id, dto.confirm === true, locale(req), { sendOutOfHours: dto.sendOutOfHours === true });
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.resume', idFrom: 'params.id' })
  resume(@Id() id: string, @Req() req: any) {
    return this.agents.resume(id, locale(req));
  }

  @Post(':id/duplicate')
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.duplicate', idFrom: 'result.id' })
  duplicate(@Id() id: string, @Req() req: any) {
    return this.agents.duplicate(id, locale(req));
  }

  @Get(':id/readiness')
  @RequirePermission('agents.read')
  readiness(@Id() id: string, @Req() req: any) {
    return this.agents.readiness(id, locale(req));
  }

  @Get(':id/metrics')
  @RequirePermission('agents.read')
  metrics(@Id() id: string, @Query() q: AgentMetricsQueryDto) {
    return this.agents.metrics(id, q);
  }

  @Get(':id/export')
  @RequirePermission('agents.manage')
  export(@Id() id: string, @Req() req: any) {
    return this.agents.export(id, locale(req));
  }

  @Post(':id/apply-preset-update')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  applyPresetUpdate(@Id() id: string, @Body() dto: ApplyPresetUpdateDto, @Req() req: any) {
    return this.agents.applyPresetUpdate(id, dto.presetVersion, locale(req));
  }

  // --- versions [FIG AGT-03 Versions] ----------------------------------------------------------------------------------------
  @Get(':id/versions')
  @RequirePermission('agents.read')
  versions(@Id() id: string) {
    return this.agents.versions(id);
  }
  @Get(':id/versions/:v')
  @RequirePermission('agents.read')
  version(@Id() id: string, @Param('v', ParseIntPipe) v: number) {
    return this.agents.version(id, v);
  }
  @Get(':id/versions/:v/diff')
  @RequirePermission('agents.read')
  versionDiff(@Id() id: string, @Param('v', ParseIntPipe) v: number, @Query() q: AgentVersionDiffQueryDto) {
    return this.agents.versionDiff(id, v, q.against);
  }
  @Post(':id/versions/:v/restore')
  @HttpCode(200)
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.version_restore', idFrom: 'params.id' })
  restore(@Id() id: string, @Param('v', ParseIntPipe) v: number, @Req() req: any) {
    return this.agents.restore(id, v, locale(req));
  }

  // --- FAQ [FIG AGT-02 step 2] -----------------------------------------------------------------------------------------------
  @Get(':id/faq')
  @RequirePermission('agents.read')
  faqs(@Id() id: string) {
    return this.knowledge.faqs(id);
  }
  @Post(':id/faq')
  @RequirePermission('agents.manage')
  createFaq(@Id() id: string, @Body() dto: AgentFaqDto) {
    return this.knowledge.createFaq(id, dto);
  }
  @Post(':id/faq/extract')
  @HttpCode(202)
  @RequirePermission('agents.manage')
  extractFaq(@Id() id: string, @Body() dto: FaqExtractDto) {
    return this.pages.startFaqExtract(id, dto.channelId);
  }
  @Post(':id/faq/import')
  @RequirePermission('agents.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 6 * 1024 * 1024 } }))
  importFaq(@Id() id: string, @UploadedFile() file: Incoming | undefined) {
    return this.knowledge.importFaq(id, file);
  }
  @Patch(':id/faq/:fid')
  @RequirePermission('agents.manage')
  updateFaq(@Id() id: string, @Param('fid', ParseUUIDPipe) fid: string, @Body() dto: AgentFaqUpdateDto) {
    return this.knowledge.updateFaq(id, fid, dto);
  }
  @Delete(':id/faq/:fid')
  @HttpCode(204)
  @RequirePermission('agents.manage')
  async removeFaq(@Id() id: string, @Param('fid', ParseUUIDPipe) fid: string) {
    await this.knowledge.removeFaq(id, fid);
  }

  // --- playground (AGT-07) -----------------------------------------------------------------------------------------------------
  @Post(':id/test')
  @HttpCode(200)
  @RequirePermission('agents.test')
  async test(@Id() id: string, @Body() dto: PlaygroundTurnDto, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    // journey retest R10-1: the server's time of the turn, so a slow answer in the page can be told from a slow server
    const r = await this.playground.requestTurn(id, dto as PlaygroundTurnInput);
    res.setHeader('Server-Timing', serverTiming(r));
    return r.turn;
  }
  @Post(':id/test/flag')
  @HttpCode(200)
  @RequirePermission('agents.test')
  flag(@Id() id: string, @Body() dto: PlaygroundFlagDto) {
    return this.playground.flag(id, dto.turnId, dto.note);
  }
  @Get(':id/test/export')
  @RequirePermission('agents.test')
  exportTest(@Id() id: string, @Query() q: PlaygroundExportQueryDto) {
    return this.playground.export(id, q.sessionId);
  }
  @Post(':id/test-scenarios')
  @HttpCode(202)
  @RequirePermission('agents.test')
  startScenarios(@Id() id: string) {
    return this.playground.startScenarios(id);
  }
  @Get(':id/test-scenarios')
  @RequirePermission('agents.test')
  scenarios(@Id() id: string) {
    return this.playground.scenarios(id);
  }
  @Post(':id/test-links')
  @RequirePermission('agents.manage')
  @Audited({ entity: 'Agent', action: 'agent.test_link_create', idFrom: 'params.id' })
  testLink(@Id() id: string, @Body() dto: TestLinkDto) {
    return this.links.create(id, dto.expiresInHours);
  }
}

/** AGT-08 — the insights queue. */
@Controller('agent-insights')
export class AgentInsightsController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @RequirePermission('agents.read')
  list(@Query() q: InsightsQueryDto) {
    return this.knowledge.listInsights(q as InsightsQuery);
  }

  @Post('bulk/dismiss')
  @HttpCode(200)
  @RequirePermission('insights.manage')
  dismiss(@Body() dto: BulkDismissInsightsDto, @Req() req: any) {
    return this.knowledge.dismissInsights(dto.ids, bulkCtx(req));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('insights.manage')
  @Audited({ entity: 'AgentInsight', action: 'insight.resolve', idFrom: 'params.id' })
  resolve(@Id() id: string, @Body() dto: ResolveInsightDto) {
    return this.knowledge.resolveInsight(id, dto as ResolveInsightInput);
  }
}

/** The agent of a page, its icebreaker and the page analysis (CHN-08) — routes under `/channels`, owned by this module. */
@Controller('channels')
export class ChannelAgentController {
  constructor(private readonly pages: PageService) {}

  @Put(':id/agent')
  @RequirePermission('channels.manage')
  @Audited({ entity: 'Channel', action: 'channel.agent_set', idFrom: 'params.id' })
  setAgent(@Id() id: string, @Body() dto: SetChannelAgentDto, @Req() req: any) {
    return this.pages.setChannelAgent(id, dto as SetChannelAgentInput, req);
  }

  @Put(':id/icebreaker')
  @RequirePermission('channels.manage')
  setIcebreaker(@Id() id: string, @Body() dto: IcebreakerDto) {
    return this.pages.setIcebreaker(id, dto.text);
  }

  @Post(':id/analysis')
  @HttpCode(202)
  @RequirePermission('channels.manage')
  startAnalysis(@Id() id: string) {
    return this.pages.startAnalysis(id);
  }

  @Get(':id/analysis')
  @RequirePermission('channels.read')
  analysis(@Id() id: string) {
    return this.pages.analysis(id);
  }

  @Post(':id/analysis/import')
  @HttpCode(200)
  @RequirePermission('channels.manage')
  @Audited({ entity: 'Channel', action: 'channel.analysis_import', idFrom: 'params.id' })
  importAnalysis(@Id() id: string, @Body() dto: AnalysisImportDto) {
    return this.pages.importAnalysis(id, dto as AnalysisImportInput);
  }
}

/** Public shared playground (06 §12): `/agent-test/:token`, 24 h, 60 turns / h per link. */
@Controller('agent-test')
export class SharedTestController {
  constructor(private readonly links: TestLinkService) {}

  @Public()
  @Get(':token')
  @RateLimit({ name: 'agent-test-open', max: 120, windowSeconds: 3600, by: 'ip' })
  info(@Param('token') token: string) {
    return this.links.info(token);
  }

  @Public()
  @Post(':token/messages')
  @HttpCode(200)
  @RateLimit({ name: 'agent-test-message', max: 240, windowSeconds: 3600, by: 'ip' })
  async message(@Param('token') token: string, @Body() dto: SharedTestMessageDto, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    const r = await this.links.messageTurn(token, dto);
    res.setHeader('Server-Timing', serverTiming(r));
    return r.reply;
  }
}
