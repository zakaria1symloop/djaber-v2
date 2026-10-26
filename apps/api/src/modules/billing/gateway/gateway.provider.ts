// Picks the transport of the (only) payment gateway. SAFETY: `PAYMENT_DRIVER=chargily` is refused in development / test
// unless `PAYMENT_ALLOW_LIVE=true` — no real payment can be created from a developer machine or a test run. Even then the
// test mode of Chargily is used unless `CHARGILY_MODE=live`. Tests always run on the simulated Chargily API.
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../../core/config/config.schema';
import { ChargilyGateway, fetchPayTransport, type PayTransport } from './chargily.gateway';
import { FAKE_CHARGILY_BASE, FakeChargilyBackend } from './fake-chargily';
import type Redis from 'ioredis';

type PayEnv = Pick<AppConfig, 'NODE_ENV' | 'PAYMENT_DRIVER' | 'PAYMENT_ALLOW_LIVE' | 'CHARGILY_SECRET' | 'CHARGILY_API_KEY' | 'CHARGILY_MODE' | 'PUBLIC_API_URL'>;
/** HMAC key of the simulated Chargily (never a real key). */
export const FAKE_CHARGILY_SECRET = 'fake-chargily-secret-not-a-real-key';

export const createPaymentGateway = (env: PayEnv, redis: Redis, transport?: PayTransport) => {
  const api = env.PUBLIC_API_URL.replace(/\/$/, '');
  const webhookUrl = `${api}/api/v1/webhooks/chargily`;
  if (env.PAYMENT_DRIVER !== 'chargily') {
    // production must take real payments: the simulated checkout is served nowhere there (it would be a dead end)
    if (env.NODE_ENV === 'production') throw new Error('PAYMENT_DRIVER=fake is refused in production: set PAYMENT_DRIVER=chargily and CHARGILY_SECRET');
    const fake = new FakeChargilyBackend(redis, { pageBase: `${api}/api/v1/dev-payments`, secret: FAKE_CHARGILY_SECRET });
    return { gateway: new ChargilyGateway('fake', fake.transport, { apiBase: FAKE_CHARGILY_BASE, secret: FAKE_CHARGILY_SECRET, webhookUrl }), fake };
  }
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (local && !env.PAYMENT_ALLOW_LIVE) {
    throw new Error('PAYMENT_DRIVER=chargily is refused in development / test: set PAYMENT_DRIVER=fake (or PAYMENT_ALLOW_LIVE=true if you really mean to create Chargily checkouts)');
  }
  const secret = env.CHARGILY_SECRET || env.CHARGILY_API_KEY;
  if (!secret) throw new Error('PAYMENT_DRIVER=chargily needs CHARGILY_SECRET');
  const apiBase = env.CHARGILY_MODE === 'live' ? 'https://pay.chargily.net/api/v2' : 'https://pay.chargily.net/test/api/v2';
  new Logger('PaymentGateway').log(`payment gateway: chargily (${env.CHARGILY_MODE})`);
  return { gateway: new ChargilyGateway('chargily', transport ?? fetchPayTransport(), { apiBase, secret, webhookUrl }), fake: null };
};
