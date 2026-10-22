'use client';
// Top-bar search (tester report 2026-10-20 improvement: "a search bar at the top of the dashboard to quickly find
// elements"): pages of the menu, orders (number, client, phone), clients (name, phone) and products (name, SKU) the member
// may open (`can()`, hidden sections included). Enter opens the first result; Escape closes; results are links.
import { formatMoney, formatPhoneDz } from '@djaber/shared';
import { cn, Ltr } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { apiRaw } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { filterNav, FOOTER_NAV, MAIN_NAV } from './nav';

type Hit = { key: string; group: 'pages' | 'orders' | 'clients' | 'products'; label: string; meta?: string; href: string };
type Row = Record<string, unknown>;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Menu pages whose name contains the typed text (accents and case ignored). */
export const matchPages = <T extends { key: string; href: string }>(items: T[], label: (key: string) => string, q: string): T[] => {
  const f = fold(q.trim());
  return f.length < 2 ? [] : items.filter((i) => fold(label(i.key)).includes(f)).slice(0, 5);
};

const rows = async (path: string, q: string): Promise<Row[]> => (await apiRaw<Row[]>(path, { query: { q, pageSize: 25 } })).data?.slice(0, 5) ?? [];

export function GlobalSearch() {
  const t = useT();
  const router = useRouter();
  const ws = useWorkspaceId();
  const { can, workspace } = useSession();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // the lists are asked once the typing pauses
  useEffect(() => {
    const id = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(id);
  }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const enabled = q.length >= 2;
  const orders = useQuery({ queryKey: [ws, 'search', 'orders', q], queryFn: () => rows('/orders', q), enabled: enabled && can('orders.read'), staleTime: 30_000 });
  const clients = useQuery({ queryKey: [ws, 'search', 'clients', q], queryFn: () => rows('/clients', q), enabled: enabled && can('clients.read'), staleTime: 30_000 });
  const products = useQuery({ queryKey: [ws, 'search', 'products', q], queryFn: () => rows('/products', q), enabled: enabled && can('catalog.read'), staleTime: 30_000 });

  const hits = useMemo<Hit[]>(() => {
    const nav = filterNav([...MAIN_NAV.flatMap((g) => g.items), ...FOOTER_NAV], { stockMode: workspace?.stockMode ?? 'simple', can: (k) => can(k as never) });
    const pages = matchPages(nav, (k) => t(k), text).map((i) => ({ key: `p:${i.href}`, group: 'pages' as const, label: t(i.key), href: i.href }));
    if (!enabled) return pages;
    return [
      ...pages,
      ...(orders.data ?? []).map((o) => ({ key: `o:${o.id}`, group: 'orders' as const, label: `#${String(o.number)}`, meta: [(o.client as { name?: string } | null)?.name, formatMoney(Number(o.total ?? 0))].filter(Boolean).join(' · '), href: `/orders/${String(o.id)}` })),
      ...(clients.data ?? []).map((c) => ({ key: `c:${c.id}`, group: 'clients' as const, label: String(c.name), meta: c.phone ? formatPhoneDz(String(c.phone)) : undefined, href: `/clients?sheet=${String(c.id)}` })),
      ...(products.data ?? []).map((p) => ({ key: `r:${p.id}`, group: 'products' as const, label: String(p.name), meta: [p.sku ? String(p.sku) : null, formatMoney(Number(p.price ?? 0))].filter(Boolean).join(' · '), href: `/products/${String(p.id)}` })),
    ];
  }, [text, enabled, orders.data, clients.data, products.data, can, t, workspace?.stockMode]);
  const loading = enabled && (orders.isFetching || clients.isFetching || products.isFetching);
  const go = (h: Hit) => {
    setOpen(false);
    setText('');
    router.push(h.href);
  };
  const groups: Hit['group'][] = ['pages', 'orders', 'clients', 'products'];
  return (
    <div ref={box} className="relative w-full max-w-sm" data-testid="global-search">
      <label className="flex h-9 items-center gap-2 rounded-card border border-line-edge bg-ink-surface px-3 text-[13px] focus-within:border-line-lit">
        <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setOpen(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              go(hits[active]!);
            }
          }}
          placeholder={t('search.global.placeholder')}
          aria-label={t('search.global.placeholder')}
          aria-expanded={open && text.trim().length >= 2}
          aria-controls="global-search-results"
          role="combobox"
          className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
        />
      </label>
      {open && text.trim().length >= 2 ? (
        <div id="global-search-results" role="listbox" className="absolute inset-x-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-card border border-line-edge bg-ink-raised py-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 ts-label-meta text-text-muted">{loading ? t('common.loading') : t('search.global.none')}</p>
          ) : (
            groups.map((g) => {
              const list = hits.filter((h) => h.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="py-1">
                  <div className="px-3 py-1 ts-label-micro uppercase text-text-muted">{t(`search.global.group.${g}`)}</div>
                  {list.map((h) => {
                    const i = hits.indexOf(h);
                    return (
                      <button
                        key={h.key}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h)}
                        className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-start text-[13px]', i === active ? 'bg-ink-surface text-text-primary' : 'text-text-secondary')}
                        data-hit={h.group}
                      >
                        <span className="min-w-0 flex-1 truncate">{h.label}</span>
                        {h.meta ? <Ltr className="shrink-0 ts-label-meta text-text-muted">{h.meta}</Ltr> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
