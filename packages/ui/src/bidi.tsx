// Full-test 15/11 AI-CHAT-18: inside a right-to-left bubble the space of « 4 900 » made the browser show « 900 4 » (a
// neutral between two numbers takes the paragraph's direction). Each number group (digits joined by spaces, dots or
// commas) is isolated left-to-right; a left-to-right text is unchanged.
import { Fragment, type ReactNode } from 'react';

const NUMBER_GROUP = /\d+(?:[ \u00a0\u202f.,]\d+)*/g;

/** `text` with every number group in a `<bdi dir="ltr">` (CLAUDE.md rule 7 « <Ltr> for numbers »). */
export function isolateNumbers(text: string): ReactNode {
  if (!/\d[ \u00a0\u202f.,]\d/.test(text)) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMBER_GROUP)) {
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
}
