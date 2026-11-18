// LST-03 rules without a database: name folding (04 §24 unique per user and page), the `?view=` expansion (06 §1).
import { cleanSavedViewFilters, CreateSavedViewSchema, savedViewApiQuery } from '@djaber/shared';
import { mergeViewQuery, savedViewPageOf } from './saved-view-query.interceptor';
import { foldName } from './saved-views.service';

describe('saved views — rules', () => {
  it('names compare without case or extra spaces, accents kept', () => {
    expect(foldName('  À ENVOYER   Sétif ')).toBe(foldName('à envoyer sétif'));
    expect(foldName('Retours')).not.toBe(foldName('Rétours'));
  });

  it('stored filters drop paging, sort and presentation keys', () => {
    expect(cleanSavedViewFilters({ tab: 'new', q: 'amina', page: '2', pageSize: '50', sort: '-total', sheet: 'x', density: 'compact', hide: 'risk', layout: 'grid', view: 'v', cursor: 'c', limit: '10' })).toEqual({ tab: 'new', q: 'amina' });
  });

  it('the status tab becomes the filter it stands for, per list; values travel as URL strings', () => {
    expect(savedViewApiQuery('orders', { tab: 'confirmed', wilayaId: ['19', '16'], neverCalled: true, minTotal: 1000 })).toEqual({ status: 'confirmed', wilayaId: '19,16', neverCalled: 'true', minTotal: '1000' });
    expect(savedViewApiQuery('orders', { tab: 'unknown' })).toEqual({});
    expect(savedViewApiQuery('products', { tab: 'rejected' })).toEqual({ moderationStatus: 'rejected,appealed' });
    expect(savedViewApiQuery('products', { tab: 'hidden', status: 'active' })).toEqual({ status: 'active' }); // explicit filter of the view wins
    expect(savedViewApiQuery('delivery', { tab: 'in_transit' })).toEqual({ shipmentStatus: 'pending,sent,picked_up,in_transit,out_for_delivery' });
    expect(savedViewApiQuery('clients', { tab: 'x', blocked: false, q: '' })).toEqual({});
  });

  it('explicit query params override the stored ones and `view` is consumed', () => {
    expect(mergeViewQuery({ status: 'confirmed', sort: '-total' }, { view: 'id', status: 'new', page: '2' })).toEqual({ status: 'new', sort: '-total', page: '2' });
  });

  it('each list endpoint maps to its page; other paths are left alone', () => {
    expect(savedViewPageOf('/api/v1/orders')).toBe('orders');
    expect(savedViewPageOf('/api/v1/orders/stats')).toBe('orders');
    expect(savedViewPageOf('/api/v1/orders/123')).toBeNull();
    expect(savedViewPageOf('/api/v1/shipments')).toBe('delivery');
    expect(savedViewPageOf('/api/v1/stock/movements')).toBe('movements');
    expect(savedViewPageOf('/api/v1/conversations')).toBe('inbox');
    expect(savedViewPageOf('/api/v1/stock-recommendations')).toBeNull();
  });

  it('a view is validated: name 1–60, known page, flat filters', () => {
    expect(CreateSavedViewSchema.safeParse({ page: 'orders', name: ' Sétif ', filters: { tab: 'new', wilayaId: ['19'] } }).success).toBe(true);
    expect(CreateSavedViewSchema.safeParse({ page: 'orders', name: '   ' }).success).toBe(false);
    expect(CreateSavedViewSchema.safeParse({ page: 'invoices', name: 'x' }).success).toBe(false);
    expect(CreateSavedViewSchema.safeParse({ page: 'orders', name: 'x', filters: { a: { b: 1 } } }).success).toBe(false);
  });
});
