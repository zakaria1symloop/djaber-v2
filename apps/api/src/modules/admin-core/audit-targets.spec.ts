// journey J13v-5 — every audited record type has a readable target in the audit log (12 §Audit log, J13-6 / J13r-10): the
// entity names written by the code are listed from the sources, and a type without an `AUDIT_TARGETS` entry fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUDIT_TARGETS, AuditRowLike, auditTargetNames, snapshotName } from './audit-targets';

const ROOTS = [resolve(__dirname, '../../../src'), resolve(__dirname, '../../../../worker/src')];
const walk = (dir: string): string[] => {
  let out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (n.endsWith('.ts') && !n.endsWith('.spec.ts')) out.push(p);
  }
  return out;
};

/** `entity: 'X'` (audit.write / auditAdmin / @Audited / auditLog.create) and the positional `log(actor, 'action', 'X', …)` helpers. */
export const auditedEntities = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const f of ROOTS.flatMap(walk)) {
    const src = readFileSync(f, 'utf8');
    if (!/audit|Audited|log\(/.test(src)) continue;
    for (const m of src.matchAll(/\bentity: '([A-Z][A-Za-z]+)'/g)) found.set(m[1]!, f);
    for (const m of src.matchAll(/\blog\([^;\n]*?(?:'[a-z_]+\.[a-z_.]+'|`[^`\n]*`), '([A-Z][A-Za-z]+)'/g)) found.set(m[1]!, f);
  }
  return found;
};

describe('audit log targets (journey J13v-5)', () => {
  it('lists the audited entity types of the code (sanity)', () => {
    const names = [...auditedEntities().keys()];
    expect(names.length).toBeGreaterThan(40);
    for (const n of ['CashTransaction', 'CashClosing', 'Job', 'DeliveryFeeRule', 'Invitation', 'WebhookEndpoint', 'SavedView', 'Recommendation', 'Membership', 'ModerationRule', 'AiRoute', 'Plan', 'AccountDeletionRequest']) expect(names).toContain(n);
  });

  it('every audited entity type has a readable target (no short id while the record exists)', () => {
    const missing = [...auditedEntities()].filter(([n]) => !AUDIT_TARGETS[n]).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
    for (const [n, spec] of Object.entries(AUDIT_TARGETS)) if (spec.kind === 'named') expect({ n, named: !!(spec.load || spec.fromRow) }).toEqual({ n, named: true });
  });

  const row = (entity: string, entityId: string | null, before: unknown = null, after: unknown = null): AuditRowLike => ({ id: `r-${entity}-${entityId}`, entity, entityId, workspaceId: null, at: new Date('2026-11-19T10:00:00Z'), before, after });

  it('names a record from the row when the id is not a record id (day, capability, report key) or the record is gone', async () => {
    const names = await auditTargetNames(
      [
        row('CashClosing', '2026-11-19'),
        row('AiRoute', 'text'),
        row('ReportSchedule', 'payments'),
        row('PlatformSetting', 'maintenance'),
        row('DeliveryFeeRule', null, null, { written: 69 }),
      ],
      'fr',
    );
    // rows whose id is no record id never reach the database (no loader query)
    {
      expect(names.get('row:r-CashClosing-2026-11-19')).toBe('19 nov. 2026');
      expect(names.get('row:r-AiRoute-text')).toBe('Texte (réponse)');
      expect(names.get('row:r-ReportSchedule-payments')).toBe('Paiements');
      expect(names.get('row:r-PlatformSetting-maintenance')).toBe('maintenance');
      expect(names.get('row:r-DeliveryFeeRule-null')).toBe('Toutes les wilayas');
    }
    const cash = AUDIT_TARGETS.CashTransaction;
    expect(cash?.kind === 'named' && (await cash.fromRow?.(row('CashTransaction', 'x', { description: 'loyer boutique', category: 'rent', type: 'expense', amount: 2000 }), 'fr'))).toBe('loyer boutique · −2 000 DA');
    const rule = AUDIT_TARGETS.ModerationRule;
    expect(rule?.kind === 'named' && (await rule.fromRow?.(row('ModerationRule', 'x', { value: 'contrefaçon' }), 'fr'))).toBe('« contrefaçon »');
    const closing = AUDIT_TARGETS.CashClosing;
    expect(closing?.kind === 'named' && (await closing.fromRow?.(row('CashClosing', '2026-11-19'), 'ar'))).toBe('19 نوفمبر 2026');
  });

  it('a gone record is named from its snapshot: name, masked e-mail, URL host', () => {
    expect(snapshotName({ url: 'https://hooks.example.dz/djaber', events: [] }, null)).toBe('hooks.example.dz/djaber');
    expect(snapshotName(null, { email: 'nadia@boutique.dz', role: 'operator' })).toBe('n•••@boutique.dz');
    expect(snapshotName({ name: 'Vue « à livrer »' }, null)).toBe('Vue « à livrer »');
    expect(snapshotName(null, { failureCount: 3 })).toBeNull();
  });
});
