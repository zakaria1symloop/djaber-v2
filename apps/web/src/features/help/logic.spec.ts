import { describe, expect, it } from 'vitest';
import type { HelpArticle } from './api';
import { allowedCategories, articleBlocks, buildContext, canRate, canReply, clientLabel, contextKey, contextPayload, countByCategory, labelContextLines, messageTooShort, safeFrom, suggestGuide, ticketPill } from './logic';

const art = (key: string, title: string, category: string | null, excerpt = ''): HelpArticle => ({ key, title, category, excerpt, locale: 'fr', requestedLocale: 'fr', fallback: false, version: 1, publishedAt: null, contexts: [] });

describe('help center rules (HELP-01…04)', () => {
  it('Operators cannot pick the billing category; Owner / Admin can', () => {
    expect(allowedCategories('operator')).not.toContain('billing');
    expect(allowedCategories('admin')).toContain('billing');
    expect(allowedCategories('owner')).toHaveLength(10);
  });

  it('ticket pill: RÉPONSE REÇUE when the support answered last on an open ticket', () => {
    expect(ticketPill({ status: 'open', awaitingMe: true })).toBe('answered');
    expect(ticketPill({ status: 'open', awaitingMe: false })).toBe('open');
    expect(ticketPill({ status: 'pending_customer', awaitingMe: true })).toBe('pending_customer');
    expect(ticketPill({ status: 'resolved', awaitingMe: false })).toBe('resolved');
    expect(ticketPill({ status: 'closed', awaitingMe: false })).toBe('closed');
  });

  it('a closed ticket takes no reply (TICKET_CLOSED); the rating is asked once resolved and not rated', () => {
    expect(canReply({ status: 'closed' })).toBe(false);
    expect(canReply({ status: 'resolved' })).toBe(true);
    expect(canRate({ status: 'resolved', satisfaction: null })).toBe(true);
    expect(canRate({ status: 'resolved', satisfaction: 4 })).toBe(false);
    expect(canRate({ status: 'open', satisfaction: null })).toBe(false);
    // full-test 15/11 HELP-09: asked at close too, once
    expect(canRate({ status: 'closed', satisfaction: null })).toBe(true);
    expect(canRate({ status: 'closed', satisfaction: 3 })).toBe(false);
  });

  it('message of at least 20 characters', () => {
    expect(messageTooShort('trop court')).toBe(true);
    expect(messageTooShort('Depuis hier les commandes n’arrivent plus')).toBe(false);
  });

  it('suggests the guide sharing the most words, guides of the matching category first', () => {
    const guides = [art('sheets', 'Reconnecter Google Sheets', 'getting_started', 'Feuille Google'), art('ig', 'Connecter Instagram', 'pages_instagram'), art('zr', 'Bordereau ZR Express', 'orders_delivery')];
    expect(suggestGuide('Depuis hier les commandes n’arrivent plus dans ma feuille Google Sheets', 'integrations', guides)?.key).toBe('sheets');
    expect(suggestGuide('Instagram ne veut pas se connecter', 'meta_connection', guides)?.key).toBe('ig');
    expect(suggestGuide('bonjour', 'other', guides)).toBeNull();
  });

  it('counts guides per category with every category present', () => {
    const c = countByCategory([art('a', 'A', 'stock'), art('b', 'B', 'stock'), art('c', 'C', null)]);
    expect(c.stock).toBe(2);
    expect(c.getting_started).toBe(0);
    expect(Object.keys(c)).toHaveLength(8);
  });

  it('auto-context: browser label, last error, empty lines dropped from the payload', () => {
    expect(clientLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36')).toBe('web Chrome 130');
    expect(clientLabel('Mozilla/5.0 Firefox/131.0')).toBe('web Firefox 131');
    const ctx = buildContext({ workspace: 'Boutique Amel', plan: 'Pro', userAgent: 'Chrome/130.1', page: '/settings', lastError: { code: 'SHEETS_403', ref: 'r1', at: '2026-10-03T20:12:00Z' }, formatAt: () => '03 oct. 21:12' });
    expect(ctx.lastError).toBe('SHEETS_403 · r1 (03 oct. 21:12)');
    expect(contextPayload({ ...ctx, page: '  ' })).not.toHaveProperty('page');
  });

  it('page of origin: internal paths only', () => {
    expect(safeFrom('/settings/integrations')).toBe('/settings/integrations');
    expect(safeFrom('//evil.example')).toBeNull();
    expect(safeFrom('https://evil.example')).toBeNull();
    expect(safeFrom(null)).toBeNull();
  });

  it('contextual panel key from the route', () => {
    expect(contextKey('/orders/3f2c1a9e-1111-2222-3333-444455556666')).toBe('orders');
    expect(contextKey('/settings/billing')).toBe('settings/billing');
    expect(contextKey('/fr/inbox')).toBe('inbox');
    expect(contextKey('/')).toBe('home');
  });

  it('guide body: headings, lists, paragraphs; no HTML', () => {
    expect(articleBlocks('# Titre\nTexte un\nsuite\n\n- a\n- b\n\n<b>gras</b>')).toEqual([
      { kind: 'h', text: 'Titre' },
      { kind: 'p', text: 'Texte un\nsuite' },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'p', text: '<b>gras</b>' },
    ]);
    expect(articleBlocks(null)).toEqual([]);
  });
});

describe('auto-context labels (full-test 15/11 HELP-07)', () => {
  it('reads the form labels instead of the raw keys, other lines unchanged', () => {
    const NL = String.fromCharCode(10);
    const label = (k: string) => ({ workspace: 'Espace', client: 'Navigateur', page: 'Page' } as Record<string, string>)[k] ?? k;
    const body = ['workspace: Boutique', 'client: web Chrome 156', 'page: /orders', 'note: x'].join(NL);
    expect(labelContextLines(body, label).split(NL)).toEqual(['Espace : Boutique', 'Navigateur : web Chrome 156', 'Page : /orders', 'note: x']);
  });
});
