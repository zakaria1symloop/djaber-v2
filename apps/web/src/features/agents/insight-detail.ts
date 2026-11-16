// `AgentInsight.detail` is written by the AI pipeline as a code (`off_catalogue`, `customer_request`, `refund`,
// `blocked_word:<word>`, `faq_candidate`, `outside_window`…) or as free text (a provider error). The cards of the agents
// list, of the Insights tab and of the inbox dialog show it in words: the handoff-reason labels of the inbox for the
// codes they share, the text itself otherwise.
import type { TFunction } from '@/lib/i18n';
import { handoffLabel } from '@/features/inbox/ui';
import { queueReason } from '@/features/queue/logic';

export const insightDetail = (t: TFunction, detail: string | null | undefined): string | null => {
  const raw = detail?.trim();
  if (!raw) return null;
  if (raw === 'faq_candidate') return t('agents.insights.detail.faqCandidate');
  // full-test 15/11 AGENTS-14: the error causes of an « Erreur IA » insight (`malformed_output:no_json`, `provider_error:503 …`)
  if (/^malformed_output\b/.test(raw)) return t('agents.insights.detail.malformed');
  if (/^(provider_error|provider_unavailable|provider|timeout|rate_limited|reaped|internal_error|aborted)\b/.test(raw)) return t('agents.insights.detail.providerError');
  const reason = queueReason(raw);
  if (reason.kind === 'transfer') {
    // a machine value (snake_case, « code:detail ») is never printed as such
    if (/^[a-z0-9]+(?:_[a-z0-9]+)+(?::.*)?$/.test(raw)) return t('inbox.handoff.reason.transfer');
    // free text: shown as the server wrote it
    if (reason.detail) return reason.detail;
    // UX-059: a code is never shown as such — an error code gets its sentence, any other code the plain "handed over"
    if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(raw)) return t.has(`error.${raw}`) ? t(`error.${raw}`) : null;
    return t('inbox.handoff.reason.transfer');
  }
  return handoffLabel(t, raw);
};
