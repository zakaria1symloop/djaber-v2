# 06 — API

One REST API serves the web app, the mobile app and API clients `[CDC §8]`.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base | `/api/v1` |
| Auth | `Authorization: Bearer <access JWT>` (users) or `X-API-Key: <key>` (API clients). Refresh `POST /auth/refresh` (cookie on web, body on mobile). |
| Tenant | `X-Workspace-Id` (users; default owned workspace, else last used, else `400 WORKSPACE_REQUIRED`). API keys bound to one workspace. |
| Language | `Accept-Language: fr|ar|en` (or `?lang=`) → error messages, localized fields, exports. |
| Format | JSON, camelCase, ISO-8601 UTC, integer DZD. |
| Success envelope | Single resource `{ data: T, meta?: { warnings?: Warning[] } }`. Every success response is wrapped this way; shorthand shapes written after `→` in §2–§12 (e.g. `→ { url }`) are the content of `data`. |
| Pagination | Offset lists `?page&pageSize` (25/50/100, default 25) → `{ data: T[], meta: { page, pageSize, total, warnings? } }`; cursor lists (messages, notifications, inbox) `?cursor` → `{ data: T[], meta: { nextCursor, hasMore } }`. |
| Filtering / sort | `?status=a,b&from&to&q&sort=-createdAt`. |
| Idempotency | `Idempotency-Key` **required** (`400 IDEMPOTENCY_KEY_MISSING`) on `POST /orders`, `/sales`, `/purchases`, `/orders/:id/shipments`, `/shipments/bulk`, `/conversations/:id/messages`, `/billing/checkout`, `/credits/packs/checkout`, `/products/import/:jobId/commit`, `/orders/import/:jobId/commit`; optional on other POSTs. Clients generate a UUID v4 per submit attempt and reuse it on retry. Stored 24 h; same key + different body ⇒ `422 IDEMPOTENCY_MISMATCH`; replay returns the stored response. |
| Warnings | Success envelope may carry `meta.warnings[{code, params, field?}]` (e.g. `SELLING_BELOW_COST`); UI shows them as non-blocking inline hints (11 §11). |
| Concurrency | `PATCH` bodies carry `version`; stale ⇒ `409 CONFLICT` (`details: { changedBy, changedAt, current }`). |
| Bulk | `POST …/bulk` always `200 { data: { results: BulkResult[] }, meta: { ok, failed } }` with `BulkResult = { id, ok, error?, data? }`, never all-or-nothing. |
| Errors | `{ error: { code, message, params, fields, details, ref } }` — `code` from [11](11-error-catalogue.md); `message` localized; `params` interpolation values; `fields` = `{ field: validationKey }`; `details` = provider message or per-item list; `ref` = request id echoed in `X-Request-Id` (shown in support tickets `[FIG HELP]`). `params`, `fields`, `details` are optional; `ref` is always present. Full contract in `../implementation/api-contract.md` §1.5. |
| Saved views | Any list page accepts `?view=<savedViewId>`; the server expands the stored filters and the explicit query params override them (05 §16, D42). |
| Status codes | 400 malformed / `WORKSPACE_REQUIRED` · 401 unauthenticated · 402 `INSUFFICIENT_CREDITS` · 403 `FORBIDDEN` / `PLAN_LIMIT` / `WORKSPACE_SUSPENDED` · 404 not found / other workspace · 409 conflict / `WORKSPACE_DELETION_SCHEDULED` · 410 expired token · 413/415 uploads · 422 validation / business rule · 426 `APP_UPDATE_REQUIRED` · 429 `RATE_LIMITED` · 500 `INTERNAL` · 503 provider down / `MAINTENANCE_MODE`. |
| Rate limits | auth per 02 AUTH-08; users 1200/min; API keys 600/min; playground 60/h; page analysis / FAQ extraction / agent generation 3 per day per workspace (`ANALYSIS_RATE_LIMITED`). |
| Uploads | `POST /uploads` multipart: image ≤ 5 MB (jpg, png, webp, gif; min 600 px on the short side, else warning `IMAGE_SMALL`; 10 images per product, `IMAGES_LIMIT`) / pdf ≤ 10 MB / audio ≤ 25 MB; returns `{ id, url }` (public https for Meta sends). |
| Jobs | long operations return `202 { data: { jobId } }`; `GET /jobs/:id` → `{ id, kind, status, progress, result, error? }` (`JobKind`, `JobStatus`); WS `job.updated`. |
| Docs | OpenAPI 3 at `/api/docs` (`@nestjs/swagger`); Postman export in CI. |

## 2. Endpoints

(P2)/(P3) mark later phases. Permissions: `../implementation/01-nest-module-map.md` §3.2 is the single permission table; §9 below summarises it per endpoint group.

### Auth & account
```
POST /auth/register · POST /auth/login → tokens, or `{ mfaToken }` when 2FA is on · POST /auth/refresh (reuse of a rotated token ⇒ 401 AUTH_REFRESH_REUSED, whole family revoked) · POST /auth/logout?all
POST /auth/forgot-password · GET /auth/reset-password/:token · POST /auth/reset-password
POST /auth/verify-email · POST /auth/verify-email/resend
POST /auth/2fa/setup · POST /auth/2fa/enable · POST /auth/2fa/disable (password; users with a platform role ⇒ 403 TWO_FA_REQUIRED_FOR_ROLE) · POST /auth/2fa/verify { mfaToken, code | recoveryCode } · POST /auth/2fa/recovery-codes (password)
GET /me · PATCH /me · PATCH /me/password · POST /me/email-change · account deletion: POST /me/deletion-request (§8.1)
GET /me/sessions · DELETE /me/sessions/:id
POST /me/devices · DELETE /me/devices/:token (§11)
```

### Workspace & team
```
GET /workspaces (memberships, §11) · POST /workspaces (only when `ownedWorkspaceId` is null, D30) · GET /workspace · PATCH /workspace · DELETE /workspace (schedules deletion, §8.1)
PATCH /workspace/onboarding { step }
GET /workspace/members · PATCH /workspace/members/:id · DELETE /workspace/members/:id
POST /workspace/invitations · POST /workspace/invitations/:id/resend (60 s cooldown) · DELETE /workspace/invitations/:id · GET /invitations/:token (§8.1) · POST /invitations/:token/accept
GET|POST /workspace/quick-replies · PATCH|DELETE /workspace/quick-replies/:id · PATCH /workspace/quick-replies/order { ids[] } (§8.1)
GET|PUT /workspace/system-messages { handoff, out_of_hours, out_of_stock, welcome } × { fr, ar, en } (11 §9)
```

### Channels
```
GET /channels · GET /channels/:id · PATCH /channels/:id { status: active|paused, swapWithChannelId? } · DELETE /channels/:id
GET /channels/connect/facebook → url · GET /channels/callback/facebook · GET /channels/connect/reports/:id → ConnectReport (kept 10 min, same-tab return and pop-up hand-off)
# callback path = META_OAUTH_CALLBACK_PATH (default /api/v1/channels/callback/{platform}); with META_LEGACY_PATHS the V1 path /api/pages/callback/{facebook|instagram} reaches it (§3)
# Facebook scopes = META_FACEBOOK_SCOPES when set, else the full list (05-integrations §1.5)
GET /channels/connect/instagram → url · GET /channels/callback/instagram
POST /channels/:id/reconnect → url
GET /channels/:id/insights · GET /channels/:id/summary · GET /channels/:id/messages?direction&from&to
POST /channels/:id/sync → 202 · POST /channels/:id/analysis → 202 · GET /channels/:id/analysis
POST /channels/:id/analysis/import { items[] }
GET /channels/app-review-status
```

### Conversations
```
GET /conversations?channelId&status&q&assigneeId&unread · GET /conversations/counts?channelId → { all, active, needs_human, resolved, archived, unread }
GET /conversations/:id · PATCH /conversations/:id { status, aiPaused, assigneeId, version } · DELETE /conversations/:id
# list rows carry pageHasAgent; actions.pauseAi / resumeAi disabled with CONVERSATION_NO_AGENT when the page has no agent and none answered the conversation
GET /conversations/:id/messages?cursor · POST /conversations/:id/messages { text, uploadId? } | { templateKey } (§8.8)
POST /conversations/:id/read
GET|POST /conversations/:id/notes
```

### Agents & AI
```
GET|POST /agents · GET|PATCH|DELETE /agents/:id · POST /agents/:id/pause · POST /agents/:id/resume
POST /agents/:id/test { messages[] } → { reply, model, toolCalls[], cards[] } (full shape §8.7)
GET /agents/:id/metrics?from&to · GET /agents/presets
POST /agents/generate { channelId } → 202 · POST /agents/generate/:jobId/apply { agentId? }
GET /agent-insights?agentId&status&type · POST /agent-insights/:id/resolve (§8.7)
GET /ai/models
```

### Catalogue (GDS)
```
GET /products?q&categoryIds&type&lowStock&active&minPrice&maxPrice&minCost&maxCost&minQty&maxQty&minMargin&maxMargin&sort
POST /products · GET|PATCH|DELETE /products/:id · POST /products/:id/restore · GET /products/search?q (AI)
POST /products/import → 202 preview · POST /products/import/:jobId/commit → 202 · GET /products/export?…filters → 202
POST /products/ai-fill (multipart, §8.6)
POST /products/:id/images · PATCH /products/:id/images/order · PATCH|DELETE /products/:id/images/:imgId
GET|POST /products/:id/variants · PATCH|DELETE /products/:id/variants/:vid
POST /stock/adjustments (§8.6) — the only stock-adjustment endpoint
GET|POST /products/:id/expenses · PATCH|DELETE /products/:id/expenses/:eid · GET /products/:id/margins
GET /products/low-stock
GET|POST /categories { name, parentId? } (2 levels max, CATEGORY_DEPTH_EXCEEDED) · PATCH|DELETE /categories/:id?reassignTo (deleting a parent: `moveChildrenToRoot=true` moves its sub-categories to root)
GET|POST /units · PATCH|DELETE /units/:id?reassignTo
GET /stock/overview · GET /stock/movements?productId&variantId&type&from&to · GET /stock/snapshot?date (§8.6)
```

### Clients
```
GET /clients?q&source&tags&from&to&minOrders&maxOrders&minSpent&maxSpent · POST /clients
GET|PATCH|DELETE /clients/:id · GET /clients/:id/orders · GET /clients/:id/metrics · GET /clients/export → 202
```

### Orders
```
GET /orders?…  (full query-param list in §10 — status, confirmation, payment, delivery, source, channelId, agentId, assigneeId, wilaya, amount, date, productId, risk, sort, view)
GET /orders/stats?…same filters · POST /orders · GET|PATCH|DELETE /orders/:id
POST /orders/:id/status { to, reason?, note?, effectiveAt?, amountCollected?, restoreStock?, returnFee?, version } · POST /orders/bulk/status { ids[], to, reason? } (`to` ∈ confirmed|preparing|shipped|cancelled; `delivered` and `returned` are never bulk)
GET|POST /orders/:id/calls { result: CallResult, callbackAt?, notes } · GET|POST /orders/:id/notes · GET /orders/:id/history
POST /orders/:id/payments { amount, method, reference?, note? } (PaymentEntry; ORDER_PAYMENT_LOCKED on terminal) · GET /orders/:id/payments
POST /orders/:id/callback { at, note?, notifyCustomer? } · DELETE /orders/:id/callback   `[FIG DLG Programmer un rappel]`
POST /orders/:id/assign { assigneeId|null, notify? } · POST /orders/bulk/assign { ids[], assigneeId|null }   `[FIG DLG Assigner]`
POST /orders/:id/address { wilayaId, communeId|communeText, isStopdesk, stopdeskId?, address?, phone2? } (COURIER_ADDRESS_LOCKED once sent)   `[FIG DLG Modifier l'adresse]`
POST /orders/:id/duplicate → new draft payload (no write) · POST /orders/bulk/print { ids[], withPrices?, twoPerPage?, lang? } → 202
POST /orders/import (multipart CSV; columns clientName, phone, wilaya, commune?, address, items "SKU×qty;SKU×qty", note?) → 202 preview with per-row errors · POST /orders/import/:jobId/commit → 202 (idempotent; rows create Order(source=import, status=new, importJobId), client find-or-create by phone, stock checked per row)   `[FIG ORD-05 v2 "Importer"]`
GET /orders/:id/print (PDF slip) · GET /orders/export?…filters&format=xlsx|pdf → 202
POST /orders/:id/payment-link (P2, link valid 15 min) · POST /orders/:id/refunds (P2) · GET /payments (P2, CDC §8.1)
```

### Delivery
```
GET /geo/wilayas (69 rows, Cache-Control max-age=86400) · GET /geo/wilayas/:id/communes
GET /delivery/fees · PUT /delivery/fees/:wilayaId { homePrice, stopdeskPrice, returnPrice?, freeAbove?, isActive? } · DELETE /delivery/fees/:wilayaId (back to the default grid; FEE_RULE_NOT_FOUND when no custom row) · POST /delivery/fees/seed { overwrite } · GET /delivery/fees/quote?wilayaId&stopdesk&subtotal
GET /delivery/couriers/providers (P2) · GET|POST /delivery/couriers · PATCH|DELETE /delivery/couriers/:id · POST /delivery/couriers/:id/test (P2)
POST /orders/:id/shipments { courierAccountId?, wilayaId, communeId|communeText, address, isStopdesk, stopdeskId? (required when isStopdesk and the provider has stop-desks), weight? } (P2)
POST /shipments/bulk { orderIds[], courierAccountId? } → 202 (P2)
GET /orders/:id/shipments · GET /shipments/:id · POST /shipments/:id/sync · POST /shipments/:id/cancel · POST /shipments/:id/retry (P2)
GET /shipments/:id/label · POST /shipments/labels { ids[] } → merged PDF (P2)
GET /delivery/overview → { kpis, failures[], stale[] } (the only delivery-overview endpoint) · GET /delivery/rates?courierAccountId&wilayaId&stopdesk · POST /delivery/fees/copy-from-courier (P2)
```

### Recommendations (P2)
```
GET|POST /recommendations · PATCH|DELETE /recommendations/:id · POST /recommendations/generate → 202 · GET /recommendations/stats
```

### GDS operations (P2)
```
GET|POST /suppliers · GET|PATCH|DELETE /suppliers/:id
GET|POST /purchases · GET|PATCH|DELETE /purchases/:id · POST /purchases/:id/receive { items[{id, receivedQty}] } (over-receipt accepted: line quantity raised to receivedQty, `200 ⚠ PURCHASE_OVER_RECEIVE {ordered, received}`; cost price = weighted average, integer DA half-up) · POST /purchases/:id/cancel · GET /purchases/stats
GET|POST /sales · GET|PATCH|DELETE /sales/:id · GET /sales/stats   (PATCH on a draft accepts client { name, phone } — found by phone or created — instead of clientId; both ⇒ 422)
GET|POST /cash · PATCH|DELETE /cash/:id · GET /cash/stats   (rows = CashTransaction)
GET /reports · GET /reports/:key?from&to&format=json|xlsx|pdf (→ 202 when > 5 000 rows; range ≤ 732 days, REPORT_RANGE_TOO_LONG) · POST|DELETE /reports/:key/schedule (§8.6)
```

### Notifications, home, analytics
```
GET /notifications?type&types&group&unread&from&to&cursor · GET /notifications/unread-count → { count } · POST /notifications/:id/read · POST /notifications/read-all
GET|PUT /notification-preferences
GET /dashboard/home
GET /analytics/overview?from&to|period&compare=previous → { kpis: { [key]: { value, previous?, deltaPct? } }, series[] }   `[FIG ANA-02 overview]`
GET /analytics/{conversations|responses|consumption|agents|channels|products|orders|delivery}?period|from&to&channelId&compare=previous (P2) — "overview + 8 tabs"; `compare=previous` is accepted on every tab and adds `previous` / `deltaPct` to each KPI (previous = same length ending at `from`); range ≤ 732 days (REPORT_RANGE_TOO_LONG)
```

### Billing & credits
```
GET /plans (public) · GET /billing/subscription · POST /billing/checkout { planId, cycle, promoCode? } (Owner; Chargily checkout, idempotent on `providerCheckoutId`; amount must equal plan price × cycle) · GET /billing/checkout/return?ref (§8.9, the only checkout-result endpoint) · POST /billing/cancel · GET /billing/payments
GET /credits · GET /credits/ledger?from&to&action
```

### Integrations (P2)
```
GET|POST /api-keys · DELETE /api-keys/:id
GET|POST /webhooks · PATCH|DELETE /webhooks/:id · GET /webhooks/:id/deliveries · POST /webhooks/deliveries/:id/replay
GET /integrations/google-sheets · GET /integrations/google-sheets/connect → url · GET /integrations/google-sheets/callback
PUT /integrations/google-sheets { spreadsheetId|createNew, sheetName, filters } · POST /integrations/google-sheets/backfill { from, to } → 202 · DELETE /integrations/google-sheets
```

### Jobs & uploads
```
GET /jobs?kind&status&page → my workspace's jobs (JobKind, JobStatus; default sort createdAt desc)   `[FIG ANA-04 Exports, DLG Tâches]`
GET /jobs/:id → { id, kind, status, progress, result, error?, createdAt, finishedAt? }
POST /jobs/:id/cancel (status ∈ queued|running, else 409 JOB_NOT_CANCELLABLE) · POST /jobs/:id/retry (status ∈ failed|partial, else 409 JOB_NOT_CANCELLABLE; re-enqueues with the same payload → 202 { data: { jobId } } of the new job)
POST /uploads
```

### Platform admin (P2, platform roles — matrix in §9)
```
GET /admin/analytics?period · GET /admin/alerts
GET /admin/workspaces?… (§10) · POST /admin/workspaces { name, ownerEmail, trialMonths?, initialCredits?, sendInvite?, assistedOnboarding? } `[FIG DLG Créer un espace]`
GET|PATCH /admin/workspaces/:id · GET /admin/workspaces/:id/{members|subscription|credits|channels|agents|audit}
POST /admin/workspaces/:id/suspend { reason: SuspendReason, note, notifyOwner } · POST /admin/workspaces/:id/reactivate { reason }
POST /admin/workspaces/:id/plan { planId, cycle, when: now|next_period, reason } · POST /admin/workspaces/:id/credits { credits, reason } (CreditLedger action=grant, kind=credit, bucket=plan; support ≤ 1 000 ⇒ ADMIN_CREDIT_GRANT_LIMIT above; finance and super_admin unlimited)
POST /admin/workspaces/:id/extend { days: 7|30 | until, reason } (trial extension) · POST /admin/workspaces/:id/schedule-deletion { reason } · DELETE /admin/workspaces/:id/schedule-deletion
POST /admin/workspaces/:id/trust-level { trustLevel: TrustLevel, reason } (manual changes: standard→trusted, watch→standard; audited)
POST /admin/channels/:id/release { reason, proofTicketId? }
GET /admin/users?… · GET|PATCH /admin/users/:id · DELETE /admin/users/:id → schedules deletion (ACCOUNT_OWNS_WORKSPACE)
POST /admin/users/:id/{resend-verification|reset-password|disable-2fa|revoke-sessions|block|unblock} { reason } · POST /admin/users/:id/platform-role { platformRole, totpCode } (super_admin, ADMIN_CANNOT_DEMOTE_SELF, TWO_FA_REQUIRED_FOR_ROLE)
GET|POST /admin/plans · GET|PATCH /admin/plans/:id (⇒ new PlanVersion, impact preview) · GET /admin/plans/:id/versions · POST /admin/plans/:id/archive · POST /admin/plans/:id/migrate { toPlanId, when } · DELETE /admin/plans/:id (PLAN_IN_USE)
GET /admin/subscriptions?… · POST /admin/subscriptions { workspaceId, planId, cycle, startsAt, appliedPrice?, provider, reason } · PATCH /admin/subscriptions/:id · POST /admin/subscriptions/:id/{cancel|cancel-now|discount|resend-dunning}
GET /admin/invoices?… · POST /admin/invoices/:id/mark-paid { method: manual_transfer|manual_ccp|manual_cash, amount, reference, paidAt, proofUploadId } → 200 (amount = remaining ⇒ invoice `paid` + immediate reactivation; amount < remaining ⇒ invoice stays `unpaid`, `meta.warnings` INVOICE_PARTIAL_PAYMENT {remaining}; amount > remaining ⇒ 422 VALIDATION_ERROR `fields.amount = validation.range`, max = remaining) · GET /admin/invoices/export?from&to → 202
GET|POST /admin/agent-presets · GET|PATCH /admin/agent-presets/:id · GET|POST /admin/agent-presets/:id/versions · PATCH /admin/agent-presets/:id/versions/:v · POST /admin/agent-presets/:id/versions/:v/{test|publish} · POST /admin/agent-presets/:id/{archive|restore}
GET /admin/ai-providers · PATCH /admin/ai-providers/:key { apiKey?, isActive?, isPrimary? } · POST /admin/ai-providers/:key/test · CRUD /admin/ai-models · GET|PUT /admin/ai-routes/:capability · GET /admin/ai-pricing · POST /admin/ai-pricing/simulate · POST /admin/ai-pricing/versions (new CreditPricing version; applies at each workspace's next credit period)
GET /admin/conversations?workspaceId… · GET /admin/conversations/:id { reason } · GET /admin/products?workspaceId… · GET /admin/products/:id (read-only viewers; every open ⇒ AuditLog `viewer.open`) · POST /admin/conversations/:id/unmask { reason } (super_admin)
GET|POST /admin/cms · GET|PATCH /admin/cms/:id · PUT /admin/cms/:id/locales/:locale · POST /admin/cms/:id/{publish|schedule|unpublish|translate} · GET /admin/cms/:id/versions · GET /admin/cms/:id/preview-link → signed url 24 h
GET /admin/audit-logs?… · POST /admin/audit-logs/export { format: csv_signed|json, from, to } → 202
```
New admin modules (moderation, reports, support, platform settings, jobs & health, credit packs & promo codes, platform team & deletion requests): see §8.11.

## 3. Inbound webhooks (public, verified, idempotent on provider event id, ack fast)

| Endpoint | Source | Verification |
|---|---|---|
| `GET/POST /webhooks/meta` | Messenger + Instagram | `hub.verify_token` / `X-Hub-Signature-256` (raw body) |
| `POST /webhooks/meta/data-deletion` (callback; the status URL it returns is `GET /data-deletion/:code`, §12) | Meta | signed_request |
| `POST /webhooks/chargily` | billing + order payments | `signature` HMAC (raw body) |
| `POST /webhooks/couriers/:courierAccountId` | couriers that offer webhooks | per-account secret; status re-fetched before applying |
| `POST /webhooks/store/google-play` · `POST /webhooks/store/app-store` | store server notifications (IAP refunds) | store signature (§8.9) |
| `POST /webhooks/google` (optional) | Google push | channel token |

**V1 paths (cutover, `META_LEGACY_PATHS=true`)**: the paths registered in the V1 Meta app are rewritten to their V2 routes before routing — `/api/webhooks/meta` → `/api/v1/webhooks/meta`, `/api/webhooks/meta/data-deletion` → `/api/v1/webhooks/meta/data-deletion`, `/api/pages/callback/{facebook|instagram}` → `/api/v1/channels/callback/{platform}` (query string kept; the raw body is captured by the body parser, so signatures still verify). Off by default; on in the live deployment (07 §12) so the Meta app settings did not change at go-live.

## 4. Outbound webhooks `[CDC §8.3]`

Headers `X-Djaber-Signature: t=<ts>,v1=<hmac_sha256(secret, ts.body)>`, `X-Djaber-Event`, `X-Djaber-Delivery`. Payload `{ id, event, createdAt, workspaceId, data }`. Events: `order.created, order.status_changed, order.paid, order.shipped, order.delivered, stock.low, stock.out, customer.new, payment.failed, conversation.escalated`. Retries 1 min, 5 min, 30 min, 2 h, 12 h, 24 h; auto-disable after 50 consecutive failures + notification.

## 5. API-key scopes (whitelist; everything else 403)

| Scope | Endpoints |
|---|---|
| `products:read` / `products:write` | `GET /products*`, `/categories`, `/units`, `/stock/*` / `POST|PATCH|DELETE /products*`, `POST /stock/adjustments`, import |
| `orders:read` / `orders:write` | `GET /orders*` / `POST /orders`, `PATCH /orders/:id`, `POST /orders/:id/status`, calls, notes |
| `customers:read` / `customers:write` | `/clients*` |
| `conversations:read` / `conversations:reply` | `GET /conversations*` / `POST /conversations/:id/messages` |
| `delivery:read` | fees, quote, shipments, tracking |
| `analytics:read` | `/analytics/*`, `/reports/*` (json) |
| `webhooks:manage` | `/webhooks*` |

No API-key access to auth, workspace, members, agents, billing, integrations, admin.

## 6. WebSocket (Socket.IO `/ws`)

Handshake with access token; rooms `ws:<workspaceId>`, `user:<userId>`; server emits `auth.expiring` 60 s before token expiry → client refreshes and reconnects; on reconnect client sends `since` and receives `resync` (conversations/orders updated since). Events: `message.created`, `conversation.updated`, `order.created`, `order.updated`, `shipment.updated`, `notification.created`, `credits.updated`, `job.updated`, `channel.updated`.

## 7. Export columns (appendix)

Orders XLSX/PDF: number, date, channel, source, client, phone, wilaya, commune, address/stop-desk, items (name × qty × price), subtotal, discount, delivery fee, total, paid, remaining, payment method, status, confirmation, delivery status, courier, tracking. Products: sku, name, category, unit, price, old price, cost, stock, min, variants count, active. Clients: name, phone, email, source, orders, spent, last order, tags. Locale = workspace locale; numbers formatted `12 500 DA`; PDF with workspace logo. `[FIG DLG Exporter les commandes]`: `scope=selection|filter|all`, `format=csv|xlsx|pdf`, `columns=standard|all`, `includeItems`, `courierFormat=zrexpress` (bulk-import layout); > 5 000 rows ⇒ 202 job.

---

# Additions from the Figma web design (2026-10-06 pass)

Sections 8–12 append what the Figma frames need beyond §2. Frame names in brackets. Every decision behind these sections is final (README Decisions D36–D78, `../audit/decisions-log-2026-10-11.md`). Every endpoint follows §1 (pagination, bulk per-item results, 202 jobs, idempotency on POSTs that create money/stock movements). Each path appears exactly once in this file; where §2 and §8 both mention a feature, the line marked "(the only …)" or "(§8.x)" is the definition.

## 8. New endpoints

### 8.1 Account, preferences, saved views, legal, workspace lifecycle
```
GET|PATCH /me/prefs { listDensity, soundOnMessage, dismissedAnnouncementIds[], reportFavorites[] }   `[FIG ORD-05 v2, SET notifications, ANA-04]`
GET /me/saved-views?page · POST /me/saved-views { page, name, filters, sort?, columns?, density?, isDefault? } · PATCH|DELETE /me/saved-views/:id · POST /me/saved-views/:id/share (Admin+) `[FIG REF Deep-link map]` (D42)
POST /me/deletion-request { password, totpCode? } → 202 (grace 30 d; ACCOUNT_OWNS_WORKSPACE / WORKSPACE_HAS_DEBT as `blockedReason`) · GET /me/deletion-request · DELETE /me/deletion-request (cancel) · GET /me/data-export → 202 (JSON + CSV)  `[FIG DLG Supprimer mon compte, ADM-16]`
POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? } (Owner; target must be an Admin member ⇒ OWNERSHIP_TRANSFER_TARGET_INVALID; AUTH_INVALID_CREDENTIALS on password mismatch; totpCode required when the owner has 2FA ⇒ TWO_FA_CONFIRMATION_REQUIRED; old owner → admin, new owner → owner, audit `workspace.transfer_ownership`, e-mail + `member.role_changed` to both)   `[FIG DLG Transférer la propriété]`
POST /workspace/deletion/cancel (Owner; Workspace.status deletion_scheduled → active, audited; 409 CONFLICT when not scheduled)   `[FIG SET danger zone banner]`
GET /invitations/:token (public) → { workspaceName, workspaceLogoUrl, inviterName, email, role, expiresAt } (INVITATION_EXPIRED; logged-in user with another e-mail ⇒ INVITATION_EMAIL_MISMATCH)   `[FIG AUTH Invitation]`
PATCH /workspace/quick-replies/order { ids[] } (full ordered list of the workspace's QuickReply ids; 422 VALIDATION_ERROR when an id is missing or unknown)   `[FIG SET quick replies drag]`
GET /legal/pending → [{ key: LegalDocKey, version, url }] · POST /legal/accept { key, version } → 204 (creates LegalAcceptance; LEGAL_REACCEPT_REQUIRED is lifted once every pending key is accepted)   `[FIG ADM-13 ré-acceptation]`
GET /announcements (active CmsEntry announcements of channel banner for my plan/workspace, dismissed ones left out) · GET /announcements/:id (also ended / withdrawn, with `state`) · POST /announcements/:id/dismiss → 204 · public GET /cms/announcements (channel web, every-workspace target)
```

### 8.2 Product moderation — merchant side
```
GET /products?moderationStatus=not_required|pending|approved|rejected|appealed (list pill filter; Product.moderationStatus) `[FIG MOD]`
GET /products/:id/moderation → { status, item: { aiFlags, decision, merchantMessage, rejectedFields, decidedAt }, history[], appeal? }
POST /products/:id/resubmit → 202 (re-runs AI pre-screen; 409 MODERATION_NOT_REJECTED when Product.moderationStatus ≠ rejected)
POST /products/:id/submit-changes → 200 `{ submitted, moderationStatus }` (tester report 25/10 UX-001: the save of the product form; submits when the product differs from its last reviewed snapshot — fields, a new picture, a new / renamed / ±50 % variant — else nothing; idempotent)
POST /products/:id/appeal { message ≤ 500, attachmentUploadId? } (MODERATION_APPEAL_ALREADY_USED / MODERATION_APPEAL_WINDOW_EXPIRED) `[FIG MOD appeal dialog]`
GET /moderation/summary → { pending, rejected, appealed, trustLevel }  (banner "38 produits en attente")
```

### 8.3 Trust & safety — merchant side
```
GET /safety/blocks?q&source&page · POST /safety/blocks { clientId | phone, reason: BlockReason, note? } · DELETE /safety/blocks/:id (Admin+; 403 CUSTOMER_BLOCKED_BY_PLATFORM for rows with source=platform)   `[FIG SAFE]`
POST /conversations/:id/block { reason: BlockReason, note? } · POST /conversations/:id/unblock · POST /conversations/bulk/block { ids[] }
POST /safety/reports { type: conversation|customer|ai_message|product, conversationId?, clientId?, messageId?, productId?, reason: ReportReason, details?, blockAlso? } → { id, status } (Operator+; ABUSE_REPORT_ALREADY_OPEN / ABUSE_REPORT_RATE_LIMITED / ABUSE_REPORT_SELF) `[FIG SAFE Signaler à Djaber]`
GET /safety/reports (mine / workspace) · GET /safety/reports/:id   (`GET /reports` is the reports hub, §2)
GET|PUT /safety/rules { riskAfterReturns, autoBlockEnabled, autoBlockAfterUncollected (≥ 1), handoffOnRisk } (Admin+) · GET|PUT /safety/blocked-words { words[] }
POST /clients/:id/risk { riskLevel: normal|high }   `[FIG SAFE "Marquer risque"]`
GET /conversations?blocked=1 (tab "Bloqués")
```

### 8.4 Help & support
```
GET /help/articles?q&category&lang&context (context = current page key → contextual guides for the "?" panel) · GET /help/articles/:slug   `[FIG HELP]`
GET /status (public mirror of status.djaber.ai, see §12)
GET /support/tickets?status&page · POST /support/tickets { category: TicketCategory, priority: TicketPriority, message, attachments[], context (auto, editable) } → { id, number, slaDueAt }
GET /support/tickets/:id · POST /support/tickets/:id/messages { body, attachments[] } · POST /support/tickets/:id/rate { score 1–5, note? } · POST /support/tickets/:id/close
```

### 8.5 Orders, delivery, clients — dialogs not covered in §2
```
POST /orders/:id/cancel { reason: CancelReason, note?, notifyCustomer? } (= status cancelled; 409 DELIVERY_ORDER_ALREADY_SENT when an active shipment exists ⇒ use returned)  `[FIG DLG Annuler la commande]`
POST /orders/:id/deliver { amountCollected, reason?, deliveredAt } (manual delivery, COD rule)   `[FIG DLG Marquer livrée manuellement]`
POST /orders/:id/return { reason: address|unreachable|refused|damaged|other (FailureReason), restoreStock, returnFee?, note? }   `[FIG DLG Marquer retournée]`
POST /orders/:id/ship-manual { trackingNumber? } (Shipment provider=manual)
POST /shipments/:id/retry-delivery (adapter retryDelivery, +1 attempt) · POST /shipments/:id/change-courier { courierAccountId } · POST /shipments/:id/mark-delivered · POST /shipments/:id/mark-returned
POST /shipments/:id/mark-failed { reason: FailureReason, note? } (Shipment.status → failed, order stays `shipped`, notification `shipment.failed`; 409 CONFLICT when status ∈ delivered|returned|cancelled)   `[FIG DLG Échec de livraison]`
GET /shipments?… (§10 Livraison) · POST /shipments/bulk/sync { ids[] } → 202 · POST /shipments/bulk/ship-manual { ids[] }   (KPIs + failures + stale: `GET /delivery/overview`, §2)
GET /delivery/stopdesks?provider&communeId   `[FIG DLG Modifier l'adresse]`
GET /delivery/couriers/:id/capabilities · GET /delivery/rates?… (cached 1 h, CourierRateCache)
POST /clients/merge { keepId, mergeId } (CUSTOMER_MERGE_IRREVERSIBLE)   `[FIG DLG Fusionner les clients]`
POST /clients/bulk/tags { ids[], add[], remove[] } · POST /clients/bulk/delete { ids[] } · POST /clients/bulk/export { ids[] } → 202
PATCH /clients/:id (quick edit: name, phone, tags, riskLevel, default address) · GET /clients/:id/conversations
```
Public tracking page: `GET /track/:publicToken` (§12).

### 8.6 Catalogue & GDS — dialogs and bulk actions not covered in §2
```
POST /products/bulk/category { ids[], categoryId } · POST /products/bulk/agent { ids[], agentId } · POST /products/bulk/min-stock { ids[], minStock }
POST /products/bulk/price { ids[], op: increase|decrease|set, value, unit: percent|dzd, roundUpTens?, applyToVariants? } → per-item results + warnings SELLING_BELOW_COST   `[FIG DLG Modifier les prix en masse]`
POST /products/bulk/archive { ids[], releaseStock? } · POST /products/bulk/labels { ids[] } → 202 · POST /products/bulk/export { ids[] } → 202
POST /products/:id/duplicate { name, copyImages, copyVariants, copyCost } · POST /products/:id/variants/generate { attributes: [{name, values[]}], defaultPrice, defaultStock } (VARIANT_LIMIT)
GET /products/:id/card-preview → rendered Messenger card · GET /products/:id/relations → { orders, movements, agents, recommendations } counts + last rows   `[FIG CAT-01 quick edit]`
DELETE /products/:id?mode=archive|hard&releaseStock (hard only if no order/sale line: PRODUCT_HAS_ORDERS)
POST /products/import/mapping { jobId, mapping, updateExisting?, saveMapping? }   `[FIG DLG Correspondance des colonnes]`
POST /products/ai-fill (multipart 1–5 photos, 5 credits) → { name, description, categoryId?, attributes } (the only create-from-photo endpoint)   `[FIG DLG Créer depuis une photo]`
POST /stock/adjustments { productId, variantId?, type: in|out|set, quantity, reason: breakage|loss|initial|inventory|correction|other, note? (≤ 255), force? } (force = negative stock; `in` ⇒ MovementType adjustment_in, `out`/`set` downwards ⇒ adjustment_out)
GET /stock/movements/:id · GET /stock/movements/export → 202 · POST /stock/movements/:id/reverse { note } (new inverse movement)
GET /stock/snapshot?date=YYYY-MM-DD&categoryId&q&page → [{ productId, variantId?, name, sku, quantityAtDate, costPriceAtDate, valueAtDate }] + meta.totalValue (stock as of end of `date` Africa/Algiers, replayed from StockMovement; date ≥ workspace creation, else 422 INVALID_DATE_RANGE)   `[FIG GDS-05 "Voir le stock à cette date"]`
GET|POST /inventories { scope: InventoryScope, categoryId? } · GET /inventories/:id · PUT /inventories/:id/lines { lines[{productId, variantId?, countedQty, note?}] } · POST /inventories/:id/validate · POST /inventories/:id/cancel · GET /inventories/:id/sheet (PDF)   `[FIG DLG Lancer / Valider l'inventaire]`
GET /suppliers/:id/purchases · POST /suppliers/:id/payments { amount, method, purchaseId|oldest, reference? } · POST /suppliers/:id/{deactivate|activate} (SUPPLIER_HAS_PURCHASES on delete)
POST /purchases/:id/order (draft → pending) · POST /purchases/:id/duplicate · GET /purchases/:id/print · POST /purchases/:id/payments { amount, method, reference? }
POST /sales/:id/cancel { reason, restoreStock, refund } (SALE_CANNOT_CANCEL_AFTER_7D) · POST /sales/:id/payments { amount, method } · POST /sales/:id/client { clientId } · GET /sales/:id/receipt (PDF)
GET /cash?day&direction&category&method&createdById&q · GET /cash/days (open/closed; CashClosing rows) · POST /cash/close { day, countedBalance, note? } → CashClosing { day, theoreticalBalance, countedBalance, difference } · POST /cash/days/:day/reopen (Admin+, audited) · GET /cash/export → 202   `[FIG GDS-09]`
POST /reports/:key/schedule { email, dayOfMonth 1–28 } → ReportSchedule (plan feature `scheduled_reports` ⇒ PLAN_FEATURE_REQUIRED; one row per workspace × reportKey × email) · DELETE /reports/:key/schedule { email } · GET /reports/schedules   `[FIG ANA-04 "Planifier"]`
GET /stock-recommendations?type&priority&status&categoryId · POST /stock-recommendations/generate → 202 (RECO_RATE_LIMITED 1/10 min) · POST /stock-recommendations/:id/{apply|dismiss|snooze} · GET /stock-recommendations/history · POST /stock-recommendations/mute { productId, type } (StockRecommendationMute)   `[FIG GDS-10]`
```

### 8.7 Agents & channels — wizard, versions, tests, insights
```
POST /agents { presetKey | fromScratch, ...step1 } → draft (status=draft; drafts do not count toward maxAgents) · PATCH /agents/:id { step, ...fields, version } (each save ⇒ AgentVersion and server-side compilation of customInstructions / humanHandoffRules; 409 CONFLICT merge by section)   `[FIG AGT-02, AGT-04]`
GET /agents/:id/readiness → checklist { catalog, productsWithoutPhoto[], feeGrid, policies, channels[], emailVerified, credits, pendingModeration }   `[FIG AGT-02 step 5]`
POST /agents/:id/test-scenarios → 202 (8 scenarios, free) · GET /agents/:id/test-scenarios
POST /agents/:id/activate { at? } (AGENT_NO_CHANNEL; PLAN_LIMIT {resource: agents} counted on agents with status ∈ active|paused; AUTH_EMAIL_UNVERIFIED) · DELETE /agents/:id/activate (cancels a scheduled activation: scheduledActivateAt → null, idempotent, agents.manage, audit agent.unschedule; not a draft any more ⇒ 409 CONFLICT) · POST /agents/:id/pause (AGENT_PAUSED_WITH_OPEN_THREADS confirm) · POST /agents/:id/duplicate
POST /agents/bulk/{pause|resume|delete} { ids[] } → per-item results (same rules as the single endpoints; AGENT_HAS_CHANNELS on delete)   `[FIG MECH Agents multi-select]`
GET /agents/:id/versions · GET /agents/:id/versions/:v · GET /agents/:id/versions/:v/diff?against · POST /agents/:id/versions/:v/restore   `[FIG AGT-03 Versions]`
POST /agents/:id/apply-preset-update { presetVersion } → new version · GET /agents/:id/export (JSON, no secrets)
POST /agents/:id/test-links { expiresInHours: 24 } → { url } (public playground `GET /agent-test/:token`, §12)
GET|POST /agents/:id/faq · PATCH|DELETE /agents/:id/faq/:fid · POST /agents/:id/faq/extract { channelId } → 202 (free, 3/day/workspace) · POST /agents/:id/faq/import (multipart PDF/DOCX/TXT ≤ 5 MB, UPLOAD_TOO_LARGE) → 202
GET /agent-insights?agentId&status&type&channelId&from&to&groupByTopic · POST /agent-insights/:id/resolve { action: instruction|faq|product|ignored_30d (InsightResolution), instruction?, question?, answer? } (the only insight-resolution endpoint) · POST /agent-insights/bulk/dismiss { ids[] }   `[FIG DLG Résoudre l'insight]`
POST /agents/:id/test { messages[], attachments? } → { reply, status, intent, confidence, model, tokens, latencyMs, toolCalls[], cards[], creditsInProd, promptPreview } · POST /agents/:id/test/flag { turnId, note } (eval) · GET /agents/:id/test/export
POST /channels/:id/sync-info (name, avatar, followers; 1/10 min) · POST /channels/:id/{disable|enable} · PUT /channels/:id/agent { agentId|null } (AGENT_CHANNEL_SWITCH_NEXT_THREAD) · PUT /channels/:id/icebreaker { text }
GET /channels/:id/events?kind&from&to · POST /channels/:id/sync { days: 7|30|90 } → 202 · GET /channels/:id/approval-status
GET /ai/routes (public read of capability → model label for the read-only model badge of the agent form)
```

### 8.8 Inbox additions
```
POST /conversations/bulk/{resolve|archive|assign|resume-ai|block} { ids[], assigneeId? } → per-item results   `[FIG DLG Inbox Actions groupées]`
POST /conversations/:id/messages { templateKey: orderShipped|orderOutForDelivery|orderDelivered|orderFailed|reminderScheduled } (template message; outside the 24 h window it is sent with the Messenger `HUMAN_AGENT` tag; placeholders filled from the conversation's last order; Instagram outside the window ⇒ 422 REPLY_OUTSIDE_WINDOW)   `[FIG DLG Inbox "Envoyer un message modèle"]`
POST /conversations/:id/unread · POST /conversations/:id/restore (Admin+, ≤ 30 d after soft delete)
GET /conversations?… (§10 Boîte) · GET /messages/:id/ai-run → AiRun detail (admin/debug)   `[FIG REF "Clic sur IA → détail du tour"]`
POST /messages/:id/report → shortcut to POST /safety/reports { type: ai_message }
```

### 8.9 Billing — invoices, packs, promo codes
```
GET /billing/invoices?status&page · GET /billing/invoices/:id/pdf · GET|PUT /billing/info { companyName, nif, address }   `[FIG BIL-04 Factures]`
POST /billing/invoices/:id/pay → { checkoutUrl } (Owner/Admin; Invoice.status=unpaid only, else 409 CONFLICT; Chargily checkout for the remaining amount; payment ⇒ Subscription.status=active, new period, paused resources lifted)   `[FIG BIL-04 "Payer maintenant"]`
POST /billing/checkout { planId, cycle, promoCode? } → { checkoutUrl, prorata, preview } · POST /billing/preview { planId, cycle, promoCode? } → { amountNow, nextAmount, effectiveAt, pausedResources[] }   `[FIG DLG Changer de plan]`
POST /billing/promo/validate { code, planId? } → { kind: PromoKind, value, periods } | PROMO_* · POST /billing/promo/redeem { code } (kind=credits)
GET /billing/checkout/return?ref → { status: verifying|success|pending|failed|expired, invoiceId?, planUntil? }
GET /credit-packs (public, web prices + store product ids; `?platform=google_play|app_store` → store product ids only) · POST /credits/packs/checkout { packId } → { checkoutUrl } (web) · GET /credits/packs/purchases
POST /credits/packs/iap/validate { platform: google_play|app_store, productId, transactionId, receipt?, purchaseToken? } → `IapValidateResult { status, creditsAdded, purchaseId, balance }` (api-contract §3.10; receipt = App Store, purchaseToken = Google Play; idempotent on transactionId; IAP_RECEIPT_INVALID / IAP_PRODUCT_UNKNOWN / IAP_STORE_UNAVAILABLE; a replayed transactionId ⇒ 409 IAP_RECEIPT_ALREADY_USED, treated as success by the client)   `[FIG ADM-15 rules]`
POST /webhooks/store/google-play · POST /webhooks/store/app-store (server notifications: refunds ⇒ CreditLedger action=store_refund, `credits.negative` when the balance goes below 0)
GET /credits → { plan: {used, limit, periodEnd}, packs: {remaining}, burnRatePerDay, exhaustedEta? } · GET /credits/ledger?from&to&action&agentId&bucket&page · GET /credits/ledger/export → 202 · GET /credits/calculator?conversations&photoPct&voicePct&msgsPerConv → estimate
```

### 8.10 Integrations additions
```
POST /webhooks/:id/test (ping) · POST /webhooks/:id/enable (after WEBHOOK_ENDPOINT_DISABLED, resets failureCount) · POST /webhooks/:id/rotate-secret → shown once · GET /webhooks/:id/deliveries?status&event&page
POST /api-keys { name, scopes[], environment } → { key (shown once), prefix } · POST /api-keys/:id/revoke
GET /integrations/google-sheets/status · POST /integrations/google-sheets/picker-token
```

### 8.11 Platform admin — new modules
```
# Moderation — write: moderator, super_admin; read: every platform role
GET /admin/moderation/items?status&priority&aiFlag&scoreMin&scoreMax&trustLevel&categoryId&workspaceId&waitingOver&assigneeId&q&sort · GET /admin/moderation/items/:id (snapshot, merchant history)
POST /admin/moderation/items/:id/{approve|reject|request-changes} { decision?: ModerationDecision, reasonTemplateKey?, merchantMessage, rejectedFields[] } · POST /admin/moderation/items/bulk/{approve|reject|assign} { ids[], decision?, reasonTemplateKey?, merchantMessage?, assigneeId? } (reject requires decision + reasonTemplateKey + merchantMessage, assign requires assigneeId; else 422 VALIDATION_ERROR) · POST /admin/moderation/items/:id/assign { assigneeId }
GET /admin/moderation/appeals?status · POST /admin/moderation/appeals/:id/decide { decision: upheld|overturned, note } (reviewer ≠ first reviewer)
GET|POST /admin/moderation/rules · PATCH|DELETE /admin/moderation/rules/:id · GET /admin/moderation/stats?period · GET /admin/moderation/sample (5 % of auto-approved)
# Reports & safety — write: moderator, super_admin; read: every platform role
GET /admin/reports?type&severity&status&reporterKind&workspaceId&assigneeId&from&to · GET /admin/reports/:id (masked excerpt)
POST /admin/reports/:id/decide { decision: ReportDecision, note, notifyReporter } · POST /admin/reports/:id/assign
GET|POST /admin/blacklist · DELETE /admin/blacklist/:id { reason } · GET|PUT /admin/blocked-words · GET /admin/safety/auto-rules · GET /admin/safety/export?month → 202 (store compliance export)
# Support — write: support, super_admin; read: every platform role
GET /admin/support/tickets?status&category&priority&channel&planSlug&assigneeId&slaBreached&q · GET /admin/support/tickets/:id · POST /admin/support/tickets { workspaceId, userId, subject, category, priority, channel: email|chat }
POST /admin/support/tickets/:id/messages { body, isInternal, cannedReplyKey?, attachments[] } · POST /admin/support/tickets/:id/{assign|resolve|reopen|escalate|wait-customer|link-incident} · GET /admin/support/stats?period · CRUD /admin/support/canned-replies (CannedReply)
# Platform settings — write: super_admin; read: every platform role — ADM-13
GET /admin/settings · PUT /admin/settings/:key { value, reason } · GET /admin/settings/:key/versions
GET|PUT /admin/app-versions/:platform { minVersion, recommendedVersion, latestVersion, updateMessage { fr, ar, en }, storeUrl, totpCode (required when minVersion rises) } → impact { devicesBelowMin, pct } (AppVersion; notifications `app.update_required` / `app.update_recommended`)
GET|POST /admin/feature-flags · PATCH|DELETE /admin/feature-flags/:key · GET /admin/feature-flags/:key/evaluate?workspaceId
GET|POST /admin/legal-documents · POST /admin/legal-documents/:key/publish { version, isMajor, cmsEntryId } (isMajor ⇒ `legal.reacceptance_required`) · GET /admin/legal-documents/:key/acceptance-stats
GET /admin/meta/permissions · PATCH /admin/meta/permissions/:scope · GET /admin/meta/app · PUT /admin/meta/app { appId, appSecret }
GET /admin/providers · PUT /admin/providers/:key { config, secret? } · POST /admin/providers/:key/test (PlatformProvider.key ∈ chargily|email|sms|push|courier_zr|courier_ecotrack|courier_yalidine|google_oauth)
PUT /admin/maintenance { enabled, scheduledFrom?, scheduledTo?, scope } · PUT /admin/incident-banner { visible, text JSON }
# Jobs & health — ADM-14 (write: super_admin; support: read + replay of failed jobs; read for the other roles)
GET /admin/health → { queues[{name, waiting, active, failed, delayed, p95, state}], metaWebhooks{received, invalidSignatures, ackOver5s, p95}, ai{errorRate24h, failoverActive}, duplicates7d }
POST /admin/queues/:name/{pause|resume|drain-failed|replay-failed|run-now} · GET /admin/queues/:name/failed?page · GET /admin/queues/failed/:jobId · POST /admin/queues/failed/:jobId/replay
GET|POST /admin/incidents · PATCH /admin/incidents/:id · POST /admin/incidents/:id/updates { status, body } · POST /admin/incidents/:id/resolve { postMortem? }
# Credit packs & promo codes — ADM-15 (write: finance, super_admin; read for the other roles)
GET|POST /admin/credit-packs · PATCH /admin/credit-packs/:id · GET /admin/credit-packs/purchases?channel&status&from&to · GET /admin/credit-pricing/versions
GET|POST /admin/promo-codes · PATCH /admin/promo-codes/:id · POST /admin/promo-codes/:id/deactivate · GET /admin/promo-codes/:id/redemptions
# Platform team & deletion requests — ADM-16
GET /admin/platform-members · POST /admin/platform-members/invitations { email (@djaber.ai), platformRole } · DELETE /admin/platform-members/invitations/:id · POST /admin/platform-members/:userId/force-2fa   (super_admin)
GET /admin/deletion-requests?status · GET /admin/deletion-requests/:id (read: every platform role) · POST /admin/deletion-requests/:id/{cancel|resolve|process-now} { reason } (super_admin, support)
# Impersonation — read-only sessions (R-F); super_admin, support
GET /admin/impersonation/sessions?adminUserId&workspaceId&from&to · POST /admin/impersonation/sessions { workspaceId, reason (≥ 10 chars), ticketId? } → { data: { sessionId, token, expiresAt } } (expiresAt = startedAt + 30 min; every subsequent request carries `X-Impersonation-Session: <sessionId>`; any non-GET ⇒ 403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION; after expiresAt ⇒ 401 ADMIN_IMPERSONATION_EXPIRED; audit impersonation.start / impersonation.action / impersonation.stop) · DELETE /admin/impersonation/sessions/:id (ends the session)
```

## 9. Role matrix

Mirror of `../implementation/01-nest-module-map.md` §3.2 (the single permission table), one row per endpoint group. Merchant roles = `MemberRole` (`owner` / `admin` / `operator`); "Admin+" = owner + admin. `●` full · `R` read · `—` none. Permission keys in parentheses.

| Endpoint group `[FIG frame]` | Owner | Admin | Operator |
|---|---|---|---|
| Workspace settings, system messages, onboarding (`PATCH /workspace`, `/workspace/system-messages`) | ● | ● | R |
| Workspace: transfer ownership (`workspace.transfer`) · delete / cancel deletion | ● · ● | — · — | — · — |
| Members & invitations: list (`members.read`) · invite, change role, remove (`members.write`) | ● · ● | R · — | R · — |
| Quick replies: list (`inbox.read`) · create, edit, delete, reorder (`workspace.settings`) | ● · ● | ● · ● | ● · — |
| Channels: connect, reconnect, pause, agent assignment, delete | ● | ● | R |
| Inbox: read, reply, notes, assign, resolve, bulk actions, template messages | ● | ● | ● |
| Inbox: restore a deleted conversation | ● | ● | — |
| Saved views: own `[REF]` · share to team (`views.share`) | ● · ● | ● · ● | ● · — |
| Orders: create, edit, assign, callback, record payment, address edit `[DLG Orders]` | ● | ● | ● |
| Orders: status change (`POST /orders/:id/status`, cancel, deliver, return) | ● | ● | ● except `delivered → returned` |
| Orders: bulk status (`to` ≠ delivered/returned, bulk cancel included) / bulk send / bulk print `[ORD-05 v2]` | ● | ● | ● |
| Orders: delete | ● | ● | — |
| Orders: import CSV (`orders.import`) | ● | ● | — |
| Products & categories & units: read (`catalog.read`) · create, edit, images, variants, archive (`catalog.write`) | ● · ● | ● · ● | R · — |
| Products: moderation view · resubmit, appeal `[MOD]` (`catalog.write`) | ● · ● | ● · ● | R · — |
| Products: bulk price / category / agent / archive, duplicate, variants generate, AI fill, import | ● | ● | — |
| Stock: movements read, snapshot, movements export (`stock.read`) · adjustments (`force` included), reverse movement (`stock.adjust`) | ● · ● | ● · ● | R · — |
| Inventory count: start, validate, cancel · count lines (`stock.count`) `[DLG GDS]` | ● · ● | ● · ● | — · ● |
| Suppliers, purchases, sales, cash rows, cash close / reopen (`gds.*`) | ● | ● | — |
| Reports, exports, schedules (`/reports*`, `/jobs*`) | ● | ● | — |
| Analytics (`/analytics/*`, `/dashboard/home`) | ● | ● | R |
| Stock recommendations: apply / dismiss / snooze / mute | ● | ● | R |
| Clients: create, edit, tags, risk, merge, bulk | ● | ● | ● (merge/bulk delete: Admin+) |
| Agents: wizard, versions, restore, activate, pause, bulk, test links · playground `/agents/:id/test` | ● · ● | ● · ● | R · ● |
| Insights: resolve (instruction / FAQ / product / ignore) | ● | ● | ● |
| Safety: block / report customer `[SAFE]` · unblock, auto-rules, blocked words | ● · ● | ● · ● | ● · — |
| Support: open tickets, reply, see own `[HELP]` · see all workspace tickets (`support.read_all`) | ● · ● | ● · ● | ● · — |
| Billing: plan change / checkout / cancel, billing info (`billing.plan`) | ● | — | — |
| Billing: invoices read, invoice pay, promo validate / redeem, buy pack, IAP (`billing.write`) `[BIL-04]` | ● | ● | — |
| Credits: `GET /credits`, ledger (`billing.read_credits`) | ● | ● | ● |
| Integrations: API keys, webhooks, Google Sheets | ● | ● | — |
| Notifications, preferences, devices, prefs, legal acceptance, own deletion request | ● | ● | ● |

Platform roles (`User.platformRole` ∈ `PlatformRole`: `super_admin` / `support` / `moderator` / `finance` / `read`; `none` = merchant only), `[FIG ADM-16 matrice]`. Permission keys `admin.<area>.read` and `admin.<area>.write`, areas = overview, workspaces, users, billing, ai, presets, cms, audit, health, settings, moderation, safety, support, team, deletion. Every role has `admin.<area>.read` on every area; writes are:

| Endpoint group (area) | super_admin | support | moderator | finance | read |
|---|---|---|---|---|---|
| Overview, alerts (`/admin/analytics`, `/admin/alerts`) (overview) | R | R | R | R | R |
| Workspaces: view, members, viewers (`/admin/workspaces`, `/admin/conversations`, `/admin/products`) (workspaces) | R | R | R | R | R |
| Workspaces: create, edit, suspend / reactivate, schedule deletion, extend trial, release channel (workspaces write) | ● | — | — | — | — |
| Workspaces: trust level (`/admin/workspaces/:id/trust-level`) (moderation write) | ● | — | ● | — | — |
| Viewer unmask (`POST /admin/conversations/:id/unmask`) | ● | — | — | — | — |
| Impersonation sessions (`/admin/impersonation/sessions`, read-only sessions only) | ● | ● | — | — | — |
| Users: view (users) · edit, block, reset, platform role (users write) | R · ● | R · — | R · — | R · — | R · — |
| Billing: plans, subscriptions, invoices, manual payments (`mark-paid`), discounts, promo codes, credit packs, pricing versions (billing write) | ● | — | — | ● | — |
| Credit grants (`POST /admin/workspaces/:id/credits`) | ● | ≤ 1 000 | — | ● | — |
| AI providers, models, routes, pricing (ai write) | ● | — | — | — | — |
| Agent presets (presets write) | ● | — | — | — | — |
| CMS, announcements, legal documents (cms write) | ● | — | — | — | — |
| Audit log read (audit) · export (`POST /admin/audit-logs/export`) | R · ● | R · — | R · — | R · ● | R · — |
| Jobs & health: queues pause/resume/drain/run-now, incidents (health write) · replay failed jobs | ● · ● | — · ● | — · — | — · — | — · — |
| Platform settings, app versions, feature flags, Meta app, providers, maintenance (settings write) | ● | — | — | — | — |
| Moderation items, appeals, rules (moderation write) | ● | — | ● | — | — |
| Safety: reports decide/assign, blacklist, blocked words, auto-rules (safety write) | ● | — | ● | — | — |
| Support tickets, canned replies (support write) | ● | ● | — | — | — |
| Platform members, invitations, force-2fa (team write) | ● | — | — | — | — |
| Deletion requests: view (deletion) · cancel / resolve / process-now (deletion write) | R · ● | R · ● | R · — | R · — | R · — |

Every platform role requires `totpEnabled` (`TWO_FA_REQUIRED_FOR_ROLE`); every write under `/admin/*` that touches a merchant requires `reason` (≥ 10 chars, `ADMIN_REASON_REQUIRED`) and writes `AuditLog.reason`. Impersonation sessions are read-only: there is no write session.

## 10. List query parameters (one block per Figma filter panel)

Conventions: multi-value = comma list; ranges = `min<Field>`/`max<Field>`; dates = `from`/`to` (end of day inclusive, Africa/Algiers) or `period=today|7d|30d|month|last_month|90d|year|custom`; `q` = server search (300 ms debounce client-side); `sort=-field`; `page`/`pageSize` (25/50/100, default 25; inbox 50 cursor); `view=<savedViewId>`; KPIs of the page use the same filters (`GET …/stats` accepts them). Status tabs = the `status` filter (never duplicated). Every enum-valued param accepts exactly the values of the Prisma enum named in parentheses.

| Page `[FIG]` | Endpoint | Query params (model source) |
|---|---|---|
| Commandes `[ORD-05 filter panel]` | `GET /orders`, `/orders/stats` | `status` (`OrderStatus`: new, confirmed, preparing, shipped, delivered, cancelled, returned), `confirmationStatus` (`ConfirmationStatus`: pending, no_answer, confirmed, rejected, wrong_number, callback), `minCalls`, `neverCalled` (callAttempts), `paymentStatus` (`PaymentStatus`: unpaid, partial, paid, pending_link, refunded), `paymentMethod` (`PaymentMethod`: cash, card, transfer, ccp, other), `hasRemaining`, `deliveryStatus` (`DeliveryStatus`: not_sent, pending, sent, in_transit, out_for_delivery, delivered, failed, returned), `shipmentProvider` (`ShipmentProvider`: manual, zrexpress, ecotrack, yalidine), `source` (`OrderSource`: ai, manual, mobile, api, import), `channelId`, `agentId`, `assigneeId` (`me`), `wilayaId`, `isStopdesk`, `minTotal`/`maxTotal`, `from`/`to`/`period` (orderedAt), `productId` (OrderItem), `riskLevel` (`RiskLevel`: normal, high), `clientId`, `callbackDue`, `q` (number, client, phone, product, notes), `sort` (orderedAt, total, status, clientName), `view` |
| Produits `[CAT-08 filter panel]` | `GET /products` | `categoryIds`, `status` (active/inactive/archived), `type` (stock/service/variants/no_variants), `stockState` (low/out/in_stock), `minQty`/`maxQty`, `minPrice`/`maxPrice`, `minCost`/`maxCost`, `minMargin`/`maxMargin`, `agentId` / `noAgent`, `moderationStatus` (`ModerationStatusProduct`: not_required, pending, approved, rejected, appealed), `createdFrom`/`createdTo`, `updatedFrom`/`updatedTo`, `q` (name, sku, keywords), `sort` (name, sku, price, cost, stock, updatedAt), `layout` ignored server-side, `view` |
| Clients `[CLI-03 filter panel]` | `GET /clients` | `source` (`ClientSource`: manual, ai, import, api), `quality` (placeholder/no_phone/no_address/duplicates), `tags`, `riskLevel` (`RiskLevel`), `channelId` / `noConversation`, `minOrders`/`maxOrders`, `neverOrdered`, `returned`, `minSpent`/`maxSpent`, `lastOrder` (lt30/30_90/gt90/never), `wilayaId`, `createdFrom`/`createdTo`, `blocked`, `q` (name, phone), `sort` (lastOrderAt, name, totalSpent, createdAt), `view` |
| Boîte `[INB filter sheet]` | `GET /conversations`, `/conversations/counts` | `channelIds`, `status` (`ConversationStatus`: active, needs_human, resolved, archived — tabs), `ai` (active/paused/no_agent), `agentId`, `unread`, `assigneeId` (`me`/`none`), `order` (with/cart/abandoned/without), `intent` (`AiIntent`: sale, info, tracking, complaint, greeting, other — lastAiIntent), `client` (risk/placeholder/vip), `language` (fr/ar/en — context.lastLanguage), `lastMessage` (lt24h/gt24h/7d/custom + from/to), `blocked`, `q` (name, phone, text), `sort` (lastMessageAt, oldestWaiting, unreadFirst), `cursor` |
| Agents `[MECH Agents]` | `GET /agents` | `status` (`AgentStatus`: draft, active, paused), `channelId`, `modelId`, `capabilities` (voice/image/orders), `presetKey`, `activeDays` (7/30), `defaultLanguage`, `hasPendingInsights`, `q`, `sort` (lastActiveAt, name) |
| Pages connectées `[MECH Channels]` | `GET /channels` | `platform` (`ChannelPlatform`: facebook, instagram), `status` (`ChannelStatus`: active, paused, pending_review, needs_reconnect, disabled, disconnected), `agentId` / `noAgent`, `pausedBy` (`PausedReason`: manual, plan, moderation), `q` (name, externalId), `sort` |
| Livraison & suivi `[MECH Delivery]` | `GET /shipments` (joined with Order) | `shipmentStatus` (`not_sent` = no active shipment, then the full `ShipmentStatus` enum: pending, sent, picked_up, in_transit, out_for_delivery, delivered, failed, returned, cancelled, stale), `provider` (`ShipmentProvider`: manual, zrexpress, ecotrack, yalidine), `deliveryType` (home/stopdesk), `wilayaId`, `communeId`, `orderStatus` (`OrderStatus`), `lastEvent` (lt24h/2_5d/gt5d_stale — "Sans mouvement" = no event > 5 d while status ∈ sent, picked_up, in_transit), `failureReason` (`FailureReason`: address, unreachable, refused, damaged, other), `lastError` (`COURIER_CREDENTIALS_INVALID`, `COURIER_VALIDATION`, `COURIER_UNAVAILABLE`, `TRACKING_NOT_FOUND`), `from`/`to` (shipment createdAt or order confirmedAt), `q` (number, tracking, client), `sort` (lastSyncedAt) |
| Mouvements `[GDS-05 filter panel]` | `GET /stock/movements` | `productId`, `variantId`, `type` (`MovementType`: in, out, adjustment_in, adjustment_out, inventory, return), `reason` (`MovementReason`, 16 values), `refType` (`MovementRefType`: order, sale, purchase, inventory, import, manual, variant), `refId`, `createdById` (`system`), `from`/`to`, `minQty`/`maxQty` (abs), `categoryId`, `q` (product, variant, reference), `sort` (createdAt) |
| Achats `[GDS-07]` | `GET /purchases` | `status` (`PurchaseStatus`: draft, pending, partial, received, cancelled), `supplierId`, `paymentStatus` (`GdsPaymentStatus`: unpaid, partial, paid), `late` (expectedAt < now ∧ not received), `from`/`to`, `q`, `sort` |
| Ventes `[GDS-08]` | `GET /sales` | `paymentStatus` (`GdsPaymentStatus`), `status` (`SaleStatus`: draft, completed, cancelled), `createdById`, `clientId`, `from`/`to`, `q`, `sort` |
| Fournisseurs `[GDS-06]` | `GET /suppliers` | `hasBalance`, `lastPurchase` (period), `isActive`, `q` (name, phone, email), `sort` |
| Caisse `[GDS-09]` | `GET /cash` | `day` (default today), `direction` (`CashType`: income, expense), `category` (`CashCategory`), `method` (`CashMethod`: cash, ccp, card, transfer, other), `createdById`, `source` (auto = `sourceType` ∈ `CashSourceType` / manual = `sourceType` null), `q`, `from`/`to` (for exports) |
| Recommandations `[GDS-10]` | `GET /stock-recommendations` | `type` (`StockRecoType`: restock, stockout_imminent, promote, price, supplier, agent), `priority` (`Priority3`: high, medium, low), `status` (`StockRecoStatus`, default active), `categoryId` |
| Notifications `[ANA-01b]` | `GET /notifications` | `types` (multi, `NotificationType`), `unread`, `from`/`to`, `cursor` |
| Membres `[SET members]` | `GET /workspace/members` | `role` (`MemberRole`: owner, admin, operator), `state` (active/invited/read_only), `q` |
| Crédits `[BIL-04]` | `GET /credits/ledger` | `from`/`to`, `action` (`CreditAction`), `agentId`, `bucket` (`CreditBucket`: plan, pack), `page` |
| Insights `[AGT-08]` | `GET /agent-insights` | `agentId`, `status` (`InsightStatus`: pending, resolved, dismissed), `type` (`InsightType`: unclear, unknown_topic, handoff, error), `channelId`, `period`, `groupByTopic` |
| Tâches `[ANA-04 Exports]` | `GET /jobs` | `kind` (`JobKind`), `status` (`JobStatus`: queued, running, done, partial, failed, cancelled), `page` |
| Admin › Espaces `[ADM-02]` | `GET /admin/workspaces` | `planSlug`, `status` (`WorkspaceStatus`: active, suspended, deletion_scheduled), `subscriptionStatus` (`SubscriptionStatus`: trial, active, dunning, expired, cancelled), `credits` (lt20/exhausted), `createdFrom`/`createdTo`, `wilayaId`, `withPages`, `withAgents`, `inactiveDays`, `minPages`/`maxPages`, `minProducts`/`maxProducts`, `minRevenue`/`maxRevenue`, `trustLevel` (`TrustLevel`: new, standard, trusted, watch), `q` (name, owner, e-mail, page id), `sort` |
| Admin › Utilisateurs `[ADM-03]` | `GET /admin/users` | `platformRole` (`PlatformRole`), `status` (`UserStatus`: active, blocked, deletion_scheduled), `emailVerified`, `totpEnabled`, `lastLogin` (period), `workspaceId`, `q` (name, e-mail, phone) |
| Admin › Abonnements `[ADM-05]` | `GET /admin/subscriptions`, `/admin/invoices` | `planSlug`, `status` (`SubscriptionStatus`), `cycle` (`BillingCycle`: monthly, yearly, none), `method` (`PaymentMethodBilling`), `renewal` (lt7d/overdue), `q`; invoices: `status` (`InvoiceStatus`: upcoming, unpaid, paid, void, refunded), `kind` (`InvoiceKind`: subscription, credit_pack, manual), `from`/`to` |
| Admin › Audit `[ADM-09]` | `GET /admin/audit-logs` | `actorId`, `action`, `entity`, `workspaceId`, `from`/`to`, `impersonation` (only/exclude), `q` (actor, target, reason, ip) |
| Admin › CMS `[ADM-08]` | `GET /admin/cms` | `type` (`CmsType`), `status` (`CmsStatus`), `missingLocale`, `target`, `updatedById`, `q` |
| Admin › Modération / Signalements / Support | see §8.11 | — |

## 11. Mobile-only needs `[MOB, FIG ADM-13/15, HELP]`

Request/response shapes (success bodies are the `data` content, §1). `docs/specs/14-mobile-app.md` uses exactly these names.

```
GET /app/version?platform=android|ios&version=2.1.0 (public, no auth)
  → { minVersion, recommendedVersion, latestVersion, status: ok|update_recommended|update_required, message, storeUrl, maintenance?: { until, text } }
    status = update_required when version < minVersion (client shows the blocking screen; every other call then answers 426 APP_UPDATE_REQUIRED {minVersion, storeUrl, message}),
    update_recommended when minVersion ≤ version < recommendedVersion, else ok; message = AppVersion.updateMessage in Accept-Language; maintenance present only while maintenance mode is on.
POST /me/devices { token, platform: android|ios, appVersion, deviceName?, locale: fr|ar|en } → { id } (DeviceToken; upsert on token; 21st device of a user ⇒ 422 DEVICE_LIMIT {max: 20})
DELETE /me/devices/:token → 204 (called on logout; unknown token ⇒ 204)
POST /credits/packs/iap/validate { platform: google_play|app_store, productId, transactionId, receipt?, purchaseToken? } → `IapValidateResult { status, creditsAdded, purchaseId, balance }` (§8.9; IAP_RECEIPT_INVALID / IAP_PRODUCT_UNKNOWN / IAP_STORE_UNAVAILABLE / 409 IAP_RECEIPT_ALREADY_USED)
GET /credit-packs?platform=google_play|app_store → [{ id, slug, credits, storeProductId }] (store product ids only, no web price)
GET /legal/pending → [{ key: terms|privacy|account_deletion|content_rules, version, url }] — shown at launch when non-empty (every protected call answers 403 LEGAL_REACCEPT_REQUIRED {document, version} until accepted)
POST /legal/accept { key, version } → 204
GET /workspaces → [{ id, name, logoUrl, role: owner|admin|operator, status: active|suspended|deletion_scheduled, planSlug }] (memberships of the current user; the picker in the app bar; `X-Workspace-Id` = the chosen id)
GET /feature-flags?platform=mobile → { [key]: boolean } (evaluated for the current workspace)
GET /status (incident banner inside the app) · GET /help/articles (WebView content) · POST /support/tickets (native form with photo)
```

Deep links: `djaber://` + the web path of every `NotificationType`, listed once in 03 §15; unknown object ⇒ "introuvable"; other workspace ⇒ switch if member else 403. Mobile uses the same JWT/refresh contract (secure storage, refresh token in the body), `X-Workspace-Id`, `X-App-Platform` / `X-App-Version` headers, `Idempotency-Key` on every creating POST, and the same error codes (11 §10); `503 MAINTENANCE_MODE` ⇒ retry after 60 s.

## 12. Public pages `[FIG 13 Public pages]`

```
GET /plans (public; isActive ∧ isVisible; monthly/yearly prices; "Essai gratuit 14 jours") · GET /credit-packs (public)
GET /cms/:slug?lang (legal/help/page; 404 when unpublished; `fallback: fr` flag when locale missing) · GET /cms/preview/:signedToken (admin preview, 24 h)   (help search = GET /help/articles, §8.4)
GET /status (public JSON: components[{key, status, uptime90d}], incidents[], banner) · POST /status/subscribe { email, locale } · GET /status/unsubscribe/:token
POST /account-deletion/request { email } → always 200 ("si un compte existe…"), 3/h/IP · GET /account-deletion/confirm/:token · POST /account-deletion/confirm/:token { exportData? } → { scheduledAt } · POST /account-deletion/cancel/:token
GET /data-deletion/:code → { status: pending|done|not_found, requestedAt, completedAt? } (DataDeletionRequest; the Meta data-deletion status URL returned by POST /webhooks/meta/data-deletion, MSG-08)
GET /track/:publicToken (public, no auth) → parcel status page { orderNumber, status, events[], courierName, workspaceName } (web route `/s/[code]`)   `[FIG DLV-06 QR]`
POST /track/:publicToken/report (public "Signaler ce vendeur" on the tracking page: { reason: ReportReason, details?, email? } → Report { reporterKind=end_customer, type=merchant, targetWorkspaceId }; ABUSE_REPORT_RATE_LIMITED 3/h/IP; `POST /safety/reports` stays the authenticated merchant route of §8.3)
GET /agent-test/:token (shared playground; AGENT_TEST_LINK_EXPIRED after 24 h) → { agentName, avatarUrl, expiresAt } + POST /agent-test/:token/messages { text } → { reply, cards[] } (web route `/agent-test/[token]`, rate limit 60/h per token)
```
