// 04 §20 locked day — the date of an automatic cash row (journeys 16/11 J06-1: rows written into a closed day).
import type { Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { algiersDay, algiersDayStart } from '../../core/time/algiers';
import { cashDate } from './cash-rows';

const DAY = 86_400_000;
const fakeTx = (closed: string[]) =>
  ({
    cashClosing: {
      findFirst: async ({ where }: { where: { day: Date } }) => (closed.includes(where.day.toISOString().slice(0, 10)) ? { id: 'c' } : null),
    },
  }) as unknown as Tx;

describe('cashDate (04 §20)', () => {
  const today = algiersDay();
  const yesterday = algiersDay(new Date(Date.now() - DAY));
  const tomorrow = algiersDay(new Date(Date.now() + DAY));

  it('keeps the effective date of an open day', async () => {
    const at = new Date(Date.now() - DAY);
    expect(await cashDate(fakeTx([]), at)).toBe(at);
    const now = new Date();
    expect(await cashDate(fakeTx([]), now)).toBe(now);
  });

  it('a closed earlier day ⇒ today', async () => {
    const d = await cashDate(fakeTx([yesterday]), new Date(Date.now() - DAY));
    expect(algiersDay(d)).toBe(today);
  });

  it('today closed ⇒ a member action is refused with CASH_DAY_CLOSED {date: today}', async () => {
    await expect(cashDate(fakeTx([today]), new Date())).rejects.toBeInstanceOf(AppException);
    await expect(cashDate(fakeTx([yesterday, today]), new Date(Date.now() - DAY))).rejects.toMatchObject({ code: 'CASH_DAY_CLOSED' });
  });

  it('today closed ⇒ a system event is booked at the start of the next open day', async () => {
    expect(await cashDate(fakeTx([today]), new Date(), 'next')).toEqual(algiersDayStart(tomorrow));
  });
});
