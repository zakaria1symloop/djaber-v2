import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditInterceptor } from './core/audit/audit.interceptor';
import { AuthGuard } from './core/auth/auth.guard';
import { CoreModule } from './core/core.module';
import { AppExceptionFilter } from './core/errors/app-exception.filter';
import { HealthController } from './core/health/health.controller';
import { EnvelopeInterceptor } from './core/http/envelope.interceptor';
import { RequestContextMiddleware } from './core/http/request-context.middleware';
import { IdempotencyInterceptor } from './core/idempotency/idempotency.interceptor';
import { PermissionGuard } from './core/rbac/permission.guard';
import { FilesController } from './core/storage/files.controller';
import { TenantGuard } from './core/tenancy/tenant.guard';
import { RateLimitGuard } from './core/throttle/rate-limit.guard';
import { WsGateway } from './core/ws/ws.gateway';
import { AccountModule } from './modules/account/account.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AiCoreModule } from './modules/ai/ai-core.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { ShippingModule } from './modules/delivery/shipping.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { CreditsModule } from './modules/credits/credits.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { MetaModule } from './modules/meta/meta.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { LegalGuard } from './modules/workspace/legal.guard';
import { AppVersionGuard, FeatureGuard, MaintenanceGuard } from './core/platform/platform.guards';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { PlatformPublicModule } from './modules/platform-public/platform-public.module';
import { GdsModule } from './modules/gds/gds.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportsModule } from './modules/gds/reports/reports.module';
import { AdminModerationModule } from './modules/admin-ops/moderation/moderation.module';
import { AdminHealthModule } from './modules/admin-ops/health/health.module';
import { AdminSafetyModule } from './modules/admin-ops/safety/admin-safety.module';
import { SupportModule } from './modules/admin-ops/support/support.module';
import { PlatformSettingsModule } from './modules/admin-ops/settings/settings.module';
import { AdminCoreModule } from './modules/admin-core/admin-core.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { PublicSiteModule } from './modules/public-site/public-site.module';
import { SavedViewsModule } from './modules/saved-views/saved-views.module';

/** Feature modules are appended here milestone after milestone (00-build-order). */
export const FEATURE_MODULES = [PlatformPublicModule, AccountModule, UploadsModule, WorkspaceModule, AuthModule, NotificationsModule, JobsModule, CreditsModule, AiCoreModule, CatalogModule, MetaModule, ChannelsModule, MessagingModule, DeliveryModule, ClientsModule, OrdersModule, ShippingModule, BillingModule, AiModule, AgentsModule, DashboardModule, RecommendationsModule, GdsModule, AnalyticsModule, ReportsModule, AdminModerationModule, SupportModule, AdminSafetyModule, PlatformSettingsModule, AdminHealthModule, AdminCoreModule, IntegrationsModule, PublicSiteModule, SavedViewsModule];

@Module({
  imports: [CoreModule, ...FEATURE_MODULES],
  controllers: [HealthController, FilesController],
  providers: [
    WsGateway,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Guard order = pipeline of 01-nest-module-map §3: auth → rate limit → tenant → permission
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 04 §15: 403 LEGAL_REACCEPT_REQUIRED until a major legal version is accepted (auth / legal routes exempt)
    { provide: APP_GUARD, useClass: LegalGuard },
    // 04 §15 (M10): mobile version gate (426), maintenance window (503 on mutations), feature flags (403 FEATURE_DISABLED)
    { provide: APP_GUARD, useClass: AppVersionGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    // Interceptor order: envelope (outermost) → idempotency → audit
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
