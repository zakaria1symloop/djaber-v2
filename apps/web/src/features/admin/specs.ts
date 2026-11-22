// URL list specs of the admin core lists (api-contract §4 admin query types; names = API query names).
import type { ListSpec } from '@/lib/list-state';

export const WORKSPACES_LIST: ListSpec = {
  filters: {
    planSlug: 'list',
    status: 'list',
    subscriptionStatus: 'list',
    credits: 'text',
    createdFrom: 'date',
    createdTo: 'date',
    wilayaId: 'text',
    withPages: 'bool',
    withAgents: 'bool',
    inactiveDays: 'text',
    minPages: 'int',
    maxPages: 'int',
    minProducts: 'int',
    maxProducts: 'int',
    minRevenue: 'int',
    maxRevenue: 'int',
    trustLevel: 'list',
  },
  sorts: ['createdAt', 'name', 'lastActivityAt'],
  defaultSort: '-createdAt',
};

export const USERS_LIST: ListSpec = {
  filters: { platformRole: 'list', status: 'list', emailVerified: 'text', totpEnabled: 'text', lastLogin: 'text', workspaceId: 'text' },
  sorts: ['createdAt', 'lastLoginAt', 'email'],
  defaultSort: '-createdAt',
};

export const SUBSCRIPTIONS_LIST: ListSpec = {
  filters: { planSlug: 'list', status: 'list', cycle: 'list', method: 'list', renewal: 'text', kind: 'list', from: 'date', to: 'date', provider: 'list', channel: 'list' },
  sorts: ['currentPeriodEnd', 'createdAt', 'date', 'paidAt'],
  defaultSort: 'currentPeriodEnd',
  tabs: ['invoices', 'payments', 'packs'],
};

export const PROMO_LIST: ListSpec = { filters: { state: 'list', kind: 'list' }, sorts: ['createdAt', 'code'], defaultSort: '-createdAt' };

export const CMS_LIST: ListSpec = {
  filters: { status: 'list', missingLocale: 'text', target: 'text', updatedById: 'text' },
  sorts: ['updatedAt', 'key', 'startsAt'],
  defaultSort: '-updatedAt',
  tabs: ['announcement', 'legal', 'help', 'email', 'plan_text', 'system_message_default', 'page'],
};

export const AUDIT_LIST: ListSpec = {
  filters: { actorId: 'text', action: 'list', entity: 'list', workspaceId: 'text', from: 'date', to: 'date', period: 'text', impersonation: 'text', impersonationSessionId: 'text' },
  sorts: ['at'],
  defaultSort: '-at',
};

export const DELETION_LIST: ListSpec = { filters: { status: 'list' }, sorts: ['requestedAt'], defaultSort: '-requestedAt' };
/** ADM-16 / MSG-08 — end-customer data deletions, second list of `/admin/team`: its URL keys carry `dd.` (`?dd.status=pending`) */
export const DATA_DELETION_LIST: ListSpec = { prefix: 'dd.', filters: { status: 'list', source: 'text' }, sorts: ['requestedAt'], defaultSort: '-requestedAt' };

export const VIEWER_PRODUCTS_LIST: ListSpec = { filters: { workspaceId: 'text', moderationStatus: 'list' }, sorts: ['name', 'updatedAt'], defaultSort: 'name' };
