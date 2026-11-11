// Menu rule of a list row (no server descriptors on rows): same keys and reasons as `ConversationService.actions`.
import { describe, expect, it } from 'vitest';
import { localActions } from './use-conversation-actions';

const may = { block: true, unblock: true, remove: true };
const row = { status: 'active' as const, aiPaused: false, unreadCount: 0, blocked: false };
const of = (actions: ReturnType<typeof localActions>, key: string) =>
  actions.find((a) => a.key === key)!;

describe('localActions — pause / resume the AI', () => {
  it('recette 11/11 (Badro): no credit left ⇒ « Reprendre l’IA » greyed with INSUFFICIENT_CREDITS until a top-up', () => {
    expect(of(localActions({ ...row, status: 'needs_human', aiPaused: true, pageHasAgent: true }, may, true), 'resumeAi')).toEqual({ key: 'resumeAi', enabled: false, reasonCode: 'INSUFFICIENT_CREDITS' });
    expect(of(localActions({ ...row, aiPaused: true, pageHasAgent: true }, may, false), 'resumeAi').enabled).toBe(true);
    // pausing stays possible without credits
    expect(of(localActions({ ...row, pageHasAgent: true }, may, true), 'pauseAi').enabled).toBe(true);
  });
  it('a page with an agent: pause while it answers, resume once paused', () => {
    expect(of(localActions({ ...row, pageHasAgent: true }, may), 'pauseAi')).toEqual({
      key: 'pauseAi',
      enabled: true,
    });
    expect(
      of(localActions({ ...row, aiPaused: true, pageHasAgent: true }, may), 'resumeAi'),
    ).toEqual({ key: 'resumeAi', enabled: true });
  });
  it('no agent on the page and none answered: both greyed with CONVERSATION_NO_AGENT', () => {
    const a = localActions({ ...row, pageHasAgent: false, agent: null }, may);
    expect(of(a, 'pauseAi')).toEqual({
      key: 'pauseAi',
      enabled: false,
      reasonCode: 'CONVERSATION_NO_AGENT',
    });
    const paused = localActions(
      { ...row, status: 'needs_human', aiPaused: true, pageHasAgent: false, agent: null },
      may,
    );
    expect(of(paused, 'resumeAi')).toEqual({
      key: 'resumeAi',
      enabled: false,
      reasonCode: 'CONVERSATION_NO_AGENT',
    });
  });
  it('the agent that answered the conversation still counts; a row without the field is not refused', () => {
    expect(
      of(
        localActions(
          { ...row, pageHasAgent: false, agent: { id: 'a1', name: 'Vendeur', status: 'active' } },
          may,
        ),
        'pauseAi',
      ).enabled,
    ).toBe(true);
    expect(of(localActions(row, may), 'pauseAi').enabled).toBe(true);
  });
});
