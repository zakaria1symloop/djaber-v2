// Give a platform role (super admin by default) to an EXISTING account, whatever its e-mail domain — owner decision
// 09/11/2026: the admin screen only invites @djaber.ai addresses, the owner needs admins with other addresses.
// The person signs up first on the web app with their own e-mail and password (nobody else sees it); this script only
// changes the role, closes the person's open sessions (so the new role applies at the next login) and writes an audit row.
// The admin area then asks for 2FA (authenticator app) at the first access, as for every platform user.
// Usage, from the repo root on the server:  node ~/make-admin.cjs <email> [super_admin|support|moderator|finance|read|none]
const fs = require('fs');
const path = require('path');

const ROLES = ['super_admin', 'support', 'moderator', 'finance', 'read', 'none'];
const email = (process.argv[2] ?? '').trim().toLowerCase();
const role = (process.argv[3] ?? 'super_admin').trim();
if (!email.includes('@') || !ROLES.includes(role)) {
  console.error(`usage (from the repo root): node ~/make-admin.cjs <email> [${ROLES.join('|')}]`);
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
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/db')] }));
const db = new PrismaClient({ datasources: { db: { url } } });

(async () => {
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true, email: true, platformRole: true, status: true, emailVerifiedAt: true, totpEnabled: true } });
  if (!user) {
    console.error(`No account with ${email}. Ask the person to sign up first on the web app with this e-mail, then run this again.`);
    process.exit(2);
  }
  if (user.status !== 'active') console.warn(`Note: this account is ${user.status}; it cannot log in until it is active again.`);
  if (user.platformRole === role) {
    console.log(`${user.email} already has the role ${role}. Nothing changed.`);
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { platformRole: role } });
    // the access token carries the role: close the open sessions so the next login picks up the new one
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        action: 'user.platform_role_change',
        entity: 'User',
        entityId: user.id,
        before: { platformRole: user.platformRole },
        after: { platformRole: role, via: 'tools/deploy/make-admin.cjs' },
        reason: 'owner request 09/11: platform role for an address outside @djaber.ai (server script)',
      },
    });
  });
  console.log(`Done: ${user.email} is now ${role} (was ${user.platformRole}).`);
  if (role !== 'none') {
    console.log('Next: the person logs out and logs in again on the web app, opens the admin,');
    console.log(`and sets up 2FA with an authenticator app${user.totpEnabled ? ' (already set up on this account)' : ' (asked at the first admin access)'}.`);
    if (!user.emailVerifiedAt) console.log('Their e-mail is not verified yet: they should click the link in the sign-up e-mail first.');
  }
})()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
