// Owner decision 26/11 — « Autonomie de l'IA »: the share of an agent's conversations the AI kept without asking a person
// to step in. ONE definition for the agents list, the agent page, the agent metrics (`resolutionRate`), Statistiques
// (`autonomyPct`) and the page overview (`aiResolutionPct30d`).
//
// « The AI asked a person » = a hand-off decided in an AI turn: by the model, or by a server rule on its behalf (order limits,
// risky customer, third unclear message, blocked word, …) — recorded as a reply `AiRun` with status `handoff`. A hand-off made
// by a member (`manual`) or by the pause of the agent is not one: the team chose to take the thread.

/** The window of the figure shown on the agents list and at the top of the agent page. */
export const AUTONOMY_DAYS = 30;

export type AgentAutonomy = {
  /** 0–100, `null` when the agent had no conversation in the window */
  pct: number | null;
  /** conversations the agent answered in the window */
  conversations: number;
  /** those of them where the AI asked a person to step in */
  handoffs: number;
  days: typeof AUTONOMY_DAYS;
};

/**
 * `round(100 × (conversations − handoffs) / conversations)`; `null` without a conversation. `decimals` only for the screens
 * that already showed one decimal (Statistiques, page overview) — the formula is the same.
 */
export const autonomyPct = (conversations: number, handoffs: number, decimals = 0): number | null => {
  if (!Number.isFinite(conversations) || conversations <= 0) return null;
  const asked = Math.min(Math.max(Number.isFinite(handoffs) ? handoffs : 0, 0), conversations);
  const f = 10 ** decimals;
  return Math.round((100 * (conversations - asked) * f) / conversations) / f;
};

export const agentAutonomy = (conversations: number, handoffs: number): AgentAutonomy => ({
  pct: autonomyPct(conversations, handoffs),
  conversations,
  handoffs: Math.min(Math.max(handoffs, 0), Math.max(conversations, 0)),
  days: AUTONOMY_DAYS,
});

/** ≥ 90 success · 70–89 warning · < 70 danger · no conversation yet: neutral. */
export const autonomyTone = (pct: number | null): 'success' | 'warning' | 'danger' | 'neutral' => (pct === null ? 'neutral' : pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger');
