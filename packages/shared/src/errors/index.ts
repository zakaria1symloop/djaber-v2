import { formatNumber } from '../format';
export * from './codes';
export { ERROR_ALIASES } from './aliases';
import fr from './messages.fr.json';
import ar from './messages.ar.json';
import en from './messages.en.json';

export const ERROR_MESSAGES: Record<'fr' | 'ar' | 'en', Record<string, string>> = { fr, ar, en };

/**
 * journey J14v-2 (19/11): ICU plurals in the texts the server renders (invoice lines, stored texts, admin notifications,
 * customer messages) — `{count, plural, one {…} two {…} few {…} many {…} other {…}}` picks its branch with the reader's
 * plural rules (`=N` first, then the CLDR category, then `other`); `#` is the number as displayed (« 12 500 »). A value
 * that is not a number keeps the `other` branch. Nested blocks inside the picked branch are expanded too.
 */
export const expandPlurals = (template: string, value: (name: string) => unknown, locale: string): string => {
  if (!template.includes(', plural,')) return template;
  let out = '';
  let i = 0;
  const head = /\{(\w+), plural,/g;
  for (let m = head.exec(template); m; m = head.exec(template)) {
    let depth = 0;
    let j = m.index;
    for (; j < template.length; j++) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}' && --depth === 0) break;
    }
    const body = template.slice(m.index + m[0].length, j);
    const branches = new Map<string, string>();
    const br = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/g;
    for (let b = br.exec(body); b; b = br.exec(body)) {
      let d = 0;
      let k = b.index + b[0].length - 1;
      for (; k < body.length; k++) {
        if (body[k] === '{') d++;
        else if (body[k] === '}' && --d === 0) break;
      }
      branches.set(b[1]!, body.slice(b.index + b[0].length, k));
      br.lastIndex = k + 1;
    }
    const raw = value(m[1]!);
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    const pick = Number.isNaN(n) ? branches.get('other') : (branches.get(`=${n}`) ?? branches.get(new Intl.PluralRules(locale).select(n)) ?? branches.get('other'));
    const shown = Number.isNaN(n) ? String(raw ?? '') : formatNumber(n);
    out += template.slice(i, m.index) + expandPlurals((pick ?? '').replace(/#(?!\{)/g, shown), value, locale);
    i = j + 1;
    head.lastIndex = j + 1;
  }
  return out + template.slice(i);
};

/**
 * Replaces `{param}` placeholders. Unknown placeholders are left as-is. journey 16/11 J05-17: an amount (a number placed
 * right before « DA » / « دج ») is grouped by thousands — « (3 000 DA) », never « (3000 DA) »; other numbers stay as given.
 * Plural blocks are expanded first with the plural rules of `locale` (journey J14v-2; without a locale, an Arabic text
 * reads with the Arabic rules, any other with the French ones).
 */
export const formatMessage = (template: string, params: Record<string, string | number> = {}, locale?: string) =>
  expandPlurals(template, (k) => params[k], locale ?? (/[\u0600-\u06FF]/.test(template) ? 'ar' : 'fr')).replace(/\{(\w+)\}(\s?(?:DA|دج))?/g, (m, k: string, unit: string | undefined) => {
    if (!(k in params)) return m;
    const v = params[k];
    return `${unit && typeof v === 'number' && Number.isInteger(v) ? formatNumber(v) : String(v)}${unit ?? ''}`;
  });
