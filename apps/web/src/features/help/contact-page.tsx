'use client';
// `/help/contact` — the contact form on its own page (HELP-03; same form as the HELP frame card). Reached from the "?"
// panel, the suspended page ("Contacter le support") and error states; `?from=` = page of origin for the auto-context.
import { HelpCard } from '@djaber/ui';
import { useSearchParams } from 'next/navigation';
import { AppPage } from '@/components/app-page';
import { useT } from '@/lib/i18n';
import { ContactForm } from './contact-form';
import { safeFrom } from './logic';

export function ContactPage() {
  const t = useT();
  const from = safeFrom(useSearchParams().get('from'));
  return (
    <AppPage title={t('help.contact.title')} permission="support.write" back={{ href: '/help', label: t('nav.help') }}>
      <HelpCard title={t('help.contact.formTitle')} sub={t('help.contact.sub')}>
        <ContactForm from={from} />
      </HelpCard>
    </AppPage>
  );
}
