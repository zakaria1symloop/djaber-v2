// FL-13 / D30 — members list, role change, removal. The Owner can never be removed or demoted (OWNER_IMMUTABLE).
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type MemberRole, type Membership, type User } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { SessionService, type ClientInfo } from '../auth/session.service';
import { NotificationProducer } from '../notifications/notification.producer';
import type { MembersQuery } from './dto';

export const toMemberDto = (m: Membership & { user: User }) => ({
  id: m.id,
  user: { id: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, avatarUrl: m.user.avatarUrl, email: m.user.email },
  role: m.role,
  readOnly: m.readOnly,
  hiddenSections: m.role === 'owner' ? [] : m.hiddenSections,
  joinedAt: m.createdAt.toISOString(),
  lastSeenAt: m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
});

@Injectable()
export class MembershipService {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenants: TenantResolver,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationProducer,
  ) {}

  /** `GET /workspace/members` — MembersQuery { role[], state[], q }; pending invitations are `GET /workspace/invitations`. */
  async list(q: MembersQuery) {
    const states = q.state?.filter((s) => s !== 'invited');
    if (q.state?.length && !states?.length) return [];
    const readOnly = states?.length === 1 ? states[0] === 'read_only' : undefined;
    const rows = await prisma.membership.findMany({
      where: {
        ...(q.role?.length ? { role: { in: q.role as MemberRole[] } } : {}),
        ...(readOnly === undefined ? {} : { readOnly }),
        ...(q.q && q.q.length >= 2
          ? {
              user: {
                OR: [
                  { firstName: { contains: q.q, mode: 'insensitive' } },
                  { lastName: { contains: q.q, mode: 'insensitive' } },
                  { email: { contains: q.q, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: { user: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const rank = { owner: 0, admin: 1, operator: 2 } as const;
    return rows.sort((a, b) => rank[a.role] - rank[b.role]).map(toMemberDto);
  }

  private async byId(id: string) {
    const m = await prisma.membership.findFirst({ where: { id }, include: { user: true } });
    if (!m) throw notFound();
    return m;
  }

  /** `PATCH /workspace/members/:id { role?, hiddenSections? }` */
  async update(id: string, input: { role?: 'owner' | 'admin' | 'operator'; hiddenSections?: string[] }, client: ClientInfo) {
    let member = await this.byId(id);
    if (input.hiddenSections !== undefined) member = await this.setSections(member, input.hiddenSections, client);
    return input.role !== undefined ? this.changeRole(member, input.role, client) : toMemberDto(member);
  }

  /**
   * Sections the Owner hides from a member (owner decision 2026-10-21): the member's menu and the API refuse them at once
   * (tenant cache dropped). The Owner sees everything (OWNER_IMMUTABLE).
   */
  private async setSections(member: Membership & { user: User }, sections: string[], client: ClientInfo) {
    const t = TenantContext.get();
    if (member.role === 'owner') throw new AppException('OWNER_IMMUTABLE');
    const next = [...new Set(sections)].sort();
    if (next.join(',') === [...member.hiddenSections].sort().join(',')) return member;
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.membership.update({ where: { id: member.id }, data: { hiddenSections: next }, include: { user: true } });
      await this.outbox.ws(tx, `ws:${t.workspaceId}`, 'member.updated', { id: r.id, membership: { userId: r.userId, role: r.role, readOnly: r.readOnly, hiddenSections: r.hiddenSections } });
      return r;
    });
    await this.tenants.invalidate(t.workspaceId);
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'member.sections_change', entity: 'Membership', entityId: member.id, before: { hiddenSections: member.hiddenSections }, after: { hiddenSections: next, userId: member.userId }, ip: client.ip, userAgent: client.userAgent });
    return row;
  }

  private async changeRole(member: Membership & { user: User }, role: 'owner' | 'admin' | 'operator', client: ClientInfo) {
    const t = TenantContext.get();
    const id = member.id;
    // the only way to change the Owner is the ownership transfer (D51)
    if (member.role === 'owner' || role === 'owner') throw new AppException('OWNER_IMMUTABLE');
    if (member.role === role) return toMemberDto(member);
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.membership.update({ where: { id }, data: { role }, include: { user: true } });
      // 03-events §5.1 `member.role_changed`: in-app, to the member whose role changed
      await this.notifications.emit(tx, {
        type: 'member_role_changed',
        workspaceId: t.workspaceId,
        userIds: [row.userId],
        key: `member_role_changed:${row.id}:${row.updatedAt.getTime()}`,
        data: { userId: row.userId, from: member.role, to: role, role },
      });
      await this.outbox.ws(tx, `ws:${t.workspaceId}`, 'member.updated', {
        id: row.id,
        membership: { userId: row.userId, role: row.role, readOnly: row.readOnly },
      });
      return row;
    });
    await this.tenants.invalidate(t.workspaceId);
    await this.audit.write({
      workspaceId: t.workspaceId,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'member.role_change',
      entity: 'Membership',
      entityId: id,
      before: { role: member.role },
      after: { role, userId: member.userId },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return toMemberDto(updated);
  }

  /** `DELETE /workspace/members/:id` — sessions revoked, assignments cleared, authored content kept (04 §9). */
  async remove(id: string, client: ClientInfo) {
    const t = TenantContext.get();
    const member = await this.byId(id);
    if (member.role === 'owner') throw new AppException('OWNER_IMMUTABLE');
    await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({ where: { assigneeId: member.userId }, data: { assigneeId: null } });
      await tx.order.updateMany({ where: { assigneeId: member.userId }, data: { assigneeId: null } });
      await tx.membership.delete({ where: { id } });
      await tx.user.updateMany({ where: { id: member.userId, lastWorkspaceId: t.workspaceId }, data: { lastWorkspaceId: null } });
      await this.outbox.ws(tx, `ws:${t.workspaceId}`, 'member.updated', {
        id,
        membership: { userId: member.userId, role: member.role, readOnly: member.readOnly, removed: true },
      });
    });
    await this.sessions.revokeAll(member.userId);
    await this.tenants.invalidate(t.workspaceId);
    await this.audit.write({
      workspaceId: t.workspaceId,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'member.remove',
      entity: 'Membership',
      entityId: id,
      before: { userId: member.userId, role: member.role },
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }
}
