'use client';
// `useT()` — flat keys of the shared catalogue (06-i18n-copy-deck: `nav.home`, `error.NOT_FOUND`, …), ICU formatting.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeT, type Flat, type TFunction } from './format-message';

export { formatMessage, type TFunction } from './format-message';

const Ctx = createContext<{ locale: string; messages: Flat }>({ locale: 'fr', messages: {} });

export function MessagesProvider({ locale, messages, children }: { locale: string; messages: Flat; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): TFunction {
  const { locale, messages } = useContext(Ctx);
  return useMemo(() => makeT(locale, messages), [locale, messages]);
}

export const useLocaleCode = () => useContext(Ctx).locale;
/** The flat catalogue in use (a provider below can override a few keys, e.g. the impersonation read-only reason). */
export const useMessages = () => useContext(Ctx).messages;
