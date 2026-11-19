// Global infrastructure module: everything in `core/` is available to every feature module without imports.
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { ComplianceRetentionService } from './audit/retention.service';
import { TokenService } from './auth/token.service';
import { SessionDenylistService } from './auth/session-denylist.service';
import { ApiKeyAuthService } from './auth/api-key-auth.service';
import { CaptchaService } from './captcha/captcha.service';
import { ConfigService } from './config/config.service';
import { CounterService } from './counter/counter.service';
import { CryptoService } from './crypto/crypto.service';
import { FlagsService } from './flags/flags.service';
import { I18nService } from './i18n/i18n.service';
import { MailOutbox } from './mail/mail.outbox';
import { MailService } from './mail/mail.service';
import { MetricsService } from './metrics/metrics.service';
import { OutboxService } from './outbox/outbox.service';
import { ProcessorRegistry } from './queue/processor.registry';
import { QueueOutbox } from './queue/queue.outbox';
import { QueueService } from './queue/queue.service';
import { RedisService } from './redis/redis.provider';
import { StorageService } from './storage/storage.service';
import { TenantResolver } from './tenancy/tenant.resolver';
import { RateLimitGuard } from './throttle/rate-limit.guard';
import { WsEmitter } from './ws/ws.emitter';

const providers = [
  ProcessorRegistry,
  ConfigService,
  RedisService,
  I18nService,
  CryptoService,
  TokenService,
  SessionDenylistService,
  ApiKeyAuthService,
  CaptchaService,
  TenantResolver,
  OutboxService,
  AuditService,
  ComplianceRetentionService,
  QueueService,
  QueueOutbox,
  StorageService,
  MailService,
  MailOutbox,
  FlagsService,
  WsEmitter,
  RateLimitGuard,
  CounterService,
  MetricsService,
];

@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
