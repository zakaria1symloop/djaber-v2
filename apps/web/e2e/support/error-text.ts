// Retest 11/11 UX-056: merchant screens show the readable reason of an error, never its code (« Confirmez la commande avant
// l'envoi. » instead of « … (DELIVERY_ORDER_NOT_CONFIRMED) »); the Super Admin screens still print the code. `errText(code)`
// matches either: the code, or the start of its French message (`error.<CODE>`, up to the first ICU parameter).
import { getMessages } from '@djaber/shared';

const FR = getMessages('fr');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const errText = (code: string): RegExp => {
  const head = (FR[`error.${code}`] ?? '').split('{')[0]!.trim();
  return new RegExp(head.length >= 6 ? `${escape(code)}|${escape(head)}` : escape(code));
};
