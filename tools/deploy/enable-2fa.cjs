// Turns 2FA (authenticator app) on for a platform account from the server — owner request 10/11/2026: an admin created
// with make-admin.cjs has no shop, and the web app sends a user without a shop to « create a shop » before Settings ›
// Security, so the admin cannot reach the 2FA page the admin area asks for (TWO_FA_REQUIRED_FOR_ROLE).
// Same storage as the app (AUTH-05): TOTP secret AES-256-GCM encrypted with ENCRYPTION_KEYS, 10 recovery codes as SHA-256.
// The setup key, a QR code and the recovery codes are printed ONCE in this terminal — never paste them in a chat.
// Usage, from the repo root on the server (cd /opt/djaber/v2):
//   node ~/enable-2fa.cjs <email>            2FA on (refused when it is already on)
//   node ~/enable-2fa.cjs <email> --reset    new secret + new recovery codes (lost phone); the old ones stop working
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [emailArg, flag] = process.argv.slice(2);
const reset = flag === '--reset';
if (!emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailArg.trim()) || (flag && !reset)) {
  console.error('usage (from the repo root): node ~/enable-2fa.cjs <email> [--reset]');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

const root = process.env.APP_DIR || process.cwd();
const envFiles = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].filter((f) => fs.existsSync(f));
const envValue = (name) => {
  for (const f of envFiles) {
    const line = fs.readFileSync(f, 'utf8').split(/\r?\n/).find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (line) return line.replace(new RegExp(`^\\s*${name}\\s*=\\s*`), '').replace(/^["']|["']$/g, '').trim();
  }
  return '';
};
const url = envValue('DATABASE_URL');
const ring = envValue('ENCRYPTION_KEYS');
if (!url || !ring) {
  console.error(`${!url ? 'DATABASE_URL' : 'ENCRYPTION_KEYS'} not found in .env — run it from the repo root (cd /opt/djaber/v2)`);
  process.exit(1);
}
// the app encrypts with the last key of the ring: `<id>:<base64 32 bytes>[,<id>:<…>]`
const entries = ring.split(',').map((p) => [p.slice(0, p.indexOf(':')).trim(), Buffer.from(p.slice(p.indexOf(':') + 1).trim(), 'base64')]);
const [keyId, key] = entries[entries.length - 1];
if (!keyId || !key || key.length !== 32) {
  console.error('ENCRYPTION_KEYS is malformed (each entry must be <id>:<base64 32 bytes>)');
  process.exit(1);
}
const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [keyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
};

const from = (dir, m) => require(require.resolve(m, { paths: [path.join(root, dir)] }));
const { PrismaClient } = from('packages/db', '@prisma/client');
const { authenticator } = from('apps/api', 'otplib');
let QRCode = null;
try {
  QRCode = from('apps/api', 'qrcode');
} catch {}
const db = new PrismaClient({ datasources: { db: { url } } });

(async () => {
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true, email: true, platformRole: true, totpEnabled: true, status: true } });
  if (!user) throw new Error(`${email}: no account (create it first with make-admin.cjs)`);
  if (user.totpEnabled && !reset) {
    console.log(`${user.email}: 2FA is already on. Lost phone? Run it again with --reset (new key, new recovery codes).`);
    return;
  }
  if (user.status !== 'active') console.warn(`Note: ${user.email} is ${user.status}; it cannot log in until it is active again.`);
  if (!user.platformRole || user.platformRole === 'none') console.warn(`Note: ${user.email} has no platform role; 2FA is turned on anyway.`);

  const totp = authenticator.clone({ window: 1, step: 30, digits: 6 });
  const secret = totp.generateSecret();
  const otpauth = totp.keyuri(user.email, 'Djaber', secret);
  const codes = Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  const hashes = codes.map((c) => crypto.createHash('sha256').update(c.replace(/[\s-]/g, '').toLowerCase()).digest('hex'));

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { totpSecret: Buffer.from(encrypt(secret), 'utf8'), totpEnabled: true, recoveryCodes: hashes } });
    // open sessions close: the next login asks for the 6-digit code
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorType: 'system', action: reset ? 'auth.2fa_reset' : 'auth.2fa_enable', entity: 'User', entityId: user.id, after: { totpEnabled: true, via: 'tools/deploy/enable-2fa.cjs' }, reason: 'owner request 10/11: 2FA turned on from the server (admin without a shop cannot reach Settings › Security)' } });
  });

  console.log(`\n2FA ON for ${user.email}${reset ? ' (new key: the old one and the old recovery codes no longer work)' : ''}\n`);
  if (QRCode) console.log(await QRCode.toString(otpauth, { type: 'terminal', small: true }));
  console.log('1. On the phone: Google Authenticator (or Microsoft Authenticator) › + › Scan the QR code above,');
  console.log('   or « Enter a setup key »: account ' + user.email + ', key:');
  console.log('\n   ' + secret.match(/.{1,4}/g).join(' ') + '\n');
  console.log('2. Log in on the web app with the e-mail + password, then type the 6-digit code the app shows.');
  console.log('\n3. Recovery codes (each works once if the phone is lost) — keep them somewhere safe:\n');
  for (let i = 0; i < codes.length; i += 2) console.log('   ' + codes[i] + '    ' + (codes[i + 1] ?? ''));
  console.log('\nShown only here: give them privately to the person, never in a group chat or to an AI assistant.');
})()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
