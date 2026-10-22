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
