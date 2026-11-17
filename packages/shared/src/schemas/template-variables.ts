// The `{…}` variables a merchant may type in the texts sent to customers (full-test 15/11 SETTINGS-02, journeys 16/11
// J09-11 / J09-12): system messages and quick replies. A variable is matched whatever its case and its inner spaces
// (« {PRODUCT} » = « {product} »); any other `{…}` is unknown and refused inline, never sent raw.
import type { SystemMessageKey } from './workspace';

/** Variables of each system message (the server fills them when it sends the message). */
export const SYSTEM_MESSAGE_VARIABLES: Record<SystemMessageKey, readonly string[]> = {
  handoff: ['shop'],
  out_of_hours: ['shop'],
  out_of_stock: ['product', 'shop'],
  welcome: ['shop'],
};
/** Variables of a quick reply as shown to the merchant (INB-03); `QUICK_REPLY_ACCEPTED` also takes the aliases the composer fills. */
export const QUICK_REPLY_VARIABLES = ['prénom', 'boutique', 'total'] as const;
export const QUICK_REPLY_ACCEPTED: readonly string[] = [...QUICK_REPLY_VARIABLES, 'prenom', 'firstname', 'shop'];

/** The `{…}` slots of `text` that are not one of `allowed` (case-insensitive), each once, as typed. */
export const unknownVariables = (text: string, allowed: readonly string[]): string[] => [
  ...new Set(
    [...text.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]).filter((v) => !allowed.includes(v.slice(1, -1).trim().toLowerCase())),
  ),
];

/** `allowed` written as the merchant types them: « {product}, {shop} ». */
export const variablesLabel = (allowed: readonly string[]): string => allowed.map((v) => `{${v}}`).join(', ');
