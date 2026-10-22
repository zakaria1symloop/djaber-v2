#!/usr/bin/env bash
# Djaber v2 — update the API + worker on the VPS to the branch deploy/tester-fixes-2026-10-22.
# Touches only the Djaber v2 pm2 processes, their folder and the Djaber Postgres container.
set -euo pipefail
BRANCH="deploy/tester-fixes-2026-10-22"
# the Djaber v2 pm2 processes, by name: the old V1 (`djaber-api`) runs on the same server and must not be touched
# (override: API_NAME=… WORKER_NAME=… bash vps-update.sh)
API_NAME="${API_NAME:-djaber-v2-api}"
WORKER_NAME="${WORKER_NAME:-djaber-v2-worker}"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== 1/7 Finding the Djaber v2 processes in pm2 ($API_NAME, $WORKER_NAME)"
export API_NAME WORKER_NAME
DETECT="$(pm2 jlist | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s);
  const api = list.find((p) => p.name === process.env.API_NAME);
  const worker = list.find((p) => p.name === process.env.WORKER_NAME);
  if (!api || !worker) { console.error("pm2 has no process named " + (!api ? process.env.API_NAME : process.env.WORKER_NAME) + "."); process.exit(1); }
  console.log([api.pm2_env.pm_cwd, api.name, worker.name].join("\t"));
});')"
APP_DIR="$(printf '%s' "$DETECT" | cut -f1)"
API="$(printf '%s' "$DETECT" | cut -f2)"
WORKER="$(printf '%s' "$DETECT" | cut -f3)"
cd "$APP_DIR"
APP_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "$APP_DIR is not inside a git clone — stop, nothing changed."; exit 1; }
cd "$APP_DIR"
echo "   folder : $APP_DIR"
echo "   api    : $API"
echo "   worker : $WORKER"
echo "   branch now: $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"
read -r -p "Update these to $BRANCH? (y/N) " OK
[ "$OK" = "y" ] || [ "$OK" = "Y" ] || { echo "Stopped, nothing changed."; exit 1; }

# the server .env sits at the repo root or next to the API
ENV_FILE=""
for f in "$APP_DIR/.env" "$APP_DIR/apps/api/.env"; do [ -f "$f" ] && { ENV_FILE="$f"; break; }; done
[ -n "$ENV_FILE" ] || { echo ".env not found in $APP_DIR or $APP_DIR/apps/api — stop, nothing changed."; exit 1; }
echo "== 2/7 Reading DATABASE_URL from $ENV_FILE (not printed)"
export ENV_FILE
DATABASE_URL="$(node -e '
const fs = require("fs");
const line = fs.readFileSync(process.env.ENV_FILE, "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) process.exit(1);
console.log(line.replace(/^\s*DATABASE_URL\s*=\s*/, "").replace(/^["\x27]|["\x27]$/g, ""));')" || { echo "DATABASE_URL missing in .env — stop, nothing changed."; exit 1; }
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
PREV_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
# the server clone may track main only: fetch the branch into its own remote ref
git fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
echo "   now at $(git rev-parse --short HEAD) (was $PREV_BRANCH ${PREV:0:7})"

echo "== 5/7 Installing and building"
REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile
# the API and its packages only: the worker runs the API build, the web is built by Vercel
pnpm turbo run build --filter=@djaber/api...

echo "== 6/7 Applying the database migration"
pnpm --filter @djaber/db migrate:deploy

echo "== 7/7 Restarting and checking"
pm2 restart "$API" "$WORKER" --update-env
sleep 8
pm2 ls | grep -E "$API|$WORKER" || true
curl -s -o /dev/null -w "   /ready -> HTTP %{http_code}\n" https://djaber.72-60-190-211.sslip.io/ready || true
echo
echo "Done. Previous: $PREV_BRANCH ${PREV:0:7} · backup: $BACKUP"
echo "To go back: git checkout $PREV_BRANCH && REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile && pnpm turbo run build --filter=@djaber/api... && pm2 restart $API $WORKER"
