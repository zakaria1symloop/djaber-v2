// 06-api "Conversations", §3 (inbound webhooks), §8.3 (trust & safety, merchant side), §8.8 (inbox additions), §12
// (public data-deletion status). Permissions per 01-nest-module-map §3.2: `inbox.read` (every member) for the inbox,
// `inbox.delete` (Admin+) for delete / restore, `safety.block` (every member) and `safety.manage` (Admin+).
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodValidationException } from 'nestjs-zod';
import {
  BulkAssignConversationsSchema,
  BulkBlockConversationsSchema,
  BulkConversationsSchema,
  INBOX_BULK_ACTIONS,
  type ChannelMessagesQuery,
  type CreateBlockInput,
  type CreateReportInput,
  type InboxBulkAction,
  type InboxQuery,
  type MessagesQuery,
  type SafetyBlocksQuery,
  type SafetyRules,
  type SendMessageInput,
  type UpdateConversationInput,
} from '@djaber/shared';
import { prisma } from '@djaber/db';
import { Audited, Idempotent, Platform, Public, RequirePermission, RequirePlatformRole, ApiScope, ApiScopes } from '../../core/auth/decorators';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { RawResponse } from '../../core/http/envelope.interceptor';
import { Admin, type AdminActor } from '../admin-core/admin.util';
import { FAKE_MEDIA_HOST } from '../meta/fake-meta.gateway';
import { parseSignedRequest, signWebhookBody } from '../meta/meta-signature';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { ConversationService } from './conversation.service';
import { DataLifecycleService } from './data-lifecycle.service';
import {
  AdminDataDeletionCreateDto,
  AdminDataDeletionQueryDto,
  BlockConversationDto,
  BlockedWordsDto,
  ChannelMessagesQueryDto,
  ConversationCountsQueryDto,
  CreateBlockDto,
  CreateNoteDto,
  CreateReportDto,
  InboxQueryDto,
  MessagesQueryDto,
  ReportMessageDto,
  SafetyBlocksQueryDto,
  SafetyReportsQueryDto,
  SafetyRulesDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto';
import { MetaWebhookService } from './meta-webhook.service';
import { SafetyService } from './safety.service';

const Id = () => Param('id', ParseUUIDPipe);

// --- Meta webhook (public, signature-verified, ack fast) ---------------------------------------------------------------
@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(
    private readonly webhooks: MetaWebhookService,
    private readonly lifecycle: DataLifecycleService,
    private readonly config: ConfigService,
  ) {}

  /** Subscription handshake Meta performs: echo the challenge when the verify token matches, else 403. */
  @Public()
  @Get()
  verify(@Query() q: Record<string, string>, @Res() res: any) {
    if (q['hub.mode'] !== 'subscribe' || !this.webhooks.verifyToken(q['hub.verify_token'])) throw new AppException('FORBIDDEN');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(String(q['hub.challenge'] ?? ''));
  }

  /** MSG-01: verify `X-Hub-Signature-256` on the raw body, persist the raw events, enqueue, answer 200. */
  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: any) {
    const started = Date.now();
    if (!this.webhooks.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) {
      this.webhooks.recordInvalidSignature();
      throw new AppException('WEBHOOK_SIGNATURE_INVALID');
    }
    try {
      await this.webhooks.ingest(req.body);
    } catch {
      // Postgres unavailable ⇒ 503 so that Meta redelivers (05 §1.2); nothing is logged from the body
      throw new AppException('INTERNAL', {}, {}, undefined, 503);
    }
    this.webhooks.recordAck(Date.now() - started);
    return new RawResponse('EVENT_RECEIVED');
  }

  /** MSG-08: Meta data-deletion callback (form field `signed_request`) → status URL + confirmation code. */
  @Public()
  @Post('data-deletion')
  @HttpCode(200)
  async dataDeletion(@Body() body: { signed_request?: string }) {
    const payload = parseSignedRequest(this.config.get('META_APP_SECRET'), body?.signed_request);
    if (!payload || !payload.user_id) throw new AppException('WEBHOOK_SIGNATURE_INVALID');
    return new RawResponse(await this.lifecycle.request(String(payload.user_id)));
  }
}

@Controller('data-deletion')
export class DataDeletionController {
  constructor(private readonly lifecycle: DataLifecycleService) {}

  @Public()
  @Get(':code')
  status(@Param('code') code: string) {
    return this.lifecycle.status(code.slice(0, 64));
  }
}

/**
 * MSG-08 — end-customer data deletion asked by e-mail (ADM-16 « Demandes de suppression »): an admin runs the same deletion
 * job as the Meta callback for a phone or a page-scoped sender id, and sends the returned status URL to the requester.
 */
@Controller('admin/data-deletion-requests')
@Platform()
export class AdminDataDeletionController {
  constructor(private readonly lifecycle: DataLifecycleService) {}

  @Get()
  @RequirePlatformRole('admin.deletion.read')
  list(@Query() q: AdminDataDeletionQueryDto) {
    return this.lifecycle.listAdmin(q);
  }

  @Post()
  @HttpCode(201)
  @RequirePlatformRole('admin.deletion.write')
  create(@Body() dto: AdminDataDeletionCreateDto, @Admin() a: AdminActor) {
    return this.lifecycle.requestByAdmin(dto, a);
  }
}

// --- inbox ---------------------------------------------------------------------------------------------------------------
@ApiScopes({ read: 'conversations:read' })
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly safety: SafetyService,
  ) {}

  @Get()
  @RequirePermission('inbox.read')
  list(@Query() q: InboxQueryDto) {
    return this.conversations.list(q as InboxQuery);
  }

  @Get('counts')
  @RequirePermission('inbox.read')
  counts(@Query() q: ConversationCountsQueryDto) {
    return this.conversations.counts(q);
  }

  /** `POST /conversations/bulk/{resolve|archive|assign|resume-ai|block}` → per-item results. */
  @Post('bulk/:action')
  @HttpCode(200)
  @RequirePermission('inbox.read')
  async bulk(@Param('action') action: string, @Body() body: unknown, @Req() req: any) {
    if (!(INBOX_BULK_ACTIONS as readonly string[]).includes(action)) throw notFound();
    const schema = action === 'assign' ? BulkAssignConversationsSchema : action === 'block' ? BulkBlockConversationsSchema : BulkConversationsSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ZodValidationException(parsed.error);
    const d = parsed.data as { ids: string[]; assigneeId?: string | null; reason?: never; note?: string };
    return this.conversations.bulk(action as InboxBulkAction, d.ids, d, { locale: req.locale ?? 'fr', ref: req.id ?? 'unknown' });
  }

  @Get(':id')
  @RequirePermission('inbox.read')
  get(@Id() id: string) {
    return this.conversations.get(id);
  }

  @Patch(':id')
  @RequirePermission('inbox.read')
  update(@Id() id: string, @Body() dto: UpdateConversationDto) {
    return this.conversations.update(id, dto as UpdateConversationInput);
  }

  @Delete(':id')
  @RequirePermission('inbox.delete')
  remove(@Id() id: string) {
    return this.conversations.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('inbox.delete')
  restore(@Id() id: string) {
    return this.conversations.restore(id);
  }

  @Get(':id/messages')
  @RequirePermission('inbox.read')
  messages(@Id() id: string, @Query() q: MessagesQueryDto) {
    return this.conversations.messages(id, q as MessagesQuery);
  }

  @Post(':id/messages')
  @ApiScope('conversations:reply')
  @RequirePermission('inbox.read')
  @Idempotent({ required: true })
  send(@Id() id: string, @Body() dto: SendMessageDto) {
    return this.conversations.send(id, dto as SendMessageInput);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('inbox.read')
  read(@Id() id: string) {
    return this.conversations.markRead(id);
  }

  @Post(':id/unread')
  @HttpCode(200)
  @RequirePermission('inbox.read')
  unread(@Id() id: string) {
    return this.conversations.markRead(id, true);
  }

  @Get(':id/notes')
  @RequirePermission('inbox.read')
  notes(@Id() id: string) {
    return this.conversations.notes(id);
  }

  @Post(':id/notes')
  @RequirePermission('inbox.read')
  addNote(@Id() id: string, @Body() dto: CreateNoteDto) {
    return this.conversations.addNote(id, dto.body);
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequirePermission('safety.block')
  async block(@Id() id: string, @Body() dto: BlockConversationDto) {
    const block = await this.safety.blockConversation(id, { reason: dto.reason, note: dto.note });
    return this.safety.blockView(block.id);
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @RequirePermission('safety.manage')
  unblock(@Id() id: string) {
    return this.safety.unblockConversation(id);
  }
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly safety: SafetyService) {}

  /** Shortcut of `POST /safety/reports { type: ai_message }` [FIG DLG Inbox "Signaler ce message"]. */
  @Post(':id/report')
  @RequirePermission('safety.block')
  report(@Id() id: string, @Body() dto: ReportMessageDto) {
    return this.safety.report({ type: 'ai_message', messageId: id, reason: dto.reason, details: dto.details });
  }
}

/** CHN-07: message history of one page (declared here because it reads the messaging tables). */
@Controller('channels')
export class ChannelMessagesController {
  constructor(private readonly conversations: ConversationService) {}

  @Get(':id/messages')
  @RequirePermission('channels.read')
  messages(@Id() id: string, @Query() q: ChannelMessagesQueryDto) {
    return this.conversations.channelMessages(id, q as ChannelMessagesQuery);
  }
}

// --- trust & safety (merchant side) ---------------------------------------------------------------------------------------
@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('blocks')
  @RequirePermission('safety.block')
  blocks(@Query() q: SafetyBlocksQueryDto) {
    return this.safety.listBlocks(q as SafetyBlocksQuery);
  }

  @Post('blocks')
  @RequirePermission('safety.block')
  block(@Body() dto: CreateBlockDto) {
    return this.safety.block(dto as CreateBlockInput);
  }

  @Delete('blocks/:id')
  @RequirePermission('safety.manage')
  unblock(@Id() id: string) {
    return this.safety.unblock(id);
  }

  @Post('reports')
  @RequirePermission('safety.block')
  report(@Body() dto: CreateReportDto) {
    return this.safety.report(dto as CreateReportInput);
  }

  @Get('reports')
  @RequirePermission('safety.block')
  reports(@Query() q: SafetyReportsQueryDto) {
    return this.safety.listReports(q as { scope: 'mine' | 'workspace'; page: number; pageSize: number });
  }

  @Get('reports/:id')
  @RequirePermission('safety.block')
  reportOne(@Id() id: string) {
    return this.safety.getReport(id);
  }

  @Get('rules')
  @RequirePermission('safety.manage')
  rules() {
    return this.safety.getRules();
  }

  @Put('rules')
  @RequirePermission('safety.manage')
  setRules(@Body() dto: SafetyRulesDto) {
    return this.safety.setRules(dto as SafetyRules);
  }

  @Get('blocked-words')
  @RequirePermission('safety.manage')
  blockedWords() {
    return this.safety.getBlockedWords();
  }

  @Put('blocked-words')
  @RequirePermission('safety.manage')
  @Audited({ entity: 'Workspace', action: 'safety.blocked_words' })
  setBlockedWords(@Body() dto: BlockedWordsDto) {
    return this.safety.setBlockedWords(dto.words);
  }
}

// --- dev simulator ---------------------------------------------------------------------------------------------------------
/**
 * Manual testing without Meta: injects a correctly signed fake webhook delivery (a customer message, optionally with an
 * image) for one of the workspace's connected fake pages, through the exact code path of the real webhook.
 * Exists only outside production AND with the fake adapter; anywhere else the route answers 404.
 */
@Controller('dev/meta')
export class DevSimulatorController {
  constructor(
    private readonly webhooks: MetaWebhookService,
    private readonly config: ConfigService,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  private assertDev() {
    if (this.config.isProd || this.meta.driver !== 'fake') throw notFound();
  }

  @Post('inbound')
  @HttpCode(200)
  @RequirePermission('channels.manage')
  async inbound(@Body() body: { channelId?: string; text?: string; image?: boolean; audio?: boolean; senderId?: string }) {
    this.assertDev();
    const channel = typeof body?.channelId === 'string' && /^[0-9a-f-]{36}$/i.test(body.channelId) ? await prisma.channel.findFirst({ where: { id: body.channelId } }) : null;
    if (!channel) throw notFound();
    const sender = typeof body.senderId === 'string' && /^\d{6,20}$/.test(body.senderId) ? body.senderId : `7${channel.externalId.replace(/\D/g, '').slice(-9).padStart(9, '0')}001`;
    const mid = `m_sim_${randomUUID().replace(/-/g, '')}`;
    const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : body.image || body.audio ? undefined : 'Salam, c\'est combien ?';
    const message: Record<string, unknown> = { mid, ...(text ? { text } : {}), ...(body.image ? { attachments: [{ type: 'image', payload: { url: `${FAKE_MEDIA_HOST}/sim/${mid}.jpg` } }] } : body.audio ? { attachments: [{ type: 'audio', payload: { url: `${FAKE_MEDIA_HOST}/sim/${mid}.mp3` } }] } : {}) };
    const now = Date.now();
    const payload = { object: channel.platform === 'instagram' ? 'instagram' : 'page', entry: [{ id: channel.externalId, time: now, messaging: [{ sender: { id: sender }, recipient: { id: channel.externalId }, timestamp: now, message }] }] };
    const raw = Buffer.from(JSON.stringify(payload));
    const secret = this.config.get('META_APP_SECRET');
    // signed like Meta signs it, then verified like any delivery (no secret configured ⇒ the verification step is skipped)
    if (secret && !this.webhooks.verifySignature(raw, signWebhookBody(secret, raw))) throw new AppException('WEBHOOK_SIGNATURE_INVALID');
    const stored = await this.webhooks.ingest(payload);
    return { mid, senderId: sender, signed: !!secret, stored };
  }
}
