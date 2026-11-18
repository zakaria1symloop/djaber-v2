'use client';
// Dialog, dropdown ("Actions ⌄"), toasts, tabs, tooltip — Radix primitives restyled to the Djaber system.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';
import * as React from 'react';
import { Button, cn, toneDot, type Tone } from './primitives';

/**
 * full-test 15/11 MOBILE-A11Y-03: a dialog / sheet opened from controlled state (menu item, icon button) has no Radix
 * `Trigger`, so on close the focus fell to `<body>`. The element focused when it opened gets it back — for a menu item,
 * the menu's trigger (« Actions ⌄ »).
 */
export function useReturnFocus(open: boolean) {
  const opener = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    let el = document.activeElement as HTMLElement | null;
    if (el?.closest('[role="menu"]')) el = document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="menu"][data-state="open"]') ?? el;
    opener.current = el && el !== document.body ? el : null;
  }, [open]);
  return React.useCallback((e: Event) => {
    const el = opener.current;
    opener.current = null;
    e.preventDefault();
    returnFocusTo(el);
  }, []);
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const canFocus = (el: Element | null): boolean =>
  el instanceof HTMLElement && el.isConnected && !el.matches(':disabled') && !el.closest('[inert], [aria-hidden="true"]') && el.getClientRects().length > 0;
const keyOf = (el: HTMLElement) => (el.id ? `#${CSS.escape(el.id)}` : el.dataset.testid ? `[data-testid="${CSS.escape(el.dataset.testid)}"]` : null);
/** The opener; else the element now in its place (same id / test id); else the next control after it; else the page's main region. */
const focusTarget = (el: HTMLElement | null, key: string | null): HTMLElement | null => {
  if (canFocus(el)) return el;
  const same = key ? document.querySelector(key) : null;
  if (canFocus(same)) return same as HTMLElement;
  if (el?.isConnected) {
    const all = [...document.querySelectorAll(TABBABLE)];
    const next = all.find((x) => el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING && canFocus(x));
    if (next) return next as HTMLElement;
  }
  return document.getElementById('main');
};
/**
 * journey J14-3: after a dialog saved, its opener was often gone or disabled (« Enregistrer un paiement » once the order is
 * paid, the list behind a sheet after a navigation) and the focus fell to `<body>`. The focus goes to the opener or what
 * stands in its place, and is checked again while the page re-renders after the save (2 s).
 */
export function returnFocusTo(el: HTMLElement | null) {
  const key = el ? keyOf(el) : null;
  let last: HTMLElement | null = null;
  const apply = () => {
    last = focusTarget(el, key);
    // journey re-run J14r-5 (18/11): a control standing in for the opener is scrolled into view (« استرداد » after « تسجيل دفعة » was focused
    // at y 860 of an 844 px screen); only the page's main region keeps the scroll where it is
    const main = !!last && last.id === 'main';
    last?.focus({ preventScroll: true });
    if (last && !main) last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  apply();
  let n = 0;
  const timer = window.setInterval(() => {
    n += 1;
    const now = document.activeElement;
    if (!now || now === document.body) apply();
    // the member moved on, or 2 s passed: stop watching
    if (n >= 13 || (now && now !== document.body && now !== last)) window.clearInterval(timer);
  }, 150);
}

const FIELD = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';
/**
 * journey re-run J14r-1 (18/11, Major): a dialog / sheet opened while a popover or a menu closes (« Enregistrer la vue courante… »,
 * « Renommer… » of the « Vues » panel) lost the focus to the popover's trigger behind the overlay — typed letters went nowhere and Tab
 * walked the page behind the modal. While it opens (0.5 s), a focus outside the box is brought back to its first field (else its first
 * control); a focus already inside (the ✕, an autoFocus field) is left as it is. Radix's trap then keeps it inside.
 */
export function useFocusInside<T extends HTMLElement>(open: boolean) {
  const ref = React.useRef<T | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const fix = () => {
      const box = ref.current;
      if (!box || !box.isConnected || box.contains(document.activeElement)) return;
      const target = [...box.querySelectorAll<HTMLElement>(FIELD)].find(canFocus) ?? [...box.querySelectorAll<HTMLElement>(TABBABLE)].find(canFocus) ?? box;
      target.focus({ preventScroll: true });
    };
    const timers = [0, 60, 200, 500].map((ms) => window.setTimeout(fix, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open]);
  return ref;
}

/**
 * Esc pressed in an open combobox closes its list, never the dialog / sheet around it (journey J14-2: Esc in the product
 * search opened « Quitter sans enregistrer ? »). Radix reads Esc on the document before the field sees it.
 */
export const isInnerEscape = (e: KeyboardEvent) => {
  const el = (e.target ?? document.activeElement) as Element | null;
  return !!el?.closest?.('[role="combobox"][aria-expanded="true"]');
};

/* ---------- Dialog ---------- */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel,
  hideClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeLabel: string;
  /** blocking dialogs (legal re-acceptance): no ✕, Esc and outside clicks are ignored */
  hideClose?: boolean;
}) {
  const returnFocus = useReturnFocus(open);
  const box = useFocusInside<HTMLDivElement>(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <DialogPrimitive.Content
          ref={box}
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={(e) => (hideClose || isInnerEscape(e)) && e.preventDefault()}
          onInteractOutside={hideClose ? (e) => e.preventDefault() : undefined}
          // the title and the footer stay put; only the body scrolls when the dialog is taller than the screen (90 dvh:
          // the visible height on phones, under the browser bars)
          className={cn(
            'fixed start-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] -translate-y-1/2 flex-col rounded-card border border-line-edge bg-ink-surface p-5',
            'ltr:-translate-x-1/2 rtl:translate-x-1/2',
            size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : size === 'xl' ? 'max-w-4xl' : 'max-w-md',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4">
            <DialogPrimitive.Title className="ts-title">{title}</DialogPrimitive.Title>
            {hideClose ? null : (
              // MOBILE-A11Y-09: a 32 px target around the 16 px icon (it was 16 × 16 on phones)
              <DialogPrimitive.Close aria-label={closeLabel} className="-me-2 -mt-1.5 flex size-8 shrink-0 items-center justify-center rounded-card text-text-muted hover:text-text-primary">
                <X className="size-4" aria-hidden />
              </DialogPrimitive.Close>
            )}
          </div>
          {description ? (
            <DialogPrimitive.Description className="ts-label-meta mt-2 shrink-0 text-text-muted">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          {/* -mx-5 px-5: the scroll box spans the dialog so focus rings of full-width fields are not clipped */}
          {children ? <div className="-mx-5 mt-4 min-h-0 flex-1 overflow-y-auto px-5 py-0.5">{children}</div> : null}
          {footer ? <div className="mt-5 flex shrink-0 flex-wrap items-center justify-end gap-2">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmation dialog ("Quitter sans enregistrer ?", destructive confirmations). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive,
  loading,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
  closeLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeLabel={closeLabel}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/* ---------- Actions ⌄ dropdown (one per row, items driven by the server `actions` array) ---------- */
export type MenuAction = {
  key: string;
  label: string;
  onSelect?: () => void;
  primary?: boolean;
  destructive?: boolean;
  /** translated reason; the item is greyed and the reason is listed in the footer */
  disabledReason?: string;
  /** mono note on the end side: where the action leads (PAGE PRODUIT, DIALOGUE) or its shortcut (Enter, Del) */
  hint?: string;
  /** draws a separator above the item */
  separated?: boolean;
  /** one-letter keyboard shortcut (C, R, E, A…): fires the action from the open menu or from the focused trigger */
  shortcut?: string;
};
/** The enabled action of a one-letter shortcut key (no modifier), if any. */
export const shortcutAction = (actions: readonly MenuAction[], e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): MenuAction | null => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null;
  const k = e.key.toUpperCase();
  return actions.find((a) => a.shortcut && a.shortcut.toUpperCase() === k && !a.disabledReason && a.onSelect) ?? null;
};
export function ActionsMenu({
  label,
  actions,
  size = 'sm',
  align = 'end',
  heading,
  variant = 'secondary',
  iconOnly,
}: {
  label: string;
  actions: MenuAction[];
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  /** mono line on top of the menu (row identity: "PARFUM OUD 50 ML · PO-50") */
  heading?: string;
  variant?: 'secondary' | 'ghost';
  /** compact trigger "⋯" for narrow tables (variants editor); `label` stays its accessible name */
  iconOnly?: boolean;
}) {
  const disabled = actions.filter((a) => a.disabledReason);
  const [open, setOpen] = React.useState(false);
  // full-test 15/11 MOBILE-A11Y-06 (09-code-conventions: « shortcut key fires onSelect without opening »): the letters shown
  // in the menu work — from the open menu (instead of the type-ahead) and from the focused « Actions » button
  const onShortcut = (e: React.KeyboardEvent) => {
    const a = shortcutAction(actions, e);
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    a.onSelect?.();
  };
  if (!actions.length) return null;
  // « Envoyer : raison » in French (space before the colon), « Send: reason » in English / Arabic (full-test ORDERS-24);
  // the menu content renders on the client only (portal, when opened), so reading the page language is safe
  const sep = typeof document !== 'undefined' && !document.documentElement.lang.startsWith('fr') ? ': ' : ' : ';
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger asChild>
        {iconOnly ? (
          <Button size={size} variant={variant} aria-label={label} title={label} className="w-8 !px-0" onClick={(e) => e.stopPropagation()} onKeyDown={onShortcut}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button size={size} variant={variant} onClick={(e) => e.stopPropagation()} onKeyDown={onShortcut}>
            {label}
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        )}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          // long state menus (orders: up to 18 items) scroll inside the space left on screen instead of overflowing it
          className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-48 max-w-80 overflow-y-auto rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onShortcut}
        >
          {heading ? <Dropdown.Label className="truncate px-2.5 py-1.5 ts-label-micro text-text-muted">{heading}</Dropdown.Label> : null}
          {actions.map((a) => (
            <Dropdown.Item
              key={a.key}
              data-action={a.key}
              disabled={!!a.disabledReason}
              onSelect={a.onSelect}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-4 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-ink-raised-high',
                a.separated && 'mt-1 border-t border-line-hairline pt-2.5',
                a.primary && 'font-medium text-text-primary',
                a.destructive && 'text-accent-alert',
                a.disabledReason && 'cursor-not-allowed opacity-45',
              )}
            >
              <span>{a.label}</span>
              {a.hint ? <span className="ts-label-micro shrink-0 text-text-muted">{a.hint}</span> : null}
            </Dropdown.Item>
          ))}
          {disabled.length ? (
            <div className="mt-1 border-t border-line-hairline px-2.5 py-2 ts-label-meta text-text-muted">
              {disabled.map((a) => (
                <div key={a.key}>
                  {a.label}
                  {sep}
                  {a.disabledReason}
                </div>
              ))}
            </div>
          ) : null}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Generic menu (user menu, workspace switcher). */
export function Menu({ trigger, children, align = 'end' }: { trigger: React.ReactNode; children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={6} collisionPadding={8} className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52 overflow-y-auto rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl">
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function MenuItem({ className, ...rest }: React.ComponentProps<typeof Dropdown.Item>) {
  return (
    <Dropdown.Item
      className={cn('flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-ink-raised-high', className)}
      {...rest}
    />
  );
}
export const MenuSeparator = () => <Dropdown.Separator className="my-1 h-px bg-line-hairline" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <Dropdown.Label className="px-2.5 py-1.5 ts-label-micro text-text-muted">{children}</Dropdown.Label>
);

/* ---------- Tabs ---------- */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...rest }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex gap-1 overflow-x-auto border-b border-line-hairline', className)} {...rest} />;
}
export function TabsTrigger({ className, ...rest }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary',
        'data-[state=active]:border-white data-[state=active]:text-text-primary',
        className,
      )}
      {...rest}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/* ---------- Tooltip ---------- */
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-64 rounded-[6px] border border-line-edge bg-ink-raised-high px-2 py-1.5 text-[12px]">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ---------- Toasts: bottom-end, max 3, 5 s, optional action (GLOBAL frame) ---------- */
export type ToastInput = {
  tone?: Tone;
  message: string;
  action?: { label: string; onClick: () => void };
  /** 0 ⇒ stays until dismissed or updated (job progress) */
  durationMs?: number;
  /** 0–100: draws a progress line under the message (export / import jobs); null = indeterminate */
  progress?: number | null;
};
type ToastItem = ToastInput & { id: number };
let toasts: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const toast = (t: ToastInput | string) => {
  const item: ToastItem = { id: ++seq, tone: 'success', ...(typeof t === 'string' ? { message: t } : t) };
  toasts = [...toasts, item].slice(-3);
  emit();
  schedule(item.id, item.durationMs);
  return item.id;
};
const timers = new Map<number, number>();
const schedule = (id: number, durationMs: number | undefined) => {
  if (typeof window === 'undefined') return;
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  if (durationMs === 0) return;
  timers.set(id, window.setTimeout(() => dismissToast(id), durationMs ?? 5000));
};
/** Patches a visible toast (job progress → done). A new `durationMs` restarts its timer. */
export const updateToast = (id: number, patch: Partial<ToastInput>) => {
  if (!toasts.some((t) => t.id === id)) return false;
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
  if ('durationMs' in patch) schedule(id, patch.durationMs);
  return true;
};
export const dismissToast = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const EMPTY: ToastItem[] = [];

export function ToastRegion({ label, closeLabel }: { label: string; closeLabel: string }) {
  const items = React.useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
  return (
    <div role="region" aria-label={label} aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} data-toast={t.tone ?? 'success'} className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-card border border-line-edge bg-ink-raised px-3 py-2.5 text-[13px] shadow-xl">
          <span className={cn('size-2 shrink-0 rounded-full', toneDot[t.tone ?? 'success'])} />
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.progress !== undefined ? (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-raised-high">
              <span className={cn('block h-full bg-signal-live transition-[width]', t.progress === null && 'w-1/3 animate-pulse')} style={t.progress === null ? undefined : { width: `${Math.max(0, Math.min(100, t.progress))}%` }} />
            </span>
          ) : null}
          {t.action ? (
            <button
              type="button"
              // MOBILE-A11Y-09: at least 32 px high to tap on a phone (it was 12 px)
              className="-my-1.5 inline-flex min-h-8 items-center px-1 ts-label-meta text-accent-inbound hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" aria-label={closeLabel} className="-my-1.5 -me-1.5 flex size-8 shrink-0 items-center justify-center rounded-card text-text-muted hover:text-text-primary" onClick={() => dismissToast(t.id)}>
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
