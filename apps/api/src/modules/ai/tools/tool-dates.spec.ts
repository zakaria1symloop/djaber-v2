// weak-points audit 12/11 « Static scans › Dates »: the model receives Algiers wall-clock times and readable shipment words.
import { prisma } from '@djaber/db';
import { aiDateTime, algiersStamp } from '../../../core/time/algiers';
import { shipmentEventLabel, ToolRegistry } from './tool-registry';

describe('aiDateTime — Africa/Algiers wall clock, never UTC ISO', () => {
  it('shifts UTC by one hour and labels the zone', () => {
    expect(algiersStamp(new Date('2026-11-11T14:38:00Z'))).toBe('2026-11-11 15:38');
    expect(aiDateTime(new Date('2026-11-11T14:38:00Z'))).toBe('2026-11-11 15:38 (Algeria time)');
  });
  it('an order placed at 00:30 in Algiers is on that Algiers day (UTC still shows the day before)', () => {
    const at = new Date('2026-11-10T23:30:00Z');
    expect(aiDateTime(at)).toBe('2026-11-11 00:30 (Algeria time)');
    expect(aiDateTime(at)).not.toContain('T');
  });
});

describe('shipmentEventLabel — no courier code nor staff note reaches the model', () => {
  const ev = (o: Partial<{ rawStatus: string; mappedStatus: string | null; description: string | null; source: string }>) => ({ rawStatus: 'EN_LIVRAISON_04', mappedStatus: 'out_for_delivery', description: null, source: 'poll', ...o });

  it('a courier sentence is kept', () => {
    expect(shipmentEventLabel(ev({ description: 'Colis au centre de tri Alger' }))).toBe('Colis au centre de tri Alger');
  });
  it('no description, or a description that is the raw status ⇒ the plain words of the mapped status', () => {
    expect(shipmentEventLabel(ev({}))).toBe('out for delivery');
    expect(shipmentEventLabel(ev({ description: 'EN_LIVRAISON_04' }))).toBe('out for delivery');
  });
  it('manual / system events never pass their note (staff text, internal codes)', () => {
    expect(shipmentEventLabel(ev({ source: 'manual', description: 'client rappelé, pas sérieux', mappedStatus: 'failed' }))).toBe('delivery attempt failed');
    expect(shipmentEventLabel(ev({ source: 'system', description: 'no courier event for 7 d', mappedStatus: 'stale' }))).toBe('no recent update from the courier');
  });
  it('an unmapped raw status ⇒ null, never the code', () => {
    expect(shipmentEventLabel(ev({ mappedStatus: null }))).toBeNull();
  });
});

describe('lookup_order / cancel_order give the model Algiers times', () => {
  const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
  (reg as unknown as { config: unknown }).config = { get: () => 'https://app.example' };
  const ctx = { workspaceId: 'w', agent: {} as never, conversationId: null, clientId: 'cl', channelId: null, runId: 'r', callId: 'c', dryRun: false };
  const orderedAt = new Date('2026-11-10T23:38:00Z');
  afterEach(() => jest.restoreAllMocks());

  it('lookup_order: orderedAt and lastEvent.at in Algeria time, readable label', async () => {
    jest.spyOn(prisma.client, 'findUnique').mockResolvedValue({ phone: '0555123456', phone2: null } as never);
    jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
      {
        number: 'CMD-1',
        status: 'shipped',
        deliveryStatus: 'in_transit',
        clientId: 'cl',
        clientPhone: '0555123456',
        clientPhone2: null,
        total: 4900,
        orderedAt,
        shipments: [{ provider: 'yalidine', trackingNumber: 'YAL-1', publicTrackingToken: 't', events: [{ at: new Date('2026-11-11T14:05:00Z'), rawStatus: 'Sorti en livraison', mappedStatus: 'out_for_delivery', description: null, location: 'Oran', source: 'poll' }] }],
      },
    ] as never);
    const out = (await reg.execute('lookup_order', {}, ctx)) as { orders: Record<string, unknown>[] };
    expect(out.orders[0]).toMatchObject({ orderedAt: '2026-11-11 00:38 (Algeria time)', lastEvent: { at: '2026-11-11 15:05 (Algeria time)', label: 'out for delivery', location: 'Oran' } });
    expect(JSON.stringify(out)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(JSON.stringify(out)).not.toContain('Sorti en livraison');
  });

  it('cancel_order candidates: orderedAt in Algeria time', async () => {
    jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{ id: 'o1', number: 'CMD-2', total: 3000, status: 'new', orderedAt }] as never);
    jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null as never);
    const out = await reg.execute('cancel_order', {}, ctx);
    expect(out).toEqual({ ok: true, candidates: [{ number: 'CMD-2', total: 3000, status: 'new', orderedAt: '2026-11-11 00:38 (Algeria time)' }] });
  });
});
