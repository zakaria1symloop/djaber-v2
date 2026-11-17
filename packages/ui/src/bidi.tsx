// Full-test 15/11 AI-CHAT-18: inside a right-to-left bubble the space of « 4 900 » made the browser show « 900 4 » (a
// neutral between two numbers takes the paragraph's direction). Each number group (digits joined by spaces, dots or
// commas) is isolated left-to-right; a left-to-right text is unchanged.
// Journey 16/11 J03-7: in an Arabic-script text, a run of Latin words (« (stop-desk) », « ZR Express », « Robe kabyle
// M ») is isolated too, its brackets with it — « (-stop » / « desk) » were split over two lines with mirrored brackets.
import { Fragment, type ReactNode } from 'react';

const NUMBER_GROUP = String.raw`\d+(?:[ \u00a0\u202f.,]\d+)*`;
const LATIN_WORD = String.raw`[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’_.\-]*`;
const LATIN_RUN = String.raw`${LATIN_WORD}(?:[ \u00a0](?:${LATIN_WORD}|\d+))*`;
const NUMBERS = new RegExp(NUMBER_GROUP, 'g');
/** a bracketed Latin run with its brackets, a Latin run, or a number group */
const RUNS = new RegExp(String.raw`\((?:${LATIN_RUN}|${NUMBER_GROUP})\)|${LATIN_RUN}|${NUMBER_GROUP}`, 'g');
const ARABIC = /[؀-ۿ]/;

/** `text` split into plain parts and `<bdi dir="ltr">` islands (one per match of `re`). */
const isolate = (text: string, re: RegExp): ReactNode => {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(
      <bdi key={m.index} dir="ltr">
        {m[0]}
      </bdi>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
};

/** `text` with every number group (and, in an Arabic-script text, every Latin run) in a `<bdi dir="ltr">` (CLAUDE.md rule 7). */
export function isolateNumbers(text: string): ReactNode {
  if (ARABIC.test(text) && /[A-Za-zÀ-ÿ]/.test(text)) return isolate(text, RUNS);
  if (!/\d[ \u00a0\u202f.,]\d/.test(text)) return text;
  return isolate(text, NUMBERS);
}
