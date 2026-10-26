// 06-api "Catalogue (GDS)" + §8.2 + §8.6 — products, images, variants, expenses, bulk actions, import / export, moderation
// (merchant side). Reads: `catalog.read` (every member); writes: `catalog.write` (Admin+), 01-nest-module-map §3.2.
// Literal sub-paths (`low-stock`, `search`, `export`, `import`, `bulk/*`, `ai-fill`) are declared before `:id`.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IMPORT_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES } from '@djaber/shared';
import { Audited, Idempotent, RequirePermission, ApiScopes } from '../../core/auth/decorators';
import { addWarning } from '../../core/http/envelope.interceptor';
import { ExportService } from '../jobs/export.service';
import type { UploadedFile as Incoming } from '../uploads/image-upload.service';
import { imageInterceptor } from '../uploads/uploads.controller';
import { AiFillService } from './ai-fill.service';
import { BulkService } from './bulk.service';
import type { WithWarnings } from './catalog.util';
import {
  BulkAgentDto,
  BulkArchiveDto,
  BulkCategoryDto,
  BulkIdsDto,
  BulkMinStockDto,
  BulkPriceDto,
  CreateProductDto,
  CreateProductExpenseDto,
  CreateVariantDto,
  DeleteProductQueryDto,
  DuplicateProductDto,
  GenerateVariantsDto,
  ImportMappingDto,
  ProductAppealDto,
  ProductsQueryDto,
  ReorderProductImagesDto,
  RestoreProductDto,
  SearchQueryDto,
  UpdateProductDto,
  UpdateProductExpenseDto,
  UpdateProductImageDto,
  UpdateVariantDto,
  type ProductsQuery,
} from './dto';
import { ExpenseService } from './expense.service';
import { ImportService } from './import.service';
import { ModerationHookService } from './moderation-hook.service';
import { ProductImageService } from './product-image.service';
import { productOrder, productStats } from './product.query';
import { TenantContext } from '@djaber/db';
import { ProductService } from './product.service';
import { StockService } from './stock.service';
import { VariantService } from './variant.service';

/** Moves the non-blocking warnings of a service result into `meta.warnings` (11 §11). */
const unwrap = <T>(req: any, r: WithWarnings<T>): T => {
  for (const w of r.warnings) addWarning(req, w.code, w.params, w.field);
  return r.data;
};
const bulkCtx = (req: any) => ({ locale: req.locale ?? 'fr', ref: req.id ?? 'unknown' });
const Id = () => Param('id', ParseUUIDPipe);

@ApiScopes({ read: 'products:read', write: 'products:write' })
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductService,
    private readonly images: ProductImageService,
    private readonly variants: VariantService,
    private readonly expenses: ExpenseService,
    private readonly bulk: BulkService,
    private readonly imports: ImportService,
    private readonly exports: ExportService,
    private readonly aiFill: AiFillService,
    private readonly moderation: ModerationHookService,
    private readonly stock: StockService,
  ) {}

  // --- collection -----------------------------------------------------------------------------------------------------
  @Get()
  @RequirePermission('catalog.read')
  list(@Query() q: ProductsQueryDto) {
    return this.products.list(q as ProductsQuery);
  }

  @Post()
  @RequirePermission('catalog.write')
  @Idempotent()
  @Audited({ entity: 'Product', action: 'product.create', idFrom: 'result.id' })
  async create(@Body() dto: CreateProductDto, @Req() req: any) {
    return unwrap(req, await this.products.create(dto));
  }

  /** M2 carry-over: KPIs of `/products` following the list filters. */
  @Get('stats')
  @RequirePermission('catalog.read')
  stats(@Query() q: ProductsQueryDto) {
    return productStats(q as ProductsQuery, TenantContext.get().stockMode === 'advanced');
  }

  /** CAT-09 alert lines: products and variants at or below their threshold. */
  @Get('low-stock')
  @RequirePermission('catalog.read')
  lowStock() {
    return this.stock.lowStockLines();
  }

  /** Sellable products for pickers (order form now, AI tool `search_products` in M4). */
  @Get('search')
  @RequirePermission('catalog.read')
  search(@Query() q: SearchQueryDto) {
    return this.products.search(q.q, q.limit);
  }

  /** XLSX (default) or CSV of the list with the current filters → 202 job (06 §7). */
  @Get('export')
  @RequirePermission('catalog.write')
  @HttpCode(202)
  export(@Query() q: ProductsQueryDto) {
    const { page: _page, pageSize: _pageSize, view: _view, format, ...filters } = q as ProductsQuery;
    productOrder(filters.sort); // unknown sort ⇒ 400 now, not a failed job later
    return this.exports.request('products', filters, format ?? 'xlsx');
  }

  // --- import (CAT-06, FL-12) -----------------------------------------------------------------------------------------
  @Post('import')
  @RequirePermission('catalog.write')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES * 2, files: 1 } }))
  startImport(@UploadedFile() file: Incoming | undefined) {
    return this.imports.start(file);
  }

  @Post('import/mapping')
  @RequirePermission('catalog.write')
  @HttpCode(202)
  mapImport(@Body() dto: ImportMappingDto) {
    return this.imports.mapping(dto);
  }

  @Post('import/:jobId/commit')
  @RequirePermission('catalog.write')
  @Idempotent({ required: true })
  @HttpCode(202)
  @Audited({ entity: 'Job', action: 'product.import_commit', idFrom: 'result.id' })
  async commitImport(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const r = await this.imports.commit(jobId);
    return { ...r, id: r.jobId };
  }

  // --- create from photo (CAT-07) ----------------------------------------------------------------------------------------
  @Post('ai-fill')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('photos', 10, { storage: memoryStorage(), limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES * 2 } }))
  fill(@UploadedFiles() files: Incoming[] | undefined, @Body() body: Record<string, string>, @Req() req: any) {
    return this.aiFill.fill(files, { name: body?.name, description: body?.description, categoryId: body?.categoryId, unitId: body?.unitId }, req.locale ?? 'fr');
  }

  // --- bulk (06 §8.6): 200 { data: { results }, meta: { ok, failed } } --------------------------------------------------------
  @Post('bulk/category')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  bulkCategory(@Body() dto: BulkCategoryDto, @Req() req: any) {
    return this.bulk.category(dto.ids, dto.categoryId, bulkCtx(req));
  }

  @Post('bulk/agent')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  bulkAgent(@Body() dto: BulkAgentDto, @Req() req: any) {
    return this.bulk.agent(dto.ids, dto.agentId, bulkCtx(req));
  }

  @Post('bulk/min-stock')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  bulkMinStock(@Body() dto: BulkMinStockDto, @Req() req: any) {
    return this.bulk.minStock(dto.ids, dto.minStock, bulkCtx(req));
  }

  @Post('bulk/price')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  @Audited({ entity: 'Product', action: 'product.bulk_price' })
  async bulkPrice(@Body() dto: BulkPriceDto, @Req() req: any) {
    const r = await this.bulk.price(dto, bulkCtx(req));
    for (const w of r.warnings) addWarning(req, w.code, w.params);
    return { results: r.results };
  }

  @Post('bulk/archive')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  @Audited({ entity: 'Product', action: 'product.bulk_archive' })
  bulkArchive(@Body() dto: BulkArchiveDto, @Req() req: any) {
    return this.bulk.archive(dto.ids, dto.releaseStock === true, bulkCtx(req));
  }

  @Post('bulk/export')
  @RequirePermission('catalog.write')
  @HttpCode(202)
  bulkExport(@Body() dto: BulkIdsDto) {
    return this.exports.request('products', { ids: dto.ids, status: ['active', 'inactive', 'archived'] }, 'xlsx');
  }

  // --- one product ------------------------------------------------------------------------------------------------------
  @Get(':id')
  @RequirePermission('catalog.read')
  get(@Id() id: string) {
    return this.products.get(id);
  }

  @Patch(':id')
  @RequirePermission('catalog.write')
  @Audited({ entity: 'Product', action: 'product.update' })
  async update(@Id() id: string, @Body() dto: UpdateProductDto, @Req() req: any) {
    return unwrap(req, await this.products.update(id, dto));
  }

  @Delete(':id')
  @RequirePermission('catalog.write')
  @HttpCode(204)
  @Audited({ entity: 'Product', action: 'product.delete' })
  async remove(@Id() id: string, @Query() q: DeleteProductQueryDto) {
    await this.products.remove(id, q);
  }

  @Post(':id/restore')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  @Audited({ entity: 'Product', action: 'product.restore' })
  restore(@Id() id: string, @Body() dto: RestoreProductDto) {
    return this.products.restore(id, dto?.sku ?? undefined);
  }

  @Post(':id/duplicate')
  @RequirePermission('catalog.write')
  @Audited({ entity: 'Product', action: 'product.duplicate', idFrom: 'result.id' })
  async duplicate(@Id() id: string, @Body() dto: DuplicateProductDto, @Req() req: any) {
    return unwrap(req, await this.products.duplicate(id, dto));
  }

  @Get(':id/relations')
  @RequirePermission('catalog.read')
  relations(@Id() id: string) {
    return this.products.relations(id);
  }

  @Get(':id/card-preview')
  @RequirePermission('catalog.read')
  cardPreview(@Id() id: string, @Req() req: any) {
    return this.products.cardPreview(id, req.locale ?? 'fr');
  }

  @Get(':id/margins')
  @RequirePermission('catalog.read')
  margins(@Id() id: string) {
    return this.products.margins(id);
  }

  // --- moderation, merchant side (06 §8.2) ----------------------------------------------------------------------------------
  @Get(':id/moderation')
  @RequirePermission('catalog.read')
  moderationOf(@Id() id: string) {
    return this.moderation.get(id);
  }

  @Post(':id/resubmit')
  @RequirePermission('catalog.write')
  @HttpCode(202)
  resubmit(@Id() id: string) {
    return this.moderation.resubmit(id);
  }

  /** Tester report 25/10 UX-001: the product form's « Enregistrer » sends what changed (pictures included) to moderation. */
  @Post(':id/submit-changes')
  @RequirePermission('catalog.write')
  @HttpCode(200)
  submitChanges(@Id() id: string) {
    return this.moderation.submitChanges(id);
  }

  @Post(':id/appeal')
  @RequirePermission('catalog.write')
  @Audited({ entity: 'Product', action: 'product.appeal' })
  appeal(@Id() id: string, @Body() dto: ProductAppealDto) {
    return this.moderation.appeal(id, dto);
  }

  // --- images (CAT-02) ------------------------------------------------------------------------------------------------------
  @Post(':id/images')
  @RequirePermission('catalog.write')
  @UseInterceptors(imageInterceptor())
  async uploadImage(@Id() id: string, @UploadedFile() file: Incoming | undefined, @Req() req: any) {
    return unwrap(req, await this.images.upload(id, file));
  }

  @Patch(':id/images/order')
  @RequirePermission('catalog.write')
  reorderImages(@Id() id: string, @Body() dto: ReorderProductImagesDto) {
    return this.images.reorder(id, dto.ids);
  }

  @Patch(':id/images/:imgId')
  @RequirePermission('catalog.write')
  updateImage(@Id() id: string, @Param('imgId', ParseUUIDPipe) imgId: string, @Body() dto: UpdateProductImageDto) {
    return this.images.update(id, imgId, dto);
  }

  @Delete(':id/images/:imgId')
  @RequirePermission('catalog.write')
  @HttpCode(204)
  async removeImage(@Id() id: string, @Param('imgId', ParseUUIDPipe) imgId: string) {
    await this.images.remove(id, imgId);
  }

  // --- variants (CAT-03) ----------------------------------------------------------------------------------------------------
  @Get(':id/variants')
  @RequirePermission('catalog.read')
  listVariants(@Id() id: string) {
    return this.variants.list(id);
  }

  @Post(':id/variants')
  @RequirePermission('catalog.write')
  createVariant(@Id() id: string, @Body() dto: CreateVariantDto) {
    return this.variants.create(id, dto);
  }

  @Post(':id/variants/generate')
  @RequirePermission('catalog.write')
  generateVariants(@Id() id: string, @Body() dto: GenerateVariantsDto) {
    return this.variants.generate(id, dto);
  }

  @Patch(':id/variants/:vid')
  @RequirePermission('catalog.write')
  updateVariant(@Id() id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body() dto: UpdateVariantDto) {
    return this.variants.update(id, vid, dto);
  }

  @Delete(':id/variants/:vid')
  @RequirePermission('catalog.write')
  @HttpCode(204)
  async removeVariant(@Id() id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    await this.variants.remove(id, vid);
  }

  // --- expenses (GDS-09) ----------------------------------------------------------------------------------------------------
  @Get(':id/expenses')
  @RequirePermission('catalog.read')
  listExpenses(@Id() id: string) {
    return this.expenses.list(id);
  }

  @Post(':id/expenses')
  @RequirePermission('catalog.write')
  createExpense(@Id() id: string, @Body() dto: CreateProductExpenseDto) {
    return this.expenses.create(id, dto);
  }

  @Patch(':id/expenses/:eid')
  @RequirePermission('catalog.write')
  updateExpense(@Id() id: string, @Param('eid', ParseUUIDPipe) eid: string, @Body() dto: UpdateProductExpenseDto) {
    return this.expenses.update(id, eid, dto);
  }

  @Delete(':id/expenses/:eid')
  @RequirePermission('catalog.write')
  @HttpCode(204)
  async removeExpense(@Id() id: string, @Param('eid', ParseUUIDPipe) eid: string) {
    await this.expenses.remove(id, eid);
  }
}
