// 06-api "Notifications" — NTF-01: own notifications (every role, `notifications.own`).
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { NotificationsQuerySchema, type NotificationsQuery } from '@djaber/shared';
import { RequirePermission } from '../../core/auth/decorators';
import { NotificationService } from './notification.service';

class NotificationsQueryDto extends createZodDto(NotificationsQuerySchema) {}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @RequirePermission('notifications.own')
  list(@Query() q: NotificationsQueryDto, @Req() req: any) {
    return this.notifications.list(q as NotificationsQuery, req.locale ?? 'fr');
  }

  @Get('unread-count')
  @RequirePermission('notifications.own')
  async unreadCount() {
    const [count, byGroup] = await Promise.all([this.notifications.unreadCount(), this.notifications.unreadByGroup()]);
    return { count, byGroup };
  }

  @Post('read-all')
  @HttpCode(200)
  @RequirePermission('notifications.own')
  readAll() {
    return this.notifications.readAll();
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('notifications.own')
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.read(id);
  }
}
