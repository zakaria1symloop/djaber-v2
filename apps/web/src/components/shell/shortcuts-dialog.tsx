'use client';
// « Raccourcis clavier » (GLOBAL system dialog, 02-next-route-map §2.1 « `?` opens shortcuts help »): `?` outside a text
// field opens it (full-test 15/11 MOBILE-A11Y-06: the key did nothing). The keys listed are the ones that work.
import { Dialog } from '@djaber/ui';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable="true"]'));

export function ShortcutsDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const rows: { keys: string; desc: string }[] = [
    { keys: t('shortcuts.enterShiftEnter'), desc: t('shortcuts.enterShiftEnter.desc') },
    { keys: t('shortcuts.esc'), desc: t('shortcuts.esc.desc') },
    { keys: '← →', desc: t('shortcuts.arrows.desc') },
    { keys: '/', desc: t('shortcuts.slash.desc') },
    { keys: 'C · R · M · E · A · P', desc: t('shortcuts.rowActions.desc') },
    { keys: 'Ctrl+K', desc: t('shortcuts.ctrlK.desc') },
    { keys: '?', desc: t('shortcuts.help.desc') },
  ];
  return (
    <Dialog open={open} onOpenChange={setOpen} title={t('dialog.shortcuts.title')} closeLabel={t('action.close')}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]" data-testid="shortcuts-dialog">
        {rows.map((r) => (
          <div key={r.keys} className="contents">
            <dt>
              <kbd dir="ltr" className="inline-block rounded-[4px] border border-line-edge bg-ink-raised px-1.5 py-0.5 font-mono text-[12px] text-text-primary">
                {r.keys}
              </kbd>
            </dt>
            <dd className="text-text-secondary">{r.desc}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
