# 07 — Non-functional: security, performance, operations, tests, migration

---

## 1. Security

### 1.1 RBAC matrix per endpoint group (authoritative with `01-nest-module-map.md` §3.2 `permission-matrix.ts`; generated test `AT-RBAC` iterates it)

Legend: O Owner · A Admin · P Operator · K API key (scope) · — none. `R` = GET only. Every row names the permission key of `permission-matrix.ts`. Members with `readOnly=true` (plan limit) get `403 READ_ONLY_MEMBER` on every non-GET. `Workspace.status='suspended'` ⇒ `403 WORKSPACE_SUSPENDED` on every route except `GET /workspace`, `/me*`, `/support/*`; `Workspace.status='deletion_scheduled'` ⇒ `409 WORKSPACE_DELETION_SCHEDULED {at}` on every mutation except `POST /workspace/deletion/cancel`.

**Merchant routes**

| Endpoint group | Key | O | A | P | K |
|---|---|---|---|---|---|
| `/auth/*`, `/me*` (`/me/prefs`, `/me/devices`, `/me/deletion-request`, `/me/saved-views` own), `/invitations/:token` + `/accept`, `GET|POST /workspaces`, `GET /legal/pending`, `POST /legal/accept`, `GET /app/version` | — (authenticated or `@Public()` per route) | ● | ● | ● | — |
| `GET /workspace`, `GET /workspace/quick-replies`, `GET /workspace/system-messages` | `workspace.read` | ● | ● | ● | — |
| `PATCH /workspace`, `/workspace/quick-replies` (W, incl. `PATCH /workspace/quick-replies/order`), `/workspace/system-messages` (W), `/workspace/onboarding` | `workspace.settings` | ● | ● | — | — |
| `GET /workspace/members`, `GET /workspace/invitations` | `members.read` | ● | ● | R | — |
| `POST|PATCH|DELETE /workspace/members*`, `/workspace/invitations*` (W) | `members.manage` | ● | — | — | — |
| `POST /workspaces/:id/transfer-ownership` | `workspace.transfer` | ● | — | — | — |
| `DELETE /workspace`, `POST /workspace/deletion/cancel` | `workspace.delete` | ● | — | — | — |
| `GET /channels*` | `channels.read` | ● | ● | ● | — |
| `/channels/connect/*`, `/channels/:id/reconnect`, `PATCH|DELETE /channels/:id`, `/channels/:id/sync|analysis*`, `PUT /channels/:id/agent` | `channels.manage` (verified e-mail) | ● | ● | — | — |
| `GET /conversations*`, `GET /conversations/:id/messages`, `/read`, `/notes`, `PATCH /conversations/:id`, `/conversations/:id/assign`, `/conversations/bulk/{resolve\|archive\|assign\|resume-ai}` | `inbox.read` (K: `conversations:read`, GET only) | ● | ● | ● | `conversations:read` |
| `POST /conversations/:id/messages` | `inbox.reply` | ● | ● | ● | `conversations:reply` |
| `DELETE /conversations/:id` | `inbox.delete` | ● | ● | — | — |
| `POST /safety/blocks`, `POST /conversations/bulk/block`, `POST /safety/reports`, `GET /safety/*` | `safety.block` | ● | ● | ● | — |
| `DELETE /safety/blocks/:id`, `PUT /safety/rules` | `safety.manage` | ● | ● | — | — |
| `GET /agents*`, `GET /agent-insights*`, `GET /ai/models` | `agents.read` | ● | ● | ● | — |
| `POST|PATCH|DELETE /agents*`, `/agents/bulk/*`, `/agents/generate*`, `/agents/:id/versions/*/restore`, `/agents/:id/activate|pause` | `agents.manage` | ● | ● | — | — |
| `POST /agents/:id/test*`, `GET /agents/:id/test/export` | `agents.test` | ● | ● | ● | — |
| `POST /agent-insights/:id/resolve` | `insights.manage` | ● | ● | ● | — |
| `GET /products*`, `GET /categories`, `GET /units`, `GET /stock/*` (movements, snapshot), `GET /stock-recommendations*` | `catalog.read` (= `stock.read` for movements) | ● | ● | ● | `products:read` |
| `POST|PATCH|DELETE /products*`, `/categories` (W), `/units` (W), `/products/import*`, `/products/export`, `/products/ai-fill`, `/products/bulk/*`, `/products/:id/appeal`, `/products/:id/resubmit`, `/products/:id/images*` | `catalog.write` | ● | ● | — | `products:write` |
| `POST /stock/adjustments`, `POST /inventories`, `POST /inventories/:id/validate|cancel` | `stock.adjust` | ● | ● | — | `products:write` |
| `GET /inventories*`, `PUT /inventories/:id/lines` | `stock.count` | ● | ● | ● | — |
| `POST|PATCH|DELETE /stock-recommendations*`, `/stock-recommendations/generate`, `/stock-recommendations/rules*` | `catalog.write` | ● | ● | — | — |
| `GET /clients*` | `clients.read` | ● | ● | ● | `customers:read` |
| `POST /clients`, `PATCH /clients/:id`, `/clients/bulk/tags`, `/clients/merge` | `clients.write` | ● | ● | ● | `customers:write` |
| `DELETE /clients/:id`, `/clients/export` | `clients.delete` | ● | ● | — | `customers:write` (delete only) |
| `GET /orders*`, `/orders/stats`, `GET /orders/:id/history|calls|notes|shipments` | `orders.read` | ● | ● | ● | `orders:read` |
| `POST /orders`, `PATCH /orders/:id` (contact, notes), `POST /orders/:id/status` (every transition except `delivered → returned`), `/calls`, `/notes`, `/callback`, `/assign`, `POST /orders/:id/address`, `/payments`, `/orders/bulk/status` (`to ∈ confirmed\|preparing\|cancelled`), `/orders/bulk/assign`, `/orders/:id/print`, `/orders/:id/payment-link` | `orders.write` | ● | ● | ● | `orders:write` |
| `PATCH /orders/:id` with `deliveryFee`/`discount`, `POST /orders/:id/status { to:'returned' }` from `delivered`, `DELETE /orders/:id`, `/orders/export`, `/orders/:id/refunds` | `orders.money` | ● | ● | — | — |
| `POST /orders/bulk/status` with `to ∈ delivered\|returned` | forbidden for every role (`403 FORBIDDEN`) | — | — | — | — |
| `POST /orders/import`, `POST /orders/import/:jobId/commit` | `orders.import` | ● | ● | — | — |
| `GET /geo/*`, `GET /delivery/fees`, `/delivery/fees/quote`, `/delivery/overview`, `GET /shipments*`, `/delivery/rates`, `GET /delivery/couriers*` | `delivery.read` | ● | ● | ● | `delivery:read` |
| `POST /orders/:id/shipments`, `/shipments/bulk`, `/shipments/:id/sync|retry|cancel|mark-failed`, `/shipments/labels`, `GET /shipments/:id/label` | `delivery.send` | ● | ● | ● | — |
| `PUT /delivery/fees/*`, `DELETE /delivery/fees/:wilayaId`, `/delivery/fees/seed|copy-from-courier`, `/delivery/couriers*` (W) | `delivery.manage` | ● | ● | — | — |
| `/suppliers*`, `/purchases*`, `/sales*`, `/cash*` (incl. `POST /cash/close`, `POST /cash/days/:day/reopen`) | `gds.manage` | ● | ● | — | — |
| `GET /reports*`, `POST|DELETE /reports/:key/schedule` | `reports.read` | ● | ● | — | `analytics:read` (json only) |
| `GET /analytics/*`, `/dashboard/home` | `analytics.read` | ● | ● | ● | `analytics:read` |
| `/notifications*`, `/notification-preferences` | `notifications.own` | ● | ● | ● | — |
| `GET /me/saved-views`, `POST /me/saved-views`, `PATCH|DELETE /me/saved-views/:id` (own views; a view shared by another member ⇒ 403 `SAVED_VIEW_SHARED_READONLY`) | `workspace.read` | ● | ● | ● | — |
| `POST /me/saved-views/:id/share { isShared? }` | `views.share` | ● | ● | — | — |
| `GET /plans`, `GET /credit-packs` | `@Public()` | ● | ● | ● | — |
| `GET /credits`, `GET /credits/ledger` | `billing.read_credits` | ● | ● | ● | — |
| `GET /billing/*` (subscription, invoices, checkout preview, return) | `billing.read` | ● | ● | — | — |
| `POST /credits/packs/checkout`, `POST /billing/promo/validate` | `billing.write` | ● | ● | — | — |
| `POST /credits/packs/iap/validate` | `billing.write` (mobile) | ● | ● | — | — |
| `POST /billing/checkout`, `/billing/cancel`, `/billing/invoices/:id/pay`, `PATCH /billing/info` | `billing.manage` | ● | — | — | — |
| `/api-keys*`, `/webhooks*` (outbound), `/integrations/google-sheets*` | `integrations.manage` | ● | ● | — | `webhooks:manage` (webhooks only) |
| `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel|retry` (own jobs), `/uploads` | `jobs.own` | ● | ● | ● | `products:write` (uploads) |
| `POST /support/tickets`, `GET /support/tickets` (own), `GET /help/*` | `support.own` | ● | ● | ● | — |
| `GET /support/tickets` (all of the workspace) | `support.read_all` | ● | ● | — | — |
| `/webhooks/*` (inbound: meta, couriers, chargily, resend, google-play, app-store) | signature only | | | | |
| `/status`, `/legal/:key`, `/cms/*`, `/data-deletion/:code`, `/track/:publicToken`, `/agent-test/:token`, `/account-deletion/*` | `@Public()` | | | | |

Operators never see `deliveryFee`/`discount` editors, delete buttons, export buttons, courier/fee settings, GDS operations, reports, billing, member management, saved-view sharing, orders import — hidden in UI and 403 on API.

**Platform routes** (`/admin/*`; `X-Workspace-Id` ignored; 2FA mandatory for every platform role, `TWO_FA_REQUIRED_FOR_ROLE`)

Keys `admin.<area>.read` / `admin.<area>.write`, areas = `overview, workspaces, users, billing, ai, presets, cms, audit, health, settings, moderation, safety, support, team, deletion`. Legend: SA super_admin · SU support · MO moderator · FI finance · RD read.

| Area / action | Key | SA | SU | MO | FI | RD |
|---|---|---|---|---|---|---|
| Every `GET /admin/*` (all areas) | `admin.<area>.read` | ● | ● | ● | ● | ● |
| Workspaces write: suspend / reactivate / schedule deletion / extend trial / change plan / create for a client (`/admin/workspaces/:id/*`) | `admin.workspaces.write` | ● | — | — | — | — |
| Trust level change (`POST /admin/workspaces/:id/trust-level`) | `admin.moderation.write` | ● | — | ● | — | — |
| Users write: block, reset password, disable 2FA, revoke sessions (`/admin/users/:id/*`) | `admin.users.write` | ● | — | — | — | — |
| Platform role change (`POST /admin/users/:id/platform-role { totpCode }`), platform members & invitations (`/admin/platform-members*`) | `admin.team.write` | ● | — | — | — | — |
| Impersonation (`GET|POST|DELETE /admin/impersonation/sessions*`, read-only sessions) | `admin.support.write` | ● | ● | — | — | — |
| Support write: reply, assign, canned replies, close (`/admin/support/*` W) | `admin.support.write` | ● | ● | — | — | — |
| Health write: queue pause / resume / drain-failed, failed job replay (`/admin/queues/*`), incidents (`/admin/incidents*` W) | `admin.health.write` | ● | ● | — | — | — |
| Moderation write: approve / reject / request-changes / bulk, rules, appeals (`/admin/moderation/*` W) | `admin.moderation.write` | ● | — | ● | — | — |
| Safety write: abuse reports decisions, blacklist, blocked words, auto-rules (`/admin/safety/*` W) | `admin.safety.write` | ● | — | ● | — | — |
| Billing write: plans, subscriptions, invoices (`mark-paid`, resend reminder, change plan/cycle, discount, cancel), credit grants of any amount, promo codes, credit packs, credit pricing versions (`/admin/plans*`, `/admin/subscriptions*`, `/admin/invoices*`, `/admin/credits/*`, `/admin/promo-codes*`, `/admin/credit-packs*`, `/admin/credit-pricing*`) | `admin.billing.write` | ● | — | — | ● | — |
| Credit grant ≤ 1 000 (`POST /admin/workspaces/:id/credits`) | `admin.billing.grant_small` | ● | ● | — | ● | — |
| AI providers, models, routes, pricing simulate (`/admin/ai-providers*`, `/admin/ai-models*`, `/admin/ai-routes/*`, `/admin/ai-pricing*`) | `admin.ai.write` | ● | — | — | — | — |
| Presets write (`/admin/presets*` W) | `admin.presets.write` | ● | — | — | — | — |
| CMS write incl. legal publish, announcements, app versions text (`/admin/cms*` W) | `admin.cms.write` | ● | — | — | — | — |
| Platform settings, providers test, feature flags, app versions, maintenance (`PUT /admin/settings/:key`, `/admin/providers/:key/test`, `/admin/feature-flags*`, `/admin/app-versions*`) | `admin.settings.write` | ● | — | — | — | — |
| Audit export (`POST /admin/audit-logs/export`) | `admin.audit.write` | ● | — | — | ● | — |
| Viewer unmask (`?unmask=1` on `/admin/conversations/*`, `/admin/users/:id`) — audited `pii.view` | `admin.overview.write` | ● | — | — | — | — |
| Deletion requests process / cancel (`/admin/deletion-requests/:id/*`), end-customer data deletion by e-mail (`POST /admin/data-deletion-requests`) | `admin.deletion.write` | ● | ● | — | — | — |

`read` has every `admin.<area>.read` and nothing else. Every platform write is audited (01 §3.4).

### 1.2 Tenancy isolation tests
- `test/tenancy/route-crawler.spec.ts`: boots the app, reads all routes with `:id`-style params from the Nest router, creates two workspaces with one row per entity (factory per model), and for every route calls it as workspace B with workspace A's id ⇒ expects `404 NOT_FOUND` (or 403 for admin-only). Runs in CI on every PR.
- Prisma tenant extension unit tests: every tenant-scoped model `findMany` without context throws `TenantContextMissing`.
- Worker: processors assert `TenantContext.workspaceId === job.data.workspaceId` before any query.
- Unique constraints that are global (Channel `(platform, externalId)`, User email, ApiKey hash) are documented and tested for cross-workspace leakage (error message never reveals the other workspace's name except the designed `PAGE_ALREADY_CONNECTED_ELSEWHERE`).

### 1.3 Secrets & crypto
- Passwords argon2id (`m=65536, t=3, p=4`). JWT access EdDSA (Ed25519) 15 min, claims `{ sub, wsId, role, platformRole?, jti }`; refresh tokens 7 d random 256-bit, stored SHA-256, family rotation with reuse detection (reuse ⇒ revoke family + `auth.sessions_revoked` audit).
- `EncryptedField` AES-256-GCM with `ENCRYPTION_KEYS="v2:<b64>,v1:<b64>"`; new writes use the first; `sched-key-rotation` re-encrypts. Encrypted columns: `Channel.accessToken`, `CourierAccount.credentials`, `CourierAccount.webhookSecret`, `AiProvider.apiKey`, `User.totpSecret`, `SheetsConnection.refreshToken`, `WebhookEndpoint.secret`, `PlatformSetting.providers.*.secret`.
- API keys: `dj_live_` / `dj_test_` + 32 random bytes base62; SHA-256 stored; prefix (first 12 chars) displayed.
- Signed state/tokens: HMAC-SHA256 with `STATE_SECRET` (separate env).
- Never log: tokens, credentials, message text, phone/e-mail beyond masked form (`05•••••56`, `z•••@boutique.dz`).

### 1.4 PII masking for platform viewers (ADM-17, ADM-11 extract)
`PiiMasker.mask(text|phone|email, level)` applied in `/admin/conversations/*`, `/admin/reports/*` extracts, `/admin/users` list for roles `support`, `moderator`, `read`: phone ⇒ `0550 ••• •22`, e-mail ⇒ `k•••@techstore.dz`, message text ⇒ profanity/phone/e-mail/URL patterns replaced by `******` (as drawn: "vous êtes des voleurs *******"). `super_admin` and `finance` (billing data only) see unmasked data; every unmasked view is audited with `action='pii.view'`.

### 1.5 Audit
`AuditLog` fields (05 §9) + `reason`, `userAgent`, `impersonationSessionId?`. Retention 24 months (`sched-retention` deletes older). Export signed CSV (SHA-256 of body in first line) — ADM-09. Every action in `01-nest-module-map.md` §3.4 list.

### 1.6 Transport & headers
TLS 1.2+, HSTS 1 y preload, Helmet defaults + CSP for web (`default-src 'self'; img-src 'self' https://*.fbcdn.net https://*.cdninstagram.com <S3_PUBLIC_URL> data:; connect-src 'self' <API> wss://<API>; frame-src https://www.facebook.com https://accounts.google.com https://docs.google.com https://pay.chargily.net`), CORS allowlist from `WEB_ORIGINS` exactly (no wildcards); **shipped 16/11 (full-test 15/11 PUBLIC-03)**: the web app answers every page with `Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (`next.config.ts` — the full `default-src` policy above is still to do); support-ticket attachments are private files (key `private/…`, and any `…/ticket_attachment/…` key stored before) served only through signed links valid 1 h (HELP-05); cookies `Secure; HttpOnly; SameSite=Lax; Path=/api/v1/auth`.

### 1.7 Input hardening
Zod DTO whitelist (unknown keys rejected 422); file uploads validated by magic bytes (`file-type`), images re-encoded (strips EXIF/scripts), PDFs scanned for `/JS`; CMS HTML sanitised with `sanitize-html` allowlist (headings, p, ul/ol, a[href https], img[src S3], strong/em, table); webhook payload size limit 1 MB; request body limit 2 MB (uploads 25 MB multipart).

---

## 2. Performance targets & how they are met

| Target | Value | Mechanism | Test |
|---|---|---|---|
| Meta webhook ack | p99 < 1 s, p95 < 200 ms | raw body, one insert, enqueue; no Graph calls | k6 `webhook-burst` 1 000 msgs/30 s |
| Customer message → AI reply sent | p95 < 30 s incl. 3 s window | `ai-reply` concurrency 8, per-workspace cap 2, provider timeout 45 s | integration timing on fixtures |
| AI generation | p50 < 3 s, p95 < 5 s | ≤ 60-product context, retrieval above, `maxTokens ≤ 1 200` default presets, streaming off | evals report |
| List endpoints | p95 < 500 ms at 100 k orders / 10 k products / 50 k conversations per workspace | composite indexes `(workspaceId, status, orderedAt desc)`, `(workspaceId, lastMessageAt desc)`, trigram GIN on products; keyset pagination for messages/notifications; `count` via `pg_class` estimate when `total > 10 000` (exact below) | k6 `orders-list` |
| Analytics endpoints | p95 < 500 ms | `DailyStat(workspaceId, day, metrics, computedAt)` rollups (`@@unique([workspaceId, day])`, job `sched-daily-stats` at 00:30 Africa/Algiers for D−1) + today computed live | integration |
| Dashboard LCP | < 3 s on 4G | RSC shell, route-level code splitting, skeletons, `next/font`, image thumbnails 320 px | Lighthouse CI budget |
| Public / auth page weight (PUBLIC-04) | only the texts the page can show: no merchant / admin catalogue in the HTML, no catalogue in the JS | locale layout sends the generated public subset of the catalogue, non-public route groups add the rest (`FullMessages`), browser bundles get an empty stand-in for the `@djaber/shared` catalogue module (02-next-route-map §7) | `apps/web/src/i18n/public-keys.spec.ts`, `client-catalogue.spec.ts` |
| WS fan-out | message visible < 2 s | Redis adapter, room per workspace | AT-INB-01 |
| Tracking sync | 10 k shipments / run | batch 50, limiter 2/s/account, 4 workers | k6/integration |
| Throughput | > 100 req/s, 1 000 concurrent conversations | stateless API ×2, worker ×2, pgbouncer | k6 |

Caching: Redis for tenant context (30 s), plan limits (30 s), rates (1 h), `conversations/counts` (5 s, invalidated by WS events), public CMS pages (ISR 60 s in Next), wilaya/commune lists (immutable, client cached 1 d).

---

## 3. Rate limits (named throttlers; 429 `RATE_LIMITED {retryAfter}`)

| Name | Limit | Key |
|---|---|---|
| `auth-login` | 5 failures / 15 min | IP + e-mail |
| `auth-forgot` | 3 / h | e-mail |
| `auth-2fa` | 5 / 15 min | mfaToken |
| `auth-register` | 10 / h | IP |
| `verify-resend`, `invite-resend` | 1 / 60 s | user / invitation |
| `user` | 1 200 / min | userId |
| `api-key` | 600 / min (ADM-13 default, editable) | apiKeyId |
| `playground` | 60 / h | workspaceId |
| `analysis` | 3 / day | workspaceId (page analysis, agent generation, FAQ extract, create-from-photo) |
| `reco-generate` | 1 / 10 min | workspaceId |
| `tracking-sync-manual` | 1 / 5 min | shipmentId |
| `report-abuse` | 10 / day | userId |
| `support-ticket` | 20 / day | workspaceId |
| `uploads` | 120 / h | userId |
| `webhooks-inbound` | 5 000 / min | IP (Meta ranges allowlisted from throttling) |
| `public-forms` | 5 / h | IP (account deletion, contact) |

---

## 4. Backups, retention, deletion

| Data | Retention | Mechanism |
|---|---|---|
| Postgres | PITR (WAL) + hourly base backups, 30 d on-site, daily off-site copy; RTO/RPO < 1 h | managed Postgres or `pgbackrest`; `sched-backup-verify` |
| Object storage | versioning on; lifecycle per prefix (05-integrations §9) | bucket policy |
| Redis | no persistence needed except delayed jobs ⇒ AOF `everysec` | config |
| AuditLog | 24 months | `sched-retention` (`ComplianceRetentionService`, batched) |
| Invoice + BillingPayment + CreditPackPurchase | 10 years (legal) | never deleted; survive user anonymisation and workspace purge (workspace row kept as `purged` stub with billing identity: same id, name, `billingInfo`, locale, dates, `deletedAt` set, no owner / members; the payment proof `Upload` is kept with its payment; `WorkspaceDeletionService.deleteKeepingBilling`) |
| Payment events (`InboundEvent` provider `chargily` / `google_play` / `app_store`) | 5 years | `sched-retention` (excluded from the 7-day raw-event purge) |
| Messages / attachments | 12 months then purge, conversation anonymised | D28 |
| Raw inbound events (Meta/courier) | 7 d | `sched-retention` |
| Reports (closed) · customer blocks (lifted) · platform blacklist (revoked) | 2 years after the decision / lift / revocation (04 §13); open reports and blocks in force are kept | `sched-retention` |
| Meta data deletion (end customer) | on request (callback or e-mail), handled by the `meta-data-deletion` job | MSG-08 |
| Webhook deliveries | 30 d | |
| Deleted workspace | 30 d grace then hard purge | D31 |
| Account deletion | 30 d grace then anonymise | ADM-16 |
| Jobs rows/results | 90 d (finished jobs); export files 7 d | `sched-retention` (rows); bucket lifecycle (files) |
| AiRun / AiToolCall | 24 months (analytics), tool args with PII masked after 12 months | `sched-retention` (args / results replaced by `{ redacted: true }`) |
| Refresh tokens | 7 d + 30 d after expiry | |

**End-customer data deletion by e-mail** (MSG-08; the privacy policy and the data-deletion page give the support address, because a Meta callback may match nothing — status AUCUNE DONNÉE): (1) support answers within 30 days, asks for the page / shop the person wrote to and the phone used for the order (or the conversation link the merchant can give); (2) `POST /admin/data-deletion-requests { phone, workspaceId?, reason: "Demande e-mail du <date> (ticket …)" }` with a `super_admin` / `support` account (2FA), from `/api/docs` or the Postman collection (no screen yet); without `workspaceId` the phone is matched in every shop; a page-scoped sender id can be given as `externalSenderId`; (3) the answer carries `code` and `statusUrl`: send the URL to the requester; the job runs within the minute and the page shows TERMINÉ (what was deleted / anonymised) or AUCUNE DONNÉE; (4) `GET /admin/data-deletion-requests?source=admin` lists the requests; the phone is not kept once processed, the audit row keeps it masked.

Restore runbook: `docs/runbook/restore.md` (written in M0): restore DB to point in time, replay `Outbox` unprocessed rows, re-verify Meta webhook subscription, re-point `WEB_ORIGINS`.

---

## 5. Observability

- **Logs**: Pino JSON to stdout → Loki (or hosting log drain); fields §1.3 of module map; sampling none; level `info` prod, `debug` staging.
- **Errors**: Sentry (API, worker, web, mobile) with `workspaceId`, `userId` (hashed), `requestId`, release = git SHA; PII scrubbing via `beforeSend`.
- **Metrics**: Prometheus `/metrics` (API + worker, internal network only), Grafana dashboards: `API latency`, `Queues`, `AI`, `Meta`, `Couriers`, `Business` (orders/day, AI orders, credits). Alerts (Alertmanager → Slack + e-mail): webhook ack p95 > 1 s 5 min; `ai-reply` waiting > 200 or failed > 20 / 10 min; any queue paused > 15 min; AI error rate > 2 % / 10 min per provider (also drives routing fallback); `meta_send_failures_total{code="190"}` > 10 / h; courier 401 for any account; sheets quota; worker heartbeat missing > 2 min; DB connections > 80 %; disk > 80 %.
- **Incident page**: `Incident` rows (ADM-14) feed `/status` (public) and the CMS banner; post-mortem link; `platform.alert` WS to admins.
- **Health**: `/health` (liveness), `/health/ready` (deps), uptime check every minute from two regions on `/health/ready` and `/` (web).
- **Tracing**: OpenTelemetry auto-instrumentation (http, pg, ioredis, bullmq) exported to the hosting APM when available; sampled 10 %.

---

## 6. Deployment topology & environments

```
                   ┌───────────────┐
 Internet ──TLS──▶ │ Caddy / LB    │──▶ web (Next.js, 2×)  app.djaber.ai, djaber.ai, status.djaber.ai
                   │               │──▶ api (NestJS, 2×)   api.djaber.ai  (/api/v1, /ws, /webhooks, /api/docs)
                   └───────────────┘
 worker (NestJS standalone, 2×; scheduler leader via Redis lock) ──▶ same Postgres/Redis/S3
 Postgres 16 (primary + PITR; pgbouncer transaction pooling)   Redis 7 (AOF)   S3-compatible (R2/MinIO)
 Chromium (inside worker image) for PDF · Mailpit (dev) · MinIO (dev)
```
- Docker images: `apps/api/Dockerfile`, `apps/worker/Dockerfile` (adds Chromium), `apps/web/Dockerfile` (standalone output). `docker-compose.yml` for local (postgres, redis, minio, mailpit, api, worker, web).
- Environments: `local` (compose, Meta test app, `CHARGILY_MODE=test`, courier fakes), `staging` (anonymised prod copy refreshed weekly, Meta test app users, `CHARGILY_MODE=test`, `APPLE_IAP_ENV=sandbox`), `production` (`CHARGILY_MODE=live`). Config via env; no `.env` committed; secrets in the platform's secret store.
- **Live deployment (since 2026-10-14; full description in `docs/specs/07-architecture.md` §12)**: the topology above is the target; today the web runs on Vercel (project root `apps/web`, `apps/web/vercel.json`, https://djaber.vercel.app, `NEXT_PUBLIC_API_URL` → the API) and the API + worker run as two pm2 processes on a VPS behind Nginx TLS (`https://djaber.72-60-190-211.sslip.io`, `NODE_ENV=staging`), with Postgres 16 and Redis 7 in Docker containers bound to `127.0.0.1`. Settings that exist for this split: `REFRESH_COOKIE_CROSS_SITE=true` (cookie `SameSite=None; Secure; Partitioned`), `WEB_ORIGINS` with the Vercel origin, `META_LEGACY_PATHS=true` + `META_OAUTH_CALLBACK_PATH=/api/pages/callback/{platform}` (V1 URLs registered in the Meta app keep working), `META_FACEBOOK_SCOPES` (the app's 4 permissions), `MAIL_DRIVER=smtp` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`), `PLATFORM_2FA_EXEMPT_EMAILS` (testing: the test super admin opens /admin without 2FA; ignored in production — empty it before going to production). Install on Vercel and the VPS with `REDISMS_DISABLE_POSTINSTALL=1` (skips the test-only Redis build). Rollback = Nginx upstream back to V1 (still running on the VPS) + promote the last V1 Vercel deployment.
- CI (GitHub Actions): `lint` → `typecheck` → `unit` → `integration` (embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md) Postgres+Redis+MinIO) → `e2e` (Playwright against compose) → `build` images → `prisma migrate deploy` (staging auto on `main`, production manual approval) → deploy → smoke (`/health/ready`, login e2e). Nightly: `evals`, `load` (k6 subset), ZAP baseline, `pnpm audit`.
- Release: semantic version tag; web shows "Nouvelle version disponible" when `GET /app/config.webVersion` differs from the bundle's build id (polled every 5 min).
- Maintenance mode (ADM-13): `PlatformSetting(key='maintenance').value = { from, to, scope: 'all'|'mutations' }` ⇒ while `from ≤ now < to` the API returns `503 MAINTENANCE_MODE {until: to}` for every mutation (GETs allowed when `scope='mutations'`; every route except `/health*`, `/status`, `/app/version`, `/webhooks/*` when `scope='all'`), inbound webhooks are still persisted and enqueued, the web shows the maintenance banner with disabled actions, the mobile shows `V2 — Système — Maintenance` and retries every 60 s; `GET /app/version` carries `maintenance: { until, text }`; scheduled 02:00–06:00 Africa/Algiers only (`VALIDATION_ERROR` otherwise).

---

## 7. Seed data (`packages/db/seeds`)

| Seed | Content | Env |
|---|---|---|
| `geo` | 69 wilayas (`id, code, nameFr, nameAr`), communes from the official list with `postalCode` | all |
| `units` | Pièce (pc), Kilogramme (kg), Gramme (g), Litre (L), Millilitre (ml), Mètre (m), Boîte (bt) — `isSystem=true` | all |
| `plans` | D68 values exactly (R-O), `trialDays=14` on each, `maxApiKeys` 0 / 0 / 5, `maxWebhooks` 0 / 0 / 5, `syncHistoryDays` 7 / 30 / 90, `isVisible=true`, `isFeatured` on `pro`: `free` (0 / 0 DA, 100 credits, 1 page, 1 agent, 1 member, 50 products, 200 conv/month, features `[]`) · `starter` (1 900 / 19 000 DA, 1 500 credits, 2 pages, 2 agents, 3 members, 500 products, 2 000 conv/month, `[voice_notes, image_recognition, couriers, google_sheets]`) · `pro` (4 900 / 49 000 DA, 5 000 credits, 5 pages, 5 agents, 10 members, products −1, conv/month −1, `[voice_notes, image_recognition, couriers, google_sheets, api_keys, webhooks, advanced_stock, scheduled_reports, instagram, priority_support]`). No `business` plan. | all |
| `credit-packs` | `pack-500` (500 credits, `priceWebDzd` 450), `pack-2000` (2 000 credits, 1 500), `pack-6000` (6 000 credits, 3 900, `isFeatured=true`); `googleProductId` / `appleProductId` = `djaber.credits.<slug>` set in the store consoles; `storeTier` null until published | all |
| `agent-presets` | `vendeur-pro` (friendly, temp 0.6, 1 200 tokens, img+voice, 3 s), `service-client` (professional, 0.4, 1 000, 2 s), `conseiller-produit` (technical, 0.5, 1 400, 3 s), `reponse-express` (casual, 0.6, 700, no img, 1 s) — names/descriptions fr/ar/en | all |
| `quick-replies` | 4 defaults × 3 locales (greeting, delivery info, thanks for order, hours) | per workspace at creation |
| `system-messages` | the 4 workspace keys `handoff`, `out_of_stock`, `out_of_hours`, `welcome` × 3 locales (`fr`, `ar`, `en`) with the R-G defaults (06 §2.11) written into `Workspace.systemMessages` | per workspace at creation |
| `fee-defaults` | V1 default fee table (home/stopdesk/return per wilaya) | all (used by `POST /delivery/fees/seed`) |
| `ai-providers` | rows for openai/anthropic/google/groq (no keys), models with prices (gpt-4o-mini, gpt-4o, claude-haiku-4-5, claude-sonnet-4-5, gemini-2.0-flash, llama-3.3-70b, whisper) and default routes | all |
| `cms` | `CmsEntry(type=legal)` for every `LegalDocKey` (`terms`, `privacy`, `account_deletion`, `content_rules`) each with a `LegalDocument(version=1, isMajor=true)`, `CmsEntry(type=page)` `cookies`, `CmsEntry(type=help)` landing, `CmsEntry(type=system_message_default)` × 4 keys — fr with ar/en fallback | all |
| `platform-settings` | `PlatformSetting` rows: `feature_flags` (all off), `limits` (API 600/min, webhooks 6/24 h, trial 14 d, trial credits 300, deletion grace 30 d, impersonation 30 min, devices 20), `maintenance` (null), `blocked_words` (base list); `PlatformProvider` rows with `status='disabled'` for keys `chargily`, `email`, `sms`, `push`, `courier_zr`, `courier_ecotrack`, `courier_yalidine`, `google_oauth` | all |
| `demo` | one workspace "Boutique Amel" with 128 products, 6 orders in each status, 3 agents, 2 channels (fake), 40 conversations with fixtures, shipments in each state, invoices, notifications — exactly the data drawn in the Figma frames | local, staging |
| `admin` | one super admin (`ADMIN_EMAIL`, forced 2FA setup at first login) | all |

---

## 8. Test strategy

| Level | Tooling | What | Gate |
|---|---|---|---|
| Unit | Vitest (`packages/shared`, services with mocked repos) | validators (04 §2), `OrderStateMachine` full matrix (AT-ORD-01), effects (stock/cash/aggregates), money figures, phone normaliser, merge, prompt sections snapshots, status mapping tables (AT-DLV-04), credit maths, window rules, deep-link map, permission matrix | PR |
| Integration | Jest + embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md) + Supertest | every endpoint: happy, validation, permission (3 roles + API key scopes), cross-workspace 404, idempotency replay, 409 version, rate limit; processors with fakes (Meta, couriers, Chargily, Google, FCM, mail, AI provider stub returning fixtures); schedulers | PR |
| Contract | Jest + recorded fixtures (`nock`) | Meta (OAuth, send, webhook signatures, data deletion), ZR Express, EcoTrack, Yalidine (create, track, label, errors), Chargily (checkout create / verify / webhook signature), Google Sheets (append/update/404/429), Play/App Store receipts | PR |
| AI evals | `pnpm test:evals` (real provider, staging keys) | 04-ai-pipeline §15 | nightly + prompt changes |
| E2E | Playwright (web vs compose + fake providers) | one spec per Figma frame group; every AT with level E; Storybook snapshot per state (AT-UX-01); axe a11y; RTL snapshots; "no dead controls" crawler (clicks every enabled button, expects an action or a tooltip) | nightly + release |
| Load | k6 | webhook burst 1 000, orders list 100 k, tracking 10 k, 100 req/s mixed | nightly (staging) |
| Security | ZAP baseline, `pnpm audit`, `gitleaks` | staging | nightly |
| Migration | `migrate-v1 --dry-run` on anonymised copy | AT-MIG-01/02 | before cut-over |
| Mobile | Flutter widget tests (one per Mobile V2 frame) + integration tests vs staging (`10-flutter-mobile.md` §13) | `AT-MOB-01…20` (= 14 §3 MOB-R01…R20) + every AT of 13 whose feature exists on mobile | release |

Per milestone the AT ids listed in `00-build-order.md` must be green before the milestone is closed. Test naming: `<area>/<feature>.<level>.spec.ts` and test titles start with the AT id when one exists (`'AT-ORD-02 confirmed→delivered applies COD rule'`).

---

## 9. V1 data migration plan (D3, 05 §10)

`packages/db/migrate-v1` (TypeScript CLI): `pnpm migrate:v1 --source mysql://… --target postgres://… --dry-run|--apply --workspace <v1UserId>?`.

1. **Extract**: read V1 MySQL tables in dependency order: User → Page → Agent/AgentPage/AgentProduct → Product/ProductImage/Variant/Expense/Recommendation → Client → Conversation/Message → Order/OrderItem/OrderCall → Sale/SaleItem/Purchase/PurchaseItem/Supplier/CaisseTransaction/StockMovement → DeliveryFeeRule → Plan/Subscription/CreditUsage → Notification → V1 cms pages (→ `CmsEntry` + `CmsEntryLocale`) → AIProvider.
2. **Entity mapping** (05 §10) with id map tables (`v1Id → uuidv7`) kept in `migration_idmap(entity, v1Id, v2Id)` for re-runs and support lookups.
3. **Enum mapping**: order `pending→new`; `paymentStatus pending→unpaid`; delivery `not_sent|sent|in_transit|delivered` kept, missing ⇒ `not_sent`; V1 page `isActive=false` ⇒ channel `disconnected` (token discarded); conversation `resolved && aiPaused` with pending insight ⇒ `needs_human`; message `messageId` prefix `agent_|ai_` ⇒ `author='ai'`, outgoing ⇒ `human` (authorUserId = owner), incoming ⇒ `customer`; notification types per 05 §10 table; plan slug map `individual→starter`, `teams→pro`, unknown ⇒ `free`; `maxConversations→maxConversationsPerMonth`, `maxTeamMembers→maxMembers`.
4. **Placeholders**: V1 clients named `FB User`/`IG User` ⇒ `isPlaceholder=true`; missing wilaya on addresses ⇒ `ClientAddress.wilayaId=null` (allowed only for migrated rows; flagged `needsCompletion`); `communeName` fuzzy-matched (trigram ≥ 0.6) else `communeText`.
5. **Phones**: normalised; duplicates per workspace merged (oldest survives; orders/conversations re-linked; report row).
6. **Order numbers**: legacy `ORD-…` kept verbatim; `Counter.order = max(numeric suffix of legacy)+1` per workspace or 1000 (so the first new one is `CMD-1001` when no legacy) — numeric suffix parsed from `ORD-YYYYMMDD-NNNN` ⇒ `NNNN`; sales `SL-`→kept, counter `VNT`; purchases `PO-`→kept, counter `ACH`.
7. **Decimals**: `Decimal(10,2)` → `Int` rounded half-up; report rows where rounding changed totals by ≥ 1 DA.
8. **Untracked products**: V1 stock `1000000` ⇒ `trackStock=false, stock=null`.
9. **SKUs**: variant/product conflicts ⇒ suffix `-2`, `-3` + report; archived products (`archivedSku`) ⇒ `deletedAt=archivedAt`, sku restored.
10. **Credits**: V1 `creditsUsed` ⇒ one debit row in the current period; `CreditUsage` rows ⇒ ledger with `estimated=true`.
11. **Subscriptions**: one active per workspace (latest wins; report), free subscription created where none.
12. **Secrets**: page tokens decrypted with V1 key (provided at run time, never stored) and re-encrypted with v2 key; AI keys the same; courier providers not migrated.
13. **Dry-run report** (`migration-report.json` + markdown): per table in/out/rejected with reasons, Σ order totals and Σ tracked stock per workspace before/after, merged phones, SKU suffixes, rounding deltas. Acceptance AT-MIG-01: counts equal (minus rejected), sums equal.
14. **Cut-over**: freeze V1 writes (maintenance), final `--apply`, point Meta webhook URL to v2 (same app id), verify AT-MIG-02 with a test message, keep V1 read-only 30 d.

---

## 10. Do / Don't

**Do**
- Treat `01-nest-module-map.md` §3.2 + §1.1 as the only permission source; generate tests from it.
- Mask PII in logs and in platform viewers; audit unmasked views.
- Keep 10-year billing records independent of user/workspace deletion.
- Run the tenancy crawler and the no-dead-controls crawler in CI.
- Alert on AI error rate and webhook ack latency; they are the two user-visible SLOs.

**Don't**
- V1 secrets: follow root `CLAUDE.md` rule 9 (V1 `.env*` may be read to fill this repo's git-ignored `.env`; values never printed, logged or committed; `.deploy-secrets*`, `.github-deploy-key*`, SSH keys off-limits; the V1 database is read-only and used only by the migration rehearsal).
- Don't add wildcard CORS origins.
- Don't store secrets in `PlatformSetting` JSON unencrypted.
- Don't ship a migration that changes enum values without a data migration step.
- Don't run `prisma db push` anywhere.
