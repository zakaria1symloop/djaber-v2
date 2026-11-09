// Integration-test infrastructure without Docker (root CLAUDE.md):
//  - Postgres: the embedded cluster of `pnpm infra:up` when it is running, otherwise a private embedded cluster;
//    every run uses its own database `djaber_test_<epoch>_<pid>` (migrated + seeded here, dropped in teardown) so that
//    several runs (parallel engineers on the same machine) never drop each other's database; leftovers > 6 h are dropped.
//  - Redis: a free db (1…15, claimed with a lock key) of the local instance when running, otherwise redis-memory-server.
//  - The prepared environment is written to `.local/test-env-<run>.json`; its path travels in DJABER_TEST_ENV_FILE.
const { execSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { resolve } = require('node:path');
const { Client } = require('pg');

const ROOT = resolve(__dirname, '../../../..');
const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('error', () => res(false));
  });

module.exports = async () => {
  let pgPort = 54329;
  if (!(await portOpen(pgPort))) {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    pgPort = 54339;
    const dir = resolve(ROOT, '.local/test-pg');
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'djaber',
      password: 'djaber',
      port: pgPort,
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {},
      onError: () => {},
    });
    if (!existsSync(resolve(dir, 'PG_VERSION'))) await pg.initialise();
    if (existsSync(resolve(dir, 'postmaster.pid'))) rmSync(resolve(dir, 'postmaster.pid'));
    await pg.start();
    globalThis.__PG__ = pg;
  }
  const runId = `${Math.floor(Date.now() / 1000)}_${process.pid}`;
  const dbName = `djaber_test_${runId}`;
  const admin = new Client(`postgresql://djaber:djaber@localhost:${pgPort}/postgres`);
  await admin.connect();
  const stale = await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^djaber_test_[0-9]+_[0-9]+$'");
  for (const { datname } of stale.rows) {
    const epoch = Number(datname.split('_')[2]);
    if (Date.now() / 1000 - epoch > 6 * 3600) await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`).catch(() => undefined);
  }
  await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await admin.end();
  globalThis.__TEST_DB__ = { pgPort, dbName };
  const DATABASE_URL = `postgresql://djaber:djaber@localhost:${pgPort}/${dbName}`;

  let REDIS_URL = null;
  if (await portOpen(63799)) {
    const Redis = require('ioredis');
    const r = new Redis('redis://127.0.0.1:63799/0', { maxRetriesPerRequest: null });
    for (let db = 1; db <= 15 && !REDIS_URL; db++) {
      if ((await r.set(`djaber:test-redis-db:${db}`, runId, 'EX', 3 * 3600, 'NX')) === 'OK') {
        REDIS_URL = `redis://127.0.0.1:63799/${db}`;
        globalThis.__TEST_REDIS_LOCK__ = { key: `djaber:test-redis-db:${db}`, runId };
      }
    }
    await r.quit();
    if (!REDIS_URL) throw new Error('no free Redis test db (1…15): another 15 test runs are active');
  } else {
    // same launcher as `pnpm infra:up` (Redis 7; the Windows build of redis-memory-server is too old for BullMQ)
    const { startRedis } = await import(require('node:url').pathToFileURL(resolve(ROOT, 'tools/infra/redis.mjs')).href);
    const redis = await startRedis(63809, resolve(ROOT, '.local'));
    REDIS_URL = 'redis://127.0.0.1:63809';
    globalThis.__REDIS__ = redis;
  }

  const env = {
    NODE_ENV: 'test',
    DATABASE_URL,
    REDIS_URL,
    LOG_LEVEL: 'silent',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: resolve(ROOT, `.local/test-storage/${runId}`),
    MAIL_DRIVER: 'file',
    MAIL_LOCAL_DIR: resolve(ROOT, `.local/test-mail/${runId}`),
    META_DRIVER: 'fake',
    PAYMENT_DRIVER: 'fake',
    AI_DRIVER: 'fake',
    COURIER_DRIVER: 'fake',
    SHEETS_DRIVER: 'fake',
    PUSH_DRIVER: 'fake',
    IAP_DRIVER: 'fake',
    SEED_ADMIN_EMAIL: 'admin@djaber.test',
    SEED_ADMIN_PASSWORD: 'Admin-test-12345',
  };
  rmSync(env.MAIL_LOCAL_DIR, { recursive: true, force: true });
  rmSync(env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
  globalThis.__TEST_DIRS__ = [env.MAIL_LOCAL_DIR, env.STORAGE_LOCAL_DIR];
  mkdirSync(resolve(ROOT, '.local'), { recursive: true });
  const envFile = resolve(ROOT, `.local/test-env-${runId}.json`);
  writeFileSync(envFile, JSON.stringify(env));
  process.env.DJABER_TEST_ENV_FILE = envFile;
  globalThis.__TEST_ENV_FILE__ = envFile;

  const opts = { cwd: resolve(ROOT, 'packages/db'), env: { ...process.env, ...env }, stdio: 'pipe' };
  execSync('npx prisma migrate deploy', opts);
  execSync('npx tsx seeds/index.ts', opts);
  // PV 09/11: without a `moderation_policy` the platform reviews every product by hand. The suites are written for the
  // pre-screen (a clean product of a standard shop is approved at once, the AI sells it): the test platform says so;
  // test/m10/moderation.int checks the default without this row.
  {
    const pg = new Client(DATABASE_URL);
    await pg.connect();
    await pg.query(`INSERT INTO "PlatformSetting" ("id", "key", "value", "version", "updatedById", "updatedAt")
      SELECT uuid_generate_v7(), 'moderation_policy', '{"manualReviewAll": false}'::jsonb, 1, "id", now() FROM "User" WHERE "platformRole" IS NOT NULL ORDER BY "createdAt" LIMIT 1
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`);
    await pg.end();
  }

  // flush this run's redis db
  const Redis = require('ioredis');
  const r = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  await r.flushdb();
  await r.quit();
};
