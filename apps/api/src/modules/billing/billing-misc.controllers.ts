// Inbound payment webhooks (06 §3), order payment links / refunds (06 "Orders" P2), platform-admin billing writes (06 §2
// "Platform admin"), and the development-only payment simulator (fake drivers, never in production).
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  AdminGrantCreditsSchema,
  AdminRemoveCreditsSchema,
  AdminMarkPaidSchema,
  CreatePaymentLinkSchema,
  DevBillingClockSchema,
  DevPackSchema,
  DevPaymentOutcomeSchema,
  DevStoreRefundSchema,
  DevSubscriptionSchema,
  OrderRefundSchema,
} from '@djaber/shared';
import { CurrentUser, Platform, Public, RequirePermission, RequirePlatformRole, type AuthUser } from '../../core/auth/decorators';
import { ConfigService } from '../../core/config/config.service';
import { addWarning, RawResponse } from '../../core/http/envelope.interceptor';
import { AdminBillingService } from './admin-billing.service';
import { DevBillingService } from './dev-billing.service';
import { IapService } from './iap.service';
import { OrderPaymentService } from './order-payment.service';
import { PaymentService } from './payment.service';

class AdminMarkPaidDto extends createZodDto(AdminMarkPaidSchema) {}
class AdminGrantCreditsDto extends createZodDto(AdminGrantCreditsSchema) {}
class AdminRemoveCreditsDto extends createZodDto(AdminRemoveCreditsSchema) {}
class CreatePaymentLinkDto extends createZodDto(CreatePaymentLinkSchema) {}
class OrderRefundDto extends createZodDto(OrderRefundSchema) {}
class DevPaymentOutcomeDto extends createZodDto(DevPaymentOutcomeSchema) {}
class DevBillingClockDto extends createZodDto(DevBillingClockSchema) {}
class DevStoreRefundDto extends createZodDto(DevStoreRefundSchema) {}
class DevSubscriptionDto extends createZodDto(DevSubscriptionSchema) {}
class DevPackDto extends createZodDto(DevPackSchema) {}

const loc = (req: any): 'fr' | 'ar' | 'en' => (req.locale === 'ar' || req.locale === 'en' ? req.locale : 'fr');

/** `POST /webhooks/chargily` · `POST /webhooks/store/google-play` · `POST /webhooks/store/app-store` (raw body, verified, 200 at once). */
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentService,
    private readonly iap: IapService,
  ) {}

  @Public()
  @Post('chargily')
  @HttpCode(200)
  async chargily(@Req() req: any) {
    return new RawResponse(await this.payments.ingestWebhook(req.headers, req.rawBody));
  }

  @Public()
  @Post('store/google-play')
  @HttpCode(200)
  async googlePlay(@Req() req: any) {
    return new RawResponse(await this.iap.ingestNotification('google_play', { headers: req.headers, query: req.query ?? {}, rawBody: req.rawBody }));
  }

  @Public()
  @Post('store/app-store')
  @HttpCode(200)
  async appStore(@Req() req: any) {
    return new RawResponse(await this.iap.ingestNotification('app_store', { headers: req.headers, query: req.query ?? {}, rawBody: req.rawBody }));
  }
}

/** `POST /orders/:id/payment-link`, `GET /orders/:id/payment-link`, `POST /orders/:id/refunds` (orders.money / orders.read). */
@Controller('orders')
export class OrderPaymentsController {
  constructor(private readonly links: OrderPaymentService) {}

  @Post(':id/payment-link')
  @HttpCode(201)
  @RequirePermission('orders.money')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePaymentLinkDto) {
    return this.links.create(id, dto.send ?? true);
  }

  @Get(':id/payment-link')
  @RequirePermission('orders.read')
  latest(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.latest(id);
  }

  @Post(':id/refunds')
  @HttpCode(200)
  @RequirePermission('orders.money')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderRefundDto, @Req() req: any) {
    return this.links.refund(id, dto, loc(req));
  }
}

/** Platform admin (M9 endpoints; the screens are M10). */
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly admin: AdminBillingService) {}

  @Platform()
  @RequirePlatformRole('admin.billing.write')
  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  async markPaid(@Param('id') id: string, @Body() dto: AdminMarkPaidDto, @CurrentUser() user: AuthUser, @Req() req: any) {
    const r = await this.admin.markPaid(id, dto, { userId: user.id, platformRole: user.platformRole, ip: req.ip ?? null, userAgent: req.headers?.['user-agent'] ?? null });
    if (r.partial !== null) addWarning(req, 'INVOICE_PARTIAL_PAYMENT', { remaining: r.partial });
    return r.result;
  }

  @Platform()
  @RequirePlatformRole('admin.workspaces.credits')
  @Post('workspaces/:id/credits')
  @HttpCode(200)
  grant(@Param('id') id: string, @Body() dto: AdminGrantCreditsDto, @CurrentUser() user: AuthUser, @Req() req: any) {
    return this.admin.grantCredits(id, dto, { userId: user.id, platformRole: user.platformRole, ip: req.ip ?? null, userAgent: req.headers?.['user-agent'] ?? null });
  }

  @Platform()
  @RequirePlatformRole('admin.billing.write')
  @Post('workspaces/:id/credits/remove')
  @HttpCode(200)
  remove(@Param('id') id: string, @Body() dto: AdminRemoveCreditsDto, @CurrentUser() user: AuthUser, @Req() req: any) {
    return this.admin.removeCredits(id, dto, { userId: user.id, platformRole: user.platformRole, ip: req.ip ?? null, userAgent: req.headers?.['user-agent'] ?? null });
  }
}

/**
 * The fake Chargily checkout page (PAYMENT_DRIVER=fake, never in production): `GET /dev-payments/:id` shows the amount
 * and the choices, `POST /dev-payments/:id { outcome }` records the tester's choice (logged + audited), delivers the signed
 * webhook to `/webhooks/chargily` and answers where the browser goes next (form posts are redirected there).
 */
@Controller('dev-payments')
export class DevPaymentsController {
  constructor(
    private readonly dev: DevBillingService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async page(@Param('id') id: string, @Req() req: any, @Res({ passthrough: true }) res: any) {
    // helmet's default `form-action 'self'` blocks the 303 back to the web return page after a choice: allow the web origins
    res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self' ${this.config.webOrigins.join(' ')}; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`);
    return new RawResponse(await this.dev.page(id, loc(req)));
  }

  @Public()
  @Post(':id')
  @HttpCode(200)
  async decide(@Param('id') id: string, @Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const form = typeof req.headers?.['content-type'] === 'string' && req.headers['content-type'].includes('application/x-www-form-urlencoded');
    const dto = DevPaymentOutcomeSchema.parse({ outcome: body?.outcome });
    const r = await this.dev.decide(id, dto.outcome as DevPaymentOutcomeDto['outcome'], typeof body?.reason === 'string' ? body.reason : undefined, req.ip ?? null);
    if (form) {
      res.status(303).setHeader('Location', r.redirectUrl);
      return new RawResponse('');
    }
    return r;
  }
}

/** Development shortcuts to reach billing states on demand (fake drivers, never in production; Owner / Admin). */
@Controller('dev/billing')
export class DevBillingController {
  constructor(private readonly dev: DevBillingService) {}

  @Post('subscription')
  @HttpCode(200)
  @RequirePermission('billing.write')
  subscription(@Body() dto: DevSubscriptionDto, @Req() req: any) {
    return this.dev.subscription(dto, loc(req));
  }

  @Post('clock')
  @HttpCode(200)
  @RequirePermission('billing.write')
  clock(@Body() dto: DevBillingClockDto, @Req() req: any) {
    return this.dev.clock(dto.days, dto.run !== false, loc(req));
  }

  @Post('pack')
  @HttpCode(200)
  @RequirePermission('billing.write')
  pack(@Body() dto: DevPackDto) {
    return this.dev.pack(dto);
  }

  @Post('store-refund')
  @HttpCode(200)
  @RequirePermission('billing.write')
  storeRefund(@Body() dto: DevStoreRefundDto) {
    return this.dev.storeRefund(dto.transactionId);
  }

  @Get('help')
  @RequirePermission('billing.read')
  help(@Query() _q: unknown) {
    return this.dev.help();
  }
}
