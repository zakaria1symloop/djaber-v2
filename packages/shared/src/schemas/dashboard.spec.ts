// 12 §18 — order of the Home "À traiter" cards (UX-065): urgency, then age (oldest first), then key; at most 8 shown.
import { describe, expect, it } from 'vitest';
import { compareHomeQueueItems, HOME_QUEUE_MAX, type HomeQueueItem } from './dashboard';

const card = (key: string, urgency: 0 | 1 | 2, since: string): Pick<HomeQueueItem, 'key' | 'urgency' | 'since'> => ({ key, urgency, since });
const pick = (items: Pick<HomeQueueItem, 'key' | 'urgency' | 'since'>[]) => [...items].sort(compareHomeQueueItems).slice(0, HOME_QUEUE_MAX).map((i) => i.key);

describe('compareHomeQueueItems (12 §18 urgency then age)', () => {
  it('urgency first, then the oldest, then the key (deterministic on equal ages)', () => {
    const items = [
      card('stock:b', 0, '2026-11-12T10:00:00.000Z'),
      card('insight:x', 2, '2026-11-01T10:00:00.000Z'),
      card('stock:a', 0, '2026-11-12T10:00:00.000Z'),
      card('parcel:p', 0, '2026-11-11T08:00:00.000Z'),
      card('stock:low', 1, '2026-11-10T16:33:00.000Z'),
    ];
    expect([...items].sort(compareHomeQueueItems).map((i) => i.key)).toEqual(['parcel:p', 'stock:a', 'stock:b', 'stock:low', 'insight:x']);
  });

  it('UX-065: two new stock-outs never push older unhandled stock-outs out of the 8 slots', () => {
    const before = [
      card('parcel:1008', 0, '2026-11-11T08:00:00.000Z'),
      ...Array.from({ length: 9 }, (_, n) => card(`stock:old-${n}`, 0, `2026-11-1${n % 2}T1${n}:00:00.000Z`)),
      card('insight:1', 2, '2026-11-09T10:00:00.000Z'),
    ];
    const shown = pick(before);
    const after = pick([...before, card('stock:new-b', 0, '2026-11-12T15:55:00.000Z'), card('stock:new-c', 0, '2026-11-12T15:56:00.000Z')]);
    expect(after).toEqual(shown);
    expect(after).not.toContain('stock:new-b');
  });

  it('a newer stock-out is drawn once older cards are handled', () => {
    const items = [...Array.from({ length: 8 }, (_, n) => card(`stock:old-${n}`, 0, `2026-11-10T1${n}:00:00.000Z`)), card('stock:new', 0, '2026-11-12T15:55:00.000Z')];
    expect(pick(items)).not.toContain('stock:new');
    expect(pick(items.slice(1))).toContain('stock:new');
  });
});
