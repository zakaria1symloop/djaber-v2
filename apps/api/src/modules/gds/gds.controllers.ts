// 06 "GDS operations" + §8.6 (FIG GDS-06…09, CAT-11 / GDS-06b, DLG GDS I / II): suppliers, purchases, sales, cash
// register, inventory counts. Read `gds.read`, write `gds.write` (Owner + Admin); counts: `stock.count` / `stock.adjust`.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Audited, Idempotent, RequirePermission } from '../../core/auth/decorators';
import { validationError } from '../../core/errors/app.exception';
import { addWarning } from '../../core/http/envelope.interceptor';
import { isDay } from '../../core/time/algiers';
import { ExportService } from '../jobs/export.service';
import { CashService } from './cash.service';
import {
  CancelPurchaseDto,
  CancelSaleDto,
  CashDaysQueryDto,
  CashExportQueryDto,
  CashQueryDto,
  CashStatsQueryDto,
  CloseCashDto,
  CreateCashEntryDto,
  CreatePurchaseDto,
  CreateSaleDto,
  CreateSupplierDto,
  GdsPaymentDto,
  InventoriesQueryDto,
  InventoryLinesDto,
  InventoryScopePreviewQueryDto,
  PrintQueryDto,
  PurchasesQueryDto,
  PurchaseStatsQueryDto,
  ReceivePurchaseDto,
  ReopenCashDto,
  SaleClientDto,
  SalesQueryDto,
  SaleStatsQueryDto,
  StartInventoryDto,
  SupplierPaymentDto,
  SuppliersQueryDto,
  UpdateCashEntryDto,
  UpdatePurchaseDto,
  UpdateSaleDto,
  UpdateSupplierDto,
  ValidateInventoryDto,
  PurchasesExportQueryDto,
  SalesExportQueryDto,
} from './dto';
import type { PurchasesExportQuery, SalesExportQuery } from '@djaber/shared';
import { InventoryService } from './inventory.service';
import { PurchaseService } from './purchase.service';
import { SaleService } from './sale.service';
import { SupplierService } from './supplier.service';

const Id = () => Param('id', ParseUUIDPipe);

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SupplierService) {}

  @Get()
  @RequirePermission('gds.read')
  list(@Query() q: SuppliersQueryDto) {
    return this.suppliers.list(q);
  }

  @Post()
  @RequirePermission('gds.write')
  @Audited({ entity: 'Supplier', action: 'supplier.create', idFrom: 'result.id' })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Get(':id')
  @RequirePermission('gds.read')
  get(@Id() id: string) {
    return this.suppliers.get(id);
  }

  @Patch(':id')
  @RequirePermission('gds.write')
  @Audited({ entity: 'Supplier', action: 'supplier.update' })
  update(@Id() id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Supplier', action: 'supplier.delete' })
  async remove(@Id() id: string) {
    await this.suppliers.remove(id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Supplier', action: 'supplier.deactivate' })
  deactivate(@Id() id: string) {
    return this.suppliers.setActive(id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Supplier', action: 'supplier.activate' })
  activate(@Id() id: string) {
    return this.suppliers.setActive(id, true);
  }

  @Get(':id/purchases')
  @RequirePermission('gds.read')
  purchases(@Id() id: string, @Query() q: PurchasesQueryDto) {
    return this.suppliers.purchasesOf(id, q);
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Idempotent()
  @Audited({ entity: 'Supplier', action: 'supplier.payment' })
  pay(@Id() id: string, @Body() dto: SupplierPaymentDto) {
    return this.suppliers.pay(id, dto);
  }
}

@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchaseService,
    private readonly exports: ExportService,
  ) {}

  /** M8 (Figma GDS-07 "Exporter"): the list filters → 202 `{ jobId }`. */
  @Get('export')
  @RequirePermission('gds.read')
  @HttpCode(202)
  export(@Query() q: PurchasesExportQueryDto) {
    const { format, ...filters } = q as PurchasesExportQuery;
    return this.exports.request('purchases', filters, format);
  }

  @Get()
  @RequirePermission('gds.read')
  list(@Query() q: PurchasesQueryDto) {
    return this.purchases.list(q);
  }

  @Get('stats')
  @RequirePermission('gds.read')
  stats(@Query() q: PurchaseStatsQueryDto) {
    return this.purchases.stats(q);
  }

  @Post()
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'Purchase', action: 'purchase.create', idFrom: 'result.id' })
  create(@Body() dto: CreatePurchaseDto) {
    return this.purchases.create(dto);
  }

  @Get(':id')
  @RequirePermission('gds.read')
  get(@Id() id: string) {
    return this.purchases.get(id);
  }

  @Patch(':id')
  @RequirePermission('gds.write')
  @Audited({ entity: 'Purchase', action: 'purchase.update' })
  update(@Id() id: string, @Body() dto: UpdatePurchaseDto) {
    return this.purchases.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Purchase', action: 'purchase.delete' })
  async remove(@Id() id: string) {
    await this.purchases.remove(id);
  }

  @Post(':id/order')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Purchase', action: 'purchase.order' })
  order(@Id() id: string) {
    return this.purchases.order(id);
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'Purchase', action: 'purchase.receive' })
  async receive(@Id() id: string, @Body() dto: ReceivePurchaseDto, @Req() req: any) {
    const r = await this.purchases.receive(id, dto);
    for (const w of r.warnings) addWarning(req, w.code, w.params, w.field);
    return r.data;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Purchase', action: 'purchase.cancel' })
  cancel(@Id() id: string, @Body() dto: CancelPurchaseDto) {
    return this.purchases.cancel(id, dto);
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'Purchase', action: 'purchase.payment' })
  pay(@Id() id: string, @Body() dto: GdsPaymentDto) {
    return this.purchases.pay(id, dto);
  }

  @Post(':id/duplicate')
  @RequirePermission('gds.write')
  @Audited({ entity: 'Purchase', action: 'purchase.duplicate', idFrom: 'result.id' })
  duplicate(@Id() id: string) {
    return this.purchases.duplicate(id);
  }

  @Get(':id/print')
  @RequirePermission('gds.read')
  print(@Id() id: string, @Query() q: PrintQueryDto) {
    return this.purchases.print(id, q.lang);
  }
}

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SaleService,
    private readonly exports: ExportService,
  ) {}

  /** M8 (Figma GDS-08 "Exporter"): the list filters → 202 `{ jobId }`. */
  @Get('export')
  @RequirePermission('gds.read')
  @HttpCode(202)
  export(@Query() q: SalesExportQueryDto) {
    const { format, ...filters } = q as SalesExportQuery;
    return this.exports.request('sales', filters, format);
  }

  @Get()
  @RequirePermission('gds.read')
  list(@Query() q: SalesQueryDto) {
    return this.sales.list(q);
  }

  @Get('stats')
  @RequirePermission('gds.read')
  stats(@Query() q: SaleStatsQueryDto) {
    return this.sales.stats(q);
  }

  @Post()
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'Sale', action: 'sale.create', idFrom: 'result.id' })
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Get(':id')
  @RequirePermission('gds.read')
  get(@Id() id: string) {
    return this.sales.get(id);
  }

  @Patch(':id')
  @RequirePermission('gds.write')
  @Audited({ entity: 'Sale', action: 'sale.update' })
  update(@Id() id: string, @Body() dto: UpdateSaleDto) {
    return this.sales.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Sale', action: 'sale.delete' })
  async remove(@Id() id: string) {
    await this.sales.remove(id);
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'Sale', action: 'sale.payment' })
  pay(@Id() id: string, @Body() dto: GdsPaymentDto) {
    return this.sales.pay(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Sale', action: 'sale.cancel', reasonFrom: 'body.reason' })
  cancel(@Id() id: string, @Body() dto: CancelSaleDto) {
    return this.sales.cancel(id, dto);
  }

  @Post(':id/client')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'Sale', action: 'sale.link_client' })
  linkClient(@Id() id: string, @Body() dto: SaleClientDto) {
    return this.sales.linkClient(id, dto);
  }

  @Get(':id/receipt')
  @RequirePermission('gds.read')
  receipt(@Id() id: string, @Query() q: PrintQueryDto) {
    return this.sales.receipt(id, q.lang);
  }
}

@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly exports: ExportService,
  ) {}

  @Get()
  @RequirePermission('gds.read')
  list(@Query() q: CashQueryDto) {
    return this.cash.list(q);
  }

  @Get('stats')
  @RequirePermission('gds.read')
  stats(@Query() q: CashStatsQueryDto) {
    return this.cash.stats(q);
  }

  @Get('days')
  @RequirePermission('gds.read')
  days(@Query() q: CashDaysQueryDto) {
    return this.cash.days(q);
  }

  @Get('export')
  @HttpCode(202)
  @RequirePermission('gds.write')
  export(@Query() q: CashExportQueryDto) {
    const { format, ...filters } = q;
    return this.exports.request('cash', filters, format);
  }

  @Post('close')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'CashClosing', action: 'cash.close', idFrom: 'result.closing.id' })
  close(@Body() dto: CloseCashDto) {
    return this.cash.close(dto);
  }

  @Post('days/:day/reopen')
  @HttpCode(200)
  @RequirePermission('gds.write')
  @Audited({ entity: 'CashClosing', action: 'cash.reopen', idFrom: 'params.day', reasonFrom: 'body.reason' })
  reopen(@Param('day') day: string, @Body() dto: ReopenCashDto) {
    if (!isDay(day)) throw validationError({ day: 'validation.date' });
    return this.cash.reopen(day, dto);
  }

  @Post()
  @RequirePermission('gds.write')
  @Idempotent({ required: true })
  @Audited({ entity: 'CashTransaction', action: 'cash.create', idFrom: 'result.id' })
  create(@Body() dto: CreateCashEntryDto) {
    return this.cash.create(dto);
  }

  @Get(':id')
  @RequirePermission('gds.read')
  get(@Id() id: string) {
    return this.cash.get(id);
  }

  @Patch(':id')
  @RequirePermission('gds.write')
  @Audited({ entity: 'CashTransaction', action: 'cash.update', diff: true })
  update(@Id() id: string, @Body() dto: UpdateCashEntryDto) {
    return this.cash.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('gds.write')
  @Audited({ entity: 'CashTransaction', action: 'cash.delete', diff: true })
  async remove(@Id() id: string, @Req() req: { auditBefore?: unknown }) {
    // journey J13v-5: the row is deleted — the audit keeps what it was, so the log names it (« loyer · −2 000 DA »)
    const row = await this.cash.get(id);
    req.auditBefore = { description: row.description, category: row.category, type: row.type, amount: row.amount, date: row.date };
    await this.cash.remove(id);
  }
}

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoryService) {}

  @Get()
  @RequirePermission('stock.count')
  list(@Query() q: InventoriesQueryDto) {
    return this.inventories.list(q);
  }

  @Get('scope-preview')
  @RequirePermission('stock.count')
  preview(@Query() q: InventoryScopePreviewQueryDto) {
    return this.inventories.scopePreview(q);
  }

  @Post()
  @RequirePermission('stock.adjust')
  @Audited({ entity: 'InventoryCount', action: 'inventory.start', idFrom: 'result.id' })
  start(@Body() dto: StartInventoryDto) {
    return this.inventories.start(dto);
  }

  @Get(':id')
  @RequirePermission('stock.count')
  get(@Id() id: string) {
    return this.inventories.get(id);
  }

  @Put(':id/lines')
  @RequirePermission('stock.count')
  lines(@Id() id: string, @Body() dto: InventoryLinesDto) {
    return this.inventories.putLines(id, dto);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermission('stock.adjust')
  @Idempotent({ required: true })
  @Audited({ entity: 'InventoryCount', action: 'inventory.validate' })
  validate(@Id() id: string, @Body() dto: ValidateInventoryDto) {
    return this.inventories.validate(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('stock.adjust')
  @Audited({ entity: 'InventoryCount', action: 'inventory.cancel' })
  cancel(@Id() id: string) {
    return this.inventories.cancel(id);
  }

  @Get(':id/sheet')
  @RequirePermission('stock.adjust')
  sheet(@Id() id: string, @Query() q: PrintQueryDto) {
    return this.inventories.sheet(id, q.lang);
  }
}
