'use client';
// Form helpers (02-next-route-map §6): server `fields` → inputs, unknown field ⇒ form-level alert, leave guard.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { LeaveGuardDialog } from '@/components/global-states';
import { ApiError } from './api';
import { stripPlaceholders } from './format-message';
import type { TFunction } from './i18n';

/** Message of any thrown value, already localized by the API when it is an `ApiError`. */
export const errorMessage = (e: unknown, t: TFunction): string => {
  if (e instanceof ApiError) {
    const key = `error.${e.code}`;
    // the server message carries the interpolated params; the catalogue is the fallback (network / proxy errors)
    return (e.message && stripPlaceholders(e.message)) || (t.has(key) ? t(key, e.body.params) : t('state.list.error.title'));
  }
  return t('toast.noConnection');
};
export const errorCode = (e: unknown): string | null => (e instanceof ApiError ? e.code : null);

/**
 * The message of one error of a per-row result (bulk results window, import report) — UX-059: the sentence only, never
 * the code first. The server message is already localized; the catalogue is the fallback.
 */
export const rowErrorText = (t: TFunction, e: { code: string; message?: string | null; params?: Record<string, unknown> | null } | null | undefined): string => {
  if (!e) return '';
  if (e.message) return stripPlaceholders(e.message);
  const key = `error.${e.code}`;
  return t.has(key) ? t(key, (e.params ?? undefined) as Record<string, string | number> | undefined) : t('state.list.error.title');
};

/** Translates a validation message key (`validation.length`) with the limits of the field. */
export const fieldError = (t: TFunction, message: string | undefined, params?: Record<string, string | number>): string | undefined => {
  if (!message) return undefined;
  return t.has(message) ? t(message, { max: '', min: '', ...params }) : message;
};

/**
 * Maps the error envelope onto the form: `fields` → `setError(field)`, codes listed in `codeToField` → that field,
 * everything else → returned as the form-level message (shown in a `FormAlert`, content preserved).
 */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  e: unknown,
  t: TFunction,
  opts: { fields: readonly Path<T>[]; codeToField?: Record<string, Path<T>> } = { fields: [] },
): string | null {
  if (!(e instanceof ApiError)) return t('toast.noConnection');
  let mapped = 0;
  let unknown = 0;
  for (const [field, key] of Object.entries(e.body.fields ?? {})) {
    if ((opts.fields as readonly string[]).includes(field)) {
      form.setError(field as Path<T>, { type: 'server', message: key });
      mapped++;
    } else unknown++;
  }
  const direct = opts.codeToField?.[e.code];
  if (direct) {
    form.setError(direct, { type: 'server', message: errorMessage(e, t) });
    return null;
  }
  if (mapped > 0 && unknown === 0) return null;
  return errorMessage(e, t);
}

/**
 * Leave guard for dirty forms: warns on tab close / reload and intercepts in-app link clicks with the
 * "Quitter sans enregistrer ?" dialog. Render the returned `guard` element once in the page. `onLeave` runs when the
 * merchant confirms leaving (e.g. a form kept in sessionStorage drops its copy); `ask(href)` opens the same dialog for a
 * programmatic exit ("Annuler" buttons).
 */
export function useLeaveGuard(dirty: boolean, name: string, onLeave?: () => void) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
      if (a.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(a.href);
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const leave = useCallback(() => {
    const href = pending;
    setPending(null);
    if (!href) return;
    onLeaveRef.current?.();
    const u = new URL(href, window.location.origin);
    // programmatic navigation is not intercepted by the click listener above
    router.push(u.pathname + u.search + u.hash);
  }, [pending, router]);

  const guard = <LeaveGuardDialog open={pending !== null} name={name} onStay={() => setPending(null)} onLeave={leave} />;
  /** A programmatic exit to `href` (a full path, locale included): asks first when the form is dirty, else leaves at once (running `onLeave`). */
  const ask = useCallback(
    (href: string) => {
      if (dirty) return setPending(href);
      onLeaveRef.current?.();
      router.push(href);
    },
    [dirty, router],
  );
  return { guard, ask };
}
