// Read-only check of the courier set-up on the server: are parcels really sent to ZR Express / Yalidine / EcoTrack?
// Prints the driver settings (never a key), the courier accounts (provider, platform, last test) and the last parcels
// (provider, status, error, whether the tracking number looks simulated). No customer name, phone or address.
// Usage, from the repo root on the server (the script may sit outside it):  node ~/diag-couriers.cjs
const fs = require('fs');
const path = require('path');

const root = process.env.APP_DIR || process.cwd();
const envFile = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].find((f) => fs.existsSync(f));
if (!envFile) {
  console.error('.env not found (run it from the repo root, or set APP_DIR)');
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/db')] }));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const t = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');
const cut = (s, n = 160) => (s ? String(s).replace(/\s+/g, ' ').slice(0, n) : '');
// the simulated driver numbers its parcels <ZR|ECO|YAL>-<n> (fake-courier.ts)
const simulatedTracking = (tr) => /^(ZR|ECO|YAL)-\d+$/.test(tr ?? '');

(async () => {
  const driver = env.COURIER_DRIVER || 'fake (default)';
  console.log('== driver');
  console.log({ NODE_ENV: env.NODE_ENV ?? '(unset)', COURIER_DRIVER: driver, COURIER_ALLOW_LIVE: env.COURIER_ALLOW_LIVE ?? '(unset)' });
  if (!/^live$/i.test(env.COURIER_DRIVER ?? '')) {
    console.log('!! COURIER_DRIVER is not "live": every parcel, connection test and tracking is SIMULATED — nothing reaches the courier.');
    console.log('   To send real parcels: set COURIER_DRIVER=live in the server .env, then restart the API and the worker (pm2).');
  }

  const accounts = await db.courierAccount.findMany({ orderBy: { createdAt: 'asc' }, include: { workspace: { select: { name: true } } } });
  console.log(`== courier accounts (${accounts.length})`);
  for (const a of accounts) {
    const platform = a.provider === 'zrexpress' ? (a.baseUrl ? 'api.zrexpress.app' : 'Procolis') : a.provider === 'ecotrack' ? (() => { try { return new URL(a.baseUrl).host; } catch { return a.baseUrl || '—'; } })() : '';
    console.log(`${a.workspace?.name ?? a.workspaceId}  ·  ${a.provider} ${platform}  ·  ${a.isActive ? 'active' : 'inactive'}${a.isDefault ? ' · default' : ''}  ·  last test ${t(a.lastTestedAt)} ${a.lastTestOk === null ? '' : a.lastTestOk ? 'ok' : `FAILED ${a.lastTestError ?? ''}`}`);
  }

  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const shipments = await db.shipment.findMany({ where: { createdAt: { gte: since }, provider: { not: 'manual' } }, orderBy: { createdAt: 'desc' }, take: 25, select: { createdAt: true, provider: true, status: true, trackingNumber: true, attempts: true, lastError: true, workspace: { select: { name: true } } } });
  console.log(`== last parcels sent to a courier (14 days, ${shipments.length} shown)`);
  for (const s of shipments) console.log(`${t(s.createdAt)}  ${s.workspace?.name ?? ''}  ${s.provider.padEnd(9)} ${s.status.padEnd(10)} tracking ${s.trackingNumber ? (simulatedTracking(s.trackingNumber) ? 'SIMULATED' : 'real') : '—'}  attempts ${s.attempts}  ${cut(s.lastError)}`);
  const byState = {};
  for (const s of shipments) byState[`${s.provider} ${s.status}`] = (byState[`${s.provider} ${s.status}`] ?? 0) + 1;
  console.log('== by courier and status', byState);
  const auto = await db.workspace.count({ where: { deletedAt: null, autoSendToCourier: true } });
  console.log(`== workspaces sending confirmed orders automatically (autoSendToCourier): ${auto} — otherwise an order goes to the courier with « Envoyer au livreur »`);
})()
  .catch((e) => console.error('diag failed:', e.message))
  .finally(() => db.$disconnect());
