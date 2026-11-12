# 01 — NestJS module map

NestJS 11, Node 22, TypeScript strict. Two runnable apps share the same module tree: `apps/api` (HTTP + WebSocket) and `apps/worker` (standalone Nest context that registers only the BullMQ processors + schedulers). Modular monolith per 07 §3.

---

## 1. Folder structure

```
apps/api/src
  main.ts                      # bootstrap: helmet, cors allowlist, raw-body for /webhooks/*, swagger, pino
  app.module.ts                # imports every domain module + Core
apps/worker/src
  main.ts                      # NestFactory.createApplicationContext(WorkerModule)
  worker.module.ts             # imports domain modules with `processors: true`
packages/db
  prisma/schema.prisma         # owned by the schema agent
  src/client.ts                # PrismaService + tenant extension (see §4.2)
  seeds/*.ts
  migrate-v1/*                 # D3 migration scripts
packages/shared
  src/errors/codes.ts          # every code of 11 (the only source); aliases.ts mirrors 11 §13 and is used nowhere else
  src/errors/messages.{fr,ar,en}.json
  src/validators/*.ts          # zod: name, phoneDz, wilaya, commune, address, email, price, qty, sku, dates
  src/enums/*.ts               # mirrors of Postgres enums (generated from Prisma)
  src/i18n/keys.ts             # typed key list for web + mobile
  src/schemas/*.ts             # DTO zod schemas reused by API (nestjs-zod) and web forms
packages/ui                    # design system (02-next-route-map §5)

apps/api/src/core              # cross-cutting, no domain logic
  config/           config.schema.ts (zod env), config.module.ts
  logging/          pino, request-id, pii-redaction
  metrics/          prom-client registry, /metrics (internal)
  flags/            FeatureFlagService (PlatformSetting.flags → %/workspace list)
  throttle/         RedisThrottlerStorage + named limits
  tenancy/          TenantContext (AsyncLocalStorage), TenantGuard, WorkspaceIdDecorator
  auth/             JwtStrategy, ApiKeyStrategy, AuthGuard, CurrentUser, PlatformRoleGuard
  rbac/             RequirePermission, PermissionGuard, permission-matrix.ts
  idempotency/      IdempotencyInterceptor
  audit/            AuditInterceptor, @Audited()
  errors/           AppException, AppExceptionFilter, warnings (meta.warnings)
  i18n/             Accept-Language resolver, message formatter
  outbox/           OutboxService (write in tx), OutboxRelay (worker)
  ws/               WsGateway (Socket.IO), WsEmitter (Redis pub)
  queue/            BullMQ module factory, queue names, job typing, DLQ helpers
  storage/          S3 client, signed URLs, sharp pipeline
  pdf/              Playwright/Chromium HTML→PDF renderer (05-integrations §8)
  mail/             MailService + react-email templates
  crypto/           AES-256-GCM (KeyRing with versioned keys), hashing
apps/api/src/modules
  auth/             controllers: auth, me, sessions, devices
  workspace/        workspace, members, invitations, ownership-transfer, quick-replies, system-messages, onboarding, deletion, legal
  billing/          plans, subscriptions, checkout, invoices, credits, packs, promo, iap, limits, dunning
  channels/         meta-oauth, channels, insights, sync, analysis, app-review, token-refresh
  messaging/        webhooks(meta), inbound processor, conversations, messages, outbox-sends, window-rules, blocks/reports
  ai/               providers, routing, prompt-builder, tools, runs, vision, transcription, playground, captions
  agents/           agents, presets, versions, insights, generation
  catalog/          products, images, variants, categories, units, stock, import, export, from-image, moderation-hooks
  clients/          clients, identities, merge, addresses, risk
  orders/           orders, status machine, effects, calls, callbacks (Order.callbackAt), notes, numbering, print, export, bulk, import
  delivery/         geo, fees, courier-accounts, adapters/{zrexpress,ecotrack,yalidine,manual}, shipments, tracking-sync, labels, overview, rates, public-tracking
  payments/         gateway/chargily (only implementation of PaymentGateway), order-payment-links, refunds, webhooks
  recommendations/  rules, engine, events (cross-sell) + stock-recommendations (GDS-10)
  gds/              suppliers, purchases, sales, cash (+ CashClosing), expenses, inventories, reports, report-schedules
  notifications/    producer, preferences, in-app, email fan-out, push (FCM)
  analytics/        home, overview + tabs, daily-stats (DailyStat)
  sheets/           google-oauth, connection, row-sync, backfill
  integrations/     api-keys, outbound-webhooks, deliveries
  admin/            overview, workspaces, users, plans, subscriptions, ai-admin, presets, cms, audit, jobs-health, settings, moderation (+ trust levels), safety (abuse reports, blacklist, blocked words), support, platform-members, deletion-requests, viewers, impersonation (read-only)
  jobs/             Job entity service (progress/result), job controller
  uploads/          POST /uploads
  public/           cms public pages, pricing, status, data-deletion status, account-deletion page API
```

Each domain module folder: `x.module.ts`, `x.controller.ts` (HTTP only, thin), `x.service.ts` (domain), `x.repository.ts` (Prisma queries, always tenant-scoped), `dto/` (zod schemas from `packages/shared` wrapped with `createZodDto`), `events/` (domain event types), `processors/` (BullMQ `WorkerHost` classes, loaded only in the worker), `x.permissions.ts`.

---

## 2. Module list ↔ spec ↔ Figma

| Module | Spec sections | Figma frames (primary) | Depends on |
|---|---|---|---|
| `core/*` | 06 §1, 07 §6, 11 | REF Component sheet, GLOBAL catalogue | — |
| `auth` | 03 §1, 02 §4, 05 §1, 06 Auth | AUTH *, DLG Settings (2FA, password, e-mail, delete account) | mail, crypto |
| `workspace` | 03 §2, §20, 02 §1, 05 §1, FL-13/14 | ONB-01 *, SET Profile/Workspace/Security, SET Members, SET Quick replies…, AUTH create workspace | auth, billing(limits) |
| `billing` | 03 §17, 02 §5–6, 05 §2, FL-09 | BIL-01, BIL-04/03, PUB Pricing, DLG Settings & billing, ADM-15 | payments, notifications |
| `channels` | 03 §3, CHN-08/09, 05 §3 Channel, FL-05, FL-15 | CHN-06, CHN-07, CHN-07b, CHN-08, DLG Agents & channels (connect) | crypto, jobs, ai(analysis) |
| `messaging` | 03 §4, §5, 04 §5, 05 §3, 06 §3/§6, FL-01 (1–5), FL-06, MSG-08 | INB *, QUEUE, DLG Inbox, SAFE | channels, clients, ws, storage, notifications |
| `ai` | 03 §7, 04 §5, 05 §4 AiRun/AiToolCall/AiProvider/AiModel, FL-01 (6–15), FL-02, 02 §6 | AGT-07, GLOBAL credits exhausted | agents, catalog, orders(tools), delivery(fee tool), billing(credits) |
| `agents` | 03 §6, 05 §4 Agent*, AGT-03 versions | AGT-01…08, DLG Agents & channels | ai, channels, catalog |
| `catalog` | 03 §8, §14 GDS-01…04, 04 §2, 05 §5, FL-12, D36 hooks | CAT-*, GDS-01, GDS-05, MOD *, DLG GDS I/II | storage, ai(captions), jobs, billing(limits) |
| `clients` | 03 §9, 04 §2 phone, ORD-12, 05 §6 | CLI-03 (+ mechanics), DLG II (new client, delete client, tags, merge) | — |
| `orders` | 03 §10, 04 §1, §3, §4, §10, §11, 05 §7 Order*, FL-07, ORD-09 | ORD-02/05 v2/06/07, DLG Orders I/II, DLV-06/ORD-09 A5 | clients, catalog(stock), delivery(fees), gds(cash), notifications, outbox |
| `delivery` | 03 §11, 04 §1.5, 05 §7 Wilaya…ShipmentEvent, FL-08 | DLV-01/03, DLV-05, DLV-06, DLV-08, MECH Delivery, DLG I/II courier parts | orders, pdf, notifications |
| `payments` | 03 §12, 04 §6, 05 §7 OrderPayment, §2 BillingPayment, FL-10 | DLG II payment link / refund, BIL checkout return | orders, billing |
| `recommendations` | 03 §13, 05 §5 Recommendation* | GDS-10, DLG GDS II rule | catalog, orders |
| `gds` | 03 §14 GDS-05…10, 04 §3, §4, 05 §8 | GDS-06…09, CAT-11/GDS-06b, ANA-03/04, DLG GDS I/II | catalog, clients, pdf, jobs |
| `notifications` | 03 §15, 05 §9 Notification*, DeviceToken | NTF-01, ANA-01b, REF Deep-link map | mail, push, ws |
| `analytics` | 03 §16, 04 §4, §8 | ANA-01, ANA-02, ANA-02b | orders, gds, ai, delivery |
| `sheets` | 03 §22, 05 §7 Sheets*, FL-11 | SET Integrations (Sheets), DLG Settings (Sheets) | orders(outbox), crypto |
| `integrations` | 03 §18, 06 §4, §5, 05 §9 ApiKey/Webhook* | SET Integrations (keys, webhooks) | outbox |
| `admin` | 03 §19, 05 §9, D36–D42 | ADM-01…17, DLG Platform admin | every module (read), audit |
| `jobs` | 06 §1 Jobs, 05 §9 Job | GLOBAL "Tâche en cours", job toasts | ws |
| `uploads` | 06 §1 Uploads, 05 §9 Upload | DLG logo/avatar, composer image | storage |
| `public` | 01 §4.1 public site, ADM-06, MSG-08 status | PUB * | admin(cms), billing(plans) |

---

## 3. Request pipeline (order matters)

```
express.raw (only /webhooks/*)  →  Helmet / CORS  →  RequestIdMiddleware  →  PinoLogger
→ ThrottlerGuard (named limits)            # 429 RATE_LIMITED {retryAfter}
→ AuthGuard (JWT | API key | public)       # 401 UNAUTHORIZED / API_KEY_REVOKED
→ TenantGuard                              # resolves workspace: 400 WORKSPACE_REQUIRED, 404 NOT_FOUND, 403 WORKSPACE_SUSPENDED, 409 WORKSPACE_DELETION_SCHEDULED {at} (non-GET), 403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION (non-GET under X-Impersonation-Session), 401 ADMIN_IMPERSONATION_EXPIRED
→ PlatformRoleGuard (admin routes only)    # 403 FORBIDDEN (key of PLATFORM_PERMISSIONS, §3.2)
→ PermissionGuard (@RequirePermission)     # 403 FORBIDDEN / READ_ONLY_MEMBER / API_SCOPE_FORBIDDEN
→ EmailVerifiedGuard (@RequireVerifiedEmail) # 403 AUTH_EMAIL_UNVERIFIED (channels connect only)
→ ZodValidationPipe                        # 422 VALIDATION_ERROR {fields}
→ IdempotencyInterceptor                   # replay / 400 IDEMPOTENCY_KEY_MISSING / 422 IDEMPOTENCY_MISMATCH
→ AuditInterceptor (@Audited)              # writes AuditLog after success
→ VersionInterceptor                       # 409 CONFLICT on stale `version`
→ handler → ResponseEnvelopeInterceptor    # { data, meta:{ page, pageSize, total, warnings[] } }
→ AppExceptionFilter                       # { error:{ code, message(localized), params?, fields?, details?, ref } } (06 §1; ref = request id, always present)
```

### 3.1 `TenantGuard` / `TenantContext`

- Reads `X-Workspace-Id`; if absent: user's `ownedWorkspaceId`, else `User.lastWorkspaceId` (column updated on every successful request that carried a header), else `400 WORKSPACE_REQUIRED` (api-contract §1.3); header present but no membership ⇒ 404. `Workspace.status='deletion_scheduled'` ⇒ every non-GET request `409 WORKSPACE_DELETION_SCHEDULED { at: workspace.deletionScheduledAt }` except `POST /workspace/deletion/cancel` (Owner).
- API keys: workspace bound to the key; header ignored.
- Loads `{ workspaceId, membership(role, readOnly), subscription(plan limits, status), workspace.status, workspace.stockMode, workspace.locale, workspace.trustLevel }` into `TenantContext` (AsyncLocalStorage) once per request; cached in Redis 30 s keyed by `ws:<id>:ctx`, invalidated on membership/subscription/status change.
- Suspended test = `Workspace.status === 'suspended'` (set only by an admin, ADM-02 "Suspendre"; never by billing) ⇒ `403 WORKSPACE_SUSPENDED` for every route except `GET /workspace`, `GET /billing/*`, `GET /credits`, `/me/*`, help/support (`/help/*`, `/support/*`). AI replies and outbound webhooks are stopped for suspended workspaces. `Subscription.status='expired'` is NOT a suspension: the workspace keeps working under free-plan limits (02 §5).
- Platform-role users on merchant routes: no membership ⇒ 404 (D21); viewers use `/admin/*` routes only. Impersonation (D21-bis, R-F) = read-only session: header `X-Impersonation-Session: <token>` referencing an `ImpersonationSession(adminUserId, workspaceId, reason, ticketId?, startedAt, expiresAt = startedAt + 30 min, endedAt?, actionsCount)` with `endedAt IS NULL AND expiresAt > now` (else `401 ADMIN_IMPERSONATION_EXPIRED`); allowed only for `User.platformRole ∈ super_admin|support`; `TenantGuard` injects a synthetic `membership{ role:'admin', readOnly:true, impersonation:true }`, increments `actionsCount`, audits every request as `impersonation.action` with `actorType='admin'` + `impersonationSessionId`, and rejects every non-GET request with `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION` before the handler. There is no write mode.

### 3.2 `@RequirePermission('<group>.<action>')` — the single permission table

`permission-matrix.ts` is generated from the two tables below and nowhere else; `02-actors-roles.md` §3, 06 §9, 07 §1.1 and the permission column of `02-next-route-map.md` §3 mirror them. A route without a key is either `@Public()` or `@Authenticated()` (any logged-in user: `/me/*`, `/legal/*`, `/invitations/:token/*`, `/workspaces`, `/app/version`).

**Merchant keys** (`MemberRole ∈ owner|admin|operator`; ● = allowed, — = `403 FORBIDDEN`):

| Key | Owner | Admin | Operator | Covers |
|---|---|---|---|---|
| `inbox.read` | ● | ● | ● | conversations list/counts/thread/messages, send (incl. `templateKey`), read/unread, notes, assign, pause/resume AI, resolve/reopen/archive, `POST /conversations/bulk/{resolve\|archive\|assign\|resume-ai}` |
| `inbox.delete` | ● | ● | — | `DELETE /conversations/:id`, `POST /conversations/:id/restore` |
| `channels.read` | ● | ● | ● | channels list/detail/insights/summary/messages/events, `GET /channels/app-review-status` |
| `channels.manage` | ● | ● | — | connect, reconnect, `PATCH /channels/:id`, disable/enable, disconnect, sync, sync-info, analysis + import, `PUT /channels/:id/agent` |
| `agents.read` | ● | ● | ● | agents list/detail/metrics/versions/readiness, presets, `GET /ai/routes` |
| `agents.manage` | ● | ● | — | wizard create/save, activate, pause/resume, delete, duplicate, versions restore, apply-preset-update, export, FAQ, test links, generate-from-page, `POST /agents/bulk/*` |
| `agents.test` | ● | ● | ● | playground `POST /agents/:id/test`, test scenarios, `POST …/test/flag`, `GET …/test/export` |
| `insights.manage` | ● | ● | ● | `POST /agent-insights/:id/resolve`, `POST /agent-insights/bulk/dismiss` |
| `catalog.read` | ● | ● | ● | products/categories/units/services lists and details, `GET /products/:id/relations\|moderation\|card-preview\|margins`, stock overview, low-stock, stock recommendations read |
| `catalog.write` | ● | ● | — | product create/update/delete/restore/duplicate, images, variants (+ generate), categories, units, import + mapping + commit, export, bulk price/category/agent/archive/min-stock/labels/export, `POST /products/ai-fill`, expenses, moderation `POST /products/:id/appeal\|resubmit`, cross-sell recommendation rules + generate, stock recommendations apply/dismiss/snooze/mute |
| `stock.read` | ● | ● | ● | `GET /stock/movements`, `GET /stock/movements/:id`, `GET /stock/movements/export`, `GET /stock/snapshot?date` |
| `stock.adjust` | ● | ● | — | `POST /stock/adjustments` (`force` = Admin+), `POST /stock/movements/:id/reverse`, quick-edit stock steppers, inventories start/validate/cancel/sheet |
| `stock.count` | ● | ● | ● | `PUT /inventories/:id/lines`, `GET /inventories`, `GET /inventories/:id` |
| `clients.read` | ● | ● | ● | clients list/detail/orders/metrics/conversations |
| `clients.write` | ● | ● | ● | `POST /clients`, `PATCH /clients/:id`, `POST /clients/:id/risk`, `POST /clients/bulk/tags` |
| `clients.delete` | ● | ● | — | `DELETE /clients/:id`, `POST /clients/bulk/delete`, `POST /clients/merge`, `GET /clients/export`, `POST /clients/bulk/export` |
| `orders.read` | ● | ● | ● | orders list/stats/detail/history/calls/notes/payments/shipments/print |
| `orders.write` | ● | ● | ● | `POST /orders`, `PATCH /orders/:id`, `POST /orders/:id/status` (every transition except `delivered → returned`), cancel, deliver (manual), ship-manual, calls, callback set/clear, notes, assign, address, duplicate, `POST /orders/:id/payments`, `POST /orders/bulk/status` (incl. bulk cancel; bulk `delivered`/`returned` forbidden for every role), `POST /orders/bulk/assign`, `POST /orders/bulk/print` |
| `orders.money` | ● | ● | — | fee/discount override on create/update, `delivered → returned` (`POST /orders/:id/return` on a delivered order), `DELETE /orders/:id`, `GET /orders/export`, `POST /orders/:id/payment-link`, `POST /orders/:id/refunds` |
| `orders.import` | ● | ● | — | `POST /orders/import`, `POST /orders/import/:jobId/commit` |
| `delivery.send` | ● | ● | ● | fee grid read + quote, stop-desks, `POST /orders/:id/shipments`, `POST /shipments/bulk`, sync/retry/cancel/retry-delivery/change-courier/mark-failed/mark-delivered/mark-returned, labels, `GET /delivery/overview`, `GET /delivery/rates` |
| `delivery.manage` | ● | ● | — | couriers CRUD + test + capabilities, `PUT\|DELETE /delivery/fees/:wilayaId`, `POST /delivery/fees/seed`, `POST /delivery/fees/copy-from-courier`, `PATCH /workspace { freeDeliveryThreshold }` |
| `gds.read` | ● | ● | — | suppliers, purchases, sales, cash lists/details/stats/print/receipt, `GET /cash/days` |
| `gds.write` | ● | ● | — | suppliers CRUD + payments + (de)activate, purchases CRUD + order/receive/cancel/payments/duplicate, sales CRUD + payments/cancel/client, cash manual rows, `POST /cash/close`, `POST /cash/days/:day/reopen`, `GET /cash/export` |
| `reports.read` | ● | ● | — | `GET /reports`, `GET /reports/:key` (json/xlsx/pdf), export jobs list/cancel/retry, `PATCH /me/prefs { reportFavorites }` |
| `reports.schedule` | ● | ● | — | `POST\|DELETE /reports/:key/schedule` (plan feature `scheduled_reports`) |
| `analytics.read` | ● | ● | ● | `GET /dashboard/home`, `GET /analytics/overview`, the 8 tab endpoints |
| `notifications.own` | ● | ● | ● | own notifications, read/read-all, `GET\|PUT /notification-preferences`, `PATCH /me/prefs` |
| `views.share` | ● | ● | — | `POST /me/saved-views/:id/share` (own saved views need no key) |
| `members.read` | ● | ● | ● | `GET /workspace/members` |
| `members.write` | ● | — | — | `PATCH\|DELETE /workspace/members/:id`, invitations create/resend/revoke |
| `workspace.settings` | ● | ● | — | `PATCH /workspace`, onboarding, quick replies (+ order), `PUT /workspace/system-messages`, stock mode |
| `workspace.transfer` | ● | — | — | `POST /workspaces/:id/transfer-ownership` |
| `workspace.delete` | ● | — | — | `DELETE /workspace`, `POST /workspace/deletion/cancel` |
| `integrations.manage` | ● | ● | — | API keys, outbound webhooks (+ test/enable/rotate-secret/deliveries/replay), Google Sheets connect/config/backfill/disconnect |
| `billing.read` | ● | ● | — | `GET /billing/subscription\|invoices\|invoices/:id/pdf\|payments\|info`, `GET /credits/ledger`, `GET /credits/ledger/export`, `GET /credits/packs/purchases`, `GET /billing/checkout/return` |
| `billing.read_credits` | ● | ● | ● | `GET /credits`, `GET /credits/calculator` (`GET /credit-packs` and `GET /plans` are public, 06 §8.9) |
| `billing.write` | ● | ● | — | `POST /credits/packs/checkout`, `POST /billing/promo/validate\|redeem`, `POST /billing/invoices/:id/pay` |
| `billing.plan` | ● | — | — | `POST /billing/checkout`, `POST /billing/preview`, `POST /billing/cancel`, `PUT /billing/info` |
| `safety.block` | ● | ● | ● | `POST /safety/blocks`, `POST /conversations/:id/block`, `POST /conversations/bulk/block`, `POST /safety/reports`, `POST /messages/:id/report` |
| `safety.manage` | ● | ● | — | `DELETE /safety/blocks/:id`, `POST /conversations/:id/unblock`, `GET\|PUT /safety/rules`, `GET\|PUT /safety/blocked-words` |
| `support.write` | ● | ● | ● | `POST /support/tickets`, messages, rate, close; `GET /support/tickets` returns own tickets only without `support.read_all` |
| `support.read_all` | ● | ● | — | every ticket of the workspace |

**Platform keys** (`User.platformRole ∈ super_admin|support|moderator|finance|read`; areas = `overview, workspaces, users, billing, ai, presets, cms, audit, health, settings, moderation, safety, support, team, deletion`):

| Key | super_admin | support | moderator | finance | read | Covers |
|---|---|---|---|---|---|---|
| `admin.<area>.read` (one key per area) | ● | ● | ● | ● | ● | every `GET /admin/*` of the area; viewers `GET /admin/conversations*`, `GET /admin/products*` are `admin.workspaces.read` (PII masked for every role except super_admin) |
| `admin.overview.write` | ● | — | — | — | — | — (no write; reserved) |
| `admin.workspaces.write` | ● | — | — | — | — | create workspace for client, `PATCH /admin/workspaces/:id`, suspend / reactivate, extend trial, change plan, schedule / cancel deletion, `POST /admin/channels/:id/release` |
| `admin.workspaces.credits` | ● | ● (≤ 1 000) | — | ● | — | `POST /admin/workspaces/:id/credits` (the service rejects > 1 000 for `support` with `403 ADMIN_CREDIT_GRANT_LIMIT {max: 1000}`, 11 §12.1) |
| `admin.workspaces.impersonate` | ● | ● | — | — | — | `GET\|POST /admin/impersonation/sessions`, `DELETE /admin/impersonation/sessions/:id` (read-only sessions, D21-bis) |
| `admin.workspaces.unmask` | ● | — | — | — | — | `POST /admin/conversations/:id/unmask` |
| `admin.users.write` | ● | — | — | — | — | `PATCH\|DELETE /admin/users/:id`, resend-verification / reset-password / disable-2fa / revoke-sessions / block / unblock |
| `admin.billing.write` | ● | — | — | ● | — | plans (+ versions, archive, migrate), subscriptions (create/patch/cancel/discount/resend-dunning), invoices `mark-paid` + export, credit packs, promo codes, credit-pricing versions |
| `admin.ai.write` | ● | — | — | — | — | AI providers, models, routes, pricing simulate/versions |
| `admin.presets.write` | ● | — | — | — | — | agent presets + versions + publish |
| `admin.cms.write` | ● | — | — | — | — | CMS entries, locales, publish/schedule, announcements, legal documents |
| `admin.audit.export` | ● | — | — | ● | — | `POST /admin/audit-logs/export` |
| `admin.health.write` | ● | — | — | — | — | `POST /admin/queues/:name/{pause\|resume\|drain-failed\|replay-failed\|run-now}`, incidents create/update/resolve, maintenance, incident banner |
| `admin.health.replay` | ● | ● | — | — | — | `POST /admin/queues/failed/:jobId/replay` |
| `admin.settings.write` | ● | — | — | — | — | `PUT /admin/settings/:key`, app versions, feature flags, Meta permissions/app, providers config + test |
| `admin.moderation.write` | ● | — | ● | — | — | moderation items approve/reject/request-changes/assign/bulk, appeals decide, rules, `POST /admin/workspaces/:id/trust-level` |
| `admin.safety.write` | ● | — | ● | — | — | abuse reports decide/assign, blacklist, blocked words, auto-rules, compliance export |
| `admin.support.write` | ● | ● | — | — | — | tickets create/messages/assign/resolve/reopen/escalate/wait-customer/link-incident, canned replies |
| `admin.team.write` | ● | — | — | — | — | `/admin/platform-members*`, `POST /admin/users/:id/platform-role { platformRole, totpCode }` (2FA re-check) |
| `admin.deletion.write` | ● | ● | — | — | — | `POST /admin/deletion-requests/:id/{cancel\|resolve\|process-now}` |

Every platform role requires `User.totpEnabled` (`TWO_FA_REQUIRED_FOR_ROLE`); every write under `/admin/*` that touches a merchant requires `reason` (≥ 10 chars) and writes `AuditLog.reason`.

- `readOnly` memberships (plan limit) ⇒ every non-GET ⇒ 403 `READ_ONLY_MEMBER`.
- API keys: `PermissionGuard` maps route scope metadata `@ApiScope('orders:write')` to the key's `scopes[]`; routes without `@ApiScope` are 403 `API_SCOPE_FORBIDDEN` for keys (06 §5 whitelist).
- Platform roles stored on `User.platformRole` (enum, null for merchants); `isSuperAdmin` kept for migration, derived.

### 3.3 `IdempotencyInterceptor`

- Required on the routes listed in 06 §1 (`@Idempotent({ required: true })`), optional elsewhere on POST.
- Key = `(workspaceId, Idempotency-Key)`; `requestHash = sha256(method+path+body)`.
- Flow: `SET NX` in Redis `idem:<ws>:<key>` with 60 s "in-flight" lock → on hit with stored response ⇒ replay stored `responseCode/body`; in-flight ⇒ 409 `CONFLICT` (client retries); hash differs ⇒ 422 `IDEMPOTENCY_MISMATCH`. After success, persist `IdempotencyKey` row (24 h) and set Redis TTL 24 h.
- Response header `Idempotent-Replayed: true` on replays.

### 3.4 `AuditInterceptor`

- `@Audited({ entity: 'Order', action: 'status_change', idFrom: 'params.id', diff: true })`.
- Writes `AuditLog{ workspaceId, actorType(user|api_key|admin|system|courier|ai), actorId, action, entity, entityId, diff(before/after of whitelisted fields), ip, userAgent, reason(body.reason) }` after a 2xx, via outbox (non-blocking).
- Sensitive actions that MUST be audited: every `/admin/*` mutation (with `reason`), member role changes, invitations, workspace deletion, API key create/revoke, webhook create/update, courier account changes, AI provider keys, plan/subscription changes, credit grants, order delete, fee override, client merge, block/unblock, impersonation start/stop, force-release channel, 2FA disable, password/e-mail change.
- Retention 2 years (07-non-functional §6).

### 3.5 `VersionInterceptor`

For `PATCH` on Order, Product, Agent, Conversation, Workspace settings: body `version` required; service does `updateMany({ where:{ id, workspaceId, version }, data:{ ..., version:{ increment:1 } } })`; count 0 ⇒ 409 `CONFLICT { changedBy, changedAt }` (looked up from `updatedAt`/last audit row for the dialog "Modifié par Nadia F. il y a 20 s").

---

## 4. Persistence & tenancy isolation

### 4.1 Rules
- Every business table has `workspaceId NOT NULL` (05). Repositories receive `workspaceId` from `TenantContext`, never from the body.
- Cross-workspace reads return 404 (02 §1): repositories use `findFirst({ where:{ id, workspaceId } })` and throw `NOT_FOUND`.

### 4.2 Prisma tenant extension (decided; code in `09-code-conventions.md` §2.3)
`packages/db/src/client.ts` exports `prisma.$extends(tenantExtension)` where the extension reads `TenantContext.workspaceId` and, for models tagged tenant-scoped (list generated from the schema: every model with `workspaceId`), injects `where.workspaceId` into `findMany/findFirst/update*/delete*/count/aggregate` and `data.workspaceId` into `create/createMany`. Worker processors set the context explicitly per job (`TenantContext.run({ workspaceId }, () => …)`). A test (`AT-AUTH-11` harness) iterates every controller route with an id from another workspace and asserts 404.

### 4.3 Numbering
`CounterService.next('order' | 'sale' | 'purchase')` inside the caller's transaction: `UPDATE "Counter" SET value = value + 1 WHERE workspaceId=$1 AND key=$2 RETURNING value` (row lock). Formats `CMD-${value}`, `VNT-…`, `ACH-…`; seeded after migration at `max(legacy)+1` (04 §10).

### 4.4 Effects services
`OrderEffects`, `SaleEffects`, `PurchaseEffects` (04 §3) are the only writers of `StockMovement`, automatic `CashTransaction`, client aggregates. They run inside the caller's `$transaction` and enqueue outbox rows (notification, WS, Sheets, webhook) committed atomically with the data.

---

## 5. Cross-cutting concerns

| Concern | Implementation |
|---|---|
| Config | `zod` schema in `core/config/config.schema.ts`; fails fast on boot; secrets never logged. Keys: `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY` (EdDSA), `ENCRYPTION_KEYS` (`v1:base64,v2:…`), `S3_*`, `META_APP_ID/SECRET/VERIFY_TOKEN`, `PAYMENT_PROVIDER=chargily` (the only accepted value), `CHARGILY_API_KEY`, `CHARGILY_SECRET`, `CHARGILY_MODE=test|live`, `PAYMENT_ALLOW_LIVE` (dev/test guard), `IAP_DRIVER`, `IAP_ALLOW_LIVE` (dev/test guard), `GOOGLE_PLAY_SERVICE_ACCOUNT`, `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_PUBSUB_TOKEN`, `APP_STORE_SHARED_SECRET`, `APPLE_IAP_KEY_ID/ISSUER_ID/PRIVATE_KEY/BUNDLE_ID/ENV`, `APPLE_ROOT_CA_SHA256` (05-integrations §5), `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `FCM_SERVICE_ACCOUNT`, `AI_*` (platform keys live in DB `AiProvider`, env only for bootstrap), `WEB_ORIGINS` (strict allowlist), `PUBLIC_API_URL`, `PUBLIC_WEB_URL`. |
| Logging | Pino JSON; fields `reqId, workspaceId, userId, route, latencyMs`; PII redaction paths (`*.phone`, `*.email`, `*.text`, `*.accessToken`, `*.credentials`); log level per env. |
| Metrics | prom-client: `http_request_duration_seconds{route,status}`, `queue_jobs{queue,state}`, `queue_job_duration_seconds{queue}`, `ai_run_latency_seconds{provider,model,kind}`, `ai_run_errors_total{provider}`, `meta_webhook_ack_seconds`, `meta_send_failures_total{code}`, `courier_requests_total{provider,outcome}`, `credits_debited_total{action}`; scraped by Prometheus → Grafana (ADM-14 "Ouvrir le monitoring"). |
| Feature flags | `FeatureFlagService.isEnabled(key, { workspaceId, platform })` backed by the `FeatureFlag` model (per-platform percentage, plan list) and `FeatureFlagOverride` (explicit workspace list) (ADM-13), cached 30 s; deterministic bucketing `murmur(workspaceId+key) % 100 < pct`. Known flags: `instagram_dm`, `voice_notes`, `image_recognition_v2`, `yalidine_courier`, `google_sheets_two_way`, `new_onboarding`, `online_payment`, `auto_send_courier`, `embeddings_retrieval`. |
| Rate limiting | `@nestjs/throttler` with Redis storage; named throttlers: `auth-login` 5/15 min per IP+email, `auth-forgot` 3/h per email, `auth-2fa` 5/15 min per mfaToken, `user` 1200/min, `api-key` 600/min, `playground` 60/h per workspace, `analysis` 3/day per workspace (channel analysis, agent generation, extraction), `tracking-sync-manual` 1/5 min per shipment, `invite-resend` 1/60 s, `verify-resend` 1/60 s, `reco-generate` 1/10 min. Response 429 with `Retry-After` and `params.retryAfter`. |
| Errors | `AppException(code, params?, fields?, status?)`; status from the code table; message localized via `Accept-Language` at the filter; `meta.warnings` collected in a request-scoped `WarningsBag`. Unknown exceptions ⇒ 500 `INTERNAL` with `ref` (short id logged + sent to Sentry; shown as "réf. 7c1e"). |
| i18n | `Accept-Language`/`?lang` → `req.locale ∈ fr|ar|en` (error messages; fr when none) and `TenantInfo.requestLocale` (unset when no supported language is named). Screen texts rendered by services use `viewerLocale()` = `requestLocale` ?? `userLocale` (account) ?? `locale` (workspace) — never `TenantContext.get().locale` alone, which is the shop's language; worker jobs restore the requester's page language from `Job.payload.viewerLocale`. Customer documents / messages: shop or customer language (customer's last language for messages); e-mails / notifications: recipient's (specs 07 §4 « Language source »). |
| Time | All "today/period" computations use `Africa/Algiers` (`date-fns-tz`), stored UTC; date-only `to` ⇒ end of day (04 §8). |
| Uploads | `POST /uploads` multipart → type/size check (`UPLOAD_TOO_LARGE`, `UPLOAD_TYPE_INVALID`) → images re-encoded by `sharp` (strip EXIF, max 2048 px, webp + jpeg) → S3 key `ws/<id>/<kind>/<uuid>.<ext>` → public https URL; audio/pdf stored as-is. `IMAGE_SMALL` warning < 600 px. |
| Crypto | `KeyRing` with versioned AES-256-GCM keys; ciphertext prefix `v<n>:`; rotation job re-encrypts rows lazily (`EncryptedField` helper). SHA-256 for API keys/tokens; argon2id for passwords. |
| Health | `GET /health` (liveness), `GET /health/ready` (Postgres, Redis, S3 head), worker heartbeat key `worker:<host>:ts` shown on ADM-14. |
| OpenAPI | `@nestjs/swagger` from zod DTOs (`nestjs-zod`) at `/api/docs`; CI exports `openapi.json` + Postman collection; mobile Dart client generated from it. |

---

## 6. Module internals (key providers)

### `auth`
`AuthService` (register/login/refresh/logout, families), `TwoFactorService` (otplib, recovery codes), `EmailTokenService` (verify/reset/change), `SessionService` (`RefreshToken` listing/revoke), `DeviceService`. Guards: `JwtAuthGuard`, `ApiKeyGuard`, `MfaTokenGuard`. Rate limits per 3.5.

### `workspace`
`WorkspaceService`, `MembershipService` (D30 invariants: `OWNER_IMMUTABLE`, one owner partial unique), `OwnershipTransferService` (`POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }`: target must be an Admin member ⇒ `OWNERSHIP_TRANSFER_TARGET_INVALID`, password checked ⇒ `AUTH_INVALID_CREDENTIALS`, `totpCode` required when 2FA on ⇒ `TWO_FA_CONFIRMATION_REQUIRED`; old owner → `admin`, new → `owner`, `User.ownedWorkspaceId` moved, audit `workspace.transfer_ownership`, e-mail + `member.role_changed` to both), `InvitationService` (7-day token, resend cooldown, `GET /invitations/:token`), `QuickReplyService` (+ `PATCH /workspace/quick-replies/order { ids[] }`), `SystemMessagesService` (4 keys `handoff|out_of_hours|out_of_stock|welcome` × `fr|ar|en` in `Workspace.systemMessages`, seeded at creation, defaults and placeholders `{shop}`/`{product}` from 11 §9, reset-to-default), `LegalService` (`GET /legal/pending`, `POST /legal/accept { key, version }` → `LegalAcceptance`; `LEGAL_REACCEPT_REQUIRED` guard after a major publish), `OnboardingService`, `WorkspaceDeletionService` (soft delete → `Workspace.status='deletion_scheduled'` → `sched-workspace-purge`; `POST /workspace/deletion/cancel`).

### `billing`
`PlanService`, `SubscriptionService` (one current per workspace, upgrade/downgrade/cancel, expiry job), `CheckoutService` (→ `payments.gateway`), `InvoiceService` (+ PDF), `CreditService` (`reserve(runId, cost)`, `settle(runId)`, `release(runId)`, `balance(workspaceId)` = plan period credits − debits + pack credits; ledger append-only), `CreditPackService` (`GET /credit-packs`, `POST /credits/packs/checkout { packId }` → Chargily checkout, `GET /credits/packs/purchases`), `PromoCodeService`, `IapService` (`POST /credits/packs/iap/validate` idempotent on `transactionId`, store server notifications `POST /webhooks/store/{google-play|app-store}`, refund ⇒ `CreditLedger action=store_refund` + `credits.negative`), `LimitService.assert(resource)` used inside creating transactions (`PLAN_LIMIT {resource, limit, current}`) and `LimitService.applyFreeLimits/restore` (02 §5 single rule), `DunningService` (R-J: J−7 `subscription.expiring` + `dunningStage=d_minus_7`; J0 invoice `unpaid`, `Subscription.status=dunning`, `dunningStage=d0`, Chargily payment link `POST /billing/invoices/:id/pay` sent by e-mail + `invoice.unpaid`; J+3 `d_plus_3` + `invoice.unpaid`; J+7 `status=expired`, `dunningStage=expired` ⇒ free plan + `subscription.expired`; payment at any stage ⇒ `active`; never touches `Workspace.status`), `ManualPaymentService` (`POST /admin/invoices/:id/mark-paid`: amount = remaining ⇒ `paid` + reactivation; < remaining ⇒ `200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`; > remaining ⇒ `422 VALIDATION_ERROR`).

### `channels`
`MetaOAuthService` (signed state = HMAC(workspaceId, nonce, exp 10 min)), `ChannelService`, `ConnectReportBuilder`, `MetaGraphClient` (versioned Graph API wrapper with error mapping: 190 ⇒ `needs_reconnect`, 4/613/32 ⇒ rate limit, 10/2018278 ⇒ outside window, 551 ⇒ user unavailable), `ChannelInsightsService`, `HistorySyncProcessor`, `PageAnalysisProcessor`, `TokenRefreshScheduler`, `AppReviewStatusService` (reads `PlatformSetting.metaPermissions`).

### `messaging`
`MetaWebhookController` (raw body, signature, `InboundEvent` insert, enqueue `meta-inbound`), `InboundProcessor` (parse → dedup → conversation/client → message → attachments to `media` queue → eligibility → schedule `ai-reply` with window), `ConversationService`, `MessageService`, `OutboundSendService` (24 h rules, tags, `Message.deliveryStatus`, outbox key `runId`/`messageId`), `WindowRules` (`canSend(channel, conversation, kind: ai|human|transactional)`), `BatchingService` (Redis key `batch:<conversationId>` → delayed job id; abuse counters `abuse:<conv>:1m`, `:10m`), `CustomerBlockService`, `ReportService` (merchant side), `RetentionPurgeScheduler`, `DataDeletionService` (Meta signed_request).

### `ai`
See `04-ai-pipeline.md`. Providers: `ProviderRegistry` (Vercel AI SDK model factories per `AiProvider`), `RoutingService` (capability → primary/fallback from `AiRoute`), `PromptBuilder`, `ToolRegistry` (zod + JSON Schema), `AiRunService` (idempotent runs, tool replay), `ReplyProcessor` (`ai-reply` queue), `VisionService` (2-pass), `TranscriptionService` (Groq → OpenAI), `CaptionService`, `PlaygroundService` (dry-run tools), `InsightService` (creation side), `BlockedWordsService`, `StructuredOutputParser`.

### `agents`
`AgentService` (wizard steps as partial updates on a draft, `status: draft|active|paused`), `AgentVersionService` (snapshot on activate/save, restore), `PresetService`, `AgentChannelService` (move dialog ⇒ `AGENT_PAGE_ALREADY_ASSIGNED`, explicit `move:true`), `AgentInsightService` (resolve/dismiss/add-to-instructions/create-FAQ), `AgentGenerationProcessor`, `AgentMetricsService`, `FaqService` (`AgentFaq` entries ≤ 50, ≤ 20 000 chars — Figma AGT-02 step 2).

### `catalog`
`ProductService` (shared create/update validation; SKU uniqueness = partial unique index `(workspaceId, sku) WHERE deletedAt IS NULL` on `Product` and on `ProductVariant` (raw SQL migration) + cross-table check in the same transaction; Prisma `P2002` ⇒ `409 PRODUCT_SKU_ALREADY_EXISTS` — no registry table), `ProductImageService` (+ `media` jobs for re-encode & caption; ≤ 10 images, 5 MB, min 600 px), `VariantService` (+ generator, `VARIANT_LIMIT`), `CategoryService` (`parentId`, 2 levels max ⇒ `CATEGORY_DEPTH_EXCEEDED`, reassign on delete, "move sub-categories to root"), `UnitService`, `StockService` (`POST /stock/adjustments` → movement `adjustment_in|adjustment_out`; `POST /stock/movements/:id/reverse`; `GET /stock/snapshot?date`; conditional decrement helpers used by effects ⇒ `STOCK_INSUFFICIENT`), `LowStockEvaluator`, `ImportService` (parse → preview `Job` → mapping → commit tx), `ExportProcessor`, `AiFillService` (`POST /products/ai-fill`), `ModerationHookService` (D36: creates/updates `ModerationItem` on moderated-field change; `Product.moderationStatus ∈ not_required|pending|approved|rejected|appealed` (`ModerationStatusProduct`); `POST /products/:id/resubmit` ⇒ `MODERATION_NOT_REJECTED` when not rejected; `POST /products/:id/appeal` once ⇒ `MODERATION_APPEAL_ALREADY_USED` / `MODERATION_APPEAL_WINDOW_EXPIRED`; AI grounding excludes `pending|rejected|appealed`), `ProductDuplicateService`, `BulkPriceService`.

### `clients`
`ClientService`, `PhoneNormalizer` (shared), `ClientMergeService` (CLI-02 rule, `CUSTOMER_MERGE_IRREVERSIBLE` confirm), `ClientAggregates.recompute(clientId)`, `RiskService` (nightly + on cancel), `ClientExportProcessor`.

### `orders`
`OrderService` (create manual/AI/API/mobile/import with `source`), `OrderStateMachine` (04 §1.2 matrix as data; `allowedTransitions(order, role)` feeds the row menu; Operator may run every transition except `delivered → returned`), `OrderEffects`, `OrderCallService` (04 §1.3, `CallResult` enum), `OrderPaymentService` (04 §1.4), `OrderCallbackService` (Figma "Programmer un rappel": `POST /orders/:id/callback { at, note?, notifyCustomer? }` sets `Order.callbackAt` + `confirmationStatus='callback'` and sends `customer.reminderScheduled` when the body has `notifyCustomer=true`; `DELETE /orders/:id/callback` clears it; the due notification `order.callback_due` is emitted by `sched-order-reminders`, `03-events-and-jobs.md` §4), `OrderAssignService`, `OrderAddressService` (`POST /orders/:id/address`, `COURIER_ADDRESS_LOCKED` after send), `OrderPrintService` (A5, `POST /orders/bulk/print`), `OrderExportProcessor`, `OrderImportService` (`POST /orders/import` → preview job, `POST /orders/import/:jobId/commit`; columns `clientName, phone, wilaya, commune?, address, items ("SKU×qty;SKU×qty"), note?`; `Order(source=import, status=new, importJobId)`, client find-or-create by phone, stock checked per row), `BulkStatusService` (per-item results; bulk `delivered`/`returned` forbidden for every role ⇒ `ORDER_INVALID_TRANSITION`), `OrderNoteService`, `OrderHistoryService`.

### `delivery`
Two Nest modules in `modules/delivery/` (orders depend on the first, the second depends on orders): `DeliveryModule` = `GeoService` + `FeeService`; `ShippingModule` = everything else below (M6). `GeoService` (wilayas/communes, `CourierCommuneMap`), `FeeService` (grid, seed/fill/reset, quote with free-delivery rule; copy-from-courier lives in `RatesService`), `CourierAccountService` (per-provider credential schema, test, delete guard `COURIER_HAS_ACTIVE_SHIPMENTS`), `CourierAdapter` interface + `adapters/*` (`05-integrations.md` §2), `ShipmentService` (send single/bulk, `DELIVERY_ORDER_NOT_CONFIRMED`, `DELIVERY_ORDER_ALREADY_SENT`, cancel, retry), `CourierSendProcessor` (`courier` queue), `TrackingSyncScheduler` + `TrackingSyncProcessor` (cadence, batch `getStatuses`, mapping tables), `CourierWebhookController`, `LabelService` (adapter label → S3; fallback Djaber A6 label; merged PDF job), `DeliveryOverviewService`, `RatesService` (cache 1 h).

### `payments`
`PaymentGateway` interface (`createCheckout`, `verify`, `parseWebhook`, `refund`) with `ChargilyGateway` as its only implementation (`PAYMENT_PROVIDER=chargily`; CIB / Edahabia are Chargily payment methods); `OrderPaymentLinkService` (15 min, one active), `RefundService`, `PaymentWebhookController` (`POST /webhooks/chargily`: raw body, signature, idempotent on event id, amount check), `CheckoutReturnService` (`GET /billing/checkout/return?ref`).

### `gds`
`SupplierService`, `PurchaseService` + `PurchaseEffects` (over-receipt accepted: line `quantity` raised to `receivedQty`, `200 ⚠ PURCHASE_OVER_RECEIVE {ordered, received}`; weighted-average `costPrice` recomputed at every receipt, integer DA half-up), `SaleService` + `SaleEffects` (`SALE_INSUFFICIENT_STOCK`), `CashService` (manual rows, locks `CAISSE_EDIT_AUTOMATIC`, day close → `CashClosing(day, theoreticalBalance, countedBalance, difference, note, closedById, reopenedById)` via `POST /cash/close { day, countedBalance, note? }`, `POST /cash/days/:day/reopen` (Admin+, audited), `GET /cash/days`), `ProductExpenseService` + `MarginCalculator` (`Workspace.targetMarginPct`, default 35), `InventoryService` (`InventoryCount` sessions: `GET|POST /inventories`, `PUT /inventories/:id/lines`, `POST /inventories/:id/validate|cancel`, `GET /inventories/:id/sheet`), `ReportService` (`modules/gds/reports/`: metadata of the 23 reports in `@djaber/shared` `REPORT_DEFINITIONS`, one query per report in `definitions.ts`: `{ key, query(period, filters), columns, chart }`, range ≤ 732 d ⇒ `REPORT_RANGE_TOO_LONG`) + `ReportExportProcessor`, `ReportScheduleService` (`POST|DELETE /reports/:key/schedule { email, dayOfMonth }` → `ReportSchedule`; plan feature `scheduled_reports`; sent by `sched-report-schedules`).

### `notifications`
`NotificationProducer.emit(type, { workspaceId, userIds?|all, data })` → in-app row(s) + WS `notification.created` + fan-out jobs (email/push per `NotificationPreference`) + customer message when applicable (via `messaging.OutboundSendService`); `ThrottleRules` (`conversation.needs_human_message` 1/10 min/conversation; `stock.low`/`stock.out` 1/day/product; `credits.exhausted` 1/day/workspace; `product.approved` grouped 1/day/workspace; `ai.error` 1/10 min/workspace; `channel.needs_reconnect` 1/day/channel; `sheets.error` 1/h/connection — full list per type in `03-events-and-jobs.md` §5.1); `PushService` (FCM HTTP v1, token pruning, `DEVICE_LIMIT` 20 tokens/user); `DeepLinkMap` (03-events §5.1: English routes of `02-next-route-map.md`, mobile = `djaber://` + same path).

### `analytics`
`HomeService` (ANA-01 queue + KPIs), `AnalyticsService` (`GET /analytics/overview` + the 8 tab endpoints, `compare=previous` on every one; reads the `DailyStat` model for past days + live query for today), `DailyStatsScheduler` (`sched-daily-stats`: recomputes `DailyStat(workspaceId, day, metrics Json, computedAt)` `@@unique([workspaceId, day])` for yesterday, never incremented), `MoneyFigures` (04 §4 named figures, reused by reports).

### `sheets`
`GoogleOAuthService`, `SheetsConnectionService` (Picker token, URL parse, create sheet with header row + hidden `djaber_id`), `SheetsRowSyncProcessor` (debounced upsert), `SheetsBackfillProcessor`, `SheetsHealthService`.

### `integrations`
`ApiKeyService` (prefix `dj_live_`/`dj_test_`, shown once), `WebhookEndpointService` (HTTPS only, secret shown once, test ping, re-enable), `WebhookDispatchProcessor` (HMAC, retries, auto-disable, replay).

### `admin`
One controller per ADM frame; services mostly compose other modules' repositories in cross-workspace mode (`TenantContext.bypass()` guarded by `PlatformRoleGuard`): `AdminOverviewService`, `AdminWorkspaceService` (suspend `POST /admin/workspaces/:id/suspend { reason ∈ SuspendReason, note, notifyOwner }` ⇒ `Workspace.status='suspended'` + `workspace.suspended`; `POST …/reactivate` ⇒ `active` + `workspace.reactivated`; release channel, grant credits (support ≤ 1 000), create for client, extend trial, change plan, schedule / cancel deletion), `AdminUserService`, `AdminPlanService` (versions, archive, migrate), `AdminSubscriptionService` (dunning view, cancel, discount, resend dunning) + `ManualPaymentService` (billing), `AiAdminService` (providers/models/routes per capability/test/pricing simulate + versions), `PresetAdminService`, `CmsService` (entries, locales, versions, publish/schedule, `GET /admin/cms/:id/preview-link`, announcements), `AuditQueryService` (+ signed export `POST /admin/audit-logs/export`), `JobsHealthService` (`GET /admin/health`, `POST /admin/queues/:name/{pause|resume|drain-failed|replay-failed|run-now}`, `GET /admin/queues/:name/failed`, `GET /admin/queues/failed/:jobId`, `POST /admin/queues/failed/:jobId/replay`, incidents), `PlatformSettingsService` (`PUT /admin/settings/:key { value, reason }` versioned, app versions with 2FA re-check when `minVersion` rises ⇒ `app.update_required` push, feature flags, legal documents publish ⇒ `legal.reacceptance_required`, Meta permissions, providers test, maintenance), `ModerationService` (queue, decisions, appeals, rules, SLA) + `TrustLevelService` (R-L: `new → standard` automatic on approval and by `sched-trust-levels`; `any → watch` automatic at ≥ 3 counterfeit rejections / 90 d; `standard → trusted` and `watch → standard` manual by a moderator with reason, audited), `AbuseReportService` (reports, blacklist, blocked words platform list, auto rules, monthly compliance export), `SupportTicketService` (tickets, canned replies, SLA per plan, context snapshot), `PlatformMemberService` (`/admin/platform-members`, invitations, force-2FA, `POST /admin/users/:id/platform-role { platformRole, totpCode }`), `AccountDeletionService` (requests, grace, anonymise; `blockedReason ∈ ACCOUNT_OWNS_WORKSPACE|WORKSPACE_HAS_DEBT`), `ViewerService` (read-only conversations/products, PII masked, `POST /admin/conversations/:id/unmask` super_admin), `ImpersonationService` (read-only sessions: `GET|POST /admin/impersonation/sessions`, `DELETE /admin/impersonation/sessions/:id`; audit `impersonation.start|stop`).

### `jobs`
`JobService.create({ kind, name, payload })` (workspace and creator from `TenantContext`) → `Job` row + outbox row `job` → BullMQ job `job:<jobId>`; processors wrap their work in `JobService.run(jobId, fn)`; `progress(jobId, pct, message)` emits WS `job.updated`; `finish(result)` emits `job.finished`, `fail(error)` emits `job.failed`; `GET /jobs?kind&status`, `GET /jobs/:id`, `POST /jobs/:id/cancel` (Redis flag processors poll), `POST /jobs/:id/retry` (a new `Job` row with the same payload → `202 { data: { jobId } }` of the new job, 06 "Jobs & uploads").

---

## 7. Worker composition

`apps/worker` imports the same domain modules with `WORKER=true` so that only `processors/*` (classes extending `WorkerHost`) and schedulers (`@Cron`) are instantiated; controllers are excluded via a dynamic module option `forFeature({ processors: true, controllers: false })`. Queues, jobs, retries and schedules are in `03-events-and-jobs.md`. Concurrency per queue is configured in `core/queue/queues.ts` and overridable by env (`QUEUE_CONCURRENCY_ai_reply=8`).

---

## 8. Do / Don't

**Do**
- Put every route behind `AuthGuard → TenantGuard → PermissionGuard`; mark public routes with `@Public()` explicitly.
- Read `workspaceId` only from `TenantContext`; pass `tx` into effects services and the outbox.
- Use `AppException(code)` with `fields` for inline errors; map provider errors in the adapter.
- Keep controllers thin: validate (DTO), call one service method, return the result.
- Declare `@Idempotent({ required: true })` on the routes listed in 06 §1 and `@Audited` on the actions listed in §3.4.

**Don't**
- Don't compute aggregates incrementally — recompute (`ClientAggregates.recompute`, `Product.stock = Σ variants`).
- Don't touch stock or cash outside `OrderEffects` / `SaleEffects` / `PurchaseEffects`.
- Don't call Meta, couriers, payment, Google or AI providers synchronously in a webhook or request handler (exceptions in `03-events-and-jobs.md` §7).
- Don't import `@prisma/client` outside `packages/db` and `*.repository.ts`.
- Don't create a permission key that is not in §3.2 here (the single table; `02-actors-roles.md` §3, 06 §9, 07 §1.1 and the `02-next-route-map.md` permission column mirror it).
- Don't bypass the tenant extension with `ALLOW_NO_TENANT`; admin reads run `TenantContext.run` per target workspace.

## 9. Testing hooks in the module layer

- Every module exports a `TestingModuleFactory` with fake adapters (Meta Graph, couriers, payment gateway, Google, FCM, mail) for integration tests; recorded fixtures under `test/fixtures/<provider>/`.
- `TenantContext.run()` in tests; `AT-AUTH-11` route crawler reads Nest's route explorer to enumerate every `:id` route.
- Processors are tested by invoking `process(job)` directly with a `Job` stub; schedulers by calling the handler.
