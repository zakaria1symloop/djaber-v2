'use client';
// /inbox and /inbox/[conversationId] — Figma "INB — Inbox — thread with handoff", "INB — Inbox — AR (RTL)".
// Three panes ≥ 1280 (list · thread · client), two at 1024–1279 (the client panel becomes a drawer), one below 1024
// (list, then the thread with a back link). Tab, channel, search and filters live in the query string; the selected
// conversation is the path segment — rendered by the layout so that the list keeps its scroll between threads.
import { roleCan } from '@djaber/shared';
import { ThreePane } from '@djaber/ui';
import { MessagesSquare } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page403 } from '@/components/global-states';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useDocumentTitle } from '@/lib/document-title';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ClientPanel } from './client-panel';
import { ConversationList } from './conversation-list';
import { inboxQueryString, parseInboxParams, type InboxFilters } from './logic';
import { Thread } from './thread';
import { useConversationActions } from './use-conversation-actions';

export function InboxView() {
  const t = useT();
  const locale = useLocaleCode();
  const { role } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const route = useParams<{ conversationId?: string }>();
  const selectedId = route.conversationId ?? null;
  const filters = useMemo(() => parseInboxParams(params), [params]);
  const qs = inboxQueryString(filters);
  const [panelOpen, setPanelOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  useDocumentTitle(t('nav.inbox'));

  const hrefOf = useCallback((id: string) => `/inbox/${id}${qs ? `?${qs}` : ''}`, [qs]);
  const listHref = `/inbox${qs ? `?${qs}` : ''}`;
  const setFilters = useCallback(
    (next: InboxFilters) => {
      const s = inboxQueryString(next);
      router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
    },
    [router, pathname],
  );
  const actions = useConversationActions({ onDeleted: (id) => id === selectedId && router.replace(listHref) });

  // a new thread closes the drawer; Échap closes it too (GLOBAL shortcuts: "fermer dialogue / panneau")
  useEffect(() => setPanelOpen(false), [selectedId]);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const focusNote = () => {
    setPanelOpen(true);
    // the drawer is rendered on the next frame below 1280
    window.setTimeout(() => noteRef.current?.focus(), 50);
  };

  if (!roleCan(role, 'inbox.read')) return <Page403 role={role ? t(`enum.Membership.role.${role}`) : '—'} homeHref={`/${locale}/home`} permissions={['inbox.read']} />;

  return (
    // the shell pads its content; the inbox is edge to edge
    <div className="-mx-4 -my-6 h-[calc(100%+3rem)] md:-mx-8" data-testid="inbox">
      <ThreePane
        view={selectedId ? 'thread' : 'list'}
        panelOpen={panelOpen}
        onPanelClose={() => setPanelOpen(false)}
        panelLabel={t('inbox.panel.title')}
        list={<ConversationList filters={filters} setFilters={setFilters} selectedId={selectedId} hrefOf={hrefOf} actions={actions} />}
        thread={
          selectedId ? (
            <Thread id={selectedId} backHref={listHref} actions={actions} onTogglePanel={() => setPanelOpen((v) => !v)} onFocusNote={focusNote} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center" data-testid="thread-placeholder">
              <MessagesSquare className="size-5 text-text-secondary" aria-hidden />
              <p className="ts-title">{t('inbox.placeholder.title')}</p>
              <p className="ts-label-meta max-w-sm text-text-muted">{t('inbox.placeholder.description')}</p>
            </div>
          )
        }
        panel={selectedId ? <ClientPanel id={selectedId} noteRef={noteRef} onClose={() => setPanelOpen(false)} /> : undefined}
      />
      {actions.dialogs}
    </div>
  );
}
