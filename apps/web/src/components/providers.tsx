'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastRegion } from '@djaber/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiSession } from '@/lib/api';
import { MessagesProvider, useT } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';

function Toasts() {
  const t = useT();
  return <ToastRegion label={t('nav.notifications')} closeLabel={t('action.close')} />;
}

export function Providers({ locale, messages, children }: { locale: string; messages: Record<string, string>; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // never retry client errors (403/404/422…): the UI shows the matching state immediately
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
  );
  // the locale must reach the API client before the first request (session boot runs in the first effect pass)
  if (apiSession.get().locale !== locale) apiSession.set({ locale });
  const shownLocale = useRef(locale);
  useEffect(() => {
    apiSession.set({ locale });
    // UX-046 (10/11): texts built by the server in the request's language (fee note, order history, …) are fetched
    // again in the new language instead of staying in the previous one until they go stale
    if (shownLocale.current !== locale) {
      shownLocale.current = locale;
      void client.invalidateQueries();
    }
  }, [locale, client]);
  return (
    <MessagesProvider locale={locale} messages={messages}>
      <QueryClientProvider client={client}>
        <SessionProvider>{children}</SessionProvider>
        <Toasts />
      </QueryClientProvider>
    </MessagesProvider>
  );
}
