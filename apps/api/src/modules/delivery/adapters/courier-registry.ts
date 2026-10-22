// Picks the courier driver. SAFETY: `COURIER_DRIVER=live` is refused in development / test unless
// `COURIER_ALLOW_LIVE=true` (no real parcel may be created from a developer machine or a test run); tests always fake.
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '../../../core/config/config.service';
import type { AppConfig } from '../../../core/config/config.schema';
import { MetricsService } from '../../../core/metrics/metrics.service';
import { ZR_APP_CAPABILITIES, zrPlatformOf, type CourierAdapter, type CourierProvider } from './courier-adapter';
import { EcotrackAdapter } from './ecotrack.adapter';
import { FakeCourierAdapter, FakeCourierBackend } from './fake-courier';
import { fetchTransport, type CourierTransport } from './http';
import { ManualAdapter } from './manual.adapter';
import { YalidineAdapter } from './yalidine.adapter';
import { ZrExpressAppAdapter } from './zrexpress-app.adapter';
import { ZrExpressAdapter } from './zrexpress.adapter';

type CourierEnv = Pick<AppConfig, 'NODE_ENV' | 'COURIER_DRIVER' | 'COURIER_ALLOW_LIVE'>;

export const createCourierAdapters = (env: CourierEnv, transport: CourierTransport = fetchTransport()) => {
  const fake = new FakeCourierBackend();
  const manual = new ManualAdapter();
  if (env.COURIER_DRIVER !== 'live') {
    return { driver: 'fake' as const, fake, adapters: { zrexpress: new FakeCourierAdapter('zrexpress', fake), ecotrack: new FakeCourierAdapter('ecotrack', fake), yalidine: new FakeCourierAdapter('yalidine', fake), manual } as Record<CourierProvider, CourierAdapter>, zrApp: new FakeCourierAdapter('zrexpress', fake, ZR_APP_CAPABILITIES) as CourierAdapter };
  }
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (local && !env.COURIER_ALLOW_LIVE) {
    throw new Error('COURIER_DRIVER=live is refused in development / test: set COURIER_DRIVER=fake (or COURIER_ALLOW_LIVE=true if you really mean to create real parcels)');
  }
  return { driver: 'live' as const, fake, adapters: { zrexpress: new ZrExpressAdapter(transport), ecotrack: new EcotrackAdapter(transport), yalidine: new YalidineAdapter(transport), manual } as Record<CourierProvider, CourierAdapter>, zrApp: new ZrExpressAppAdapter(transport) as CourierAdapter };
};

/** `courier_requests_total{provider,outcome}` (M6 carry-over): every async adapter call, outcome `ok` or the error code. */
const metered = (provider: string, adapter: CourierAdapter, metrics: MetricsService): CourierAdapter =>
  new Proxy(adapter, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function' || provider === 'manual') return v;
      return (...args: unknown[]) => {
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        if (!out || typeof (out as Promise<unknown>).then !== 'function') return out;
        return (out as Promise<unknown>).then(
          (res) => {
            metrics.courier(provider, 'ok');
            return res;
          },
          (err: unknown) => {
            const code = (err as { code?: unknown })?.code;
            metrics.courier(provider, typeof code === 'string' ? code : 'error');
            throw err;
          },
        );
      };
    },
  });

@Injectable()
export class CourierAdapters {
  readonly driver: 'fake' | 'live';
  /** the fake backend (scripting in tests and in the dev simulator); unused with the live driver */
  readonly fake: FakeCourierBackend;
  private readonly adapters: Record<CourierProvider, CourierAdapter>;
  /** ZR Express new platform (accounts whose `baseUrl` is `ZR_APP_BASE_URL`) */
  private readonly zrApp: CourierAdapter;

  constructor(config: ConfigService, @Optional() metrics?: MetricsService) {
    const r = createCourierAdapters(config.all);
    this.driver = r.driver;
    this.fake = r.fake;
    this.adapters = (metrics ? Object.fromEntries(Object.entries(r.adapters).map(([k, a]) => [k, metered(k, a, metrics)])) : r.adapters) as Record<CourierProvider, CourierAdapter>;
    this.zrApp = metrics ? metered('zrexpress', r.zrApp, metrics) : r.zrApp;
    new Logger('CourierAdapters').log(`courier adapters: ${r.driver}`);
  }

  /** Adapter of a provider; `baseUrl` = the account's (picks the ZR Express platform). */
  get(provider: CourierProvider | string, baseUrl?: string | null): CourierAdapter {
    if (zrPlatformOf(provider, baseUrl) === 'app') return this.zrApp;
    const a = this.adapters[provider as CourierProvider];
    if (!a) throw new Error(`unknown courier provider ${provider}`);
    return a;
  }
}
