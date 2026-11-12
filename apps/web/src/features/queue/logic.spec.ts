// Queue cards: reason line derived from `Conversation.handoffReason` (frame QUEUE — File d'attente — items).
import { describe, expect, it } from 'vitest';
import { queueReason, shortName } from './logic';

describe('queueReason', () => {
  it('no reason ⇒ plain transfer', () => {
    expect(queueReason(null)).toEqual({ kind: 'transfer', detail: null });
    expect(queueReason('  ')).toEqual({ kind: 'transfer', detail: null });
  });
  it.each([
    ['human_request', 'human_request'],
    ['CUSTOMER_REQUEST', 'human_request'],
    ['credits_exhausted', 'credits'],
    ['ai_error', 'ai_error'],
    ['provider_error', 'ai_error'],
    ['risky_client', 'risk'],
    ['blocked_word', 'blocked_word'],
    ['abuse_guard', 'abuse'],
    ['manual', 'manual'],
    ['outside_window', 'window'],
    ['refund', 'refund'],
    ['complaint', 'complaint'],
    ['angry', 'angry'],
    ['unclear_streak', 'unclear'],
    ['off_catalogue', 'off_catalogue'],
    ['order_limits', 'order_limits'],
    ['keyword', 'keyword'],
    ['other', 'transfer'],
  ])('known code %s ⇒ %s', (raw, kind) => {
    expect(queueReason(raw)).toEqual({ kind, detail: null });
  });
  it('prefixed rule or keyword ⇒ transfer with its label', () => {
    expect(queueReason('rule:remboursement')).toEqual({ kind: 'transfer', detail: 'remboursement' });
    expect(queueReason('keyword: « avocat »')).toEqual({ kind: 'transfer', detail: 'avocat' });
    expect(queueReason('rule:credits_exhausted')).toEqual({ kind: 'credits', detail: null });
  });
  it('an order tool refused before the orders module ⇒ orders unavailable', () => {
    expect(queueReason('orders_unavailable')).toEqual({ kind: 'orders_unavailable', detail: null });
  });
  it('an AI reply withheld by the safety filter ⇒ blocked word with the word', () => {
    expect(queueReason('blocked_word:arnaque')).toEqual({ kind: 'blocked_word', detail: 'arnaque' });
  });
  it('UX-059: an unmapped code gets no detail (never shown raw); quota_exceeded is a credits reason', () => {
    expect(queueReason('quota_exceeded')).toEqual({ kind: 'credits', detail: null });
    expect(queueReason('some_new_reason')).toEqual({ kind: 'transfer', detail: null });
    expect(queueReason('rule:SOME_CODE')).toEqual({ kind: 'transfer', detail: null });
  });
  it('free text ⇒ transfer with the text', () => {
    expect(queueReason('demande de remboursement')).toEqual({ kind: 'transfer', detail: 'demande de remboursement' });
  });
});

describe('shortName', () => {
  it('first name + initial of the last name', () => {
    expect(shortName('Amina Belkacem')).toBe('Amina B.');
    expect(shortName('  Sara   ben ali ')).toBe('Sara A.');
    expect(shortName('Yacine')).toBe('Yacine');
    expect(shortName(null)).toBe('');
  });
});
