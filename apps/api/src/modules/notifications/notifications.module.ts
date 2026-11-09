import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '../../core/config/config.service';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotifier } from './admin-notifier.service';
import { NotificationFanoutService } from './notification-fanout.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationProducer } from './notification.producer';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { createPushGateway, PUSH_GATEWAY } from './push/push.gateway';

/**
 * Producer (in-app rows + WS) with its e-mail and push channels (M5: preferences per member and type, 03 §15 matrix),
 * the notification centre and the preferences endpoints. Push goes through the FCM port (`fake` adapter by default).
 */
@Global()
@Module({
  controllers: [NotificationsController, NotificationPreferencesController, AdminNotificationsController],
  providers: [
    NotificationProducer,
    NotificationService,
    AdminNotifier,
    NotificationFanoutService,
    {
      provide: PUSH_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const gateway = createPushGateway(config.all);
        new Logger('NotificationsModule').log(`push adapter: ${gateway.driver}`);
        return gateway;
      },
    },
  ],
  exports: [NotificationProducer, NotificationService, AdminNotifier, NotificationFanoutService, PUSH_GATEWAY],
})
export class NotificationsModule {}
