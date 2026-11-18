'use client';
// 12-screen-states « Cash register » / 11 §CASH_DAY_CLOSED (« dialog: Rouvrir la journée, Admin+ ») — journey J06r-3: a sale,
// a collect, a refund or a payment refused because the day is closed says how to go on, not only « Journée du … clôturée. »:
// an Admin+ gets the link to the Caisse of that day (its banner holds « Rouvrir la journée »), a member is told to ask an
// admin; the counter-sale sheet adds that a draft is still accepted (it moves no money).
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** The closed day of a refused write (`409 CASH_DAY_CLOSED {date}`): its `yyyy-mm-dd`, '' when the server sent none, else null. */
export function closedDayOf(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.code !== 'CASH_DAY_CLOSED') return null;
  const d = e.body.params?.date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

export function ClosedDayHint({ day, draft = false }: { day: string | null | undefined; /** the sheet can still save a draft */ draft?: boolean }) {
  const t = useT();
  const { can } = useSession();
  if (day === null || day === undefined) return null;
  return (
    <span className="mt-1 block" data-testid="closed-day-hint">
      {can('gds.write') ? (
        <>
          {t('cash.closedHint.admin')}{' '}
          <Link href={day ? `/cash?day=${day}` : '/cash'} className="underline underline-offset-2 hover:text-text-primary">
            {t('cash.closedHint.reopen')}
          </Link>
        </>
      ) : (
        t('cash.closedHint.member')
      )}
      {draft ? ` ${t('cash.closedHint.draft')}` : null}
    </span>
  );
}
