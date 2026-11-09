// Key of a new platform rule: `<kind>.[<locale>.]<slug of the value>` (ModerationRuleSchema: [a-z0-9_.-], 2–80 chars). A
// value without Latin letters (Arabic) gets a short hash of itself, so the same word always has the same key.
export function ruleKey(kind: string, value: string, locale?: string | null): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const hash = [...value.trim()].reduce((n, ch) => (n * 31 + ch.codePointAt(0)!) >>> 0, 7).toString(36);
  return `${kind}.${locale ? `${locale}.` : ''}${slug || `w${hash}`}`.slice(0, 80);
}

/** PV 09/11 « les mots interdits multi langue ar fr en »: the lists a word is entered for in each language. */
export const MULTILINGUAL_KINDS = ['blocked_word', 'prohibited_category', 'sensitive_category'] as const;
export const RULE_LOCALES = ['fr', 'ar', 'en'] as const;
export type RuleLocale = (typeof RULE_LOCALES)[number];
