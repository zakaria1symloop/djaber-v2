'use client';
// ADM-08 « Aperçu » of an announcement (tester log 26/10 UX-035): the announcement as the clients will see it, per locale —
// the banner at the top of the merchant app, the bell notification that opens it, the strip of the public site — each with
// its « En savoir plus » when a link is set. Opened from the row « Actions » (saved entry) and from the editor (the draft).
import type { CmsEntryAdminDto } from '@djaber/shared';
import { Banner, Dialog, MonoChip, PillTabs } from '@djaber/ui';
import { Bell, Megaphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { announcementLink } from '@/features/announcements/links';
import { useT } from '@/lib/i18n';

type Loc = 'fr' | 'ar' | 'en';
const LOCALES: Loc[] = ['fr', 'ar', 'en'];
/** The text of an announcement in each locale, with « replier sur FR » applied (what the client gets). */
export type AnnouncementText = Record<Loc, { title: string; body: string; fallback: boolean }>;

export const announcementTextOf = (locales: Record<Loc, { title: string; body: string }>, fallbackToFr: boolean): AnnouncementText =>
  Object.fromEntries(
    LOCALES.map((l) => {
      const own = locales[l];
      const empty = !own.title.trim() || !own.body.trim();
      return [l, empty && fallbackToFr && l !== 'fr' ? { ...locales.fr, fallback: true } : { ...own, fallback: false }];
    }),
  ) as AnnouncementText;

export const entryText = (e: CmsEntryAdminDto): AnnouncementText =>
  announcementTextOf(
    Object.fromEntries(LOCALES.map((l) => [l, { title: e.locales.find((x) => x.locale === l)?.title ?? '', body: e.locales.find((x) => x.locale === l)?.body ?? '' }])) as Record<Loc, { title: string; body: string }>,
    e.locales.some((x) => x.fallbackToFr),
  );

export function AnnouncementPreviewDialog({ open, onClose, text, channels, link }: { open: boolean; onClose: () => void; text: AnnouncementText; channels: string[]; link: string | null }) {
  const t = useT();
  const [loc, setLoc] = useState<Loc>('fr');
  const a = text[loc];
  const more = announcementLink(link) ? t('announcements.more') : null;
  const excerpt = (max: number) => (a.body ? a.body.split('\n')[0]!.slice(0, max) : '');
  const off = (c: string) => (!channels.includes(c) ? t('admin.cms.preview.notSent') : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('admin.cms.preview.title')} description={t('admin.cms.preview.context')} closeLabel={t('action.close')} size="lg">
      <div className="flex flex-col gap-4" data-testid="cms-announcement-preview">
        <PillTabs label={t('admin.cms.preview.locale')} value={loc} onChange={(k) => setLoc(k as Loc)} tabs={LOCALES.map((l) => ({ key: l, label: l.toUpperCase() }))} />
        {!a.title.trim() ? <p className="ts-label-meta text-text-muted">{t('admin.cms.preview.missing', { locale: loc.toUpperCase() })}</p> : null}
        {a.fallback ? <p className="ts-label-micro !normal-case text-text-muted">{t('announcements.fallback')}</p> : null}
        <div lang={a.fallback ? 'fr' : loc} dir={loc === 'ar' && !a.fallback ? 'rtl' : 'ltr'} className="flex flex-col gap-4">
          <Section channel="banner" label={t('admin.cms.channel.banner')} off={off('banner')}>
            <Banner tone="info" action={more ? { label: more, onClick: () => undefined } : undefined} onDismiss={() => undefined} dismissLabel={t('action.close')}>
              <strong className="font-medium">{a.title || '—'}</strong>
              {a.body ? <span className="text-text-secondary"> — {excerpt(200)}</span> : null}
            </Banner>
          </Section>
          <Section channel="in_app" label={t('admin.cms.preview.notification')} off={off('in_app')}>
            <div className="flex items-start gap-3 rounded-card border border-line-edge bg-ink-surface px-3 py-2.5 text-[13px]">
              <Bell className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text-primary">{a.title || '—'}</div>
                {a.body ? <div className="truncate text-text-secondary">{excerpt(140)}</div> : null}
              </div>
              <MonoChip className="shrink-0">{t('admin.cms.preview.now')}</MonoChip>
            </div>
          </Section>
          <Section channel="web" label={t('admin.cms.channel.web')} off={off('web')}>
            <div className="flex items-start gap-2 rounded-card border border-line-hairline bg-ink-surface px-3 py-2.5 text-[13px] text-text-secondary">
              <Megaphone className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <p className="min-w-0 flex-1">
                <strong className="font-medium text-text-primary">{a.title || '—'}</strong>
                {a.body ? <> — {excerpt(240)}</> : null}
                {more ? <span className="ms-1 text-text-primary underline underline-offset-2">{more}</span> : null}
              </p>
            </div>
          </Section>
        </div>
        {link ? (
          <p className="ts-label-micro !normal-case text-text-muted">
            {t('admin.cms.preview.link')} <span dir="ltr" className="font-mono">{link}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** One channel of the preview; `off` = « not sent on this channel » (the channel is not ticked), shown dimmed. */
function Section({ channel, label, off, children }: { channel: string; label: string; off: string | null; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5" data-preview-channel={channel} data-off={off ? true : undefined}>
      <div className="flex items-center gap-2">
        <span className="ts-label-micro uppercase text-text-muted">{label}</span>
        {off ? <span className="ts-label-micro !normal-case text-text-muted">{off}</span> : null}
      </div>
      <div className={off ? 'opacity-50' : undefined}>{children}</div>
    </section>
  );
}
