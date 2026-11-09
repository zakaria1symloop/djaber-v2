// AUTH-01 / D30 / D60 — creates a workspace with its owner membership, the 14-day Pro trial, the 300-credit grant
// and the workspace defaults (system messages, 4 quick replies in the workspace locale, the 69-row fee grid, onboarding step 1).
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DEFAULT_QUICK_REPLIES, DEFAULT_SYSTEM_MESSAGES, type Tx, type Workspace } from '@djaber/db';
import type { AppLocale } from '@djaber/shared';
import { defaultFeeRows } from '../delivery/fee.service';
import { AdminNotifier } from '../notifications/admin-notifier.service';

const DAY = 86_400_000;

export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const defaultWorkspaceName = (firstName: string, locale: AppLocale) =>
  locale === 'ar' ? `متجر ${firstName}` : locale === 'en' ? `${firstName}'s shop` : `Boutique de ${firstName}`;

export type NewWorkspace = {
  ownerId: string;
  name: string;
  locale: AppLocale;
  stockMode?: 'simple' | 'advanced';
  senderWilayaId?: number | null;
};

@Injectable()
export class ProvisioningService {
  constructor(private readonly admins: AdminNotifier) {}

  /** Must run inside the caller's transaction and inside a system / bypass tenant context. */
  async createWorkspace(tx: Tx, input: NewWorkspace): Promise<Workspace> {
    const settings = await tx.platformSetting.findUnique({ where: { key: 'limits' } });
    const limits = (settings?.value ?? {}) as { trialDays?: number; trialCredits?: number };
    const trialDays = Number.isInteger(limits.trialDays) ? limits.trialDays! : 14;
    const trialCredits = Number.isInteger(limits.trialCredits) ? limits.trialCredits! : 300;

    const ws = await tx.workspace.create({
      data: {
        name: input.name,
        slug: `${slugify(input.name) || 'boutique'}-${randomBytes(4).toString('hex')}`,
        locale: input.locale,
        stockMode: input.stockMode ?? 'simple',
        senderWilayaId: input.senderWilayaId ?? null,
        onboardingStep: 1,
        systemMessages: DEFAULT_SYSTEM_MESSAGES,
      },
    });
    await tx.membership.create({ data: { workspaceId: ws.id, userId: input.ownerId, role: 'owner' } });
    await tx.user.update({ where: { id: input.ownerId }, data: { ownedWorkspaceId: ws.id, lastWorkspaceId: ws.id } });

    // D60: Subscription(status=trial, plan=pro, billingCycle=none, provider=none, currentPeriodEnd=trialEndsAt=+14 d)
    const plan = await tx.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    const now = new Date();
    const end = new Date(now.getTime() + trialDays * DAY);
    await tx.subscription.create({
      data: {
        workspaceId: ws.id,
        planId: plan.id,
        planVersion: plan.version,
        status: 'trial',
        billingCycle: 'none',
        provider: 'none',
        currentPeriodStart: now,
        currentPeriodEnd: end,
        trialEndsAt: end,
      },
    });
    await tx.creditLedger.create({
      data: {
        workspaceId: ws.id,
        periodStart: now,
        bucket: 'plan',
        action: 'grant',
        kind: 'credit',
        credits: trialCredits,
        balanceAfter: trialCredits,
        reason: 'trial',
        idempotencyKey: `trial:${ws.id}`,
      },
    });
    await tx.quickReply.createMany({
      data: DEFAULT_QUICK_REPLIES.map((q, i) => ({
        workspaceId: ws.id,
        title: q.title[input.locale],
        body: q.body[input.locale],
        shortcut: `/${q.shortcut}`,
        locale: input.locale,
        sortOrder: i,
      })),
    });
    // DLV-01: the fee grid starts from the default table (69 rows, `source=default`)
    await tx.deliveryFeeRule.createMany({ data: await defaultFeeRows(tx, ws.id), skipDuplicates: true });
    // owner request 09/11: the Djaber team is told of every new shop
    const owner = await tx.user.findUnique({ where: { id: input.ownerId }, select: { firstName: true, lastName: true, email: true } });
    await this.admins.notify(tx, { kind: 'workspace_created', key: `workspace_created:${ws.id}`, params: { workspace: ws.name, owner: [owner?.firstName, owner?.lastName].filter(Boolean).join(' ') || owner?.email || '—' }, ids: { workspaceId: ws.id } });
    return ws;
  }
}
