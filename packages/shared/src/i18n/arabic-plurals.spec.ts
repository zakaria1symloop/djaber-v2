// journey J13v-4 (J13r-11 family) — Arabic counted nouns follow the CLDR forms: `two` is the dual (« عنصران »), never the
// plural of 3–10; `many` (11–99) is the accusative singular (« 79 عنصرًا »), never the bare singular of `one`; a message
// that varies at all has its `few` and `many` forms (else 11–99 or 100+ read wrong). Every Arabic catalogue is checked.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, 'messages');

type Block = { arg: string; forms: Record<string, string> };
/** The `{arg, plural, …}` blocks of a message (nested blocks included), with the text of each form. */
export function pluralBlocks(msg: string): Block[] {
  const out: Block[] = [];
  const re = /\{\s*(\w+)\s*,\s*plural\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    let i = m.index + m[0].length;
    const forms: Record<string, string> = {};
    const sel = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/y;
    for (;;) {
      sel.lastIndex = i;
      const s = sel.exec(msg);
      if (!s) break;
      let depth = 1;
      let j = s.index + s[0].length;
      for (; j < msg.length && depth; j++) {
        if (msg[j] === '{') depth++;
        else if (msg[j] === '}') depth--;
      }
      forms[s[1]!] = msg.slice(s.index + s[0].length, j - 1);
      i = j;
    }
    out.push({ arg: m[1]!, forms });
  }
  return out;
}

const counted = (text: string | undefined) => !!text && /#|\{\w+\}/.test(text);

export function arabicPluralProblems(messages: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [key, msg] of Object.entries(messages)) {
    if (typeof msg !== 'string' || !msg.includes('plural')) continue;
    for (const { arg, forms } of pluralBlocks(msg)) {
      const { one, two, few, many, other } = forms;
      if (one !== undefined && many !== undefined && counted(one) && many === one) problems.push(`${key} {${arg}}: many = one (« ${many} »), 11–99 need the accusative (« 79 عنصرًا »)`);
      if (two !== undefined && few !== undefined && counted(two) && two === few) problems.push(`${key} {${arg}}: two = few (« ${two} »), 2 is the dual (« عنصران »)`);
      if (few !== undefined && many === undefined) problems.push(`${key} {${arg}}: few without many`);
      if (one !== undefined && few === undefined && counted(other) && other !== one) problems.push(`${key} {${arg}}: one / other only, 3–10 and 11–99 need few / many`);
      if (one !== undefined && few === undefined && counted(other) && other === one) problems.push(`${key} {${arg}}: one = other (« ${other} »), the noun never varies`);
    }
  }
  return problems;
}

/**
 * journey J14v-2 (19/11): a count written straight before a counted noun, outside any plural block — « {count} وحدة » reads « 2 وحدة »,
 * « 5 وحدة » (« وحدتان », « 5 وحدات » expected). The nouns the app counts, singular and plural, with or without the article.
 */
const COUNTED_NOUNS = [
  'وحدة', 'وحدات', 'قطعة', 'قطع', 'منتج', 'منتجات', 'طلب', 'طلبات', 'طلبية', 'طلبيات', 'عنصر', 'عناصر', 'عميل', 'عملاء', 'زبون', 'زبائن', 'رسالة', 'رسائل',
  'محادثة', 'محادثات', 'يوم', 'أيام', 'ساعة', 'ساعات', 'دقيقة', 'دقائق', 'صورة', 'صور', 'حركة', 'حركات', 'سطر', 'أسطر', 'مادة', 'مواد', 'مرة', 'مرات',
  'محاولة', 'محاولات', 'طرد', 'طرود', 'ولاية', 'ولايات', 'بلدية', 'بلديات', 'متغير', 'متغيرات', 'فاتورة', 'فواتير', 'عملية', 'عمليات', 'مستخدم', 'مستخدمين',
  'عضو', 'أعضاء', 'صفحة', 'صفحات', 'رصيد', 'أرصدة', 'نقطة', 'نقاط', 'حساب', 'حسابات', 'مورد', 'موردين', 'فئة', 'فئات', 'تذكرة', 'تذاكر', 'ملف', 'ملفات',
  'خطأ', 'أخطاء', 'تنبيه', 'تنبيهات', 'إشعار', 'إشعارات', 'وكيل', 'وكلاء', 'قناة', 'قنوات', 'أسبوع', 'أسابيع', 'شهر', 'أشهر', 'سنة', 'سنوات', 'ثانية',
  'نتيجة', 'نتائج', 'كلمة', 'كلمات', 'حرف', 'أحرف', 'سجل', 'سجلات',
];
const COUNT_BEFORE_NOUN = new RegExp(`(\\{\\w+\\}|#)\\s*(?:ال)?(?:${COUNTED_NOUNS.join('|')})(?![\\u0621-\\u064A])`, 'u');
/** The message without its plural / select blocks (nested ones included). */
const outsideBlocks = (msg: string): string => {
  let s = msg;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, '');
  }
  return s;
};
export function countedNounProblems(messages: Record<string, string>): string[] {
  return Object.entries(messages)
    .filter(([, msg]) => typeof msg === 'string' && COUNT_BEFORE_NOUN.test(outsideBlocks(msg)))
    .map(([key]) => key);
}
/**
 * The messages written before this check that still count outside a plural block (a ratchet: a new one fails, a fixed one must leave the
 * list). Some are not counts (« {name} المحادثة »: a member's name). Each is fixed with its call site, which must pass the count as a number.
 */
const BASELINE = JSON.parse(readFileSync(join(__dirname, 'arabic-plurals.baseline.json'), 'utf8')) as Record<string, string[]>;

describe('Arabic plural forms (journey J13v-4)', () => {
  it('journey J14v-2: a count before a counted noun outside a plural block is found (« {count} وحدة »), inside one it is not', () => {
    expect(countedNounProblems({ a: '{count} وحدة', b: 'محجوز {count} وحدة (طلبات)', c: '{count, plural, one {{n} وحدة} two {وحدتان} few {{n} وحدات} many {{n} وحدةً} other {{n} وحدة}}', d: '{amount} دج', e: 'المجموع {total} · {units} وحدة' })).toEqual(['a', 'b', 'e']);
  });

  it.each(readdirSync(DIR).filter((f) => f.endsWith('.ar.json')))('%s: no new count outside a plural block (journey J14v-2 ratchet)', (file) => {
    const messages = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>;
    const found = countedNounProblems(messages);
    const known = new Set(BASELINE[file] ?? []);
    expect(found.filter((k) => !known.has(k))).toEqual([]);
    // a message fixed (or removed) leaves the baseline
    expect([...known].filter((k) => !found.includes(k))).toEqual([]);
  });

  it('reads the forms of a message', () => {
    expect(pluralBlocks('{a} · {count, plural, one {# عنصر} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}')).toEqual([
      { arg: 'count', forms: { one: '# عنصر', two: 'عنصران', few: '# عناصر', many: '# عنصرًا', other: '# عنصر' } },
    ]);
    expect(arabicPluralProblems({ k: '{count, plural, one {# عنصر} two {# عناصر} few {# عناصر} many {# عنصر} other {# عنصر}}' })).toHaveLength(2);
    expect(arabicPluralProblems({ k: '{count, plural, one {{n} رصيد} other {{n} رصيد}}' })).toHaveLength(1);
    expect(arabicPluralProblems({ k: '{count, plural, =0 {الآن} other {منذ # د.}}' })).toEqual([]);
  });

  it.each(readdirSync(DIR).filter((f) => f.endsWith('.ar.json')))('%s: dual, few and many forms are right', (file) => {
    const messages = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>;
    expect(arabicPluralProblems(messages)).toEqual([]);
  });
});
