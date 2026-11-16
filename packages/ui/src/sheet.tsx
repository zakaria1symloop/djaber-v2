'use client';
// SideSheet (02-next-route-map §5): quick-edit / detail panel on the end side, opened over a list without navigation.
// Esc closes, the body scrolls, ‹ › (and ← → keys, mirrored in RTL) walk the rows of the list behind it.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import * as React from 'react';
import { useReturnFocus } from './overlays';
import { Button, cn } from './primitives';

export type SheetNav = { onPrev?: () => void; onNext?: () => void; position?: string; prevLabel: string; nextLabel: string };

export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  media,
  headerAction,
  nav,
  footer,
  status,
  width = 440,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** grey mono line under the title (SKU · CATÉGORIE · …) */
  subtitle?: React.ReactNode;
  /** thumbnail on the start side of the title */
  media?: React.ReactNode;
  /** link / button next to the ✕ ("Fiche complète") */
  headerAction?: React.ReactNode;
  nav?: SheetNav;
  /** fixed actions on the end side of the footer */
  footer?: React.ReactNode;
  /** save status on the start side of the footer ("● Prix modifié · enregistré") */
  status?: React.ReactNode;
  width?: 420 | 440 | 460;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!nav) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable], [role=radiogroup], [role=tablist]')) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') && nav.onPrev) {
      e.preventDefault();
      nav.onPrev();
    } else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') && nav.onNext) {
      e.preventDefault();
      nav.onNext();
    }
  };
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          onCloseAutoFocus={returnFocus}
          onKeyDown={onKeyDown}
          style={{ maxWidth: width }}
          className="fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line-edge bg-ink-surface shadow-2xl focus:outline-none"
        >
          <header className="flex items-start gap-3 border-b border-line-hairline px-5 py-4">
            {media}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="ts-display-s truncate" title={title}>
                {title}
              </DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="ts-label-meta mt-1 truncate uppercase text-text-muted">{subtitle}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            {headerAction}
            {/* MOBILE-A11Y-09: a 32 px target around the 16 px icon */}
            <DialogPrimitive.Close aria-label={closeLabel} className="-me-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-card text-text-muted hover:text-text-primary">
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer || nav || status ? (
            <footer className="flex flex-wrap items-center gap-2 border-t border-line-hairline px-5 py-3">
              <div className="min-w-0 flex-1 ts-label-meta text-text-muted" aria-live="polite">
                {status}
              </div>
              {nav ? (
                <>
                  <Button size="sm" variant="ghost" disabled={!nav.onPrev} onClick={nav.onPrev}>
                    <ChevronLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
                    {nav.prevLabel}
                  </Button>
                  {nav.position ? <span className="ts-label-meta tabular-nums text-text-muted">{nav.position}</span> : null}
                  <Button size="sm" variant="ghost" disabled={!nav.onNext} onClick={nav.onNext}>
                    {nav.nextLabel}
                    <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                  </Button>
                </>
              ) : null}
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Section of a sheet / panel: mono label on the start side, model or hint note on the end side. */
export function SheetSection({ label, note, children, className }: { label: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="ts-label-section text-text-muted">{label}</h3>
        {note ? <span className="ts-label-micro truncate text-text-muted">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}
