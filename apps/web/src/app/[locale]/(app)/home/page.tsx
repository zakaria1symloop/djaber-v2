'use client';
// /home — Figma "ANA-01 — Home — default", "ANA-01 — Home — new workspace + banners", "ANA-01b — Home & Notifications —
// states catalogue", "ANA-01 — Home — AR (RTL)" (12 §3, §18; `GET /dashboard/home`). Greeting, "À TRAITER" queue cards,
// "APERÇU" KPI tiles, "ACTIONS RAPIDES", "VOS PAGES" page cards and the "DÉMARRER" checklist. The banners of the frame
// are the shell BannerStack (one at a time, global priority) — not drawn a second time here.
import {
  formatMoney,
  formatNumber,
  TIMEZONE,
  type HomePageCard as HomePageCardView,
  type HomeView,
} from '@djaber/shared';
import {
  buttonClass,
  ChecklistRow,
  HomeEmptyCard,
  HomeKpiTile,
  HomePageCard,
  HomeQueueCard,
  HomeQueueMore,
  HomeSection,
  HomeSkeleton,
  Ltr,
  pillTone,
  QuickActionCard,
} from '@djaber/ui';
import {
  Bot,
  ChevronRight,
  MessageSquareText,
  Package,
  Settings2,
  Share2,
  ShoppingBag,
  Sparkles,
  Upload,
  Inbox as InboxIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { ChannelStatusPill, PlatformMark } from '@/features/channels/ui';
import { useHome, useHomeEvents } from '@/features/home/api';
import { dayMonth, greetingKey, longDate } from '@/features/home/greeting';
import {
  agentCta,
  agentState,
  aiLive,
  homeTiles,
  QUICK_ACTION_HREF,
  queueHref,
  queueLabelKey,
  queueOverflow,
  queueText,
  queueToneKey,
  quickActionsOf,
  shortAge,
  sortQueue,
  type QuickActionKey,
} from '@/features/home/logic';
import { Link } from '@/i18n/navigation';
import { reasonText } from '@/lib/actions';
import { CHECKLIST_KEYS, checklistOf, type ChecklistKey } from '@/lib/contracts';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { compactAmount } from '@/lib/money';
import { useSession } from '@/lib/session';

const CHECKLIST_HREF: Record<ChecklistKey, string> = {
  channel: '/channels',
  product: '/products',
  agent: '/agents',
  sale: '/orders',
};
const QUICK_ICON: Record<QuickActionKey, ReactNode> = {
  connect_page: <Share2 className="size-5" aria-hidden />,
  add_product: <Package className="size-5" aria-hidden />,
  create_agent: <Bot className="size-5" aria-hidden />,
  new_order: <ShoppingBag className="size-5" aria-hidden />,
  open_inbox: <InboxIcon className="size-5" aria-hidden />,
  import_products: <Upload className="size-5" aria-hidden />,
};

/** The skeleton only shows after 300 ms (GLOBAL catalogue): fast answers never flash it. */
function useDelayed(on: boolean, ms = 300) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!on) return setShow(false);
    const id = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return show;
}

export default function HomePage() {
  const t = useT();
  const locale = useLocaleCode();
  const { me, workspace } = useSession();
  const home = useHome();
  useHomeEvents();
  const skeleton = useDelayed(home.isPending);
  const now = new Date();
  const greeting = t(greetingKey(now), { name: me?.firstName ?? '' });

  return (
    <AppPage title={t('nav.home')} bare permission="analytics.read">
      <div className="flex w-full flex-col gap-8" data-testid="home">
        <header>
          <div className="ts-label-meta uppercase text-text-muted">{longDate(now, locale)}</div>
          <h1 className="ts-display-m mt-2">{greeting}</h1>
          <p className="ts-body mt-2 text-text-secondary">{t('home.subtitle')}</p>
        </header>
        {home.isPending ? (
          skeleton ? (
            <HomeSkeleton label={t('common.loading')} />
          ) : (
            <div className="min-h-96" aria-busy />
          )
        ) : home.isError ? (
          <QueryError error={home.error} onRetry={() => void home.refetch()} />
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-8">
              <Queue view={home.data} />
              <Overview view={home.data} advanced={workspace?.stockMode === 'advanced'} />
              <QuickActions view={home.data} />
            </div>
            <div className="flex min-w-0 flex-col gap-8">
              <Pages pages={home.data.pages} products={home.data.kpis.products.total} />
              <GetStarted view={home.data} />
            </div>
          </div>
        )}
      </div>
    </AppPage>
  );
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
const words = (
  t: TFunction,
  w: { key: string; params: Record<string, string | number> } | string | null,
) => (w === null ? null : typeof w === 'string' ? w : t.has(w.key) ? t(w.key, w.params) : null);

const ageText = (t: TFunction, iso: string) => {
  const a = shortAge(iso);
  return t(a.key, { count: a.count });
};

function Queue({ view }: { view: HomeView }) {
  const t = useT();
  const items = sortQueue(view.queue.items);
  const more = queueOverflow(view.queue, items);
  return (
    <HomeSection
      label={t('home.queue.title')}
      count={formatNumber(view.queue.total)}
      data-testid="home-queue"
    >
      {items.length === 0 || items.every((i) => i.handled) ? (
        <HomeEmptyCard
          title={t('home.queue.empty.title')}
          description={t('home.queue.empty.description')}
          data-testid="home-queue-empty"
        />
      ) : null}
      {items.length === 0 ? null : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => {
            const text = queueText(i, clock);
            return (
              <li key={i.key}>
                <Link
                  href={queueHref(i)}
                  className="block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound"
                  data-testid={i.handled ? 'home-queue-handled' : 'home-queue-item'}
                >
                  <HomeQueueCard
                    kind={i.kind}
                    kindLabel={t(queueLabelKey(i.kind))}
                    tone={pillTone('Home.queue', queueToneKey(i.kind))}
                    age={ageText(t, i.since)}
                    title={<bdi>{words(t, text.title) ?? i.title}</bdi>}
                    subtitle={words(t, text.subtitle) ?? i.subtitle}
                    handledLabel={i.handled ? (i.handled.by ? t('home.queue.handledBy', { name: i.handled.by.name }) : t('home.queue.handled')) : undefined}
                  />
                </Link>
              </li>
            );
          })}
          {/* UX-065: one "+ n …" link per hidden kind, to the page that lists all the cards of that kind */}
          {more.length ? (
            <li className="flex flex-wrap gap-2">
              {more.map((m) => (
                <Link key={m.kind} href={m.href} className="block rounded-card" data-testid="home-queue-more" data-more-kind={m.kind}>
                  <HomeQueueMore>{t(m.key, { count: m.count })}</HomeQueueMore>
                </Link>
              ))}
            </li>
          ) : null}
        </ul>
      )}
    </HomeSection>
  );
}

function Overview({ view, advanced }: { view: HomeView; advanced: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const tiles = homeTiles(view.kpis);
  const label: Record<string, string> = {
    pages: t('home.kpi.pages'),
    products: t('home.kpi.products'),
    revenue: t('home.kpi.revenue'),
    stock:
      advanced && view.kpis.stockValue.cost !== null
        ? t('home.kpi.stockCost')
        : t('home.kpi.stock'),
  };
  return (
    <HomeSection label={t('home.overview.title')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="home-kpis">
        {tiles.map((tile) => (
          <HomeKpiTile
            key={tile.key}
            data-kpi={tile.key}
            label={label[tile.key]!}
            value={tile.money ? compactAmount(tile.value, locale) : formatNumber(tile.value)}
            unit={tile.money ? t('common.currency') : undefined}
            sub={tile.sub.length ? tile.sub.map((x) => t(x.key, { count: x.count })).join(' · ') : undefined}
            title={tile.money ? formatMoney(tile.value) : undefined}
          />
        ))}
      </div>
    </HomeSection>
  );
}

function QuickActions({ view }: { view: HomeView }) {
  const t = useT();
  const actions = quickActionsOf(view);
  return (
    <HomeSection label={t('home.quick.title')}>
      <ul className="grid gap-3 sm:grid-cols-3" data-testid="home-quick-actions">
        {actions.map((a) => {
          const card = (
            <QuickActionCard
              icon={QUICK_ICON[a.key] ?? <MessageSquareText className="size-5" aria-hidden />}
              title={t(`home.quick.${a.key}.title`)}
              description={t(`home.quick.${a.key}.description`)}
              disabledReason={a.enabled ? undefined : reasonText(t, a.reasonCode)}
            />
          );
          return (
            <li key={a.key} data-action={a.key}>
              {a.enabled ? (
                <Link
                  href={QUICK_ACTION_HREF[a.key] ?? '/home'}
                  className="block h-full rounded-card"
                >
                  {card}
                </Link>
              ) : (
                card
              )}
            </li>
          );
        })}
      </ul>
    </HomeSection>
  );
}

/** The catalogue is shared by every page of the workspace: the "STOCK" tile shows the workspace product count. */
function Pages({ pages, products }: { pages: HomePageCardView[]; products: number }) {
  const t = useT();
  return (
    <HomeSection label={t('home.pages.title')} data-testid="home-pages">
      {pages.length === 0 ? (
        <HomeEmptyCard
          title={t('home.pages.empty.title')}
          description={t('home.pages.empty.description')}
          action={
            <Link href="/channels" className={buttonClass({ variant: 'primary' })}>
              {t('home.pages.empty.action')}
            </Link>
          }
          data-testid="home-pages-empty"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {pages.map((p) => (
            <li key={p.id}>
              <PageCard page={p} products={products} />
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

function PageCard({ page: p, products }: { page: HomePageCardView; products: number }) {
  const t = useT();
  const locale = useLocaleCode();
  const state = agentState(p);
  const cta = agentCta(p);
  const btn = buttonClass({ size: 'sm', className: 'w-full' });
  return (
    <HomePageCard
      data-page={p.id}
      icon={<PlatformMark platform={p.platform} size={40} src={p.avatarUrl} name={p.name} />}
      name={p.name}
      meta={`${t(`enum.Channel.platform.${p.platform}`)} · ${t('home.pages.connectedOn', { date: dayMonth(new Date(p.connectedAt), locale) })}`}
      badge={<ChannelStatusPill channel={p} />}
      ai={aiLive(p) ? t('home.pages.ai') : undefined}
      tiles={[
        {
          key: 'conversations',
          value: <Ltr>{formatNumber(p.conversations.total)}</Ltr>,
          label: t('home.pages.tile.conversations'),
          sub: t('home.pages.tile.active', { count: p.conversations.active }),
        },
        {
          key: 'messages',
          value: <Ltr>{formatNumber(p.messages7d.total)}</Ltr>,
          label: t('home.pages.tile.messages7d'),
          sub: t('home.pages.tile.inbound', { count: p.messages7d.inbound }),
        },
        {
          key: 'unread',
          value: <Ltr>{formatNumber(p.unread)}</Ltr>,
          label: t('home.pages.tile.unread'),
          sub: t('home.pages.tile.needsHuman', { count: p.needsHuman }),
        },
        {
          key: 'stock',
          value: <Ltr>{formatNumber(products)}</Ltr>,
          label: t('home.pages.tile.stock'),
          sub: t('home.pages.tile.products'),
        },
      ]}
      agent={{
        icon:
          state === 'none' ? (
            <Bot className="size-5 text-text-muted" aria-hidden />
          ) : (
            <Sparkles className="size-5" aria-hidden />
          ),
        title: t(`home.pages.agent.${state}`, { name: p.agent?.name ?? '' }),
        meta: p.agent ? p.agent.name : t('home.pages.agent.noneHint'),
        action: (
          <Link href={cta.href} className={buttonClass({ size: 'sm', variant: 'primary' })} data-testid="home-page-agent-cta">
            {t(cta.labelKey)}
          </Link>
        ),
      }}
      actions={
        <>
          <Link href={`/inbox?channel=${p.id}`} className={btn}>
            <MessageSquareText className="size-3.5" aria-hidden />
            {t('home.pages.inbox')}
          </Link>
          <Link href="/products" className={btn}>
            <Package className="size-3.5" aria-hidden />
            {t('home.pages.stock')}
          </Link>
          <Link href={`/channels/${p.id}`} className={btn}>
            <Settings2 className="size-3.5" aria-hidden />
            {t('action.configure')}
          </Link>
        </>
      }
    />
  );
}

function GetStarted({ view }: { view: HomeView }) {
  const t = useT();
  const list = checklistOf(view.getStarted);
  const done = CHECKLIST_KEYS.filter((k) => list[k]).length;
  return (
    <section aria-labelledby="get-started" className="w-full">
      <div className="flex items-center justify-between px-5">
        <h2 id="get-started" className="ts-label-section text-text-muted">
          {t('home.getStarted.title')}
        </h2>
        <bdi
          dir="ltr"
          className="ts-label-meta tabular-nums text-text-primary"
          data-testid="checklist-count"
        >
          {done} / {CHECKLIST_KEYS.length}
        </bdi>
      </div>
      <ol className="mt-3 flex flex-col">
        {CHECKLIST_KEYS.map((k, i) => (
          <li key={k} data-step={k}>
            <Link href={CHECKLIST_HREF[k]} className="block rounded-card px-3 hover:bg-ink-raised">
              <ChecklistRow
                done={list[k]}
                index={i + 1}
                title={t(`home.getStarted.${k}.title`)}
                description={t(`home.getStarted.${k}.description`)}
                action={
                  <ChevronRight
                    className="mt-1 size-4 shrink-0 text-text-muted rtl:-scale-x-100"
                    aria-hidden
                  />
                }
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
