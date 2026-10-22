// Sidebar items, order exactly as Figma `ANA-01 — Home — default` (02-next-route-map §2.1).
import {
  BarChart3,
  ClipboardList,
  Bell,
  Bot,
  Boxes,
  FileBarChart,
  FolderTree,
  HelpCircle,
  Home,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Package,
  ArrowLeftRight,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  Wrench,
  Receipt,
  Share2,
} from 'lucide-react';

export type NavItem = {
  key: string; // i18n key
  href: string;
  icon: LucideIcon;
  /** hidden when workspace.stockMode === 'simple' (D12) */
  advancedOnly?: boolean;
  /** name of the badge counter in the shell counters */
  badge?: string;
  /** merchant permission required to see the item */
  permission?: string;
};
export type NavGroup = { key?: string; items: NavItem[] };

export const MAIN_NAV: NavGroup[] = [
  {
    items: [
      { key: 'nav.home', href: '/home', icon: Home },
      { key: 'nav.queue', href: '/queue', icon: ListChecks, badge: 'queue' },
      // the read key of each section: a section the Owner hid from the member leaves the menu (owner decision 2026-10-21)
      { key: 'nav.inbox', href: '/inbox', icon: Inbox, badge: 'inbox', permission: 'inbox.read' },
      { key: 'nav.orders', href: '/orders', icon: ShoppingBag, permission: 'orders.read' },
      { key: 'nav.delivery', href: '/delivery', icon: Truck, permission: 'delivery.send' },
      { key: 'nav.clients', href: '/clients', icon: Users, permission: 'clients.read' },
    ],
  },
  {
    key: 'nav.group.stock',
    items: [
      { key: 'nav.stockDashboard', href: '/stock', icon: LayoutDashboard, permission: 'stock.read' },
      { key: 'nav.products', href: '/products', icon: Package, permission: 'catalog.read' },
      // 08-web-screens sidebar "Produits · Services" (CAT-11): the services list (trackStock = false)
      { key: 'nav.services', href: '/services', icon: Wrench, permission: 'catalog.read' },
      { key: 'nav.categories', href: '/categories', icon: FolderTree, permission: 'catalog.read' },
      { key: 'nav.movements', href: '/movements', icon: ArrowLeftRight, advancedOnly: true, permission: 'stock.read' },
      { key: 'nav.suppliers', href: '/suppliers', icon: Store, advancedOnly: true, permission: 'gds.read' },
      { key: 'nav.purchases', href: '/purchases', icon: ShoppingCart, advancedOnly: true, permission: 'gds.read' },
      { key: 'nav.sales', href: '/sales', icon: Receipt, advancedOnly: true, permission: 'gds.read' },
      { key: 'nav.cash', href: '/cash', icon: Wallet, advancedOnly: true, permission: 'gds.read' },
      { key: 'nav.inventory', href: '/inventory', icon: ClipboardList, advancedOnly: true, permission: 'stock.count' },
      { key: 'nav.recommendations', href: '/recommendations', icon: Lightbulb, permission: 'catalog.read' },
    ],
  },
  {
    key: 'nav.group.ai',
    items: [
      { key: 'nav.agents', href: '/agents', icon: Bot, permission: 'agents.read' },
      { key: 'nav.channels', href: '/channels', icon: Share2, permission: 'channels.read' },
    ],
  },
  {
    key: 'nav.group.analysis',
    items: [
      { key: 'nav.analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read' },
      { key: 'nav.reports', href: '/reports', icon: FileBarChart, permission: 'reports.read' },
    ],
  },
];

export const FOOTER_NAV: NavItem[] = [
  { key: 'nav.notifications', href: '/notifications', icon: Bell, badge: 'notifications' },
  { key: 'nav.settings', href: '/settings', icon: Settings },
  { key: 'nav.help', href: '/help', icon: HelpCircle },
];

export const NAV_ICON_FALLBACK = Boxes;

/** Sidebar entries for a member: advanced-only entries need `stockMode = advanced` (D12), others their permission. */
export const filterNav = <T extends NavItem>(items: T[], o: { stockMode: 'simple' | 'advanced'; can: (key: string) => boolean }): T[] =>
  items.filter((i) => (!i.advancedOnly || o.stockMode === 'advanced') && (!i.permission || o.can(i.permission)));
