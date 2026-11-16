// 06-api "Clients" + §8.3 (risk) + §8.5 (merge, bulk, conversations). Read / write = every member (`clients.read`,
// `clients.write`); delete, merge, export = Admin+ (`clients.delete`) — 01-nest-module-map §3.2.
// Literal sub-paths (`export`, `merge`, `bulk/*`) are declared before `:id`.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  BulkClientIdsSchema,
  BulkClientTagsSchema,
  BulkDeleteClientsSchema,
  ClientRiskSchema,
  ClientsExportQuerySchema,
  ClientsQuerySchema,
  ClientTagsQuerySchema,
  CreateClientSchema,
  DeleteClientQuerySchema,
  MergeClientsSchema,
  UpdateClientSchema,
  type ClientsQuery,
} from '@djaber/shared';
import { prisma } from '@djaber/db';
import { RequirePermission, ApiScopes } from '../../core/auth/decorators';
import { notFound } from '../../core/errors/app.exception';
import { bulkCtx, runBulk } from '../../core/http/bulk';
import { I18nService } from '../../core/i18n/i18n.service';
import { ExportService } from '../jobs/export.service';
import { conversationInclude, presentConversation } from '../messaging/messaging.presenter';
import { SafetyService } from '../messaging/safety.service';
import { ORDER_LIST_INCLUDE, presentOrderListItem } from '../orders/order.presenter';
import { ClientService } from './client.service';

class ClientsQueryDto extends createZodDto(ClientsQuerySchema) {}
class ClientTagsQueryDto extends createZodDto(ClientTagsQuerySchema) {}
class ClientsExportQueryDto extends createZodDto(ClientsExportQuerySchema) {}
class CreateClientDto extends createZodDto(CreateClientSchema) {}
class UpdateClientDto extends createZodDto(UpdateClientSchema) {}
class ClientRiskDto extends createZodDto(ClientRiskSchema) {}
class MergeClientsDto extends createZodDto(MergeClientsSchema) {}
class BulkClientTagsDto extends createZodDto(BulkClientTagsSchema) {}
class BulkClientIdsDto extends createZodDto(BulkClientIdsSchema) {}
class BulkDeleteClientsDto extends createZodDto(BulkDeleteClientsSchema) {}
class DeleteClientQueryDto extends createZodDto(DeleteClientQuerySchema) {}

const Id = () => Param('id', ParseUUIDPipe);

@ApiScopes({ read: 'customers:read', write: 'customers:write' })
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientService,
    private readonly exports: ExportService,
    private readonly safety: SafetyService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @RequirePermission('clients.read')
  list(@Query() q: ClientsQueryDto) {
    return this.clients.list(q as ClientsQuery);
  }

  @Post()
  @RequirePermission('clients.write')
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  /** M11 — tag suggestions: `{ tag, count }[]` of the workspace's clients (count desc, ≤ 100), `?q=` filters by substring (API key: `customers:read` of the controller). */
  @Get('tags')
  @RequirePermission('clients.read')
  tags(@Query() q: ClientTagsQueryDto) {
    return this.clients.tags(q.q);
  }

  /** XLSX (default) or CSV of the filtered list → 202 job (06 §7 columns). */
  @Get('export')
  @HttpCode(202)
  @RequirePermission('clients.delete')
  export(@Query() q: ClientsExportQueryDto) {
    const { page: _p, pageSize: _ps, view: _v, format, ...filters } = q as ClientsQuery & { format?: 'csv' | 'xlsx' };
    return this.exports.request('clients', filters, format ?? 'xlsx');
  }

  @Post('merge')
  @HttpCode(200)
  @RequirePermission('clients.delete')
  merge(@Body() dto: MergeClientsDto) {
    return this.clients.merge(dto.keepId, dto.mergeId, dto.confirm === true);
  }

  @Post('bulk/tags')
  @HttpCode(200)
  @RequirePermission('clients.write')
  bulkTags(@Body() dto: BulkClientTagsDto, @Req() req: any) {
    return runBulk(this.i18n, dto.ids, bulkCtx(req), (id, tx) => this.clients.bulkTags(id, dto.add ?? [], dto.remove ?? [], tx!));
  }

  @Post('bulk/delete')
  @HttpCode(200)
  @RequirePermission('clients.delete')
  bulkDelete(@Body() dto: BulkDeleteClientsDto, @Req() req: any) {
    return runBulk(this.i18n, dto.ids, bulkCtx(req), (id) => this.clients.remove(id, dto.archive === true), { ownTx: true });
  }

  @Post('bulk/export')
  @HttpCode(202)
  @RequirePermission('clients.delete')
  bulkExport(@Body() dto: BulkClientIdsDto) {
    return this.exports.request('clients', { ids: dto.ids }, 'xlsx');
  }

  @Get(':id')
  @RequirePermission('clients.read')
  get(@Id() id: string, @Req() req: any) {
    return this.clients.get(id, req.locale ?? 'fr');
  }

  @Patch(':id')
  @RequirePermission('clients.write')
  update(@Id() id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('clients.delete')
  remove(@Id() id: string, @Query() q: DeleteClientQueryDto) {
    return this.clients.remove(id, q.archive === true);
  }

  /** full-test CLIENTS-03: an archived client is restored (its orders and risk history come back with it). */
  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('clients.delete')
  restore(@Id() id: string) {
    return this.clients.restore(id);
  }

  @Post(':id/risk')
  @HttpCode(200)
  @RequirePermission('clients.write')
  risk(@Id() id: string, @Body() dto: ClientRiskDto) {
    return this.clients.setRisk(id, dto.riskLevel);
  }

  @Get(':id/metrics')
  @RequirePermission('clients.read')
  metrics(@Id() id: string) {
    return this.clients.metrics(id);
  }

  /** "Commandes de ce client" — the 50 latest (the full list is `GET /orders?clientId=`). */
  @Get(':id/orders')
  @RequirePermission('clients.read')
  async orders(@Id() id: string, @Req() req: any) {
    const c = await prisma.client.findFirst({ where: { id }, select: { id: true } });
    if (!c) throw notFound();
    const index = await this.safety.index();
    const rows = await prisma.order.findMany({ where: { clientId: id }, include: ORDER_LIST_INCLUDE, orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }], take: 50 });
    return rows.map((o) => presentOrderListItem(o, { locale: req.locale ?? 'fr', blocked: (clientId, phone) => index.has({ clientId, channelId: '', externalSenderId: '' }, phone) }));
  }

  @Get(':id/conversations')
  @RequirePermission('clients.read')
  async conversations(@Id() id: string) {
    const c = await prisma.client.findFirst({ where: { id }, select: { id: true } });
    if (!c) throw notFound();
    const index = await this.safety.index();
    const rows = await prisma.conversation.findMany({ where: { clientId: id, deletedAt: null }, include: conversationInclude, orderBy: { lastMessageAt: 'desc' }, take: 50 });
    return rows.map((cv) => presentConversation(cv, index.has(cv, cv.client?.phone)));
  }
}
