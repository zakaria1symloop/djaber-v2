// 01-nest-module-map §3.2 — merchant permission table mirrored for the web / mobile clients
// (source of truth enforced by the API: apps/api/src/core/rbac/permission-matrix.ts — keep both in sync).
import type { MemberRole } from './enums';

const ALL: readonly MemberRole[] = ['owner', 'admin', 'operator'];
const ADMIN_UP: readonly MemberRole[] = ['owner', 'admin'];
const OWNER: readonly MemberRole[] = ['owner'];

export const MERCHANT_PERMISSIONS = {
  'inbox.read': ALL,
  'inbox.delete': ADMIN_UP,
  'channels.read': ALL,
  'channels.manage': ADMIN_UP,
  'agents.read': ALL,
  'agents.manage': ADMIN_UP,
  'agents.test': ALL,
  'insights.manage': ALL,
  'catalog.read': ALL,
  'catalog.write': ADMIN_UP,
  'stock.read': ALL,
  'stock.adjust': ADMIN_UP,
  'stock.count': ALL,
  'clients.read': ALL,
  'clients.write': ALL,
  'clients.delete': ADMIN_UP,
  'orders.read': ALL,
  'orders.write': ALL,
  'orders.money': ADMIN_UP,
  'orders.import': ADMIN_UP,
  'delivery.send': ALL,
  'delivery.manage': ADMIN_UP,
  'gds.read': ADMIN_UP,
  'gds.write': ADMIN_UP,
  'reports.read': ADMIN_UP,
  'reports.schedule': ADMIN_UP,
  'analytics.read': ALL,
  'notifications.own': ALL,
  'views.share': ADMIN_UP,
  'members.read': ALL,
  'members.write': OWNER,
  'workspace.read': ALL,
  'workspace.settings': ADMIN_UP,
  'workspace.transfer': OWNER,
  'workspace.delete': OWNER,
  'integrations.manage': ADMIN_UP,
  'billing.read': ADMIN_UP,
  'billing.read_credits': ALL,
  'billing.write': ADMIN_UP,
  'billing.plan': OWNER,
  'safety.block': ALL,
  'safety.manage': ADMIN_UP,
  'support.write': ALL,
  'support.read_all': ADMIN_UP,
} as const satisfies Record<string, readonly MemberRole[]>;

export type MerchantPermission = keyof typeof MERCHANT_PERMISSIONS;

export const isMerchantPermission = (key: string): key is MerchantPermission => key in MERCHANT_PERMISSIONS;

/** Role check only. */
export const roleCan = (role: MemberRole | null | undefined, key: MerchantPermission): boolean =>
  !!role && (MERCHANT_PERMISSIONS[key] as readonly MemberRole[]).includes(role);

/** Read keys stay usable by read-only members (plan limit); every other key guards a mutation. */
export const isReadPermission = (key: MerchantPermission): boolean => /\.(read|read_credits|read_all|own)$/.test(key);

/**
 * Sections an Owner can hide from one member (owner decision 2026-10-21, tester report: "choose what each member sees").
 * A hidden section refuses every key of its prefixes (API guard, `FORBIDDEN`) and leaves the member's menu and screens.
 * Members, workspace, notifications, billing and support keys belong to no section: they follow the role only.
 */
export const MEMBER_SECTIONS = ['inbox', 'orders', 'delivery', 'clients', 'catalog', 'stock', 'gds', 'reports', 'analytics', 'agents', 'channels'] as const;
export type MemberSection = (typeof MEMBER_SECTIONS)[number];
const SECTION_PREFIXES: Record<MemberSection, readonly string[]> = {
  inbox: ['inbox'],
  orders: ['orders'],
  delivery: ['delivery'],
  clients: ['clients'],
  catalog: ['catalog'],
  stock: ['stock'],
  gds: ['gds'],
  reports: ['reports'],
  analytics: ['analytics'],
  agents: ['agents', 'insights'],
  channels: ['channels'],
};
/** Section of a permission key (`orders.write` → `orders`), null for the keys no section can hide. */
export const sectionOf = (key: string): MemberSection | null => {
  const prefix = key.split('.')[0] ?? '';
  return MEMBER_SECTIONS.find((s) => SECTION_PREFIXES[s].includes(prefix)) ?? null;
};
export const isHidden = (hiddenSections: readonly string[] | null | undefined, key: string): boolean => {
  const s = sectionOf(key);
  return !!s && !!hiddenSections?.includes(s);
};

/**
 * UI helper mirroring the API: the role must hold the key, a `readOnly` member (plan `maxMembers`,
 * `READ_ONLY_MEMBER`) keeps only the read keys, and a section the Owner hid from the member is refused.
 */
export const memberCan = (m: { role: MemberRole | null | undefined; readOnly?: boolean; hiddenSections?: readonly string[] }, key: MerchantPermission): boolean =>
  roleCan(m.role, key) && (!m.readOnly || isReadPermission(key)) && !isHidden(m.hiddenSections, key);

// 01-nest-module-map §3.2 — platform keys `admin.<area>.read` / `admin.<area>.write` (+ extension keys), mirrored from
// apps/api/src/core/rbac/permission-matrix.ts (PLATFORM_PERMISSIONS) for the admin shell. The API enforces every key.
export type PlatformRoleName = 'super_admin' | 'support' | 'moderator' | 'finance' | 'read';
const P_ALL: readonly PlatformRoleName[] = ['super_admin', 'support', 'moderator', 'finance', 'read'];
const P_SA: readonly PlatformRoleName[] = ['super_admin'];
export const PLATFORM_AREAS = ['overview', 'workspaces', 'users', 'billing', 'ai', 'presets', 'cms', 'audit', 'health', 'settings', 'moderation', 'safety', 'support', 'team', 'deletion'] as const;
export type PlatformArea = (typeof PLATFORM_AREAS)[number];

export const PLATFORM_PERMISSIONS = {
  ...(Object.fromEntries(PLATFORM_AREAS.map((a) => [`admin.${a}.read`, P_ALL])) as Record<`admin.${PlatformArea}.read`, readonly PlatformRoleName[]>),
  'admin.overview.write': P_SA,
  'admin.workspaces.write': P_SA,
  'admin.workspaces.credits': ['super_admin', 'support', 'finance'],
  'admin.workspaces.impersonate': ['super_admin', 'support'],
  'admin.workspaces.unmask': P_SA,
  'admin.users.write': P_SA,
  'admin.billing.write': ['super_admin', 'finance'],
  'admin.ai.write': P_SA,
  'admin.presets.write': P_SA,
  'admin.cms.write': P_SA,
  'admin.audit.export': ['super_admin', 'finance'],
  'admin.health.write': P_SA,
  'admin.health.replay': ['super_admin', 'support'],
  'admin.settings.write': P_SA,
  'admin.moderation.write': ['super_admin', 'moderator'],
  'admin.safety.write': ['super_admin', 'moderator'],
  'admin.support.write': ['super_admin', 'support'],
  'admin.team.write': P_SA,
  'admin.deletion.write': ['super_admin', 'support'],
} as const satisfies Record<string, readonly PlatformRoleName[]>;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export const isPlatformPermission = (key: string): key is PlatformPermission => key in PLATFORM_PERMISSIONS;
/** UI mirror of `canPlatform` (API): `none` / unknown roles hold no key. */
export const platformCan = (role: string | null | undefined, key: PlatformPermission): boolean =>
  !!role && (PLATFORM_PERMISSIONS[key] as readonly string[]).includes(role);
