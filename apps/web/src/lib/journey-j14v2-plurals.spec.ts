// journey J14v-2 follow-up (19/11) — the 164 Arabic messages that wrote a count straight before a counted noun now pick the
// CLDR form (dual for 2, plural for 3–10, accusative singular for 11–99, singular for 100+); the call sites pass the number
// (`xN` beside a value already formatted for display). French and English keep their text.
import { describe, expect, it } from 'vitest';
import { getMessages } from '@djaber/shared';
import { makeT } from './format-message';

const ar = makeT('ar', getMessages('ar'));
const fr = makeT('fr', getMessages('fr'));
const en = makeT('en', getMessages('en'));

describe('J14v-2: Arabic counts, by feature', () => {
  it('credits and billing (formatted value + numeric selector)', () => {
    expect(ar('credits.pack.credits', { count: '2', countN: 2 })).toBe('رصيدان');
    expect(ar('credits.pack.credits', { count: '5', countN: 5 })).toBe('5 أرصدة');
    expect(ar('credits.pack.credits', { count: '13', countN: 13 })).toBe('13 رصيدًا');
    expect(ar('credits.pack.credits', { count: '1 200', countN: 1200 })).toBe('1 200 رصيد');
    expect(fr('credits.pack.credits', { count: '1 200', countN: 1200 })).toBe('1 200 crédits');
    expect(fr('credits.pack.credits', { count: '1', countN: 1 })).toBe('1 crédit');
    expect(en('credits.reason.pack', { credits: '500', creditsN: 500 })).toBe('Pack of 500 credits');
    expect(ar('credits.reason.pack', { credits: '2', creditsN: 2 })).toBe('باقة رصيدين');
    expect(ar('billing.description.free', { credits: '50', creditsN: 50 })).toBe('الخطة المجانية · 50 رصيدًا / شهر');
    expect(fr('billing.description.free', { credits: '50', creditsN: 50 })).toBe('Plan gratuit · 50 crédits / mois');
    expect(ar('billing.promo.periods', { count: 2 })).toBe('شهران');
    expect(ar('billing.promo.periods', { count: 6 })).toBe('6 أشهر');
    expect(ar('agents.capabilities.replyText.hint', { cost: 1 })).toBe('رصيد واحد / رد');
    expect(ar('products.form.photo.analyse', { credits: 3 })).toBe('تحليل (3 أرصدة)');
  });

  it('days and minutes', () => {
    expect(ar('channels.sync.days', { days: 7 })).toBe('7 أيام');
    expect(ar('channels.sync.days', { days: 30 })).toBe('30 يومًا');
    expect(ar('channels.sync.daysPro', { days: 90 })).toBe('90 يومًا (برو)');
    expect(ar('orders.status.effectiveError', { days: 2 })).toBe('تاريخ في المستقبل أو أقدم من يومين');
    expect(ar('admin.ws.filter.inactive', { days: 7 })).toBe('غير نشط منذ 7 أيام');
    expect(ar('admin.ws.impersonate.context', { minutes: 30 })).toBe('قراءة فقط · 30 دقيقةً · مسجّل');
    expect(ar('public.pricing.cta.trial', { days: 14 })).toBe('تجربة مجانية لـ 14 يومًا');
    expect(fr('public.pricing.cta.trial', { days: 14 })).toBe('Essai gratuit 14 j');
  });

  it('orders, parcels, clients, wilayas', () => {
    expect(ar('send.bulk.title', { count: 1 })).toBe('إرسال طلب واحد إلى شركة التوصيل');
    expect(ar('send.bulk.title', { count: 2 })).toBe('إرسال طلبين إلى شركة التوصيل');
    expect(ar('send.bulk.valid', { count: 4 })).toBe('4 طلبات جاهزة للإرسال');
    expect(ar('delivery.bulk.syncStarted', { count: 12 })).toBe('تحديث 12 طردًا…');
    expect(ar('clients.bulk.selected', { count: 2 })).toBe('عميلان محددان');
    expect(ar('clients.dialog.tags.context', { count: 13 })).toBe('13 عميلًا محددًا');
    expect(fr('clients.dialog.tags.context', { count: 3 })).toBe('3 clients sélectionnés');
    expect(ar('clients.dialog.delete.conversations', { count: 0 })).toBe('لا محادثات');
    expect(ar('fees.footer', { count: 58, custom: 3, inactive: 0 })).toMatch(/^58 ولايةً · /);
    expect(ar('fees.missingBanner', { count: 2 })).toBe('ولايتان بدون تعريفة مسجلة بعد (تُعرض القيم الافتراضية).');
    expect(ar('orders.confirm.items', { count: 3 })).toBe('3 منتجات');
  });

  it('rows, pages, files', () => {
    expect(ar('reports.export.fileReady', { format: 'CSV', count: '2', countN: 2 })).toBe('CSV جاهز · سطران');
    expect(ar('import.upload.limits', { rows: '5 000', rowsN: 5000 })).toBe('CSV، XLSX، XLS · 5 م.ب كحد أقصى · 5 000 سطر كحد أقصى');
    expect(fr('import.upload.limits', { rows: '5 000', rowsN: 5000 })).toBe('CSV, XLSX, XLS · 5 Mo max · 5 000 lignes max');
    expect(ar('carry.labels.zipFile', { file: 'a.zip', files: '3', filesN: 3, pages: '24', pagesN: 24 })).toBe('a.zip · 3 ملفات PDF · 24 صفحةً');
    expect(fr('carry.labels.zipFile', { file: 'a.zip', files: '3', filesN: 3, pages: '24', pagesN: 24 })).toBe('a.zip · 3 fichiers PDF · 24 pages');
    expect(ar('inventory.validate.description', { counted: '11', countedN: 11, gaps: 2, value: '0 DA' })).toBe('11 سطرًا معدودًا · فرقان · القيمة 0 DA');
  });

  it('agents and channels', () => {
    expect(ar('agents.generate.read', { page: 'P', conversations: '2', conversationsN: 2, messages: '40', messagesN: 40 })).toBe('P · محادثتان · قُرئت 40 رسالةً');
    expect(en('agents.generate.read', { page: 'P', conversations: '2', conversationsN: 2, messages: '40', messagesN: 40 })).toBe('P · 2 conversations · 40 messages read');
    expect(ar('agents.validation.tooLong', { max: 500 })).toBe('طويل جدًا (500 حرف كحد أقصى).');
    expect(ar('channels.limit.pages', { current: 1, limit: 3 })).toBe('1 / 3 من الصفحات');
    expect(ar('channels.event.detail.historySynced', { conversations: 2, messages: 5 })).toBe('تمت مزامنة السجل: محادثتان، 5 رسائل');
  });

  it('a member name is no longer read as a count (« {name} المحادثة »)', () => {
    expect(ar('inbox.system.archived', { name: 'Amina', time: '10:00' })).toBe('أُرشفت المحادثة بواسطة Amina · 10:00');
  });
});
