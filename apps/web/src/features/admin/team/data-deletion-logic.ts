// ADM-16 / MSG-08 — end-customer data deletion asked by e-mail: pure rules of the « Nouvelle demande » dialog and of the
// list rows (`GET|POST /admin/data-deletion-requests`). The API decides (phone normalisation, pending duplicate ⇒ the
// same request); the dialog only checks what it can before sending, with the same rules as `AdminDataDeletionCreateSchema`.
import { isPhoneDz, normalizePhoneDz, type AdminDataDeletionCreateInput, type AdminDataDeletionRequestDto } from '@djaber/shared';
import { reasonOk } from '../dialog-kit';

export const DATA_DELETION_STATUSES = ['pending', 'done', 'no_data', 'not_found'] as const;
export const DATA_DELETION_SOURCES = ['admin', 'callback'] as const;

/** how the requester is identified: a phone number (order, client card) or the Messenger / Instagram sender id */
export type DataDeletionTarget = 'phone' | 'sender';
export type DataDeletionForm = { by: DataDeletionTarget; phone: string; senderId: string; workspaceId: string | null; reason: string; ticketId: string };
export const EMPTY_DATA_DELETION_FORM: DataDeletionForm = { by: 'phone', phone: '', senderId: '', workspaceId: null, reason: '', ticketId: '' };

const SENDER_ID = /^\d{5,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field → validation key (`validation.phone`, `validation.invalid`, `validation.id`) for a typed value the API would refuse. */
export function dataDeletionFieldErrors(f: DataDeletionForm): Partial<Record<'phone' | 'externalSenderId' | 'ticketId', string>> {
  const out: Partial<Record<'phone' | 'externalSenderId' | 'ticketId', string>> = {};
  const phone = f.phone.trim();
  const sender = f.senderId.trim();
  const ticket = f.ticketId.trim();
  if (f.by === 'phone' && phone && !isPhoneDz(normalizePhoneDz(phone))) out.phone = 'validation.phone';
  if (f.by === 'sender' && sender && !SENDER_ID.test(sender)) out.externalSenderId = 'validation.invalid';
  if (ticket && !UUID.test(ticket)) out.ticketId = 'validation.id';
  return out;
}

/** The submit button is enabled once the chosen identifier is filled and valid and the reason has 10 characters. */
export function canSubmitDataDeletion(f: DataDeletionForm): boolean {
  const filled = f.by === 'phone' ? f.phone.trim().length > 0 : f.senderId.trim().length > 0;
  return filled && reasonOk(f.reason) && Object.keys(dataDeletionFieldErrors(f)).length === 0;
}

/** Body of `POST /admin/data-deletion-requests`: only the chosen identifier is sent (the other field may still hold text). */
export function dataDeletionBody(f: DataDeletionForm): AdminDataDeletionCreateInput {
  const body: AdminDataDeletionCreateInput = { reason: f.reason.trim() };
  if (f.by === 'phone') body.phone = normalizePhoneDz(f.phone.trim());
  else body.externalSenderId = f.senderId.trim();
  if (f.workspaceId) body.workspaceId = f.workspaceId;
  if (f.ticketId.trim()) body.ticketId = f.ticketId.trim();
  return body;
}

/** API field names the dialog shows next to its inputs (anything else goes to the form-level alert). */
export const DATA_DELETION_FIELDS = ['phone', 'externalSenderId', 'workspaceId', 'reason', 'ticketId'] as const;

/** Items of the row `Actions ⌄` (all read-only, always offered): the workspace one only when the request names a shop. */
export function dataDeletionRowActions(r: Pick<AdminDataDeletionRequestDto, 'workspaceId'>): ('copy_link' | 'copy_code' | 'open_status' | 'open_workspace')[] {
  return ['copy_link', 'copy_code', 'open_status', ...(r.workspaceId ? (['open_workspace'] as const) : [])];
}

/** Non-zero parts of the deletion summary, in reading order (`conversations`, `clientsAnonymised`, …); [] when not processed. */
export function dataDeletionSummaryParts(r: Pick<AdminDataDeletionRequestDto, 'summary'>): { key: 'conversations' | 'clientsAnonymised' | 'clientsDeleted' | 'orders' | 'workspaces'; count: number }[] {
  if (!r.summary) return [];
  const order = ['conversations', 'clientsAnonymised', 'clientsDeleted', 'orders', 'workspaces'] as const;
  return order.map((key) => ({ key, count: r.summary![key] ?? 0 })).filter((p) => p.count > 0);
}
