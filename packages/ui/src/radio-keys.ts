// Keyboard of a custom radio group made of buttons (`role="radiogroup"` › `role="radio"`): WAI-ARIA radio group pattern —
// one Tab stop (the checked radio, the first one when none is checked), arrows move the focus and the selection, Home /
// End jump to the ends; left / right follow the reading direction (full-test 15/11 HELP-13, ONBOARDING-13).
import type * as React from 'react';

/** `tabIndex` of radio `index` (roving tab stop). */
export const radioTabIndex = (index: number, selectedIndex: number): 0 | -1 => (selectedIndex < 0 ? (index === 0 ? 0 : -1) : index === selectedIndex ? 0 : -1);

/** The radio to move to for a key, or null when the key is not a radio-group key. */
export function radioKeyTarget(key: string, index: number, count: number, rtl = false): number | null {
  if (count <= 0) return null;
  const next = (i: number) => (i + 1) % count;
  const prev = (i: number) => (i - 1 + count) % count;
  switch (key) {
    case 'ArrowDown':
      return next(index);
    case 'ArrowUp':
      return prev(index);
    case 'ArrowRight':
      return rtl ? prev(index) : next(index);
    case 'ArrowLeft':
      return rtl ? next(index) : prev(index);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * `onKeyDown` of radio `index`: moves the focus to the target radio of the same group (skipping disabled ones is left to
 * the caller's `select`) and selects it.
 */
export function onRadioKeyDown(e: React.KeyboardEvent<HTMLElement>, index: number, count: number, select: (index: number) => void) {
  const group = e.currentTarget.closest('[role="radiogroup"]');
  const rtl = !!e.currentTarget.closest('[dir="rtl"]') && getComputedStyle(e.currentTarget).direction === 'rtl';
  const target = radioKeyTarget(e.key, index, count, rtl);
  if (target === null) return;
  e.preventDefault();
  const radios = group ? Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')) : [];
  radios[target]?.focus();
  select(target);
}

/**
 * `onKeyDown` of a radio that does not know its index: the radios of the closest `role="radiogroup"` are read from the
 * page; the target radio is focused and clicked (its own `onClick` selects it). Disabled radios are skipped.
 */
export function onRadioGroupKeyDown(e: React.KeyboardEvent<HTMLElement>, o: { select?: boolean } = {}) {
  const group = e.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter((r) => !r.hasAttribute('disabled') && r.getAttribute('aria-disabled') !== 'true');
  const index = radios.indexOf(e.currentTarget);
  if (index < 0) return;
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
  const target = radioKeyTarget(e.key, index, radios.length, rtl);
  if (target === null) return;
  e.preventDefault();
  radios[target]!.focus();
  // `select: false` when choosing has a side effect (a setting saved at once): the arrows only move, Space / Enter choose
  if (o.select !== false) radios[target]!.click();
}
