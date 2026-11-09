// Super admin notifications (owner request 09/11): the bell of the admin shell. Every platform role reads its own rows
// (`Notification(type = platform_admin, workspaceId = null, userId = me)`), newest first, in the request's language.
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AdminNotificationsQuerySchema, isAppLocale, type AdminNotificationsQuery, type AdminNotificationView } from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { Platform, RequirePlatformRole } from '../../core/auth/decorators';
import { notFound } from '../../core/errors/app.exception';
import { WsEmitter } from '../../core/ws/ws.emitter';
import { ADMIN_SCOPE, adminNotificationView } from './admin-notifier.service';

class QueryDto extends createZodDto(AdminNotificationsQuerySchema) {}

// read in the request's context, before `runSystem` (the system context carries no user)
const me = () => TenantContext.get().userId!;
const mineOf = (userId: string) => ({ ...ADMIN_SCOPE, userId });

@Controller('admin/notifications')
@Platform()
export class AdminNotificationsController {
  constructor(private readonly ws: WsEmitter) {}

  @Get()
  @RequirePlatformRole('admin.overview.read')
  async list(@Query() q: QueryDto, @Req() req: any): Promise<{ data: AdminNotificationView[]; nextCursor: string | null }> {
    const query = q as AdminNotificationsQuery;
    const locale = isAppLocale(req.locale) ? req.locale : 'fr';
    const mine = mineOf(me());
    return TenantContext.runSystem(async () => {
      const after = query.cursor ? await prisma.notification.findFirst({ where: { ...mine, id: query.cursor }, select: { createdAt: true, id: true } }) : null;
      const rows = await prisma.notification.findMany({
        where: { ...mine, ...(query.unread ? { readAt: null } : {}), ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      // the envelope turns { data, nextCursor } into { data, meta: { nextCursor, hasMore } }
      return { data: page.map((r) => adminNotificationView(r, locale)), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
    });
  }

  @Get('unread-count')
  @RequirePlatformRole('admin.overview.read')
  async unreadCount() {
    const mine = mineOf(me());
    return { count: await TenantContext.runSystem(() => prisma.notification.count({ where: { ...mine, readAt: null } })) };
  }

  @Post('read-all')
  @HttpCode(200)
  @RequirePlatformRole('admin.overview.read')
  async readAll() {
    const mine = mineOf(me());
    const r = await TenantContext.runSystem(() => prisma.notification.updateMany({ where: { ...mine, readAt: null }, data: { readAt: new Date() } }));
    this.ws.emit(`user:${mine.userId}`, 'admin.notification.read', { all: true, unreadCount: 0 });
    return { updated: r.count, unreadCount: 0 };
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePlatformRole('admin.overview.read')
  async read(@Param('id', ParseUUIDPipe) id: string) {
    const mine = mineOf(me());
    return TenantContext.runSystem(async () => {
      const row = await prisma.notification.findFirst({ where: { ...mine, id } });
      if (!row) throw notFound();
      if (!row.readAt) await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
      const unreadCount = await prisma.notification.count({ where: { ...mine, readAt: null } });
      // the admin's other tabs drop the dot too
      this.ws.emit(`user:${mine.userId}`, 'admin.notification.read', { id, unreadCount });
      return { id, unreadCount };
    });
  }
}
