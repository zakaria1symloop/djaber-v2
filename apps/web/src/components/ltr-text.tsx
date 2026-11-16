// A translated sentence with one left-to-right value inside (e-mail, phone, reference): the value is one LTR box that
// wraps as a whole — in Arabic its parts are not reordered, in French it is not broken at its hyphen (full-test 15/11
// ONBOARDING-15, CLAUDE.md rule 7 `<Ltr>`).
import type { ReactNode } from 'react';
import type { TFunction } from '@/lib/i18n';

const MARK = String.fromCharCode(0xe000); // private-use character: never in a message

/** `t(key, { ...params, [param]: value })` with `value` rendered as an LTR box. */
export function tWithLtr(t: TFunction, key: string, param: string, value: string, params: Record<string, string | number> = {}): ReactNode {
  const parts = t(key, { ...params, [param]: MARK }).split(MARK);
  if (parts.length < 2) return t(key, { ...params, [param]: value });
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 ? (
        <bdi dir="ltr" className="inline-block max-w-full align-bottom [overflow-wrap:anywhere]">
          {value}
        </bdi>
      ) : null}
    </span>
  ));
}
