import { formatNumber } from '../format';
export * from './codes';
export { ERROR_ALIASES } from './aliases';
import fr from './messages.fr.json';
import ar from './messages.ar.json';
import en from './messages.en.json';

export const ERROR_MESSAGES: Record<'fr' | 'ar' | 'en', Record<string, string>> = { fr, ar, en };

/**
 * Replaces `{param}` placeholders. Unknown placeholders are left as-is. journey 16/11 J05-17: an amount (a number placed
 * right before « DA » / « دج ») is grouped by thousands — « (3 000 DA) », never « (3000 DA) »; other numbers stay as given.
 */
export const formatMessage = (template: string, params: Record<string, string | number> = {}) =>
  template.replace(/\{(\w+)\}(\s?(?:DA|دج))?/g, (m, k: string, unit: string | undefined) => {
    if (!(k in params)) return m;
    const v = params[k];
    return `${unit && typeof v === 'number' && Number.isInteger(v) ? formatNumber(v) : String(v)}${unit ?? ''}`;
  });
