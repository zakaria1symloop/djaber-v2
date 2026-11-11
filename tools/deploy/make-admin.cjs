// Platform accounts (super admin, support, moderator, finance, read) for any e-mail domain — owner decision 09/11/2026:
// the admin screen only invites @djaber.ai addresses, the owner needs other admins without anyone signing up first.
//  - the account exists: its role changes, its open sessions close (the new role applies at the next login);
//  - it does not exist: it is created ready to use, like the seed admin (e-mail already verified) with a random password
//    printed ONCE in this terminal — hand it over privately and ask the person to change it in Profile › Security.
// An audit row is written for each change. The admin area still asks for 2FA (authenticator app) at the first access.
// Usage, from the repo root on the server (cd /opt/djaber/v2):
//   node ~/make-admin.cjs <email> [role]                       one account (role defaults to super_admin)
//   node ~/make-admin.cjs <email>:<role> <email>:<role> ...    several at once
// roles: super_admin | support | moderator | finance | read | none (none removes the admin access)
//   node ~/make-admin.cjs --list                               every platform account (no password shown)
//   node ~/make-admin.cjs --reset-password <email> [<email> …]  new random password for existing accounts, printed ONCE
//     here (open sessions closed; role and 2FA unchanged) — passwords are stored hashed, nobody can read them back
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES = ['super_admin', 'support', 'moderator', 'finance', 'read', 'none'];
const LIST = process.argv.includes('--list');
const RESET = process.argv.includes('--reset-password');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const entries = args.length === 2 && !args[1].includes('@') && !args[0].includes(':') ? [[args[0], args[1]]] : args.map((a) => {
  const i = a.lastIndexOf(':');
  return i > a.indexOf('@') ? [a.slice(0, i), a.slice(i + 1)] : [a, 'super_admin'];
});
const bad = entries.filter(([e, r]) => !/^[^\s@:]+@[^\s@:]+\.[^\s@:]{2,}$/.test(e.trim()) || !ROLES.includes(r.trim()));
if (!LIST && (!entries.length || bad.length)) {
  if (bad.length) console.error('Not understood: ' + bad.map(([e, r]) => `${e}:${r}`).join(', '));
  console.error('usage (from the repo root): node ~/make-admin.cjs <email> [role]   or   node ~/make-admin.cjs <email>:<role> <email>:<role> ...');
  console.error('roles: ' + ROLES.join(' | '));
  process.exit(1);
}

const root = process.env.APP_DIR || process.cwd();
const envFile = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].find((f) => fs.existsSync(f));
const line = envFile && fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) {
  console.error('DATABASE_URL not found in .env — run it from the repo root (cd /opt/djaber/v2)');
  process.exit(1);
}
const url = line.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '');
const fromDb = (m) => require(require.resolve(m, { paths: [path.join(root, 'packages/db')] }));
const { PrismaClient } = fromDb('@prisma/client');
const argon2 = fromDb('argon2');
const db = new PrismaClient({ datasources: { db: { url } } });

// 20 characters, letters + digits (the password rule: at least 8, one letter, one digit)
const newPassword = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let p = '';
  while (p.length < 18) p += A[crypto.randomInt(A.length)];
  return p + 'A' + crypto.randomInt(2, 10);
};
const audit = (tx, userId, before, after, reason) =>
  tx.auditLog.create({ data: { actorType: 'system', action: before === null ? 'user.create' : 'user.platform_role_change', entity: 'User', entityId: userId, before: before === null ? undefined : { platformRole: before }, after, reason } });

async function list() {
  const users = await db.user.findMany({ where: { platformRole: { not: 'none' }, deletedAt: null }, orderBy: [{ platformRole: 'asc' }, { email: 'asc' }], select: { email: true, platformRole: true, status: true, totpEnabled: true, lastLoginAt: true } });
  for (const u of users) console.log(`${u.email.padEnd(34)} ${u.platformRole.padEnd(12)} ${u.status.padEnd(18)} 2FA ${u.totpEnabled ? 'on ' : 'off'}  last login ${u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : 'never'}`);
  console.log(`
${users.length} platform account(s). Passwords are never shown: use --reset-password <email> to give a new one.`);
}

async function reset(emailRaw) {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true, email: true, platformRole: true } });
  if (!user) return console.log(`${email}: no account (create it with: node ~/make-admin.cjs ${email}:<role>)`);
  const password = newPassword();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorType: 'system', action: 'user.password_reset', entity: 'User', entityId: user.id, after: { via: 'tools/deploy/make-admin.cjs --reset-password' }, reason: 'owner request 11/11: new password set by server script' } });
  });
  console.log(`RESET    ${user.email.padEnd(34)} role ${user.platformRole.padEnd(12)} password: ${password}`);
}

async function one(emailRaw, role) {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true, email: true, platformRole: true, status: true, totpEnabled: true } });
  if (!user) {
    if (role === 'none') return console.log(`${email}: no account, nothing to remove.`);
    const password = newPassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const local = email.split('@')[0];
    await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, passwordHash, firstName: local.charAt(0).toUpperCase() + local.slice(1), lastName: '', platformRole: role, emailVerifiedAt: new Date() } });
      await audit(tx, u.id, null, { email, platformRole: role, via: 'tools/deploy/make-admin.cjs' }, 'owner request 09/11: platform account created by server script');
    });
    console.log(`CREATED  ${email.padEnd(34)} role ${role.padEnd(12)} password: ${password}`);
    return;
  }
  if (user.status !== 'active') console.warn(`Note: ${user.email} is ${user.status}; it cannot log in until it is active again.`);
  if (user.platformRole === role) return console.log(`SAME     ${user.email.padEnd(34)} already ${role}, nothing changed`);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { platformRole: role } });
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, user.id, user.platformRole, { platformRole: role, via: 'tools/deploy/make-admin.cjs' }, 'owner request 09/11: platform role for an address outside @djaber.ai (server script)');
  });
  console.log(`UPDATED  ${user.email.padEnd(34)} role ${role.padEnd(12)} (was ${user.platformRole}; keeps their own password, must log in again)`);
}

(async () => {
  if (LIST) return list();
  if (RESET) {
    for (const [e] of entries) await reset(e);
  } else for (const [e, r] of entries) await one(e, r.trim());
  console.log('\nPasswords are shown only here: give each one privately, never in a group chat.');
  console.log('Each person logs in on the web app, changes the password (Profile › Security), opens the admin and sets up 2FA.');
})()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
