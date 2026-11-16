// DLV-09 / 04 §2 — address checks shared by orders and clients: the commune must belong to the wilaya once the
// communes are seeded (free text ≤ 100 chars otherwise); stop-desk points per commune (CourierStopdesk, filled in M6).
import { Injectable } from '@nestjs/common';
import { prisma, type Tx } from '@djaber/db';
import type { StopdeskView } from '@djaber/shared';
import { AppException } from '../../core/errors/app.exception';

export type AddressInput = { wilayaId: number; communeId?: number | null; communeText?: string | null; address?: string | null; isStopdesk?: boolean; stopdeskId?: string | null };

@Injectable()
export class GeoService {
  /** 422 VALIDATION_ERROR `{ communeId: validation.commune }` when the commune is unknown or in another wilaya. */
  async checkAddress(a: AddressInput, db: Tx | typeof prisma = prisma, field = 'communeId') {
    const wilaya = await db.wilaya.findUnique({ where: { id: a.wilayaId }, select: { id: true, nameFr: true } });
    if (!wilaya) throw new AppException('VALIDATION_ERROR', {}, { wilayaId: 'validation.wilaya' });
    let commune: { id: number; nameFr: string } | null = null;
    if (a.communeId) {
      commune = await db.commune.findFirst({ where: { id: a.communeId, wilayaId: a.wilayaId }, select: { id: true, nameFr: true } });
      if (!commune) throw new AppException('VALIDATION_ERROR', {}, { [field]: 'validation.commune' });
    }
    if (!a.isStopdesk && a.address !== undefined && a.address !== null && a.address.trim().length < 10) throw new AppException('VALIDATION_ERROR', {}, { address: 'validation.address' });
    return { wilaya, commune };
  }

  /**
   * Stop-desk agencies (platform reference data, `CourierStopdesk`) — journey J08-10: only of the couriers the shop has an
   * active account with (a shop without any courier listed the agencies another shop's courier had loaded, test ones
   * included); none ⇒ an empty list.
   */
  async stopdesks(q: { provider?: 'zrexpress' | 'ecotrack' | 'yalidine'; communeId?: number; wilayaId?: number }): Promise<StopdeskView[]> {
    const accounts = await prisma.courierAccount.findMany({ where: { isActive: true }, select: { provider: true } });
    const mine = [...new Set(accounts.map((a) => a.provider))];
    const providers = q.provider ? mine.filter((p) => p === q.provider) : mine;
    if (!providers.length) return [];
    const rows = await prisma.courierStopdesk.findMany({
      where: { provider: { in: providers }, ...(q.communeId ? { communeId: q.communeId } : {}), ...(q.wilayaId ? { commune: { wilayaId: q.wilayaId } } : {}) },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, provider: r.provider, externalId: r.externalId, name: r.name, address: r.address, communeId: r.communeId }));
  }
}
