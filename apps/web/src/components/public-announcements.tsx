// Public site strip of the platform announcements published on the « Web public » channel and meant for every workspace
// (`GET /cms/announcements`, tester report 2026-10-21 UX-005). Server-rendered below the header; nothing when there is
// none or when the API does not answer (the page itself stays usable).
import type { AnnouncementView, AppLocale } from '@djaber/shared';
import { Megaphone } from 'lucide-react';
import { announcementLink } from '@/features/announcements/links';
import { Link } from '@/i18n/navigation';
import { publicGet, serverT } from '@/lib/public-fetch';

export async function PublicAnnouncements({ locale }: { locale: AppLocale }) {
  const r = await publicGet<AnnouncementView[]>('/cms/announcements', { locale, query: { lang: locale } });
  if (!r.ok || !r.data.length) return null;
  const t = serverT(locale);
  return (
    <div className="border-b border-line-hairline bg-ink-surface" data-testid="public-announcements">
      <ul className="mx-auto flex max-w-[1344px] flex-col gap-1 px-4 py-2.5 md:px-12">
        {r.data.map((a) => {
          const link = announcementLink(a.link);
          return (
            <li key={a.id} className="flex items-start gap-2 text-[13px] text-text-secondary" data-id={a.id}>
              <Megaphone className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <p className="min-w-0 flex-1">
                <strong className="font-medium text-text-primary">{a.title}</strong>
                {a.body ? <> — {a.body.split('\n')[0]!.slice(0, 240)}</> : null}
                {link ? (
                  <>
                    {' '}
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-text-primary underline underline-offset-2">
                        {t('announcements.more')}
                      </a>
                    ) : (
                      <Link href={link.href} className="text-text-primary underline underline-offset-2">
                        {t('announcements.more')}
                      </Link>
                    )}
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
