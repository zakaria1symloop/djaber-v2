// Recette 11/11 (Badro): the merchant inbox read through « Se connecter en tant que » masks the customer like the admin
// viewers (04 §17 « Viewers »).
import { TenantContext } from '@djaber/db';
import { presentConversation, presentMessage, type ConversationRow, type MessageRow } from '../../modules/messaging/messaging.presenter';
import { impersonating, maskName, maskPhone, maskText } from './mask';

const conversation = {
  id: 'c1',
  externalSenderId: '1234567890',
  context: { displayName: 'Amina Benali' },
  channel: { id: 'ch1', platform: 'facebook', name: 'Page', externalId: 'p1', status: 'active', agentChannels: [] },
  client: { id: 'cl1', name: 'Mehdi Hadj', phone: '0661987654', riskLevel: 'normal', isPlaceholder: false, orderCount: 2 },
  status: 'active',
  aiPaused: false,
  agent: null,
  assignee: null,
  unreadCount: 0,
  lastMessageAt: new Date('2026-11-11T10:00:00Z'),
  createdAt: new Date('2026-11-10T10:00:00Z'),
  lastMessagePreview: 'Mon numéro 0661 98 76 54',
  lastCustomerMessageAt: null,
  lastAiIntent: null,
  version: 1,
} as unknown as ConversationRow;
const message = { id: 'm1', conversationId: 'c1', direction: 'in', type: 'text', author: 'customer', authorUser: null, text: 'Appelez-moi au 0661987654', attachments: [], transcript: null, transcriptStatus: null, payload: null, sentAt: new Date(), deliveryStatus: null, error: null, aiRunId: null, customerReaction: null, containsBlockedWord: false } as unknown as MessageRow;
const asAdmin = <T>(fn: () => T) => TenantContext.run({ workspaceId: 'w1', readOnly: true, impersonation: { sessionId: 's1', adminId: 'a1' } } as never, fn);
const asMember = <T>(fn: () => T) => TenantContext.run({ workspaceId: 'w1', readOnly: false } as never, fn);

describe('PII masking', () => {
  it('name, phone and phone numbers inside a text', () => {
    expect(maskName('Mehdi Hadj')).toBe('Mehdi H.');
    expect(maskPhone('0661987654')).toBe('06•• •• •• 54');
    expect(maskText('Appelez-moi au 0661987654')).toBe('Appelez-moi au 06•• •• •• 54');
  });

  it('only a read-only impersonation session counts as « impersonating »', () => {
    expect(asAdmin(impersonating)).toBe(true);
    expect(asMember(impersonating)).toBe(false);
    expect(impersonating()).toBe(false);
  });

  it('inbox read as the merchant by a platform admin: customer name, phone and texts masked', () => {
    const row = asAdmin(() => presentConversation(conversation, false));
    expect(row.client).toMatchObject({ name: 'Mehdi H.', phone: '06•• •• •• 54' });
    expect(row.lastMessagePreview).toBe('Mon numéro 06•• •• •• 54');
    expect(asAdmin(() => presentMessage(message)).text).toBe('Appelez-moi au 06•• •• •• 54');
    const anonymous = asAdmin(() => presentConversation({ ...conversation, client: null } as unknown as ConversationRow, false));
    expect(anonymous.client.name).toBe('Amina B.');
  });

  it('the merchant team sees everything', () => {
    const row = asMember(() => presentConversation(conversation, false));
    expect(row.client).toMatchObject({ name: 'Mehdi Hadj', phone: '0661987654' });
    expect(asMember(() => presentMessage(message)).text).toBe('Appelez-moi au 0661987654');
  });
});
