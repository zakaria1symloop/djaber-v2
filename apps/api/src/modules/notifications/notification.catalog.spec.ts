// Every notification type renders without a raw `{placeholder}` given the parameters its producers send
// (NOTIFICATION_PARAMS). Table-driven from the enum and the catalogue: a new type or a new template placeholder is
// covered — and fails here — without touching this file.
import { getMessages, NotificationTypeValues, type AppLocale } from '@djaber/shared';
import type { NotificationType } from '@djaber/db';
import { jobPath, jobRefs, missingNotificationParams, NOTIFICATION_PARAMS, NOTIFICATION_VARIANTS, notificationDeepLink, notificationGroup, notificationSlug, parcelPath, renderNotification } from './notification.catalog';

const LOCALES: AppLocale[] = ['fr', 'ar', 'en'];
const sample = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, ['stock', 'min', 'minutes', 'failures', 'used', 'limit', 'count', 'credits', 'imported', 'skipped', 'total', 'amount'].includes(k) ? 7 : `<${k}>`]));
const cases = NotificationTypeValues.flatMap((type) => LOCALES.map((locale) => [type, locale] as [NotificationType, AppLocale]));

describe('notification catalogue', () => {
  it('declares the text parameters of every enum value', () => {
    expect(Object.keys(NOTIFICATION_PARAMS).sort()).toEqual([...NotificationTypeValues].sort());
  });

  it.each(cases)('%s (%s) renders with its declared parameters, no placeholder left', (type, locale) => {
    const missing: string[] = [];
    const data = sample(NOTIFICATION_PARAMS[type]);
    expect(missingNotificationParams(type, data)).toEqual([]);
    const { title, body } = renderNotification(type, data, locale, (_t, p) => missing.push(p));
    expect(missing).toEqual([]); // every placeholder of the templates is a declared parameter
    expect(`${title}\n${body}`).not.toMatch(/[{}]/);
    expect(title.length).toBeGreaterThan(0);
    // each declared parameter is really used by a text of the type (no dead parameter) — in at least one locale
    if (locale === 'fr') {
      const templates = Object.entries(getMessages('fr'))
        .filter(([k]) => k.startsWith(`notification.${notificationSlug(type)}.`))
        .map(([, v]) => v)
        .join('\n');
      const variantParams = new Set((NOTIFICATION_VARIANTS[type] ?? []).flatMap((v) => v.params));
      for (const key of NOTIFICATION_PARAMS[type]) if (!variantParams.has(key) && templates) expect(templates).toContain(`{${key}`);
    }
  });

  it.each(Object.entries(NOTIFICATION_VARIANTS).flatMap(([type, variants]) => variants!.flatMap((v) => LOCALES.map((locale) => [type as NotificationType, v.suffix, locale] as const))))('variant %s.%s (%s) renders without a placeholder', (type, suffix, locale) => {
    const variant = NOTIFICATION_VARIANTS[type]!.find((v) => v.suffix === suffix)!;
    const data = { ...sample([...NOTIFICATION_PARAMS[type], ...variant.params]), kind: 'import' };
    expect(variant.when(data)).toBe(true);
    const missing: string[] = [];
    const { title, body } = renderNotification(type, data, locale, (_t, p) => missing.push(p));
    expect(missing).toEqual([]);
    expect(`${title}\n${body}`).not.toMatch(/[{}]/);
    expect(title).toBe(renderNotification(type, data, locale).title);
    expect(title).not.toBe(renderNotification(type, sample(NOTIFICATION_PARAMS[type]), locale).title); // the variant text, not the generic one
  });

  it('a parameter missing at runtime renders as an empty string and is reported with the type — never `{name}`', () => {
    const missing: [string, string][] = [];
    const out = renderNotification('stock_low', { stock: 3 }, 'fr', (t, p) => missing.push([t, p]));
    expect(out.title).toBe('Stock faible : (3 restants)');
    expect(out.body).toBe('Seuil : . Une seule alerte par jour et par produit.');
    expect(missing).toEqual([['stock_low', 'product'], ['stock_low', 'min']]);
    expect(missingNotificationParams('stock_low', { stock: 3 })).toEqual(['product', 'min']);
    // the default reporter only logs: nothing throws
    expect(() => renderNotification('stock_out', {}, 'fr')).not.toThrow();
  });

  it('what the producers send renders the expected texts', () => {
    expect(renderNotification('stock_low', { product: 'Robe kabyle · M', stock: 2, min: 5 }, 'fr')).toEqual({ title: 'Stock faible : Robe kabyle · M (2 restants)', body: 'Seuil : 5. Une seule alerte par jour et par produit.' });
    expect(renderNotification('stock_out', { product: 'Robe kabyle' }, 'fr').title).toBe('Rupture : Robe kabyle');
    // rows stored before the parameters were named like the placeholders still read correctly
    expect(renderNotification('stock_low', { name: 'Théière', stock: 1, minStock: 4 }, 'fr').title).toBe('Stock faible : Théière (1 restants)');
    expect(renderNotification('job_finished', { name: 'export', kind: 'export' }, 'fr').title).toBe('Tâche terminée : Export');
    expect(renderNotification('job_finished', { label: 'product-import-commit', kind: 'import', imported: 12, skipped: 3 }, 'fr')).toEqual({
      title: 'Import terminé : 12 produits importés, 3 lignes ignorées',
      body: 'Téléchargez le rapport d\'erreurs pour corriger les 3 lignes.',
    });
    // member roles are shown with their label
    expect(renderNotification('member_role_changed', { role: 'admin' }, 'fr').title).toBe(`Votre rôle est maintenant ${getMessages('fr')['enum.Membership.role.admin']}`);
    expect(renderNotification('member_joined', { name: 'Amine Benali', role: 'operator' }, 'en').title).toContain(getMessages('en')['enum.Membership.role.operator']);
  });

  it('UX-059: codes carried by the parameters are shown in words, in every locale', () => {
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      expect(renderNotification('conversation_handoff', { client: 'Ilyes', reason: 'customer_request' }, locale).body).toContain(m['inbox.handoff.reason.human_request']);
      expect(renderNotification('conversation_handoff', { client: 'Ilyes', reason: 'unclear_streak' }, locale).body).toContain(m['inbox.handoff.reason.unclear']);
      const texts = [
        renderNotification('conversation_handoff', { client: 'Ilyes', reason: 'customer_request' }, locale),
        renderNotification('conversation_handoff', { client: 'Ilyes', reason: 'some_new_reason' }, locale),
        renderNotification('order_status_changed', { number: 'CMD-1003', from: 'new', to: 'cancelled' }, locale),
        renderNotification('agent_insight', { agent: 'Nadia', type: 'unknown_topic' }, locale),
        renderNotification('customer_auto_blocked', { client: 'Ilyes', rule: 'autoBlockAfterUncollected' }, locale),
        renderNotification('moderation_appeal_result', { name: 'Robe', decision: 'upheld' }, locale),
        renderNotification('report_resolved', { decision: 'block_confirmed' }, locale),
        renderNotification('job_finished', { name: 'product-labels', kind: 'labels' }, locale),
        renderNotification('job_failed', { name: 'faq-extract', kind: 'faq_extraction' }, locale),
      ];
      for (const r of texts) expect(`${r.title} ${r.body}`).not.toMatch(/customer_request|some_new_reason|unknown_topic|autoBlockAfterUncollected|upheld|block_confirmed|product-labels|faq-extract|\bnew\b|cancelled/);
    }
    expect(renderNotification('order_status_changed', { number: 'CMD-1003', from: 'new', to: 'cancelled' }, 'fr').title).toBe('Commande #CMD-1003 : Nouvelle → Annulée');
  });

  it('every type has a family and a deep link', () => {
    for (const type of NotificationTypeValues) {
      expect(notificationGroup(type)).toBeTruthy();
      const link = notificationDeepLink(type, {});
      expect(link.web.startsWith('/')).toBe(true);
      expect(link.mobile).toBe(`djaber://${link.web.slice(1)}`);
    }
  });

  it('job links open the screen that reads `?job=` (orders vs products import by job name; page / agent from the payload)', () => {
    expect(jobPath({ jobId: 'j1', kind: 'import', name: 'order-import-commit' })).toBe('/orders/import?job=j1');
    expect(jobPath({ jobId: 'j1', kind: 'import', name: 'product-import-preview' })).toBe('/products/import?job=j1');
    expect(jobPath({ jobId: 'j1', kind: 'bulk_send' })).toBe('/delivery?job=j1');
    expect(jobPath({ jobId: 'j1', kind: 'labels' })).toBe('/delivery?job=j1');
    expect(jobPath({ jobId: 'j1', kind: 'analysis', channelId: 'c1' })).toBe('/channels/c1/analysis');
    expect(jobPath({ jobId: 'j1', kind: 'analysis' })).toBe('/channels');
    expect(jobPath({ jobId: 'j1', kind: 'faq_extraction', agentId: 'a1' })).toBe('/agents/a1/configuration');
    expect(jobPath({ jobId: 'j1', kind: 'report_export' })).toBe('/reports?job=j1');
    expect(jobRefs({ name: 'history-sync', channelId: 'c1', days: 30, agentId: '' })).toEqual({ name: 'history-sync', channelId: 'c1' });
    expect(jobRefs(null)).toEqual({});
    expect(notificationDeepLink('job_failed', { jobId: 'j1', kind: 'import', name: 'order-import-commit' }).web).toBe('/orders/import?job=j1');
  });

  it('a failed parcel opens the delivery list filtered on its order (`ids`) with its tracking panel', () => {
    expect(parcelPath({ orderId: 'o1', shipmentId: 's1' })).toBe('/delivery?tab=all&ids=o1&sheet=s1');
    expect(parcelPath({ orderId: 'o1' })).toBe('/delivery?tab=all&ids=o1');
    expect(notificationDeepLink('shipment_failed', { orderId: 'o1', shipmentId: 's1' }).web).toBe('/delivery?tab=all&ids=o1&sheet=s1');
  });
});
