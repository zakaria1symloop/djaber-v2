// ADM-16 / MSG-08 — customer data deletion requests on /admin/team: dialog rules, request body, row menu, summary, and the
// `dd.` URL namespace that keeps this list apart from the account-deletion list of the same page.
import { AdminDataDeletionCreateSchema, getMessages } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { listApiQuery, listQueryString, parseListState, patchListState, serializeListState } from '@/lib/list-state';
import { makeT } from '@/lib/format-message';
import { DATA_DELETION_LIST, DELETION_LIST } from '../specs';
import { canSubmitDataDeletion, dataDeletionBody, dataDeletionFieldErrors, dataDeletionRowActions, dataDeletionSummaryParts, EMPTY_DATA_DELETION_FORM, type DataDeletionForm } from './data-deletion-logic';

const form = (p: Partial<DataDeletionForm>): DataDeletionForm => ({ ...EMPTY_DATA_DELETION_FORM, ...p });
const REASON = 'E-mail du 21/11 : demande de suppression';
const TICKET = '3f2a7c1e-5b4d-4e8f-9a0b-1c2d3e4f5a6b';

describe('new data deletion dialog', () => {
  it('needs the chosen identifier and a 10-character reason', () => {
    expect(canSubmitDataDeletion(form({}))).toBe(false);
    expect(canSubmitDataDeletion(form({ phone: '0555123456' }))).toBe(false);
    expect(canSubmitDataDeletion(form({ phone: '0555123456', reason: 'court' }))).toBe(false);
    expect(canSubmitDataDeletion(form({ phone: '0555123456', reason: REASON }))).toBe(true);
    // the phone typed before switching to the sender id does not count
    expect(canSubmitDataDeletion(form({ by: 'sender', phone: '0555123456', reason: REASON }))).toBe(false);
    expect(canSubmitDataDeletion(form({ by: 'sender', senderId: '24680135792468', reason: REASON }))).toBe(true);
  });

  it('flags a typed value the API would refuse, with the API keys', () => {
    expect(dataDeletionFieldErrors(form({ phone: '12345' }))).toEqual({ phone: 'validation.phone' });
    expect(dataDeletionFieldErrors(form({ phone: '+213 555 12 34 56' }))).toEqual({});
    expect(dataDeletionFieldErrors(form({ by: 'sender', senderId: '12ab' }))).toEqual({ externalSenderId: 'validation.invalid' });
    expect(dataDeletionFieldErrors(form({ by: 'sender', senderId: '1234' }))).toEqual({ externalSenderId: 'validation.invalid' });
    expect(dataDeletionFieldErrors(form({ ticketId: 'TCK-12' }))).toEqual({ ticketId: 'validation.id' });
    expect(canSubmitDataDeletion(form({ phone: '0555123456', reason: REASON, ticketId: 'TCK-12' }))).toBe(false);
    // an empty field is not an error (the button stays disabled instead)
    expect(dataDeletionFieldErrors(form({}))).toEqual({});
  });

  it('sends only the chosen identifier, normalised, and the optional fields when filled', () => {
    expect(dataDeletionBody(form({ phone: '+213 555 12 34 56', senderId: '24680135792468', reason: `  ${REASON} ` }))).toEqual({ phone: '0555123456', reason: REASON });
    const body = dataDeletionBody(form({ by: 'sender', phone: '0555123456', senderId: '24680135792468', workspaceId: TICKET, reason: REASON, ticketId: TICKET }));
    expect(body).toEqual({ externalSenderId: '24680135792468', workspaceId: TICKET, reason: REASON, ticketId: TICKET });
    // the body passes the API schema as is
    expect(AdminDataDeletionCreateSchema.safeParse(body).success).toBe(true);
    expect(AdminDataDeletionCreateSchema.safeParse(dataDeletionBody(form({ phone: '0555123456', reason: REASON }))).success).toBe(true);
  });
});

describe('data deletion rows', () => {
  it('row menu: copy link, copy code, tracking page; the workspace only when the request names one', () => {
    expect(dataDeletionRowActions({ workspaceId: null })).toEqual(['copy_link', 'copy_code', 'open_status']);
    expect(dataDeletionRowActions({ workspaceId: TICKET })).toEqual(['copy_link', 'copy_code', 'open_status', 'open_workspace']);
  });

  it('summary: the non-zero counts in reading order, nothing while pending', () => {
    expect(dataDeletionSummaryParts({ summary: null })).toEqual([]);
    expect(dataDeletionSummaryParts({ summary: { conversations: 2, clientsAnonymised: 1, clientsDeleted: 0, orders: 3, workspaces: 1 } })).toEqual([
      { key: 'conversations', count: 2 },
      { key: 'clientsAnonymised', count: 1 },
      { key: 'orders', count: 3 },
      { key: 'workspaces', count: 1 },
    ]);
  });

  it('summary messages read in the three languages (Arabic dual)', () => {
    const fr = makeT('fr', getMessages('fr'));
    const ar = makeT('ar', getMessages('ar'));
    const en = makeT('en', getMessages('en'));
    expect(fr('admin.team.dd.summary.conversations', { count: 2 })).toBe('2 conversations');
    expect(fr('admin.team.dd.summary.clientsAnonymised', { count: 1 })).toBe('1 fiche anonymisée');
    expect(en('admin.team.dd.summary.orders', { count: 3 })).toBe('3 orders without the name');
    expect(ar('admin.team.dd.summary.conversations', { count: 2 })).toBe('محادثتان');
    expect(ar('admin.team.dd.summary.workspaces', { count: 5 })).toBe('5 متاجر');
  });
});

describe('dd. URL namespace (two lists on /admin/team)', () => {
  const url = (qs: string) => new URLSearchParams(qs);

  it('reads its own prefixed keys and ignores the account-deletion list ones', () => {
    const s = parseListState(DATA_DELETION_LIST, url('status=grace&page=3&dd.status=pending,done&dd.source=admin&dd.page=2'));
    expect(s.filters).toEqual({ status: ['pending', 'done'], source: 'admin' });
    expect(s.page).toBe(2);
    const other = parseListState(DELETION_LIST, url('status=grace&page=3&dd.status=pending&dd.page=2'));
    expect(other.filters).toEqual({ status: ['grace'] });
    expect(other.page).toBe(3);
  });

  it('writes prefixed keys and keeps the other list parameters untouched', () => {
    const current = url('status=grace&page=3&dd.page=4');
    const s = patchListState(parseListState(DATA_DELETION_LIST, current), { filters: { status: ['no_data'] } });
    expect(serializeListState(DATA_DELETION_LIST, s)).toEqual([['dd.status', 'no_data']]);
    expect(listQueryString(DATA_DELETION_LIST, s, current.entries())).toBe('status=grace&page=3&dd.status=no_data');
    // and the account-deletion list keeps the dd. keys when it writes
    const acc = patchListState(parseListState(DELETION_LIST, current), { page: 1 });
    expect(listQueryString(DELETION_LIST, acc, url('status=grace&page=3&dd.status=no_data').entries())).toBe('dd.status=no_data&status=grace');
  });

  it('the API query keeps the plain names', () => {
    const s = parseListState(DATA_DELETION_LIST, url('dd.status=pending&dd.source=callback&dd.page=2'));
    expect(listApiQuery(s)).toEqual({ status: ['pending'], source: 'callback', sort: '-requestedAt', page: 2, pageSize: 25 });
  });
});
