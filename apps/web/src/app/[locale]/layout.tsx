import type { Metadata } from 'next';
import { Changa, Geist, JetBrains_Mono, Syne } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { isAppLocale, isRtl } from '@djaber/shared';
import { Providers } from '@/components/providers';
import { routing } from '@/i18n/routing';
import { publicMessages } from '@/lib/server-messages';
import '../globals.css';

const syne = Syne({ subsets: ['latin'], weight: ['700'], variable: '--f-syne', display: 'swap' });
const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--f-geist', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500'], variable: '--f-mono', display: 'swap' });
const changa = Changa({ subsets: ['arabic', 'latin'], weight: ['400', '500', '700'], variable: '--f-changa', display: 'swap' });

export const metadata: Metadata = { title: 'Djaber.ai', description: 'Agent IA de vente pour les e-commerçants algériens' };

export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  setRequestLocale(locale);
  // PUBLIC-04: only the public subset here; (app) / (admin) / (onboarding) add the rest (lib/server-messages.tsx)
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} className={`${syne.variable} ${geist.variable} ${mono.variable} ${changa.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={{}} timeZone="Africa/Algiers">
          <Providers locale={locale} messages={publicMessages(locale)}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
