'use client';
// Saved views of a list (LST-03, D47) — Figma "REF — Deep-link map (notification → target) + remaining list mechanics",
// panel « Vues enregistrées (toutes les listes) »: one row per view (name · DÉFAUT pill · ⋯ menu), then
// « + Enregistrer la vue courante… » and the rule line. The panel opens from the « Vues ⌄ » chip of the filter bar.
// Presentational: the page gives the rows, the row menus (rename / set default / share / delete…) and the callbacks.
import * as Popover from '@radix-ui/react-popover';
import { Bookmark, ChevronDown, Plus } from 'lucide-react';
import * as React from 'react';
import { ActionsMenu, type MenuAction } from './overlays';
import { Button, cn, Pill, Skeleton } from './primitives';

export type SavedViewRow = {
  id: string;
  name: string;
  isDefault: boolean;
  /** shared with the team (by me or another member) */
  isShared: boolean;
  /** a view another member shared: apply or duplicate only */
  readOnly: boolean;
  /** the list currently shows this view's filters */
  current?: boolean;
  /** « par Nadia F. » under a view shared by another member */
  meta?: string;
};

export type SavedViewsLabels = {
  /** chip label when no view is current (« Vues ») */
  trigger: string;
  title: string;
  saveCurrent: string;
  empty: string;
  note: string;
  defaultPill: string;
  sharedPill: string;
  rowMenu: (name: string) => string;
  loading: string;
  error: string;
  retry: string;
};

export function SavedViewsMenu({
  views,
  loading,
  error,
  onRetry,
  onSelect,
  rowActions,
  onSaveCurrent,
  saveDisabledReason,
  labels,
  align = 'end',
}: {
  views: SavedViewRow[] | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSelect: (id: string) => void;
  rowActions: (view: SavedViewRow) => MenuAction[];
  onSaveCurrent: () => void;
  /** translated reason (offline, read-only member): the row is greyed with the reason under it */
  saveDisabledReason?: string;
  labels: SavedViewsLabels;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = React.useState(false);
  const current = views?.find((v) => v.current);
  // a menu item that opens a dialog closes the panel first (focus goes back to the chip, not to a closed popover)
  const close = (fn?: () => void) => () => {
    setOpen(false);
    fn?.();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button className={cn(current ? 'border-line-lit' : '')} data-testid="saved-views-trigger">
          <Bookmark className="size-3.5" aria-hidden />
          <span className="max-w-40 truncate">{current ? current.name : labels.trigger}</span>
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={labels.title}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[420px] max-w-[calc(100vw-1rem)] flex-col gap-2.5 overflow-y-auto rounded-card border border-line-edge bg-ink-raised px-[18px] py-3.5 shadow-xl"
          data-testid="saved-views-panel"
        >
          <p className="ts-title">{labels.title}</p>
          {loading && !views ? (
            <div role="status" aria-label={labels.loading} className="flex flex-col gap-3 py-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : error && !views ? (
            <div role="alert" className="flex items-center justify-between gap-3 py-1 text-[13px] text-accent-alert">
              <span>{labels.error}</span>
              {onRetry ? (
                <Button size="sm" variant="ghost" onClick={onRetry}>
                  {labels.retry}
                </Button>
              ) : null}
            </div>
          ) : views && views.length ? (
            <ul className="flex flex-col">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-[5px]" data-view={v.id}>
                  <button
                    type="button"
                    onClick={close(() => onSelect(v.id))}
                    aria-current={v.current ? 'true' : undefined}
                    className={cn('min-w-0 flex-1 rounded-[4px] text-start text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-line-lit', v.current ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary')}
                  >
                    <span className="block truncate">{v.name}</span>
                    {v.meta ? <span className="block truncate ts-label-micro text-text-muted">{v.meta}</span> : null}
                  </button>
                  {v.isShared ? <Pill className="shrink-0 rounded-[4px]">{labels.sharedPill}</Pill> : null}
                  {v.isDefault ? (
                    <Pill tone="success" className="shrink-0 rounded-[4px]">
                      {labels.defaultPill}
                    </Pill>
                  ) : null}
                  <ActionsMenu iconOnly variant="ghost" label={labels.rowMenu(v.name)} actions={rowActions(v).map((a) => ({ ...a, onSelect: a.onSelect ? close(a.onSelect) : undefined }))} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 text-[13px] text-text-muted">{labels.empty}</p>
          )}
          <button
            type="button"
            onClick={close(onSaveCurrent)}
            disabled={!!saveDisabledReason}
            className="flex items-center gap-1.5 rounded-[4px] py-[5px] text-start text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-1 focus-visible:ring-line-lit disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="saved-views-save"
          >
            <Plus className="size-3.5" aria-hidden />
            {labels.saveCurrent}
          </button>
          {saveDisabledReason ? <p className="ts-label-meta text-text-muted">{saveDisabledReason}</p> : null}
          <p className="ts-label-micro text-text-muted">{labels.note}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
