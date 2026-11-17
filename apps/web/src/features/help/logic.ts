// Pure rules of the merchant help center (03 §25 HELP-01…04, 12 §25 "Help"). Unit tested; no React.
import { HELP_CATEGORIES, TICKET_MESSAGE_MIN, type HelpCategory, type MemberRole, type TicketCategory } from '@djaber/shared';
import type { Tone } from '@djaber/ui';
import type { HelpArticle, Ticket } from './api';

export const TICKET_CATEGORIES: readonly TicketCategory[] = ['meta_connection', 'credits', 'billing', 'delivery', 'integrations', 'agent', 'stock', 'mobile', 'security', 'other'];

/** HELP-03: Operators cannot pick the billing category (the API answers 403 FORBIDDEN). */
export const allowedCategories = (role: MemberRole | null | undefined): TicketCategory[] => TICKET_CATEGORIES.filter((c) => c !== 'billing' || (role !== 'operator' && role !== null && role !== undefined));

/** Pill of a ticket row (12 §25): OUVERT (RÉPONSE REÇUE when support replied last) · EN ATTENTE CLIENT · RÉSOLU · FERMÉ. */
export type TicketPillKey = 'open' | 'answered' | 'pending_customer' | 'resolved' | 'closed';
export const ticketPill = (t: Pick<Ticket, 'status' | 'awaitingMe'>): TicketPillKey => (t.status === 'open' && t.awaitingMe ? 'answered' : t.status);
export const TICKET_PILL_TONE: Record<TicketPillKey, Tone> = { open: 'info', answered: 'warning', pending_customer: 'neutral', resolved: 'success', closed: 'neutral' };

/** The merchant can still write in the thread (a closed ticket answers TICKET_CLOSED). */
export const canReply = (t: Pick<Ticket, 'status'>) => t.status !== 'closed';
/**
 * Satisfaction 1–5 is asked once the ticket is resolved — or closed (full-test 15/11 HELP-09: « at close ») — and not yet
 * rated (HELP-04; the API closes it on rating, 409 otherwise).
 */
export const canRate = (t: Pick<Ticket, 'status' | 'satisfaction'>) => (t.status === 'resolved' || t.status === 'closed') && (t.satisfaction === null || t.satisfaction === undefined);

export const messageTooShort = (m: string) => m.trim().length < TICKET_MESSAGE_MIN;

/** Ticket category → help category whose guides may answer it (guide suggestion before sending). */
const CATEGORY_GUIDES: Partial<Record<TicketCategory, HelpCategory>> = {
  meta_connection: 'pages_instagram',
  credits: 'credits_billing',
  billing: 'credits_billing',
  delivery: 'orders_delivery',
  agent: 'ai_agent',
  stock: 'stock',
  mobile: 'mobile_app',
  security: 'security_data',
};
export const guideCategoryFor = (c: TicketCategory): HelpCategory | null => CATEGORY_GUIDES[c] ?? null;

const STOP = new Set(['dans', 'avec', 'pour', 'plus', 'mais', 'depuis', 'nest', 'pas', 'sont', 'cette', 'votre', 'notre', 'les', 'des', 'une', 'that', 'this', 'with', 'from', 'have', 'does', 'what', 'when', 'mon', 'mes', 'ma', 'est']);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * "Suggestion : « Reconnecter Google Sheets » (guide) — peut-être la réponse ?" — the guide whose title / excerpt shares the
 * most words with the message (≥ 1 word of 4+ letters), guides of the matching category first. Null when nothing matches.
 */
export function suggestGuide(message: string, category: TicketCategory, articles: readonly HelpArticle[]): HelpArticle | null {
  const ws = new Set(words(message));
  if (ws.size === 0) return null;
  const preferred = guideCategoryFor(category);
  let best: { a: HelpArticle; score: number } | null = null;
  for (const a of articles) {
    const hits = new Set(words(`${a.title} ${a.excerpt}`).filter((w) => ws.has(w))).size;
    if (hits === 0) continue;
    const score = hits * 2 + (preferred && a.category === preferred ? 1 : 0);
    if (!best || score > best.score) best = { a, score };
  }
  return best?.a ?? null;
}

/** Guides per category for the 8 cards (HELP-01), every category present (0 when empty). */
export const countByCategory = (articles: readonly HelpArticle[]): Record<HelpCategory, number> => {
  const out = Object.fromEntries(HELP_CATEGORIES.map((c) => [c, 0])) as Record<HelpCategory, number>;
  for (const a of articles) if (a.category && a.category in out) out[a.category as HelpCategory]++;
  return out;
};

/** "web Chrome 130" / "web Firefox 131" from the user agent (auto-context of a ticket). */
export const clientLabel = (ua: string): string => {
  const m = /Edg\/(\d+)/.exec(ua) ?? null;
  if (m) return `web Edge ${m[1]}`;
  const tests: [RegExp, string][] = [
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[\d.]* Safari/, 'Safari'],
  ];
  for (const [re, name] of tests) {
    const r = re.exec(ua);
    if (r) return `web ${name} ${r[1]}`;
  }
  return 'web';
};

export type AutoContext = { workspace: string; plan: string; client: string; page: string; lastError: string };
export const CONTEXT_KEYS: readonly (keyof AutoContext)[] = ['workspace', 'plan', 'client', 'page', 'lastError'];

/**
 * full-test 15/11 HELP-07: the auto-context system message is stored as `key: value` lines; the merchant reads the form's
 * labels (« Espace : … », « Navigateur : … »), never the raw keys. Other lines are kept as they are. Journey J12-9: the value
 * is a bidi isolate (FSI … PDI), so « /orders » stays « /orders » in an Arabic line (it read « orders/ : الصفحة »).
 */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
export const labelContextLines = (body: string, label: (key: keyof AutoContext) => string): string =>
  body
    .split('\n')
    .map((line) => {
      const m = /^(\w+): (.*)$/.exec(line);
      return m && (CONTEXT_KEYS as readonly string[]).includes(m[1]!) ? `${label(m[1] as keyof AutoContext)} : ${FSI}${m[2]}${PDI}` : line;
    })
    .join('\n');

/** The editable "CONTEXTE JOINT" block (HELP-03): workspace, plan, browser, current page, last error — never customer messages. */
export const buildContext = (i: { workspace?: string | null; plan?: string | null; userAgent: string; page?: string | null; lastError?: { code: string; ref: string; at: string } | null; formatAt: (iso: string) => string }): AutoContext => ({
  workspace: i.workspace ?? '',
  plan: i.plan ?? '',
  client: clientLabel(i.userAgent),
  page: i.page ?? '',
  lastError: i.lastError ? `${i.lastError.code}${i.lastError.ref ? ` · ${i.lastError.ref}` : ''} (${i.formatAt(i.lastError.at)})` : '',
});

/** Context sent to the API: empty lines removed (the merchant may clear any of them). */
export const contextPayload = (c: AutoContext): Record<string, string> => Object.fromEntries(Object.entries(c).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));

/** Only an internal path may be carried as the page of origin (`?from=/settings/integrations`). */
export const safeFrom = (raw: string | null | undefined): string | null => (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw.slice(0, 200) : null);

/** Route key of the "?" contextual panel (`GET /help/articles?context=`): `/fr/orders/123` → `orders`, `/settings/billing` → `settings/billing` (keys of `CmsEntry.target.pages[]`). */
export const contextKey = (pathname: string): string => {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && /^(fr|ar|en)$/.test(parts[0])) parts.shift();
  const keep = parts.filter((p) => !/^[0-9a-f-]{8,}$/i.test(p) && !/^\d+$/.test(p) && !p.startsWith('CMD-'));
  return keep.slice(0, 2).join('/') || 'home';
};

/** Help guide body (CMS text, light Markdown) → safe blocks: `#` headings, `- ` lists, paragraphs. No HTML is rendered. */
export type ArticleBlock = { kind: 'h'; text: string } | { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };
export function articleBlocks(body: string | null | undefined): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  for (const chunk of (body ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      out.push({ kind: 'ul', items: lines.map((l) => l.replace(/^\s*[-*] /, '').trim()) });
      continue;
    }
    // a chunk = headings + one paragraph made of its other lines (a new chunk always starts a new paragraph)
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: 'p', text: para.join('\n') });
      para = [];
    };
    for (const l of lines) {
      if (/^#{1,6} /.test(l)) {
        flush();
        out.push({ kind: 'h', text: l.replace(/^#{1,6} /, '').trim() });
      } else para.push(l.trim());
    }
    flush();
  }
  return out;
}
