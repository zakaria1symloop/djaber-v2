// 04-ai-pipeline — every threshold of the AI pipeline lives here.
import { CREDIT_COST } from '@djaber/shared';

/** §4.2: 3 tool rounds + the final answer. */
export const MAX_STEPS = 4;
/** §3: last messages of the conversation given to the model. */
export const HISTORY_MESSAGES = 30;
/** §3.5 (D34): above this many products in scope the catalogue is retrieved instead of listed. */
export const FULL_CATALOGUE_MAX = 60;
export const RETRIEVAL_TOP = 30;
export const LAST_PRODUCTS_MAX = 10;
export const DESCRIPTION_MAX = 300;
export const DESCRIPTION_TRUNCATED = 100;
export const FAQ_MAX_CHARS = 20_000;
/** §3 token budget: `contextTokens − maxTokens − 512`; used when `AiModel.contextTokens` is null. */
export const DEFAULT_CONTEXT_TOKENS = 32_000;
export const PROMPT_RESERVE_TOKENS = 512;
/** §6: whole-run budget (the per-call timeout is `AiRoute.timeoutSec`). */
export const RUN_BUDGET_MS = 45_000;
/** PV 28/10: a customer photo still downloading when the batching window closes is waited for, at most this long. */
export const MEDIA_WAIT_MS = 12_000;
export const MEDIA_WAIT_STEP_MS = 1_000;
export const DEFAULT_CALL_TIMEOUT_S = 20;
/** §6 circuit breaker. */
export const BREAKER_WINDOW_S = 600;
export const BREAKER_OPEN_S = 300;
export const BREAKER_MIN_CALLS = 5;
/** §5: runs still `running` after this long are reaped (credits released). */
export const RUN_REAP_AFTER_MS = 5 * 60_000;
/** §9: customer photos above this size are not analysed. */
export const VISION_MAX_BYTES = 5 * 1024 * 1024;
export const VISION_CANDIDATES = 10;
export const VISION_CONFIDENCE_MIN = 0.7;
/** §9 voice: download cap and maximum length. */
export const VOICE_MAX_BYTES = 25 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 120;
/** §9: `ai-reply` waits at most this long for the transcript before F-5. */
export const VOICE_WAIT_MS = 30_000;
export const CAPTION_MAX = 200;
/** §10: handoff message at most once per episode / 24 h. */
export const HANDOFF_MESSAGE_EVERY_MS = 86_400_000;
export const UNCLEAR_STREAK_HANDOFF = 3;
/** §4.2 `add_faq_candidate`: surfaced as an insight from this count. */
export const FAQ_CANDIDATE_INSIGHT_AT = 3;
/** 03-events §3: `ai.error` notification when ≥ 3 final failures in 10 minutes for a workspace. */
export const AI_ERROR_ALERT_FAILURES = 3;
export const AI_ERROR_ALERT_WINDOW_S = 600;
/** 02 §6: per-turn cost = the highest of text / voice / image. */
export const plannedCost = (p: { hasAudio: boolean; hasImage: boolean }) => Math.max(CREDIT_COST.text, p.hasAudio ? CREDIT_COST.voice : 0, p.hasImage ? CREDIT_COST.image : 0);
/** §9 fixed voice route (not editable on ADM-06 except the timeout). */
export const VOICE_PRIMARY = { provider: 'groq', modelId: 'whisper-large-v3-turbo' } as const;
export const VOICE_FALLBACK = { provider: 'openai', modelId: 'whisper-1' } as const;
