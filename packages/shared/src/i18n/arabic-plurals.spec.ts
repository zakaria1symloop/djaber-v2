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

describe('Arabic plural forms (journey J13v-4)', () => {
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
