// UX-056 remark (UX/UI test log 12/11): « each Refresh adds another "Shipment created" line to the parcel tracking ».
// Courier events are idempotent (05-integrations §2.6): identity = raw status + courier time against every stored line,
// no courier time ⇒ same raw as the parcel holds, the creation is one line. The screens drop the lines stored twice before.
import { dedupeTimeline, isKnownCourierEvent, type TimelineEvent } from './tracking-rules';
import { syncAvailability, syncAvailableFromTtl, syncCooldownKey } from './sync-cooldown';

const T0 = new Date('2026-11-12T09:00:00Z'); // the courier's own creation time
const SENT_AT = new Date('2026-11-12T09:00:04Z'); // Djaber's « sent » line, written after the courier answered
const created: TimelineEvent = { rawStatus: 'sent', mappedStatus: 'sent', at: SENT_AT, source: 'system' };

describe('isKnownCourierEvent', () => {
  it('the courier creation line older than Djaber’s « sent » line is not added again on each refresh (the 12/11 bug)', () => {
    const courier: TimelineEvent = { rawStatus: 'Prêt à expédier', mappedStatus: 'sent', at: T0, source: 'poll' };
    // first refresh: the creation is already shown once (Djaber's line) ⇒ no second « Colis créé »
    expect(isKnownCourierEvent([created], { rawStatus: courier.rawStatus, mapped: 'sent', at: T0 })).toBe(true);
    // a timeline that already holds the courier line (older than the newest) ⇒ known whatever the newest line is
    const later: TimelineEvent = { rawStatus: 'manual_note', mappedStatus: null, at: new Date('2026-11-12T10:00:00Z'), source: 'manual' };
    expect(isKnownCourierEvent([courier, created, later], { rawStatus: 'Prêt à expédier', mapped: 'sent', at: new Date(T0.getTime() + 500) })).toBe(true);
  });
  it('same raw status at the same courier time (±1 s) ⇒ known; another time ⇒ a new line (a second hub scan)', () => {
    const scan: TimelineEvent = { rawStatus: 'En transit', mappedStatus: 'in_transit', at: new Date('2026-11-13T08:00:00Z'), source: 'poll' };
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'En transit', mapped: 'in_transit', at: new Date('2026-11-13T08:00:00.800Z') })).toBe(true);
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'En transit', mapped: 'in_transit', at: new Date('2026-11-13T15:00:00Z') })).toBe(false);
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'En livraison', mapped: 'out_for_delivery', at: new Date('2026-11-13T08:00:00Z') })).toBe(false);
  });
  it('no courier time: the raw status the parcel already holds (or its newest line) is the same report', () => {
    const scan: TimelineEvent = { rawStatus: 'En transit', mappedStatus: 'in_transit', at: new Date('2026-11-13T08:00:00Z'), source: 'poll' };
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'En transit', mapped: 'in_transit', at: null }, 'En transit')).toBe(true);
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'En transit', mapped: 'in_transit', at: null }, null)).toBe(true);
    expect(isKnownCourierEvent([created, scan], { rawStatus: 'Echec livraison', mapped: 'failed', at: null }, 'En transit')).toBe(false);
  });
  it('a first courier event on an empty timeline is new', () => {
    expect(isKnownCourierEvent([], { rawStatus: 'Ramassé', mapped: 'picked_up', at: T0 })).toBe(false);
  });
});

describe('dedupeTimeline (screens)', () => {
  it('drops the courier « sent » lines stored by each refresh before the fix, keeps Djaber’s lines and real moves', () => {
    const dup = (i: number): TimelineEvent => ({ rawStatus: 'Prêt à expédier', mappedStatus: 'sent', at: T0, source: 'poll', ...{ i } });
    const moved: TimelineEvent = { rawStatus: 'Ramassé', mappedStatus: 'picked_up', at: new Date('2026-11-13T07:00:00Z'), source: 'poll' };
    const mark: TimelineEvent = { rawStatus: 'failed', mappedStatus: 'failed', at: new Date('2026-11-13T09:00:00Z'), source: 'manual' };
    const newestFirst = [mark, moved, created, dup(1), dup(2), dup(3)];
    expect(dedupeTimeline(newestFirst)).toEqual([mark, moved, created]);
  });
  it('keeps the given order and every line when nothing repeats', () => {
    const a: TimelineEvent = { rawStatus: 'Ramassé', mappedStatus: 'picked_up', at: new Date('2026-11-13T07:00:00Z'), source: 'webhook' };
    expect(dedupeTimeline([a, created])).toEqual([a, created]);
  });
});

describe('« Actualiser » wait (Redis TTL)', () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  it('TTL seconds ⇒ the instant it is allowed again; no key / expired ⇒ null', () => {
    expect(syncAvailableFromTtl(240, now)).toBe('2026-11-14T10:04:00.000Z');
    expect(syncAvailableFromTtl(-2, now)).toBeNull();
    expect(syncAvailableFromTtl(-1, now)).toBeNull();
    expect(syncAvailableFromTtl(null, now)).toBeNull();
  });
  it('one pipeline for a whole list page; only the parcels waiting are returned', async () => {
    const asked: string[] = [];
    const ttl = new Map([[syncCooldownKey('s1'), 54], [syncCooldownKey('s2'), -2]]);
    const pipe = { ttl: (k: string) => (asked.push(k), pipe), exec: async () => asked.map((k) => [null, ttl.get(k) ?? -2] as [null, number]) };
    const redis = { client: { pipeline: () => pipe } } as never;
    const waits = await syncAvailability(redis, ['s1', 's2', 's1', 's3'], now);
    expect(asked).toEqual(['trk:manual:s1', 'trk:manual:s2', 'trk:manual:s3']);
    expect([...waits]).toEqual([['s1', '2026-11-14T10:00:54.000Z']]);
    expect((await syncAvailability(redis, [], now)).size).toBe(0);
  });
});
