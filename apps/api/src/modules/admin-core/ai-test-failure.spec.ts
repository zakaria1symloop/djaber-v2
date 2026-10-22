// UX-013 (tester report 2026-10-21): a failed provider test says why instead of one « injoignable » for everything.
import { AiProviderError } from '../ai/provider/ai.gateway';
import { testFailure } from './ai-admin.service';

describe('provider test failure reason', () => {
  it('timeout, network, endpoint (404), rate limit (429), provider down (5xx), another HTTP status', () => {
    expect(testFailure(new AiProviderError('timeout', 'groq', 'x'))).toEqual({ reason: 'timeout' });
    expect(testFailure(new AiProviderError('provider_error', 'groq', 'x'))).toEqual({ reason: 'network' });
    expect(testFailure(new AiProviderError('provider_error', 'groq', 'x', 404))).toEqual({ reason: 'endpoint', status: 404 });
    expect(testFailure(new AiProviderError('provider_error', 'groq', 'x', 429))).toEqual({ reason: 'rate_limited', status: 429 });
    expect(testFailure(new AiProviderError('provider_error', 'groq', 'x', 502))).toEqual({ reason: 'provider_down', status: 502 });
    expect(testFailure(new AiProviderError('provider_error', 'groq', 'x', 400))).toEqual({ reason: 'http_error', status: 400 });
  });
});

describe('configured models the provider lists', () => {
  it('an alias of a dated snapshot counts as listed (no false « unknown model » warning)', async () => {
    const { knownModel } = await import('./ai-admin.service');
    const listed = new Set(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash-001', 'llama-3.3-70b-versatile']);
    expect(knownModel(listed, 'claude-haiku-5-5')).toBe(true);
    expect(knownModel(listed, 'claude-haiku-4-5')).toBe(true);
    expect(knownModel(listed, 'llama-3.3-70b')).toBe(false); // a different model, not a snapshot
    expect(knownModel(listed, 'claude-haiku-3')).toBe(false);
  });
});
