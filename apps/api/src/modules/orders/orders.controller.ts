// 06-api "Orders" + §8.5 — orders list / KPIs / export, create (Idempotency-Key), order page, PATCH with `version`,
// status changes, cancel / deliver / return / manual ship, calls, callback, address, assignment, payments, notes,
// bulk status / assign / print, A5 print, delete. Permissions per 01-nest-module-map §3.2: read `orders.read`, actions
// `orders.write` (every member), money / delete / export `orders.money` (Admin+). API-key scopes per 06 §5.
// Literal sub-paths (`stats`, `export`, `bulk/*`) are declared before `:id`.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IMPORT_MAX_BYTES, OrderImportMappingSchema } from '@djaber/shared';
import type { UploadedFile as Incoming } from '../uploads/image-upload.service';
import { OrderImportService } from './order-import.service';
import { createZodDto } from 'nestjs-zod';
import {
  BulkOrderAssignSchema,
  BulkOrderPrintSchema,
  BulkOrderStatusSchema,
  CallLogSchema,
  CancelOrderSchema,
  CreateOrderSchema,
  DeleteOrderQuerySchema,
  DeliverOrderSchema,
  OrderAddressSchema,
  OrderAssignSchema,
  OrderCallbackSchema,
  OrderNoteSchema,
  OrderPrintQuerySchema,
  OrdersExportQuerySchema,
  OrderStatsQuerySchema,
  OrderStatusChangeSchema,
  OrdersQuerySchema,
  RecordPaymentSchema,
  ReturnOrderSchema,
  ShipManualSchema,
  UpdateOrderSchema,
  type OrderPrintQuery,
  type OrdersExportQuery,
  type OrdersQuery,
} from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { ApiScope, Audited, Idempotent, RequirePermission } from '../../core/auth/decorators';
import { addWarning } from '../../core/http/envelope.interceptor';
import { bulkCtx } from '../../core/http/bulk';
import { ExportService } from '../jobs/export.service';
import { OrderPrintService } from './order-print.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderService } from './order.service';
import { orderOrderBy } from './order.query';

class OrdersQueryDto extends createZodDto(OrdersQuerySchema) {}
class OrderImportMappingDto extends createZodDto(OrderImportMappingSchema) {}
class OrderStatsQueryDto extends createZodDto(OrderStatsQuerySchema) {}
class OrdersExportQueryDto extends createZodDto(OrdersExportQuerySchema) {}
class CreateOrderDto extends createZodDto(CreateOrderSchema) {}
class UpdateOrderDto extends createZodDto(UpdateOrderSchema) {}
class OrderStatusChangeDto extends createZodDto(OrderStatusChangeSchema) {}
class CancelOrderDto extends createZodDto(CancelOrderSchema) {}
class DeliverOrderDto extends createZodDto(DeliverOrderSchema) {}
class ReturnOrderDto extends createZodDto(ReturnOrderSchema) {}
class ShipManualDto extends createZodDto(ShipManualSchema) {}
class CallLogDto extends createZodDto(CallLogSchema) {}
class OrderCallbackDto extends createZodDto(OrderCallbackSchema) {}
class OrderAddressDto extends createZodDto(OrderAddressSchema) {}
class OrderAssignDto extends createZodDto(OrderAssignSchema) {}
class RecordPaymentDto extends createZodDto(RecordPaymentSchema) {}
class OrderNoteDto extends createZodDto(OrderNoteSchema) {}
class BulkOrderStatusDto extends createZodDto(BulkOrderStatusSchema) {}
class BulkOrderAssignDto extends createZodDto(BulkOrderAssignSchema) {}
class BulkOrderPrintDto extends createZodDto(BulkOrderPrintSchema) {}
class OrderPrintQueryDto extends createZodDto(OrderPrintQuerySchema) {}
class DeleteOrderQueryDto extends createZodDto(DeleteOrderQuerySchema) {}

const Id = () => Param('id', ParseUUIDPipe);
const loc = (req: any): string => req.locale ?? 'fr';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrderService,
    private readonly workflow: OrderWorkflowService,
    private readonly print: OrderPrintService,
    private readonly exports: ExportService,
    private readonly imports: OrderImportService,
  ) {}

  // --- import (03 §37 ORD, D69, `orders.import`) --------------------------------------------------------------------------
  @Post('import')
  @RequirePermission('orders.import')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES * 2, files: 1 } }))
  startImport(@UploadedFile() file: Incoming | undefined) {
    return this.imports.start(file);
  }

  @Post('import/mapping')
  @RequirePermission('orders.import')
  @HttpCode(202)
  mapImport(@Body() dto: OrderImportMappingDto) {
    return this.imports.mapping(dto);
  }

  @Post('import/:jobId/commit')
  @RequirePermission('orders.import')
  @Idempotent({ required: true })
  @HttpCode(202)
  @Audited({ entity: 'Job', action: 'order.import_commit', idFrom: 'params.jobId' })
  commitImport(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.imports.commit(jobId);
  }

  // --- collection -------------------------------------------------------------------------------------------------------
  @Get()
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  list(@Query() q: OrdersQueryDto, @Req() req: any) {
    return this.orders.list(q as OrdersQuery, loc(req));
  }

  /** `[FIG ORD-05 v2 KPIs]` — same filters as the list. */
  @Get('stats')
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  stats(@Query() q: OrderStatsQueryDto) {
    const { view: _view, ...filters } = q as OrdersQuery;
    return this.orders.stats(filters);
  }

  /** XLSX / CSV → 202 job `[FIG DLG Exporter les commandes]` (06 §7 columns, `courierFormat=zrexpress`). */
  @Get('export')
  @HttpCode(202)
  @RequirePermission('orders.money')
  export(@Query() q: OrdersExportQueryDto) {
    const query = q as OrdersExportQuery;
    orderOrderBy(query.sort); // unknown sort ⇒ 400 now, not a failed job later
    return this.exports.request('orders', query, query.format);
  }

  @Post()
  @RequirePermission('orders.write')
  @ApiScope('orders:write')
  @Idempotent({ required: true })
  create(@Body() dto: CreateOrderDto, @Req() req: any) {
    const t = TenantContext.get();
    return this.orders.create(dto, loc(req), t.apiKeyId ? 'api' : req.headers['x-app-platform'] ? 'mobile' : 'manual');
  }

  @Post('bulk/status')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent({ required: true })
  bulkStatus(@Body() dto: BulkOrderStatusDto, @Req() req: any) {
    return this.workflow.bulkStatus(dto, bulkCtx(req));
  }

  @Post('bulk/assign')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent({ required: true })
  bulkAssign(@Body() dto: BulkOrderAssignDto, @Req() req: any) {
    return this.workflow.bulkAssign(dto, bulkCtx(req));
  }

  /** A5 slips of the selection, one PDF → 202 job. */
  @Post('bulk/print')
  @HttpCode(202)
  @RequirePermission('orders.write')
  @Idempotent({ required: true })
  bulkPrint(@Body() dto: BulkOrderPrintDto) {
    return this.print.requestBulk(dto);
  }

  // --- one order --------------------------------------------------------------------------------------------------------
  @Get(':id')
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  get(@Id() id: string, @Req() req: any) {
    return this.orders.get(id, loc(req));
  }

  @Patch(':id')
  @RequirePermission('orders.write')
  @ApiScope('orders:write')
  update(@Id() id: string, @Body() dto: UpdateOrderDto, @Req() req: any) {
    return this.orders.update(id, dto, loc(req));
  }

  /** Admin+; typed number checked when sent (`?confirmNumber=CMD-1036`); audited `order.delete`. */
  @Delete(':id')
  @RequirePermission('orders.money')
  remove(@Id() id: string, @Query() q: DeleteOrderQueryDto) {
    return this.orders.remove(id, q.confirmNumber);
  }

  @Post(':id/duplicate')
  @HttpCode(200)
  @RequirePermission('orders.write')
  duplicate(@Id() id: string) {
    return this.orders.duplicate(id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @ApiScope('orders:write')
  @Idempotent({ required: true })
  status(@Id() id: string, @Body() dto: OrderStatusChangeDto, @Req() req: any) {
    return this.workflow.changeStatus(id, dto, loc(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent()
  cancel(@Id() id: string, @Body() dto: CancelOrderDto, @Req() req: any) {
    return this.workflow.cancel(id, dto, loc(req));
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent()
  deliver(@Id() id: string, @Body() dto: DeliverOrderDto, @Req() req: any) {
    return this.workflow.deliver(id, dto, loc(req));
  }

  /** `delivered → returned` additionally needs `orders.money` (checked by the status machine). */
  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent()
  returnOrder(@Id() id: string, @Body() dto: ReturnOrderDto, @Req() req: any) {
    return this.workflow.returnOrder(id, dto, loc(req));
  }

  @Post(':id/ship-manual')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent()
  shipManual(@Id() id: string, @Body() dto: ShipManualDto, @Req() req: any) {
    return this.workflow.shipManual(id, dto, loc(req));
  }

  @Get(':id/calls')
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  calls(@Id() id: string, @Req() req: any) {
    return this.workflow.calls(id, loc(req));
  }

  /** Logged call; a call on a closed order is logged with the warning `ORDER_CALL_ON_TERMINAL` (order unchanged). */
  @Post(':id/calls')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @ApiScope('orders:write')
  async logCall(@Id() id: string, @Body() dto: CallLogDto, @Req() req: any) {
    const r = await this.workflow.logCall(id, dto, loc(req));
    if (r.warning) addWarning(req, 'ORDER_CALL_ON_TERMINAL');
    return r.order;
  }

  @Post(':id/callback')
  @HttpCode(200)
  @RequirePermission('orders.write')
  setCallback(@Id() id: string, @Body() dto: OrderCallbackDto, @Req() req: any) {
    return this.workflow.setCallback(id, dto, loc(req));
  }

  @Delete(':id/callback')
  @RequirePermission('orders.write')
  clearCallback(@Id() id: string, @Req() req: any) {
    return this.workflow.clearCallback(id, loc(req));
  }

  @Post(':id/address')
  @HttpCode(200)
  @RequirePermission('orders.write')
  setAddress(@Id() id: string, @Body() dto: OrderAddressDto, @Req() req: any) {
    return this.workflow.setAddress(id, dto, loc(req));
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('orders.write')
  assign(@Id() id: string, @Body() dto: OrderAssignDto, @Req() req: any) {
    return this.workflow.assign(id, dto.assigneeId, dto.notify ?? false, loc(req));
  }

  @Get(':id/payments')
  @RequirePermission('orders.read')
  payments(@Id() id: string, @Req() req: any) {
    return this.workflow.payments(id, loc(req));
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermission('orders.write')
  @Idempotent({ required: true })
  recordPayment(@Id() id: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    return this.workflow.recordPayment(id, dto, loc(req));
  }

  @Get(':id/notes')
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  notes(@Id() id: string, @Req() req: any) {
    return this.workflow.notes(id, loc(req));
  }

  @Post(':id/notes')
  @RequirePermission('orders.write')
  @ApiScope('orders:write')
  addNote(@Id() id: string, @Body() dto: OrderNoteDto, @Req() req: any) {
    return this.workflow.addNote(id, dto.body, loc(req));
  }

  @Get(':id/history')
  @RequirePermission('orders.read')
  @ApiScope('orders:read')
  history(@Id() id: string, @Req() req: any) {
    return this.orders.history(id, loc(req));
  }

  @Get(':id/shipments')
  @RequirePermission('orders.read')
  async shipments(@Id() id: string, @Req() req: any) {
    return (await this.orders.get(id, loc(req))).shipments;
  }

  /** A5 slip PDF → `{ url }` (signed, `private/`, 24 h). */
  @Get(':id/print')
  @RequirePermission('orders.read')
  printOne(@Id() id: string, @Query() q: OrderPrintQueryDto) {
    return this.print.printOne(id, q as OrderPrintQuery);
  }
}
