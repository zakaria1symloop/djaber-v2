// MSG-06 / 04 §23 — the 24 h window matrix, table-driven.
import { decideWindow, withinWindow, type SendKind } from './window-rules';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
const SEND = { action: 'send', messagingType: 'RESPONSE' };
const HUMAN_AGENT = { action: 'send', messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' };
const SKIP = { action: 'skip' };
const REJECT = { action: 'reject', code: 'REPLY_OUTSIDE_WINDOW' };

describe('decideWindow', () => {
  const rows: [platform: 'facebook' | 'instagram', kind: SendKind, hoursSinceCustomer: number | null, expected: object][] = [
    // inside 24 h: everything is a standard send, on both platforms
    ['facebook', 'ai', 0.1, SEND],
    ['facebook', 'human', 23.9, SEND],
    ['facebook', 'transactional', 12, SEND],
    ['facebook', 'system', 1, SEND],
    ['instagram', 'ai', 0.1, SEND],
    ['instagram', 'human', 23.9, SEND],
    ['instagram', 'transactional', 12, SEND],
    ['instagram', 'system', 1, SEND],
    // Messenger outside 24 h
    ['facebook', 'ai', 24, SKIP], // the AI never uses a tag
    ['facebook', 'ai', 200, SKIP],
    ['facebook', 'system', 25, SKIP],
    ['facebook', 'human', 24, HUMAN_AGENT],
    ['facebook', 'human', 24 * 7 - 0.1, HUMAN_AGENT],
    ['facebook', 'human', 24 * 7, REJECT], // HUMAN_AGENT lasts 7 days
    ['facebook', 'human', 24 * 30, REJECT],
    // POST_PURCHASE_UPDATE is retired by Meta (#100 from 2026-04-27): an order notification outside 24 h is not sent
    ['facebook', 'transactional', 25, SKIP],
    ['facebook', 'transactional', 24 * 30, SKIP],
    // Instagram outside 24 h: nothing can be sent
    ['instagram', 'ai', 24, SKIP],
    ['instagram', 'system', 30, SKIP],
    ['instagram', 'transactional', 25, SKIP],
    ['instagram', 'human', 24, REJECT],
    ['instagram', 'human', 24 * 3, REJECT],
    // the customer never wrote (page-initiated thread, imported history)
    ['facebook', 'ai', null, SKIP],
    ['facebook', 'human', null, REJECT],
    ['facebook', 'transactional', null, SKIP],
    ['instagram', 'human', null, REJECT],
    ['instagram', 'transactional', null, SKIP],
  ];
  it.each(rows)('%s · %s · %s h since the last customer message', (platform, kind, hours, expected) => {
    expect(decideWindow({ platform, kind, lastCustomerMessageAt: hours === null ? null : ago(hours), now: NOW, humanAgent: true })).toEqual(expected);
  });

  it('without the Human Agent approval (META_HUMAN_AGENT_TAG off) a member reply outside 24 h is refused on Messenger too (#100/2018276)', () => {
    for (const hours of [24, 30, 24 * 7 - 0.1, 24 * 7]) expect(decideWindow({ platform: 'facebook', kind: 'human', lastCustomerMessageAt: ago(hours), now: NOW })).toEqual(REJECT);
    expect(decideWindow({ platform: 'facebook', kind: 'human', lastCustomerMessageAt: ago(23.9), now: NOW })).toEqual(SEND);
  });

  it('the window closes exactly 24 h after the customer message', () => {
    expect(withinWindow(ago(24 - 1 / 3600), NOW)).toBe(true);
    expect(withinWindow(ago(24), NOW)).toBe(false);
    expect(withinWindow(null, NOW)).toBe(false);
    expect(withinWindow(undefined, NOW)).toBe(false);
    // a message timestamped slightly in the future (clock skew) is inside
    expect(withinWindow(new Date(NOW.getTime() + 5000), NOW)).toBe(true);
  });
});
