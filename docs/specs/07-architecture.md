# 07 — Architecture, compliance, security, NFR, tests

## 1. Stack

| Layer | Choice | Source |
|---|---|---|
| API + worker | **NestJS 11**, Node 22 LTS, TypeScript | owner decision |
| Web | **Next.js** (App Router) + Tailwind + shadcn/ui primitives restyled to the Djaber system | owner decision |
| Mobile | **Flutter** (Android + iOS), FCM | PH2 #02 |
| DB | PostgreSQL 16 + Prisma (`pg_trgm` for search) | D2 |
| Cache / queues | Redis 7 + BullMQ | CDC §10.1 |
| Real-time | Socket.IO (`@nestjs/websockets`) + Redis adapter | 06 §6 |
| Storage | S3-compatible (MinIO / R2) + `sharp` thumbnails; public https URLs for Meta sends | CDC §10.3 |
| AI | **Vercel AI SDK** (D25) — OpenAI, Anthropic, Google, Groq; structured output + tool steps. Provider compatibility (live 2026-10-14): a model that refuses `temperature` (Claude 5.x: "`temperature` is deprecated for this model") is asked again without it and remembered per process (`provider:modelId`), so later calls go without it at once; tool input schemas never use `anyOf` / `oneOf` / `allOf` at the top level (Anthropic refuses them; a unit test keeps every tool schema provider-safe); failed calls log the provider's error type and the parameters it cites, never its free text | V1, `docs/implementation/04-ai-pipeline.md` §6 |
| Speech | Groq Whisper, runtime fallback OpenAI Whisper | V1 **fix** |
| E-mail | `MailService` drivers: `file` (dev / test, `.local/mail`), `resend` (`RESEND_API_KEY`), `smtp` (`SMTP_HOST`, `SMTP_PORT` default 587 — 465 ⇒ implicit TLS —, `SMTP_USER`, `SMTP_PASS`; the server's own mailbox, used live); sender `MAIL_FROM`; react-email templates fr/ar/en | V1 |
| Payments | **Chargily Pay** (CIB / Edahabia rails; signed webhooks, raw body) behind the `PaymentGateway` interface; `ChargilyGateway` is the only implementation; `PAYMENT_PROVIDER=chargily`. Manual payments are recorded by platform finance (`BillingProvider.manual`, D71). Mobile credit packs = store IAP (Google Play / App Store receipts validated server-side); no subscription checkout on mobile | D4, D40, CDC |
| Couriers | ZR Express, EcoTrack, Yalidine via `CourierAdapter` | PH2 #05–07, CDC |
| Google | Sheets API v4 + Picker; OAuth verification | PH2 #03 |
| Hosting | Docker images for staging / production, VPS (DZ/EU) behind Caddy/Nginx TLS or managed PaaS; the live deployment (2026-10-14) is Vercel (web) + VPS (API, worker), §12 | CDC §10.3 |
| CI/CD | GitHub Actions: lint, typecheck, unit, integration (embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md)), e2e, build, `prisma migrate deploy`, deploy | CDC §10.1 |
| Observability | Pino, Sentry (API/web/mobile), `/health` + uptime check, BullMQ board, metrics (queue depth, AI latency, send failures) | CDC §10.1 |

## 2. Repository (pnpm + Turborepo)

```
apps/api        NestJS HTTP + WebSocket
apps/worker     NestJS standalone — BullMQ processors (same modules)
apps/web        Next.js
apps/mobile     Flutter (API client generated from OpenAPI)
packages/db     Prisma schema, migrations, seeds (wilayas, communes, units, presets, quick replies, fee defaults)
packages/shared Zod schemas, enums, validators (phone, name…), error codes, i18n keys
packages/ui     design-system components (tokens from Figma)
docs/specs, docs/implementation, docs/audit
```

Validators and error codes in `packages/shared` are the single implementation for API, web forms, mobile and AI tools.

## 3. Modules (modular monolith + worker; CDC's 9 microservices not justified at this volume)

`auth` · `workspace` (tenant guard, roles, settings, onboarding, ownership transfer) · `billing` (plans, subscriptions, dunning, credits reservation, packs + IAP, limits guard) · `channels` (Meta OAuth, tokens, refresh, App Review status) · `messaging` (intake, conversations, messages, outbox sends, 24 h rules, WS gateway) · `ai` (providers, routing `AiRoute`, prompt builder, tools, AiRun/AiToolCall replay, vision 2-pass, transcription) · `agents` (wizard, versions, presets, playground) · `catalog` (+ moderation items) · `clients` (merge) · `orders` (`OrderEffects`, calls, callbacks, numbering, import) · `delivery` (geo, fee grid, adapters, shipments, tracking sync) · `payments` (`PaymentGateway` → `ChargilyGateway`) · `recommendations` (rule engine) · `gds` (suppliers, purchases, sales, cash + `CashClosing`, inventories, reports) · `notifications` (in-app/email/push, prefs, customer system messages) · `analytics` · `sheets` · `integrations` (API keys, outbound webhooks) · `safety` (blocks, abuse reports, blocked words) · `support` (`SupportTicket`, help) · `admin` (CMS, audit, viewers, read-only impersonation `ImpersonationSession`, platform settings, health) · `jobs` · `uploads`.

### Queues (worker)

| Queue | Job | Retry |
|---|---|---|
| `meta-inbound` | parse → dedup → store → schedule `ai-reply` | 5× backoff; dead-letter alert |
| `ai-reply` | run (AiRun + AiToolCall replay) → outbox send → settle credits | 3× (10 s, 1 min, 5 min); final ⇒ insight `error` |
| `outbox` | Meta sends (per-channel rate limit, 24 h rules), notifications, webhooks, Sheets | Meta 5× / 10 min; webhooks per 06 §4 |
| `media` | download attachments → S3, thumbnails, captions, transcription | 3× |
| `jobs` | import, analysis, generation, bulk send, export, backfill | 1× + resumable |
| `courier` | create parcel (retry 1, 5, 30 min, 2 h ×6), batch tracking (every 2 h for the first 3 days after `sent`, then every 12 h; after 30 d without event ⇒ `ShipmentStatus.stale`), labels | per-account limiter |
| `scheduled` | subscription dunning (J−7 `subscription.expiring` · J0 `dunning` + `invoice.unpaid` · J+3 reminder · J+7 `expired` ⇒ free plan, D49), trial end (D60), credit periods, token refresh/health, retention purge, low-stock digest guard, placeholder client cleanup, stale shipment marking, `sched-trust-levels` (D52), `sched-preset-updates`, `sched-order-reminders` (`Order.callbackAt`), `sched-abuse-auto-rules` | — |

### Core flow (FL-01) and idempotency

Webhook → verified → `InboundEvent` → `meta-inbound` → `ai-reply` (delayed, keyed by conversation) → AiRun `running` → tools persisted before execution → structured output → outbox send keyed by `runId` → AiRun `ok` → credits settled. Any retry resumes from persisted tool results; a send is never duplicated (outbox key), an order never created twice.

Targets: inbound ack < 200 ms; customer message → reply sent p95 < 30 s incl. window; AI generation p50 < 3 s.

## 4. Web app

TanStack Query over the API (no direct DB); access token in memory + refresh cookie; `next-intl` fr/ar/en with RTL via logical properties, CI fails on missing keys; react-hook-form + shared Zod; server errors mapped to fields and shown **inside** dialogs; tables server-paginated with filter state in the URL; WS updates the query cache; polling fallback; dirty-form guard; 404/403/offline pages; marketing/CMS pages server-rendered.

## 5. Mobile app

Flutter; same API/WS; secure storage; FCM deep links for every notification type (`djaber://` + the web path); Meta OAuth, Google OAuth and invitation acceptance via the system browser + app links (`djaber://` + universal links); credit packs by store IAP (`POST /credits/packs/iap/validate`); no subscription checkout on mobile (plan page read-only, D73); file picker import; offline read cache with no queued mutation; version gate `GET /app/version` (426 `APP_UPDATE_REQUIRED {minVersion, storeUrl, message}`); device registration `POST /me/devices` / `DELETE /me/devices/:token` (max 20, `DEVICE_LIMIT`); crash reporting. Full rules: [14-mobile-app.md](14-mobile-app.md) (wins over 03 §21); implementation: `docs/implementation/10-flutter-mobile.md`.

## 6. Security `[CDC §11]`

HTTPS/HSTS/TLS 1.2+ · argon2id · JWT access 15 min (EdDSA) + rotating refresh with reuse detection (web refresh cookie `HttpOnly; Path=/api/v1/auth; SameSite=Lax`, `Secure` in production; with `REFRESH_COOKIE_CROSS_SITE=true` — web and API on two different sites, e.g. `djaber.vercel.app` + the VPS host — `SameSite=None; Secure; Partitioned` (CHIPS), else the browser drops the cookie and a reload logs out) · TOTP 2FA · AES-256-GCM secrets with key rotation · hashed API keys with scopes · all inbound webhooks signature-verified on the **raw body** (`express.raw` for `/webhooks/*`) · tenant guard + Prisma extension injecting `workspaceId` + cross-workspace e2e test per resource · DTO whitelist validation, file type/size checks, image re-encoding, CMS HTML sanitised · `@nestjs/throttler` with Redis · Helmet, strict CORS allowlist (no wildcard `*.vercel.app` — V1 **fix**) · PII masked in logs · AuditLog for admin/sensitive actions (2 y) · admin impersonation **read-only only** (`ImpersonationSession`: reason ≥ 10 chars, 30 min, roles `super_admin` + `support`, every non-GET request under `X-Impersonation-Session` ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`, expiry ⇒ `401 ADMIN_IMPERSONATION_EXPIRED`, audit `impersonation.start` / `impersonation.action` per request / `impersonation.stop`) · no card data (Chargily hosts the checkout) · dependency audit + ZAP baseline in CI.

## 7. Platform compliance (new, from audit)

| Item | Requirement |
|---|---|
| Meta App Review (D13) | Reuse V1 app ID; submit `pages_messaging`, `pages_read_user_content`, `instagram_manage_messages`, Human Agent; prerequisites: privacy, terms, data-deletion pages live (P0), screencast, business verification. "Approval pending" states in UI. Live state (2026-10-14): the V1 Meta app has 4 permissions enabled — `pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement` — so the live API sets `META_FACEBOOK_SCOPES` to them (asking a permission the app does not have makes Facebook Login fail); page analysis works with `pages_read_engagement` (03 CHN-08); Instagram permissions are not enabled in that app yet, the UI follows `GET /channels/app-review-status`. The Meta webhook, OAuth return and data-deletion URLs registered for V1 are unchanged (`META_LEGACY_PATHS`, 06 §3). |
| Meta messaging policy | 24 h window rules (MSG-06); no tag for order updates (Meta retired `POST_PURCHASE_UPDATE` on 2026-04-27); `HUMAN_AGENT` only once approved; no promotional sends; outside the window ⇒ skipped. |
| Google OAuth verification | Sensitive scope `spreadsheets`; verification task in P2 with privacy page; ≤ 100 test users before approval. |
| Chargily | Signed webhooks on the raw body; test vs live mode by env (`PAYMENT_PROVIDER=chargily`); the only payment gateway of v2 (subscriptions, web credit packs, order payment links). |
| Stores | Play/App Store listings, privacy labels, account deletion in-app (AUTH-07, 14 MOB-R15); consumable IAP products for credit packs only (D40), receipts validated by `POST /credits/packs/iap/validate`; forced update via `AppVersion.minVersion` (D39). |

## 8. NFR `[CDC §13]`

API p95 < 500 ms (non-AI) · AI p50 < 3 s · 1 000 concurrent conversations, > 100 req/s · dashboard LCP < 3 s on 4G · uptime 99.5 %, RTO/RPO < 1 h (PITR, hourly backups, 30 d, off-site) · ≥ 10 channels/workspace, 10 000+ orders/month · stateless API/worker scale-out · maintenance < 4 h/month 02:00–06:00 Algiers · WCAG 2.1 AA (dark contrast, keyboard, RTL).

## 9. Tests `[CDC §14]`

| Type | Tooling | Gate |
|---|---|---|
| Unit | Vitest | every rule in 04 (transitions, effects, money, validators, merge) |
| Integration | Jest + embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md) (Postgres, Redis) + Supertest | every endpoint: happy, validation, permission, cross-workspace 404, idempotency, concurrency 409 |
| AI evals | fixture conversations (darija, arabizi, FR, EN, mixed), vision fixtures, voice fixtures; assert structured output, tool calls, handoff, no duplicate order on retry | nightly + on prompt change |
| Contract | recorded Meta, Chargily, ZR Express, EcoTrack, Yalidine, Google payloads | each adapter: create, label, status mapping, errors, webhooks |
| E2E | Playwright (web), Flutter integration (mobile) | scenarios in 13 |
| Load | k6 | webhook burst 1 000 msgs; orders list 100 k rows; tracking sync 10 k shipments |
| Security | ZAP baseline, dependency audit | staging |
| Migration | dry-run on anonymised prod copy; counts/totals equal | before cut-over |

Environments: local (no Docker: embedded Postgres 16 + Redis 7 via `pnpm infra:up`, root CLAUDE.md), staging (anonymised prod copy, Meta test app users), production; the current live deployment is described in §12.

## 10. Deliverables `[CDC §15]`

Repo, specs, OpenAPI + Postman, Docker/compose + deploy scripts, runbook (backup/restore, key rotation, incident, App Review renewals), merchant guide, admin guide.

## 11. V1 migration (D3)

`packages/db/migrate-v1`: reads V1 MySQL, writes v2 per 05 §10; dry-run report; page tokens re-encrypted; V1 kept read-only 30 days. At the 2026-10-14 cut-over the webhooks were **not** re-pointed: v2 answers the V1 URLs on the same host (`META_LEGACY_PATHS`, §12), and V1 merchants' data was not migrated (v2 started on its own database; merchants reconnect their pages).

## 12. Live deployment (since 2026-10-14)

v2 replaced V1 at the **same public addresses registered in Meta** (owner decision: no change in the Meta app settings).

| Part | Where | Notes |
|---|---|---|
| Web | Vercel, project root `apps/web`, Node 22 — https://djaber.vercel.app | build settings in `apps/web/vercel.json`: install `REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile` from the repo root (skips the test-only Redis build), build `pnpm turbo run build --filter=@djaber/web`; env `NEXT_PUBLIC_API_URL` = the API host below, `NEXT_PUBLIC_SUPPORT_EMAIL` |
| API + worker | VPS, two pm2 processes (API, worker) — API host `https://djaber.72-60-190-211.sslip.io` | Nginx TLS reverse proxy in front of the API port; `.env` on the server (never committed) with `NODE_ENV=staging`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `WEB_ORIGINS` (includes the Vercel origin) |
| Postgres 16, Redis 7 | Docker containers on the VPS, bound to `127.0.0.1` only | `DATABASE_URL`, `REDIS_URL`; migrations by `prisma migrate deploy` |

Live settings (names only; values in the server `.env`): `META_LEGACY_PATHS=true` and `META_OAUTH_CALLBACK_PATH=/api/pages/callback/{platform}` (V1 webhook, OAuth return and data-deletion paths answered by v2, 06 §3); `META_FACEBOOK_SCOPES` = the 4 permissions of the Meta app (§7); `REFRESH_COOKIE_CROSS_SITE=true` (web and API on two sites, §6); `MAIL_DRIVER=smtp` with `SMTP_*` (the server's mailbox); live AI driver with `ANTHROPIC_API_KEY` — text and vision routes on Claude Haiku (primary `claude-haiku-5-5`, fallback `claude-haiku-4-5`, ADM-06 routes); no OpenAI / Groq key, so voice-note transcription is unavailable. Other providers follow their `*_DRIVER` / `*_ALLOW_LIVE` variables (`.env.example`).

Update: on the VPS pull the deployed branch, install with `REDISMS_DISABLE_POSTINSTALL=1 pnpm install --frozen-lockfile`, build, `prisma migrate deploy`, restart the two pm2 processes; Vercel builds the web from the repository. Rollback: V1 still runs on the same VPS (other port, its own database): point the Nginx upstream back to V1 and promote the last V1 deployment on Vercel. The VPS hosts other applications: only the Djaber processes and containers are touched.
