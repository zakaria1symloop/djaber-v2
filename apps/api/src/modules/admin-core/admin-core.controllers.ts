// Platform admin core routes (06 "Platform admin" + §8.11, api-contract §3.13). Every route is `@Platform()` +
// `@RequirePlatformRole` (keys of 01-nest-module-map §3.2); platform users need 2FA (TWO_FA_REQUIRED_FOR_ROLE).
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AdminAuditExportSchema,
  AdminAuditQuerySchema,
  AdminChangePlanSchema,
  AdminChannelsQuerySchema,
  AdminCmsQuerySchema,
  AdminCreateAiModelSchema,
  AdminCreateCmsSchema,
  AdminCreatePackSchema,
  AdminCreatePlanSchema,
  AdminCreatePresetSchema,
  AdminCreatePresetVersionSchema,
  AdminCreatePricingVersionSchema,
  AdminCreatePromoSchema,
  AdminCreateSubscriptionSchema,
  AdminCreateWorkspaceSchema,
  AdminDeletionRequestsQuerySchema,
  AdminDiscountSchema,
  AdminExtendSchema,
  AdminImpersonateSchema,
  AdminImpersonationQuerySchema,
  AdminInviteMemberSchema,
  AdminInvoicesExportQuerySchema,
  AdminInvoicesQuerySchema,
  AdminMigratePlanSchema,
  AdminPackPurchasesQuerySchema,
  AdminPatchAiProviderSchema,
  AdminPatchCmsSchema,
  AdminPatchPresetSchema,
  AdminPatchPresetVersionSchema,
  AdminPatchSubscriptionSchema,
  AdminPatchUserSchema,
  AdminPatchWorkspaceSchema,
  AdminPaymentsQuerySchema,
  AdminPeriodQuerySchema,
  AdminPlatformRoleSchema,
  AdminPromoQuerySchema,
  AdminPublishCmsSchema,
  AdminPutAiRouteSchema,
  AdminPutCmsLocaleSchema,
  AdminReasonSchema,
  AdminReleaseChannelSchema,
  AdminScheduleCmsSchema,
  AdminScheduleDeletionSchema,
  AdminSubListQuerySchema,
  AdminSubscriptionsQuerySchema,
  AdminSuspendSchema,
  AdminTestAiProviderSchema,
  AdminTranslateCmsSchema,
  AdminUpdateAiModelSchema,
  AdminUpdatePackSchema,
  AdminUpdatePlanSchema,
  AdminUpdatePromoSchema,
  AdminUsersQuerySchema,
  AdminViewerConversationsQuerySchema,
  AdminViewerOpenQuerySchema,
  AdminViewerProductsQuerySchema,
  AdminWorkspacesQuerySchema,
  AiPricingSimulateSchema,
} from '@djaber/shared';
import { Idempotent, Platform, RequirePlatformRole } from '../../core/auth/decorators';
import { notFound } from '../../core/errors/app.exception';
import { AdminJobsService } from './admin-jobs.service';
import { Admin, type AdminActor } from './admin.util';
import { AiAdminService } from './ai-admin.service';
import { AuditQueryService } from './audit-query.service';
import { AdminBillingCatalogService } from './billing-admin.service';
import { CmsAdminService } from './cms.service';
import { AdminOverviewService } from './overview.service';
import { PresetAdminService } from './presets.service';
import { AdminUsersService } from './users.service';
import { AdminViewersService } from './viewers.service';
import { AdminWorkspacesService } from './workspaces.service';

const USER_ACTIONS = ['resend-verification', 'reset-password', 'disable-2fa', 'revoke-sessions', 'block', 'unblock'] as const;
const OptionalReasonSchema = z.object({ reason: z.string().trim().max(500, 'validation.length').optional() }).strict();
class PeriodQ extends createZodDto(AdminPeriodQuerySchema) {}
class WorkspacesQ extends createZodDto(AdminWorkspacesQuerySchema) {}
class CreateWorkspaceDto extends createZodDto(AdminCreateWorkspaceSchema) {}
class PatchWorkspaceDto extends createZodDto(AdminPatchWorkspaceSchema) {}
class SuspendDto extends createZodDto(AdminSuspendSchema) {}
class ReasonDto extends createZodDto(AdminReasonSchema) {}
class OptionalReasonDto extends createZodDto(OptionalReasonSchema) {}
class ChangePlanDto extends createZodDto(AdminChangePlanSchema) {}
class ExtendDto extends createZodDto(AdminExtendSchema) {}
class ScheduleDeletionDto extends createZodDto(AdminScheduleDeletionSchema) {}
class ReleaseDto extends createZodDto(AdminReleaseChannelSchema) {}
class ChannelsQ extends createZodDto(AdminChannelsQuerySchema) {}
class SubListQ extends createZodDto(AdminSubListQuerySchema) {}
class UsersQ extends createZodDto(AdminUsersQuerySchema) {}
class PatchUserDto extends createZodDto(AdminPatchUserSchema) {}
class PlatformRoleDto extends createZodDto(AdminPlatformRoleSchema) {}
class CreatePlanDto extends createZodDto(AdminCreatePlanSchema) {}
class UpdatePlanDto extends createZodDto(AdminUpdatePlanSchema) {}
class MigratePlanDto extends createZodDto(AdminMigratePlanSchema) {}
class SubsQ extends createZodDto(AdminSubscriptionsQuerySchema) {}
class CreateSubDto extends createZodDto(AdminCreateSubscriptionSchema) {}
class PatchSubDto extends createZodDto(AdminPatchSubscriptionSchema) {}
class DiscountDto extends createZodDto(AdminDiscountSchema) {}
class InvoicesQ extends createZodDto(AdminInvoicesQuerySchema) {}
class InvoicesExportQ extends createZodDto(AdminInvoicesExportQuerySchema) {}
class PaymentsQ extends createZodDto(AdminPaymentsQuerySchema) {}
class CreatePackDto extends createZodDto(AdminCreatePackSchema) {}
class UpdatePackDto extends createZodDto(AdminUpdatePackSchema) {}
class PackPurchasesQ extends createZodDto(AdminPackPurchasesQuerySchema) {}
class PromoQ extends createZodDto(AdminPromoQuerySchema) {}
class CreatePromoDto extends createZodDto(AdminCreatePromoSchema) {}
class UpdatePromoDto extends createZodDto(AdminUpdatePromoSchema) {}
class PatchProviderDto extends createZodDto(AdminPatchAiProviderSchema) {}
class TestProviderDto extends createZodDto(AdminTestAiProviderSchema) {}
class CreateModelDto extends createZodDto(AdminCreateAiModelSchema) {}
class UpdateModelDto extends createZodDto(AdminUpdateAiModelSchema) {}
class PutRouteDto extends createZodDto(AdminPutAiRouteSchema) {}
class SimulateDto extends createZodDto(AiPricingSimulateSchema) {}
class PricingVersionDto extends createZodDto(AdminCreatePricingVersionSchema) {}
class CreatePresetDto extends createZodDto(AdminCreatePresetSchema) {}
class PatchPresetDto extends createZodDto(AdminPatchPresetSchema) {}
class CreatePresetVersionDto extends createZodDto(AdminCreatePresetVersionSchema) {}
class PatchPresetVersionDto extends createZodDto(AdminPatchPresetVersionSchema) {}
class CmsQ extends createZodDto(AdminCmsQuerySchema) {}
class CreateCmsDto extends createZodDto(AdminCreateCmsSchema) {}
class PatchCmsDto extends createZodDto(AdminPatchCmsSchema) {}
class PutCmsLocaleDto extends createZodDto(AdminPutCmsLocaleSchema) {}
class PublishCmsDto extends createZodDto(AdminPublishCmsSchema) {}
class ScheduleCmsDto extends createZodDto(AdminScheduleCmsSchema) {}
class TranslateCmsDto extends createZodDto(AdminTranslateCmsSchema) {}
class AuditQ extends createZodDto(AdminAuditQuerySchema) {}
class AuditExportDto extends createZodDto(AdminAuditExportSchema) {}
class InviteDto extends createZodDto(AdminInviteMemberSchema) {}
class DeletionQ extends createZodDto(AdminDeletionRequestsQuerySchema) {}
class ConvQ extends createZodDto(AdminViewerConversationsQuerySchema) {}
class OpenQ extends createZodDto(AdminViewerOpenQuerySchema) {}
class ProductOpenQ extends createZodDto(z.object({ reason: z.string().trim().max(500).optional() }).strict()) {}
class ProductsQ extends createZodDto(AdminViewerProductsQuerySchema) {}
class ImpersonateDto extends createZodDto(AdminImpersonateSchema) {}
class ImpersonationQ extends createZodDto(AdminImpersonationQuerySchema) {}

// --- ADM-01 overview -------------------------------------------------------------------------------------------------------
@Controller('admin')
@Platform()
export class AdminOverviewController {
  constructor(
    private readonly overview: AdminOverviewService,
    private readonly jobs: AdminJobsService,
  ) {}

  @Get('analytics')
  @RequirePlatformRole('admin.overview.read')
  analytics(@Query() q: PeriodQ) {
    return this.overview.overview(q.period);
  }

  @Get('alerts')
  @RequirePlatformRole('admin.overview.read')
  alerts() {
    return this.overview.alerts();
  }

  /** The caller's own platform jobs (audit / invoices exports, CMS translation, safety export). */
  @Get('jobs/:id')
  @RequirePlatformRole('admin.overview.read')
  job(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.jobs.get(id, a.userId);
  }
}

// --- ADM-02 workspaces + channels release ----------------------------------------------------------------------------------
@Controller('admin')
@Platform()
export class AdminWorkspacesController {
  constructor(
    private readonly ws: AdminWorkspacesService,
    private readonly billing: AdminBillingCatalogService,
    private readonly audit: AuditQueryService,
  ) {}

  @Get('workspaces')
  @RequirePlatformRole('admin.workspaces.read')
  list(@Query() q: WorkspacesQ, @Admin() a: AdminActor) {
    return this.ws.list(q, a);
  }

  @Post('workspaces')
  @Idempotent()
  @RequirePlatformRole('admin.workspaces.write')
  create(@Body() dto: CreateWorkspaceDto, @Admin() a: AdminActor) {
    return this.ws.create(dto, a);
  }

  @Get('workspaces/:id')
  @RequirePlatformRole('admin.workspaces.read')
  detail(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.ws.detail(id, a);
  }

  @Patch('workspaces/:id')
  @RequirePlatformRole('admin.workspaces.write')
  patch(@Param('id') id: string, @Body() dto: PatchWorkspaceDto, @Admin() a: AdminActor) {
    return this.ws.patch(id, dto, a);
  }

  @Get('workspaces/:id/members')
  @RequirePlatformRole('admin.workspaces.read')
  members(@Param('id') id: string) {
    return this.ws.members(id);
  }

  @Get('workspaces/:id/subscription')
  @RequirePlatformRole('admin.workspaces.read')
  subscription(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.billing.subscriptionOfWorkspace(id, a);
  }

  @Get('workspaces/:id/credits')
  @RequirePlatformRole('admin.workspaces.read')
  credits(@Param('id') id: string, @Query() q: SubListQ) {
    return this.ws.creditsOf(id, q);
  }

  @Get('workspaces/:id/channels')
  @RequirePlatformRole('admin.workspaces.read')
  channels(@Param('id') id: string) {
    return this.ws.channelsOf(id);
  }

  @Get('workspaces/:id/agents')
  @RequirePlatformRole('admin.workspaces.read')
  agents(@Param('id') id: string) {
    return this.ws.agentsOf(id);
  }

  @Get('workspaces/:id/audit')
  @RequirePlatformRole('admin.workspaces.read')
  auditOf(@Param('id') id: string, @Query() q: SubListQ) {
    return this.audit.workspaceAudit(id, q);
  }

  @Post('workspaces/:id/suspend')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  suspend(@Param('id') id: string, @Body() dto: SuspendDto, @Admin() a: AdminActor) {
    return this.ws.suspend(id, dto, a);
  }

  @Post('workspaces/:id/reactivate')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  reactivate(@Param('id') id: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    return this.ws.reactivate(id, dto.reason, a);
  }

  @Post('workspaces/:id/plan')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  plan(@Param('id') id: string, @Body() dto: ChangePlanDto, @Admin() a: AdminActor) {
    return this.ws.changePlan(id, dto, a);
  }

  @Post('workspaces/:id/extend')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  extend(@Param('id') id: string, @Body() dto: ExtendDto, @Admin() a: AdminActor) {
    return this.ws.extend(id, dto, a);
  }

  @Post('workspaces/:id/schedule-deletion')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  scheduleDeletion(@Param('id') id: string, @Body() dto: ScheduleDeletionDto, @Admin() a: AdminActor) {
    return this.ws.scheduleDeletion(id, dto, a);
  }

  @Delete('workspaces/:id/schedule-deletion')
  @RequirePlatformRole('admin.workspaces.write')
  cancelDeletion(@Param('id') id: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    return this.ws.cancelDeletion(id, dto.reason, a);
  }

  @Get('channels')
  @RequirePlatformRole('admin.workspaces.read')
  channelsSearch(@Query() q: ChannelsQ) {
    return this.ws.channelsSearch(q);
  }

  @Post('channels/:id/release')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.write')
  release(@Param('id') id: string, @Body() dto: ReleaseDto, @Admin() a: AdminActor) {
    return this.ws.releaseChannel(id, dto, a);
  }
}

// --- ADM-03 users + ADM-16 team & deletion requests ------------------------------------------------------------------------
@Controller('admin')
@Platform()
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  @RequirePlatformRole('admin.users.read')
  list(@Query() q: UsersQ, @Admin() a: AdminActor) {
    return this.users.list(q, a);
  }

  @Get('users/:id')
  @RequirePlatformRole('admin.users.read')
  detail(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.users.detail(id, a);
  }

  @Patch('users/:id')
  @RequirePlatformRole('admin.users.write')
  patch(@Param('id') id: string, @Body() dto: PatchUserDto, @Admin() a: AdminActor) {
    return this.users.patch(id, dto, a);
  }

  @Delete('users/:id')
  @RequirePlatformRole('admin.users.write')
  remove(@Param('id') id: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    return this.users.scheduleUserDeletion(id, dto.reason, a);
  }

  @Post('users/:id/platform-role')
  @HttpCode(200)
  @RequirePlatformRole('admin.team.write')
  platformRole(@Param('id') id: string, @Body() dto: PlatformRoleDto, @Admin() a: AdminActor) {
    return this.users.setPlatformRole(id, dto, a);
  }

  /** resend-verification | reset-password | disable-2fa | revoke-sessions | block | unblock (declared after the fixed sub-routes). */
  @Post('users/:id/:action')
  @HttpCode(200)
  @RequirePlatformRole('admin.users.write')
  action(@Param('id') id: string, @Param('action') action: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    if (!USER_ACTIONS.includes(action as never)) throw notFound();
    return this.users.action(id, action as (typeof USER_ACTIONS)[number], dto.reason, a, dto.ticketId);
  }

  @Get('platform-members')
  @RequirePlatformRole('admin.team.read')
  team(@Admin() a: AdminActor) {
    return this.users.team(a);
  }

  @Post('platform-members/invitations')
  @Idempotent()
  @RequirePlatformRole('admin.team.write')
  invite(@Body() dto: InviteDto, @Admin() a: AdminActor) {
    return this.users.invite(dto, a);
  }

  @Delete('platform-members/invitations/:id')
  @HttpCode(204)
  @RequirePlatformRole('admin.team.write')
  async revokeInvite(@Param('id') id: string, @Admin() a: AdminActor) {
    await this.users.revokeInvitation(id, a);
  }

  @Post('platform-members/:userId/force-2fa')
  @HttpCode(200)
  @RequirePlatformRole('admin.team.write')
  force2fa(@Param('userId') userId: string, @Admin() a: AdminActor) {
    return this.users.force2fa(userId, a);
  }

  @Get('deletion-requests')
  @RequirePlatformRole('admin.deletion.read')
  deletions(@Query() q: DeletionQ, @Admin() a: AdminActor) {
    return this.users.deletionRequests(q, a);
  }

  @Get('deletion-requests/:id')
  @RequirePlatformRole('admin.deletion.read')
  deletion(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.users.deletionRequest(id, a);
  }

  @Post('deletion-requests/:id/:action')
  @HttpCode(200)
  @RequirePlatformRole('admin.deletion.write')
  deletionAction(@Param('id') id: string, @Param('action') action: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    if (!['cancel', 'resolve', 'process-now'].includes(action)) throw notFound();
    return this.users.deletionAction(id, action as 'cancel' | 'resolve' | 'process-now', dto.reason, a);
  }
}

// --- ADM-04 plans · ADM-05 subscriptions & invoices · ADM-15 packs & promo codes ----------------------------------------------
@Controller('admin')
@Platform()
export class AdminBillingCatalogController {
  constructor(
    private readonly billing: AdminBillingCatalogService,
    private readonly audit: AuditQueryService,
  ) {}

  @Get('plans')
  @RequirePlatformRole('admin.billing.read')
  plans(@Admin() a: AdminActor) {
    return this.billing.listPlans(a);
  }

  @Post('plans')
  @Idempotent()
  @RequirePlatformRole('admin.billing.write')
  createPlan(@Body() dto: CreatePlanDto, @Admin() a: AdminActor) {
    return this.billing.createPlan(dto, a);
  }

  @Get('plans/:id')
  @RequirePlatformRole('admin.billing.read')
  plan(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.billing.getPlan(id, a);
  }

  @Patch('plans/:id')
  @RequirePlatformRole('admin.billing.write')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Admin() a: AdminActor) {
    return this.billing.updatePlan(id, dto, a);
  }

  @Get('plans/:id/versions')
  @RequirePlatformRole('admin.billing.read')
  planVersions(@Param('id') id: string) {
    return this.billing.planVersions(id);
  }

  @Post('plans/:id/archive')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  archive(@Param('id') id: string, @Body() dto: OptionalReasonDto, @Admin() a: AdminActor) {
    return this.billing.archivePlan(id, true, dto.reason, a);
  }

  @Post('plans/:id/restore')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  restore(@Param('id') id: string, @Body() dto: OptionalReasonDto, @Admin() a: AdminActor) {
    return this.billing.archivePlan(id, false, dto.reason, a);
  }

  @Post('plans/:id/migrate')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  migrate(@Param('id') id: string, @Body() dto: MigratePlanDto, @Admin() a: AdminActor) {
    return this.billing.migratePlan(id, dto, a);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePlatformRole('admin.billing.write')
  async deletePlan(@Param('id') id: string, @Admin() a: AdminActor) {
    await this.billing.deletePlan(id, a);
  }

  @Get('subscriptions')
  @RequirePlatformRole('admin.billing.read')
  subscriptions(@Query() q: SubsQ, @Admin() a: AdminActor) {
    return this.billing.subscriptions(q, a);
  }

  @Post('subscriptions')
  @Idempotent()
  @RequirePlatformRole('admin.billing.write')
  createSubscription(@Body() dto: CreateSubDto, @Admin() a: AdminActor) {
    return this.billing.createSubscription(dto, a);
  }

  @Patch('subscriptions/:id')
  @RequirePlatformRole('admin.billing.write')
  patchSubscription(@Param('id') id: string, @Body() dto: PatchSubDto, @Admin() a: AdminActor) {
    return this.billing.patchSubscription(id, dto, a);
  }

  @Post('subscriptions/:id/discount')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  discount(@Param('id') id: string, @Body() dto: DiscountDto, @Admin() a: AdminActor) {
    return this.billing.discount(id, dto, a);
  }
  @Post('subscriptions/:id/:action')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  subscriptionAction(@Param('id') id: string, @Param('action') action: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    if (!['cancel', 'cancel-now', 'resend-dunning'].includes(action)) throw notFound();
    return this.billing.subscriptionAction(id, action as 'cancel' | 'cancel-now' | 'resend-dunning', dto.reason, a);
  }

  @Get('invoices/export')
  @HttpCode(202)
  @RequirePlatformRole('admin.billing.read')
  invoicesExport(@Query() q: InvoicesExportQ, @Admin() a: AdminActor) {
    return this.audit.exportInvoices(q, a);
  }

  @Get('invoices')
  @RequirePlatformRole('admin.billing.read')
  invoices(@Query() q: InvoicesQ, @Admin() a: AdminActor) {
    return this.billing.invoicesList(q, a);
  }

  @Get('payments')
  @RequirePlatformRole('admin.billing.read')
  payments(@Query() q: PaymentsQ) {
    return this.billing.payments(q);
  }

  @Get('credit-packs')
  @RequirePlatformRole('admin.billing.read')
  packs() {
    return this.billing.packsList();
  }

  @Post('credit-packs')
  @Idempotent()
  @RequirePlatformRole('admin.billing.write')
  createPack(@Body() dto: CreatePackDto, @Admin() a: AdminActor) {
    return this.billing.createPack(dto, a);
  }

  @Get('credit-packs/purchases')
  @RequirePlatformRole('admin.billing.read')
  packPurchases(@Query() q: PackPurchasesQ) {
    return this.billing.packPurchases(q);
  }

  @Patch('credit-packs/:id')
  @RequirePlatformRole('admin.billing.write')
  updatePack(@Param('id') id: string, @Body() dto: UpdatePackDto, @Admin() a: AdminActor) {
    return this.billing.updatePack(id, dto, a);
  }

  @Delete('credit-packs/:id')
  @HttpCode(204)
  @RequirePlatformRole('admin.billing.write')
  async deletePack(@Param('id') id: string, @Admin() a: AdminActor) {
    await this.billing.deletePack(id, a);
  }

  @Get('credit-pricing/versions')
  @RequirePlatformRole('admin.billing.read')
  pricingVersions() {
    return this.billing.pricingVersions();
  }

  @Get('promo-codes')
  @RequirePlatformRole('admin.billing.read')
  promos(@Query() q: PromoQ) {
    return this.billing.promos(q);
  }

  @Post('promo-codes')
  @Idempotent()
  @RequirePlatformRole('admin.billing.write')
  createPromo(@Body() dto: CreatePromoDto, @Admin() a: AdminActor) {
    return this.billing.createPromo(dto, a);
  }

  @Patch('promo-codes/:id')
  @RequirePlatformRole('admin.billing.write')
  updatePromo(@Param('id') id: string, @Body() dto: UpdatePromoDto, @Admin() a: AdminActor) {
    return this.billing.updatePromo(id, dto, a);
  }

  @Post('promo-codes/:id/deactivate')
  @HttpCode(200)
  @RequirePlatformRole('admin.billing.write')
  deactivatePromo(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.billing.deactivatePromo(id, a);
  }

  @Get('promo-codes/:id/redemptions')
  @RequirePlatformRole('admin.billing.read')
  redemptions(@Param('id') id: string, @Query() q: SubListQ) {
    return this.billing.redemptions(id, q);
  }
}

// --- ADM-06 AI -------------------------------------------------------------------------------------------------------------
@Controller('admin')
@Platform()
export class AdminAiController {
  constructor(private readonly ai: AiAdminService) {}

  @Get('ai-providers')
  @RequirePlatformRole('admin.ai.read')
  providers() {
    return this.ai.providers();
  }

  @Patch('ai-providers/:key')
  @RequirePlatformRole('admin.ai.write')
  patchProvider(@Param('key') key: string, @Body() dto: PatchProviderDto, @Admin() a: AdminActor) {
    return this.ai.patchProvider(key, dto, a);
  }

  @Post('ai-providers/:key/test')
  @HttpCode(200)
  @RequirePlatformRole('admin.ai.write')
  test(@Param('key') key: string, @Body() dto: TestProviderDto, @Admin() a: AdminActor) {
    return this.ai.testProvider(key, dto.apiKey, a);
  }

  @Get('ai-models')
  @RequirePlatformRole('admin.ai.read')
  models() {
    return this.ai.models();
  }

  @Post('ai-models')
  @Idempotent()
  @RequirePlatformRole('admin.ai.write')
  createModel(@Body() dto: CreateModelDto, @Admin() a: AdminActor) {
    return this.ai.createModel(dto, a);
  }

  @Patch('ai-models/:id')
  @RequirePlatformRole('admin.ai.write')
  updateModel(@Param('id') id: string, @Body() dto: UpdateModelDto, @Admin() a: AdminActor) {
    return this.ai.updateModel(id, dto, a);
  }

  @Delete('ai-models/:id')
  @HttpCode(204)
  @RequirePlatformRole('admin.ai.write')
  async deleteModel(@Param('id') id: string, @Admin() a: AdminActor) {
    await this.ai.deleteModel(id, a);
  }

  @Get('ai-routes')
  @RequirePlatformRole('admin.ai.read')
  routes() {
    return this.ai.routes();
  }

  @Get('ai-routes/:capability')
  @RequirePlatformRole('admin.ai.read')
  route(@Param('capability') capability: string) {
    return this.ai.route(capability);
  }

  @Put('ai-routes/:capability')
  @RequirePlatformRole('admin.ai.write')
  putRoute(@Param('capability') capability: string, @Body() dto: PutRouteDto, @Admin() a: AdminActor) {
    return this.ai.putRoute(capability, dto, a);
  }

  @Get('ai-pricing')
  @RequirePlatformRole('admin.ai.read')
  pricing() {
    return this.ai.pricing();
  }

  @Post('ai-pricing/simulate')
  @HttpCode(200)
  @RequirePlatformRole('admin.ai.read')
  simulate(@Body() dto: SimulateDto) {
    return this.ai.simulate(dto);
  }

  @Post('ai-pricing/versions')
  @Idempotent()
  @RequirePlatformRole('admin.ai.write')
  pricingVersion(@Body() dto: PricingVersionDto, @Admin() a: AdminActor) {
    return this.ai.createPricingVersion(dto, a);
  }
}

// --- ADM-07 presets --------------------------------------------------------------------------------------------------------
@Controller('admin/agent-presets')
@Platform()
export class AdminPresetsController {
  constructor(private readonly presets: PresetAdminService) {}

  @Get()
  @RequirePlatformRole('admin.presets.read')
  list(@Admin() a: AdminActor) {
    return this.presets.list(a);
  }

  @Post()
  @Idempotent()
  @RequirePlatformRole('admin.presets.write')
  create(@Body() dto: CreatePresetDto, @Admin() a: AdminActor) {
    return this.presets.create(dto, a);
  }

  @Get(':id')
  @RequirePlatformRole('admin.presets.read')
  get(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.presets.get(id, a);
  }

  @Patch(':id')
  @RequirePlatformRole('admin.presets.write')
  patch(@Param('id') id: string, @Body() dto: PatchPresetDto, @Admin() a: AdminActor) {
    return this.presets.patch(id, dto, a);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePlatformRole('admin.presets.write')
  async remove(@Param('id') id: string, @Admin() a: AdminActor) {
    await this.presets.remove(id, a);
  }

  @Get(':id/versions')
  @RequirePlatformRole('admin.presets.read')
  versions(@Param('id') id: string) {
    return this.presets.versions(id);
  }

  @Post(':id/versions')
  @RequirePlatformRole('admin.presets.write')
  createVersion(@Param('id') id: string, @Body() dto: CreatePresetVersionDto, @Admin() a: AdminActor) {
    return this.presets.createVersion(id, dto.changelog, a);
  }

  @Patch(':id/versions/:v')
  @RequirePlatformRole('admin.presets.write')
  patchVersion(@Param('id') id: string, @Param('v', ParseIntPipe) v: number, @Body() dto: PatchPresetVersionDto, @Admin() a: AdminActor) {
    return this.presets.patchVersion(id, v, dto, a);
  }

  @Post(':id/versions/:v/test')
  @HttpCode(200)
  @RequirePlatformRole('admin.presets.write')
  test(@Param('id') id: string, @Param('v', ParseIntPipe) v: number, @Admin() a: AdminActor) {
    return this.presets.test(id, v, a);
  }

  @Post(':id/versions/:v/publish')
  @HttpCode(200)
  @RequirePlatformRole('admin.presets.write')
  publish(@Param('id') id: string, @Param('v', ParseIntPipe) v: number, @Admin() a: AdminActor) {
    return this.presets.publish(id, v, a);
  }

  @Post(':id/:action')
  @HttpCode(200)
  @RequirePlatformRole('admin.presets.write')
  archive(@Param('id') id: string, @Param('action') action: string, @Admin() a: AdminActor) {
    if (action !== 'archive' && action !== 'restore') throw notFound();
    return this.presets.archive(id, action === 'archive', a);
  }}

// --- ADM-08 CMS ------------------------------------------------------------------------------------------------------------
@Controller('admin/cms')
@Platform()
export class AdminCmsController {
  constructor(private readonly cms: CmsAdminService) {}

  @Get()
  @RequirePlatformRole('admin.cms.read')
  list(@Query() q: CmsQ, @Admin() a: AdminActor) {
    return this.cms.list(q, a);
  }

  @Post()
  @Idempotent()
  @RequirePlatformRole('admin.cms.write')
  create(@Body() dto: CreateCmsDto, @Admin() a: AdminActor) {
    return this.cms.create(dto, a);
  }

  @Get(':id')
  @RequirePlatformRole('admin.cms.read')
  get(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.cms.get(id, a);
  }

  @Patch(':id')
  @RequirePlatformRole('admin.cms.write')
  patch(@Param('id') id: string, @Body() dto: PatchCmsDto, @Admin() a: AdminActor) {
    return this.cms.patch(id, dto, a);
  }

  @Put(':id/locales/:locale')
  @RequirePlatformRole('admin.cms.write')
  putLocale(@Param('id') id: string, @Param('locale') locale: string, @Body() dto: PutCmsLocaleDto, @Admin() a: AdminActor) {
    return this.cms.putLocale(id, locale, dto, a);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePlatformRole('admin.cms.write')
  publish(@Param('id') id: string, @Body() dto: PublishCmsDto, @Admin() a: AdminActor) {
    return this.cms.publish(id, dto.fallbackToFr, a);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @RequirePlatformRole('admin.cms.write')
  schedule(@Param('id') id: string, @Body() dto: ScheduleCmsDto, @Admin() a: AdminActor) {
    return this.cms.schedule(id, dto, a);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePlatformRole('admin.cms.write')
  unpublish(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.cms.unpublish(id, a);
  }

  @Post(':id/translate')
  @HttpCode(202)
  @RequirePlatformRole('admin.cms.write')
  translate(@Param('id') id: string, @Body() dto: TranslateCmsDto, @Admin() a: AdminActor) {
    return this.cms.translate(id, dto.to, a);
  }

  @Get(':id/versions')
  @RequirePlatformRole('admin.cms.read')
  versions(@Param('id') id: string) {
    return this.cms.versions(id);
  }

  @Get(':id/preview-link')
  @RequirePlatformRole('admin.cms.read')
  preview(@Param('id') id: string) {
    return this.cms.previewLink(id);
  }
}

// --- ADM-09 audit ----------------------------------------------------------------------------------------------------------
@Controller('admin/audit-logs')
@Platform()
export class AdminAuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePlatformRole('admin.audit.read')
  list(@Query() q: AuditQ) {
    return this.audit.list(q);
  }

  @Post('export')
  @Idempotent()
  @HttpCode(202)
  @RequirePlatformRole('admin.audit.export')
  export(@Body() dto: AuditExportDto, @Admin() a: AdminActor) {
    return this.audit.export(dto, a);
  }

  @Get(':id')
  @RequirePlatformRole('admin.audit.read')
  get(@Param('id') id: string) {
    return this.audit.get(id);
  }
}

// --- ADM-17 viewers + impersonation ----------------------------------------------------------------------------------------
@Controller('admin')
@Platform()
export class AdminViewersController {
  constructor(private readonly viewers: AdminViewersService) {}

  @Get('conversations')
  @RequirePlatformRole('admin.workspaces.read')
  conversations(@Query() q: ConvQ) {
    return this.viewers.conversations(q);
  }

  @Get('conversations/:id')
  @RequirePlatformRole('admin.workspaces.read')
  conversation(@Param('id') id: string, @Query() q: OpenQ, @Admin() a: AdminActor) {
    return this.viewers.openConversation(id, q.reason, a);
  }

  @Post('conversations/:id/unmask')
  @HttpCode(200)
  @RequirePlatformRole('admin.workspaces.unmask')
  unmask(@Param('id') id: string, @Body() dto: ReasonDto, @Admin() a: AdminActor) {
    return this.viewers.unmaskConversation(id, dto.reason, a);
  }

  @Get('products')
  @RequirePlatformRole('admin.workspaces.read')
  products(@Query() q: ProductsQ) {
    return this.viewers.products(q);
  }

  @Get('products/:id')
  @RequirePlatformRole('admin.workspaces.read')
  product(@Param('id') id: string, @Query() q: ProductOpenQ, @Admin() a: AdminActor) {
    return this.viewers.openProduct(id, q.reason, a);
  }

  @Get('impersonation/sessions')
  @RequirePlatformRole('admin.workspaces.impersonate')
  sessions(@Query() q: ImpersonationQ) {
    return this.viewers.sessions(q);
  }

  @Post('impersonation/sessions')
  @Idempotent()
  @RequirePlatformRole('admin.workspaces.impersonate')
  start(@Body() dto: ImpersonateDto, @Admin() a: AdminActor) {
    return this.viewers.start(dto, a);
  }

  @Delete('impersonation/sessions/:id')
  @RequirePlatformRole('admin.workspaces.impersonate')
  stop(@Param('id') id: string, @Admin() a: AdminActor) {
    return this.viewers.stop(id, a);
  }
}
