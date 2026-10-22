#!/usr/bin/env bash
# Djaber v2 — update the API + worker on the VPS to the branch deploy/tester-fixes-2026-10-22.
# Touches only the Djaber v2 pm2 processes, their folder and the Djaber Postgres container.
set -euo pipefail
BRANCH="deploy/tester-fixes-2026-10-22"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== 1/7 Finding the Djaber v2 processes in pm2"
DETECT="$(pm2 jlist | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s);
  const path = (p) => String((p.pm2_env && p.pm2_env.pm_exec_path) || "");
  const api = list.find((p) => /apps[\\/]api[\\/]dist[\\/]main\.js$/.test(path(p)));
  const worker = list.find((p) => /apps[\\/]worker[\\/]/.test(path(p)));
  if (!api || !worker) { console.error("Djaber v2 API / worker not found in pm2 (looked for apps/api/dist/main.js and apps/worker/)."); process.exit(1); }
  console.log([api.pm2_env.pm_cwd, api.name, worker.name].join("\t"));
});')"
APP_DIR="$(printf '%s' "$DETECT" | cut -f1)"
API="$(printf '%s' "$DETECT" | cut -f2)"
WORKER="$(printf '%s' "$DETECT" | cut -f3)"
cd "$APP_DIR"
APP_DIR="$(git rev-parse --show-toplevel)"
cd "$APP_DIR"
echo "   folder : $APP_DIR"
echo "   api    : $API"
echo "   worker : $WORKER"
echo "   branch now: $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"
read -r -p "Update these to $BRANCH? (y/N) " OK
[ "$OK" = "y" ] || [ "$OK" = "Y" ] || { echo "Stopped, nothing changed."; exit 1; }

echo "== 2/7 Reading DATABASE_URL from $APP_DIR/.env (not printed)"
[ -f .env ] || { echo ".env not found in $APP_DIR — stop."; exit 1; }
DATABASE_URL="$(node -e '
const fs = require("fs");
const line = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) process.exit(1);
console.log(line.replace(/^\s*DATABASE_URL\s*=\s*/, "").replace(/^["\x27]|["\x27]$/g, ""));')" || { echo "DATABASE_URL missing in .env — stop."; exit 1; }
export DATABASE_URL
read -r DB_USER DB_PASS DB_NAME DB_PORT < <(node -e '
const u = new URL(process.env.DATABASE_URL);
console.log([decodeURIComponent(u.username), decodeURIComponent(u.password) || "-", u.pathname.replace(/^\//, ""), u.port || "5432"].join(" "));')

echo "== 3/7 Backing up the database"
PG_CONTAINER="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "[:.]${DB_PORT}->" | head -1 | cut -d' ' -f1 || true)"
[ -n "$PG_CONTAINER" ] || { echo "No Docker container publishes port $DB_PORT — stop (no backup, nothing changed)."; exit 1; }
BACKUP="$HOME/djaber-backup-$STAMP.sql"
docker exec -e PGPASSWORD="$DB_PASS" "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP"
[ -s "$BACKUP" ] || { echo "Backup is empty — stop (nothing changed)."; exit 1; }
echo "   backup: $BACKUP ($(du -h "$BACKUP" | cut -f1)) from container $PG_CONTAINER"

echo "== 4/7 Getting the branch"
PREV="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "   now at $(git rev-parse --short HEAD) (was ${PREV:0:7})"

echo "== 5/7 Installing and building"
REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile
pnpm build

echo "== 6/7 Applying the database migration"
pnpm --filter @djaber/db migrate:deploy

echo "== 7/7 Restarting and checking"
pm2 restart "$API" "$WORKER" --update-env
sleep 8
pm2 ls | grep -E "$API|$WORKER" || true
curl -s -o /dev/null -w "   /ready -> HTTP %{http_code}\n" https://djaber.72-60-190-211.sslip.io/ready || true
echo
echo "Done. Previous commit: ${PREV:0:7} · backup: $BACKUP"
echo "To go back: git checkout ${PREV:0:7} && REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile && pnpm build && pm2 restart $API $WORKER"
