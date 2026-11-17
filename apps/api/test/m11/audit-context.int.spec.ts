// journeys 16/11 J13-2 (rule 9, 03 ADM-07, 12 §26 Audit log « context ip/device »): every audit row written while serving a
// person's request carries the request ip / user agent — API keys, customer blocks and clients wrote « CONTEXTE — » because
// their services passed none. AuditService now reads them from the request (RequestMeta), whatever module writes the row.
import { asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { forbidNetwork } from '../support/m3';
import { db } from '../support/m11';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  net.restore();
  await app.close();
});

const UA = 'Mozilla/5.0 (Windows NT 10.0) QA-J13';
const last = (workspaceId: string, action: string) => db.auditLog.findFirstOrThrow({ where: { workspaceId, action }, orderBy: { at: 'desc' } });

describe('audit request context (J13-2)', () => {
  it('API key create / revoke, client risk, customer block / unblock rows carry ip + user agent of the request', async () => {
    const owner = await asOwner(app);
    const key = (await owner.post('/api-keys', { name: 'Clé ERP', scopes: ['orders:read'] }).set('User-Agent', UA).expect(201)).body.data;
    await owner.post(`/api-keys/${key.id}/revoke`, {}).set('User-Agent', UA).expect(200);
    const client = (await owner.post('/clients', { name: 'Yacine Haddad', phone: '0555123987' }).set('User-Agent', UA).expect(201)).body.data;
    await owner.post(`/clients/${client.id}/risk`, { riskLevel: 'high' }).set('User-Agent', UA).expect(200);
    const block = (await owner.post('/safety/blocks', { clientId: client.id, reason: 'spam' }).set('User-Agent', UA).expect(201)).body.data;
    expect((await owner.delete(`/safety/blocks/${block.id}`).set('User-Agent', UA)).status).toBeLessThan(300);

    for (const action of ['api_key.create', 'api_key.revoke', 'client.risk', 'customer.block', 'customer.unblock']) {
      const row = await last(owner.workspaceId, action);
      expect({ action, ip: row.ip, userAgent: row.userAgent, actorId: row.actorId }).toEqual({ action, ip: expect.stringMatching(/127\.0\.0\.1|::1/), userAgent: UA, actorId: owner.userId });
    }
    // a row written by the system (no person behind it) keeps no request context
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, actorType: 'system', userAgent: UA } })).toBe(0);
  });
});
