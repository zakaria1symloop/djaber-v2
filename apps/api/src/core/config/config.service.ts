import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type AppConfig } from './config.schema';
import { repoRoot } from './repo-root';

/** Minimal `.env` loader (no dependency): the first existing file wins; real env vars always win. */
const loadDotEnv = () => {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(repoRoot(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let value = m[2] ?? '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
       
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
};

let cached: AppConfig | undefined;

export const loadConfig = (): AppConfig => {
  if (cached) return cached;
  loadDotEnv();
   
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`); // never print values
  }
  cached = parsed.data;
  return cached;
};

/** Test helper: forget the cached config (after env changes). */
export const resetConfigCache = () => {
  cached = undefined;
};

@Injectable()
export class ConfigService {
  private readonly cfg = loadConfig();
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.cfg[key];
  }
  get all(): AppConfig {
    return this.cfg;
  }
  get isProd() {
    return this.cfg.NODE_ENV === 'production' || this.cfg.NODE_ENV === 'staging';
  }
  /**
   * The fake checkout page and the simulated Google consent (PAYMENT_DRIVER / SHEETS_DRIVER=fake) are served everywhere
   * but in production: the staging site is the testers' site, where they stand in for Chargily test mode and a Google
   * OAuth client (tester reports 22/10 UX-029, 25/10: « Payer », « Acheter un pack », « Connecter Google » ⇒ NOT_FOUND).
   */
  get simulatorsAllowed() {
    return this.cfg.NODE_ENV !== 'production';
  }
  get isTest() {
    return this.cfg.NODE_ENV === 'test';
  }
  get webOrigins(): string[] {
    return this.cfg.WEB_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
