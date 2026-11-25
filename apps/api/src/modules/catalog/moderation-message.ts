// UX-099 (Houssem live 25/11): the sentence the system writes when it refuses a product for a banned word
// (`products.form.moderation.autoRejected`) is stored once, in the shop's language of that day — the French and the Arabic
// screens then showed « Rejected automatically: « drogues » is a banned word on Djaber (Title)… ». 07-architecture §4: a text the
// server stored is shown in the reader's language. The stored sentence is read back with the template of each language, and
// written again with the reader's one; the merchant's own word stays as typed. Anything else (a moderator's message) is returned
// as it is.
import { formatMessage, getMessages, type AppLocale } from '@djaber/shared';

const KEY = 'products.form.moderation.autoRejected';
const FIELD = 'products.form.moderation.field.';
const LOCALES: AppLocale[] = ['fr', 'ar', 'en'];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const autoRejectedIn = (message: string | null | undefined, locale: AppLocale): string | null => {
  if (!message) return message ?? null;
  const target = getMessages(locale);
  for (const l of LOCALES) {
    const source = getMessages(l);
    const template = source[KEY];
    if (!template) continue;
    const names: string[] = [];
    const body = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return escape(part);
        names.push(m[1]!);
        return '(.+?)';
      })
      .join('');
    const hit = new RegExp(`^${body}$`).exec(message.trim());
    if (!hit) continue;
    const params: Record<string, string> = Object.fromEntries(names.map((n, i) => [n, hit[i + 1] ?? '']));
    // the field was stored as its label in the language of the sentence (« Title », « Titre »): its key gives the reader's label
    const fieldKey = Object.keys(source).find((k) => k.startsWith(FIELD) && source[k] === params.field);
    const field = (fieldKey && (target[fieldKey] ?? getMessages('fr')[fieldKey])) || params.field || '';
    return formatMessage(target[KEY] ?? template, { word: params.word ?? '', field });
  }
  return message;
};
