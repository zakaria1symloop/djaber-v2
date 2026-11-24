// The AI port and its adapter. SAFETY: no provider key belongs on a developer machine, so the live adapter is refused in
// development / test unless AI_ALLOW_LIVE=true is set on purpose (01-nest-module-map §9: fake adapters by default).
import type { AppConfig } from '../../../core/config/config.schema';
import type { AiGateway } from './ai.gateway';
import { FakeAiGateway } from './fake-ai.gateway';
import { LiveAiGateway } from './live-ai.gateway';

type AiEnv = Pick<AppConfig, 'NODE_ENV' | 'AI_DRIVER' | 'AI_ALLOW_LIVE'> & Partial<Pick<AppConfig, 'AI_REPLY_THINKING' | 'AI_STABLE_TOOLS'>>;

export const createAiGateway = (env: AiEnv): AiGateway => {
  if (env.AI_DRIVER !== 'live') return new FakeAiGateway();
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (local && !env.AI_ALLOW_LIVE) {
    throw new Error('AI_DRIVER=live is refused in development / test: set AI_DRIVER=fake (or AI_ALLOW_LIVE=true if you really mean to call the AI providers)');
  }
  return new LiveAiGateway({ replyThinking: env.AI_REPLY_THINKING ?? 'low', stableTools: env.AI_STABLE_TOOLS === 'on' });
};
