// Journey J13r-5 — one definition of credit CONSUMPTION: the credits the AI used (the settled debits of its runs). An admin
// removal (`adjustment`) or a store refund (`store_refund`) lowers the balance but is no consumption: it never counts in
// « crédits consommés » (admin overview, top workspaces), « utilisés » (plan usage) or the burn rate « ≈ / J ».
import type { CreditAction } from '@djaber/db';

export const CONSUMPTION_ACTIONS: Extract<CreditAction, 'text_reply' | 'image_recognition' | 'voice_transcription'>[] = ['text_reply', 'image_recognition', 'voice_transcription'];
