// 05-integrations §2.2–§2.4 — raw courier status → `ShipmentStatus` (+ `FailureReason`), one table per provider
// (`zrexpress.statuses`, `ecotrack.statuses`, `yalidine.statuses`). Raw strings are compared case- and
// accent-insensitively: an exact match wins, else the LONGEST table entry contained in the raw text (so that
// "Pas encore expédié" is `sent`, not "Expédié" = `in_transit`; "Retour livré" is `returned`, not "Livré").
// Unknown raw ⇒ `null`: the event is stored and the status is left unchanged (DLV-04, AT-DLV-04).
import type { FailureReasonCode, ShipmentStatusName } from '@djaber/shared';
import type { CourierProvider } from './courier-adapter';

export type StatusRow = readonly [raw: string, mapped: ShipmentStatusName, reason?: FailureReasonCode];

export const ZREXPRESS_STATUSES: readonly StatusRow[] = [
  ['En préparation', 'sent'],
  ['Préparation', 'sent'],
  ['Ramassé', 'picked_up'],
  ['Ramassée', 'picked_up'],
  ['Collecté', 'picked_up'],
  ['Expédié', 'in_transit'],
  ['En transit', 'in_transit'],
  ['Vers wilaya', 'in_transit'],
  ['Centre', 'in_transit'],
  ['Hub', 'in_transit'],
  ['Sorti en livraison', 'out_for_delivery'],
  ['En livraison', 'out_for_delivery'],
  ['En cours de livraison', 'out_for_delivery'],
  ['Livré', 'delivered'],
  ['Livrée', 'delivered'],
  ['Encaissé', 'delivered'],
  ['Tentative échouée', 'failed', 'unreachable'],
  ['Client injoignable', 'failed', 'unreachable'],
  ['Ne répond pas', 'failed', 'unreachable'],
  ['Adresse erronée', 'failed', 'address'],
  ['Adresse incorrecte', 'failed', 'address'],
  ['Refusé', 'failed', 'refused'],
  ['Client refuse', 'failed', 'refused'],
  ['Endommagé', 'failed', 'damaged'],
  ['Retour vers vendeur', 'returned'],
  ['Retourné', 'returned'],
  ['Retour livré', 'returned'],
  ['Annulé', 'cancelled'],
  // new platform (api.zrexpress.app, 05-integrations §2.2b): parcel states + situations, French labels and English slugs
  ['Commande reçue', 'sent'],
  ['OrderReceived', 'sent'],
  ['ReadyToDispatch', 'sent'],
  ['Confirmé au bureau', 'in_transit'],
  ['Nouveau', 'sent'],
  ['Créé', 'sent'],
  ['Confirmé', 'sent'],
  ['Confirmée', 'sent'],
  ['Prêt à expédier', 'sent'],
  ['En attente de ramassage', 'sent'],
  ['Pas encore ramassé', 'sent'],
  ['Dispatch', 'in_transit'],
  ['Dispatché', 'in_transit'],
  ['Au hub', 'in_transit'],
  ['Reçu au hub', 'in_transit'],
  ['Transfert', 'in_transit'],
  ['En distribution', 'out_for_delivery'],
  ['Payé', 'delivered'],
  ['Échec de livraison', 'failed', 'other'],
  ['Non livré', 'failed', 'other'],
  ['Injoignable', 'failed', 'unreachable'],
  ['Client absent', 'failed', 'unreachable'],
  ['Téléphone éteint', 'failed', 'unreachable'],
  ['Retour en cours', 'returned'],
  ['En retour', 'returned'],
  ['Retour reçu', 'returned'],
  ['Retourné au vendeur', 'returned'],
  ['Supprimé', 'cancelled'],
  ['Annulée', 'cancelled'],
  ['created', 'sent'],
  ['confirmed', 'sent'],
  ['ready to ship', 'sent'],
  ['picked up', 'picked_up'],
  ['in transit', 'in_transit'],
  ['out for delivery', 'out_for_delivery'],
  ['delivered', 'delivered'],
  ['delivery failed', 'failed', 'other'],
  ['unreachable', 'failed', 'unreachable'],
  ['refused', 'failed', 'refused'],
  ['returned', 'returned'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
];

export const ECOTRACK_STATUSES: readonly StatusRow[] = [
  ['Créé', 'sent'],
  ['En préparation', 'sent'],
  ['Prêt à expédier', 'sent'],
  ['Ramassé', 'picked_up'],
  ['Collecté', 'picked_up'],
  ['Reçu au hub', 'in_transit'],
  ['Expédié', 'in_transit'],
  ['En transit', 'in_transit'],
  ['Transféré', 'in_transit'],
  ['Sorti en livraison', 'out_for_delivery'],
  ['En livraison', 'out_for_delivery'],
  ['Livré', 'delivered'],
  ['Tentative échouée', 'failed', 'unreachable'],
  ['Client absent', 'failed', 'unreachable'],
  ['Injoignable', 'failed', 'unreachable'],
  ['Adresse introuvable', 'failed', 'address'],
  ['Refusé', 'failed', 'refused'],
  ['Endommagé', 'failed', 'damaged'],
  ['Retour', 'returned'],
  ['Retourné au vendeur', 'returned'],
  ['Retour livré', 'returned'],
  ['Annulé', 'cancelled'],
  ['Supprimé', 'cancelled'],
  // EcoTrack API keys (activity `status` of get/tracking/info, order status enum; reference client dz-delivery, 26/10):
  // the French labels drift per courier, the keys do not
  ['order_information_received_by_carrier', 'sent'],
  ['prete_a_expedier', 'sent'],
  ['prete_a_preparer', 'sent'],
  ['en_preparation_stock', 'sent'],
  ['en_ramassage', 'sent'],
  ['picked', 'picked_up'],
  ['accepted_by_carrier', 'picked_up'],
  ['vers_hub', 'in_transit'],
  ['en_hub', 'in_transit'],
  ['vers_wilaya', 'in_transit'],
  ['suspendu', 'in_transit'],
  ['dispatched_to_driver', 'out_for_delivery'],
  ['attempt_delivery', 'failed', 'unreachable'],
  ['livred', 'delivered'],
  ['encaissed', 'delivered'],
  ['payed', 'delivered'],
  ['livre_non_encaisse', 'delivered'],
  ['encaisse_non_paye', 'delivered'],
  ['paiements_prets', 'delivered'],
  ['paye_et_archive', 'delivered'],
  ['return_asked', 'returned'],
  ['return_in_transit', 'returned'],
  ['return_received', 'returned'],
  ['retour_chez_livreur', 'returned'],
  ['retour_transit_entrepot', 'returned'],
  ['retour_en_traitement', 'returned'],
  ['retour_recu', 'returned'],
  ['retour_archive', 'returned'],
  ['annule', 'cancelled'],
];

export const YALIDINE_STATUSES: readonly StatusRow[] = [
  ['Pas encore expédié', 'sent'],
  ['A vérifier', 'sent'],
  ['En préparation', 'sent'],
  ['Pas encore ramassé', 'sent'],
  ['Prêt à expédier', 'sent'],
  ['Ramassé', 'picked_up'],
  ['Transfert', 'in_transit'],
  ['Expédié', 'in_transit'],
  ['Centre', 'in_transit'],
  ['En localisation', 'in_transit'],
  ['Vers Wilaya', 'in_transit'],
  ['Reçu à Wilaya', 'in_transit'],
  ['Bloqué', 'in_transit'],
  ['En attente du client', 'out_for_delivery'],
  ['Sorti en livraison', 'out_for_delivery'],
  ['En attente', 'out_for_delivery'],
  ['Livré', 'delivered'],
  ['Tentative échouée', 'failed', 'unreachable'],
  ['Echèc livraison', 'failed', 'other'],
  ['Retour vers centre', 'returned'],
  ['Retourné au centre', 'returned'],
  ['Retour transfert', 'returned'],
  ['Retour groupé', 'returned'],
  ['Retour à retirer', 'returned'],
  ['Retour en traitement', 'returned'],
  ['Retourné au vendeur', 'returned'],
  ['Retour livré', 'returned'],
  ['Annulé', 'cancelled'],
  ['Supprimé', 'cancelled'],
];

export const STATUS_TABLES: Record<Exclude<CourierProvider, 'manual'>, readonly StatusRow[]> = {
  zrexpress: ZREXPRESS_STATUSES,
  ecotrack: ECOTRACK_STATUSES,
  yalidine: YALIDINE_STATUSES,
};

/** Case-, accent- and spacing-insensitive form of a raw status. */
export const normalizeRaw = (raw: string) =>
  raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const compiled = new Map<string, { key: string; mapped: ShipmentStatusName; reason: FailureReasonCode | null }[]>();
const rowsOf = (provider: Exclude<CourierProvider, 'manual'>) => {
  let rows = compiled.get(provider);
  if (!rows) {
    rows = STATUS_TABLES[provider].map(([raw, mapped, reason]) => ({ key: normalizeRaw(raw), mapped, reason: reason ?? null }));
    compiled.set(provider, rows);
  }
  return rows;
};

export type MappedStatus = { mapped: ShipmentStatusName; failureReason: FailureReasonCode | null };

/** `null` = unknown raw status (event stored, status unchanged). */
export const mapCourierStatus = (provider: CourierProvider, raw: string | null | undefined): MappedStatus | null => {
  if (provider === 'manual' || !raw) return null;
  const n = normalizeRaw(raw);
  if (!n) return null;
  const rows = rowsOf(provider);
  const exact = rows.find((r) => r.key === n);
  if (exact) return { mapped: exact.mapped, failureReason: exact.reason };
  let best: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (!(` ${n} `.includes(` ${r.key} `))) continue;
    if (!best || r.key.length > best.key.length) best = r;
  }
  return best ? { mapped: best.mapped, failureReason: best.reason } : null;
};
