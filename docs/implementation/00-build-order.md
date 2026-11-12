# 00 — Build order (milestones M0 → M12)

Implementation pack for Djaber v2. Sources: `docs/specs/*` (IDs cited as `03 CHN-01`, `04 §1.2`, `FL-08`…), Figma page "Web V2" (id `898:24126`; frame names cited verbatim, see `docs/figma-coverage-matrix.md`), mobile Figma pages "Mobile V2" (base FR) + "Screens" (AR/EN) per `docs/specs/14-mobile-app.md`, decisions D1–D78 (`docs/specs/README.md`, closed 2026-10-11 in `docs/audit/decisions-log-2026-10-11.md`).

Ownership of this folder: everything except `prisma-schema.prisma` and `api-contract.md` (written by another agent). Where this pack and those two files disagree, the Prisma schema / API contract win for names; this pack wins for sequencing and behaviour.

Conventions used in this pack:
- **(decided)** marks a technical choice that is not forced by specs/Figma; it is settled here and is not re-opened by the coder.
- Phase letters P0–P3 are the spec phases (01 §5); milestones below are finer-grained and strictly ordered by dependency.
- "Exit criteria" are demo-able on staging; "tests" reference 13 AT-ids.

---

## 0. Reconciliation with `prisma-schema.prisma` and `api-contract.md` (read first)

Those two files are owned by another agent and their names win. Wherever this pack (files 01–09) uses the left-hand name, the coder uses the right-hand one. No other file in this pack needs to be re-read for this; apply the table.

| Pack wording | Use instead (schema / contract) |
|---|---|
| Payment gateway (prose "PSP", Figma name of the former gateway on return pages) | **Chargily Pay is the only gateway; `PAYMENT_PROVIDER=chargily`** (`ChargilyGateway` is the only `PaymentGateway` implementation, D4/R-N). Chargily exposes the CIB / Edahabia rails; `BillingProvider ∈ none|chargily|manual`, `BillingPaymentProvider ∈ chargily|manual|google_play|app_store`, `PaymentMethodBilling ∈ cib|edahabia|manual_transfer|manual_ccp|manual_cash|google_play|app_store`. Every Figma text naming another gateway is rendered as "Chargily (CIB / Edahabia)" (`docs/audit/figma-text-fixes.md`). |
| `NotificationType` dotted (`order.ai_created`) | enum values are snake_case (`order_ai_created`, `conversation_handoff`, `shipment_failed`, `credits_80`, `job_finished`, …); the dotted slug is only the i18n key suffix (`notification.<slug>.title`) and the deep-link label; conversion `slug = value.replaceAll('_', '.')` with the exceptions fixed by `03-events-and-jobs.md` §5.1 (`order_ai_created` → `order.ai_created`, `conversation_needs_human_message` → `conversation.needs_human_message`, `account_deletion_confirmed` → `account.deletion_confirmed`, …). Final slugs: `order.callback_due` (enum `order_callback_due`), `shipment.failed` with `data.reason='courier_unavailable'` when the courier was unreachable, `legal.reacceptance_required`, `account.deletion_confirmed` (e-mail only), `channel.approved`, `conversation.handoff`, `credits.exhausted`, `subscription.expiring`, `subscription.expired`, `channel.needs_reconnect`, `ai.error`, `member.joined`. The enum has 56 values; every value has exactly one row in `03-events-and-jobs.md` §5.1 with its producer. |
| Order reminder (Figma « Programmer un rappel ») | `Order.callbackAt` + `ConfirmationStatus.callback` + `OrderCall.callbackAt`/`CallResult.callback`; endpoints `POST /orders/:id/callback { at, note?, notifyCustomer? }`, `DELETE /orders/:id/callback`; `sched-order-reminders` reads `Order.callbackAt <= now AND confirmationStatus='callback'` and emits `order_callback_due` with idempotency key `cb:<orderId>:<callbackAt>`. No reminder model, no reminder service. |
| `Channel.status` values | `ChannelStatus ∈ active|paused|pending_review|needs_reconnect|disabled|disconnected` (`disabled` = manual pause from the card; `paused` + `pausedReason ∈ plan|moderation`; `PausedReason ∈ manual|plan|moderation`). i18n key `enum.Channel.status.pending_review`. |
| `confirmationStatus` pills | `ConfirmationStatus ∈ pending|no_answer|confirmed|rejected|wrong_number|callback`; `FAUX NUMÉRO` = `wrong_number` (auto-cancel with `CancelReason.fake`); `RAPPEL 16:00` = `callback` + `callbackAt`. `CancelReason ∈ unreachable|changed_mind|fake|unavailable|duplicate|other`. |
| `StockMovement.type adjustment` | `MovementType ∈ in|out|adjustment_in|adjustment_out|inventory|return` + `MovementReason` enum (`order_created`, `order_cancelled`, `inventory`, `archive`, …) + `MovementRefType`. i18n keys `enum.StockMovement.type.adjustment_in/adjustment_out`. |
| `Shipment.status` | includes `picked_up`; fields `weightKg` (Decimal), `contentSummary`, `publicTrackingToken`, `deliveryAttempts`, `courierCost`. |
| Cash day close (Figma `CASH_DAY_CLOSED`) | `CashClosing(day, theoreticalBalance, countedBalance, difference, note, closedById, closedAt, reopenedById, reopenedAt)` `@@unique([workspaceId, day])`; endpoints `POST /cash/close { day, countedBalance, note? }`, `POST /cash/days/:day/reopen` (Admin+, audited), `GET /cash/days`; `CashCategory` adds `deposit|withdrawal|correction|refund`; `CashSourceType ∈ order|sale|purchase|payment_entry|closing`. |
| Order "record payment" | creates `PaymentEntry(sourceType ∈ order|sale|purchase, sourceId, amount, method, reference, note, cashTransactionId)`; `POST /orders/:id/payments` per contract. |
| `allowedActions` | contract: `actions: ActionDescriptor[] = { key, enabled, reasonCode?, primary?, shortcut? }` on `GET …/:id` and list rows. |
| Admin WS room `platform:admin` | `admin:platform`; admin events `health.updated`, `moderation.queue`, `reports.queue`, `tickets.queue` (contract §5). |
| JWT claims `wsId`, `platformRole` | `{ sub, wid?, role?, pr, imp?, iat, exp }`. |
| Missing `X-Workspace-Id` ⇒ oldest membership | ⇒ owned workspace, else `User.lastWorkspaceId`, else `400 WORKSPACE_REQUIRED`. `Workspace.status='deletion_scheduled'` ⇒ every mutation `409 WORKSPACE_DELETION_SCHEDULED { at }`. `Workspace.status='suspended'` ⇒ `403 WORKSPACE_SUSPENDED` (the suspended test is `Workspace.status='suspended'`, nothing else). |
| Impersonation | **Read-only only (D21-bis, R-F).** `ImpersonationSession(adminUserId, workspaceId, reason ≥ 10 chars, ticketId?, startedAt, expiresAt = startedAt + 30 min, endedAt?, actionsCount)` — no mode column, no owner notification. Roles `super_admin`, `support`. Header `X-Impersonation-Session: <token>`; every non-GET request under it ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`; expired ⇒ `401 ADMIN_IMPERSONATION_EXPIRED`. Endpoints `GET|POST /admin/impersonation/sessions` (`{ workspaceId, reason, ticketId? } → { data: { sessionId, token, expiresAt } }`), `DELETE /admin/impersonation/sessions/:id`. Audit `impersonation.start` / `impersonation.action` (every request) / `impersonation.stop`. Banner "Vous agissez en tant que {workspace} · lecture seule · {mm} min · Quitter". |
| Cursor list envelope | `{ data, meta:{ nextCursor, hasMore } }`; bulk `{ data:{ results }, meta:{ ok, failed } }`; job `202 { data:{ jobId } }`. |
| Idempotency required routes (06 §1 list) | the longer list in contract §1.7 (adds `/orders/:id/payments`, `/orders/:id/status`, `/orders/bulk/*`, sales/purchases payments & receive, `/stock/adjustments`, `/inventories/:id/validate`, `/cash`, `/cash/close`, pack/IAP checkout, `/orders/import/:jobId/commit`). |
| `AiRoute.capability voice` | `AiCapability ∈ text|vision|transcription|embeddings`; fields `creditCost`, `timeoutSec` (default 20), `errorThresholdPct`, `failoverActive`, `failoverSince`. |
| Agent fields `maxOrderAmount`, `riskyClientPolicy`, `handoffKeywords[]`, `policies {…}`, per-agent handoff / out-of-hours texts | `maxQtyPerOrder`, `maxAmountPerOrder`, `riskyClientBehavior ∈ take_and_flag|handoff`, `recapMode ∈ always|when_unsure`, `catalogScope ∈ all|categories` + `scopeCategoryIds[]`, `outOfStockBehavior ∈ say_unavailable|suggest_alternative`, `showMissingVariants`, `policies Json`, `capabilities Json`, `orderFields Json`, `handoffRules Json`, `handoffKeywords[]`, `businessHours Json`, `languages[]`, `tone`, `formality`, `emojiLevel`, `status ∈ draft|active|paused`, `wizardStep`, `currentVersion`. The handoff and out-of-hours texts are NOT agent columns: they are the workspace system messages `handoff` and `out_of_hours` (`Workspace.systemMessages`, 4 keys `handoff|out_of_hours|out_of_stock|welcome` × `fr|ar|en`, R-G). The structured columns are compiled server-side at every save into `customInstructions` and `humanHandoffRules`; `modelId` is assigned by `AiRoute` routing, never chosen by the merchant (R-H). |
| Credit ledger `period_open` row | `CreditAction ∈ text_reply|image_recognition|voice_transcription|reserve|release|renewal|pack_purchase|grant|store_refund|adjustment`, `CreditKind ∈ reserved|debit|release|credit`, `bucket ∈ plan|pack`, `balanceAfter` stored on every row. Period opening = `action='renewal', kind='credit', bucket='plan'`. |
| Playground scenarios | `TestScenarioKey ∈ darija_price|arabizi_delivery|photo|voice|off_catalog|anger|qty_limit|refund` (8); stored in `AgentTestRun` / `AiRunKind.test_scenario`. |
| SKU registry table | no table. One partial unique index `(workspaceId, sku) WHERE deletedAt IS NULL` on `Product` and one on `ProductVariant`, both created by a raw SQL migration; `ProductService`/`VariantService` additionally check the other table inside the same transaction (`SELECT … FOR SHARE`) so a SKU is unique across products and variants of a workspace; Prisma `P2002` and the cross-table hit both map to `409 PRODUCT_SKU_ALREADY_EXISTS`. Archive keeps `deletedAt` set (index ignores the row); restore re-checks and raises the same code. |
| `PlatformSetting.flags` JSON | `FeatureFlag` + `FeatureFlagOverride` models; `AppVersion`, `LegalDocument`, `LegalAcceptance`, `MetaPermission`, `PlatformProvider`, `Incident` + `IncidentUpdate`, `StatusSubscriber`, `PlatformSettingVersion` models exist — use them. |
| `CmsPage` | `CmsEntry` + `CmsEntryLocale` + `CmsEntryVersion` (`CmsType`, `CmsStatus`, `CmsLocaleStatus`). |
| Redis rates cache | `CourierRateCache` model (1 h TTL by `fetchedAt`); stop-desks in `CourierStopdesk`. |
| `Outbox` unique `(topic, key)` | exists: `@@unique([topic, key])` on `Outbox`; `OutboxService.enqueue` inserts with `ON CONFLICT (topic, key) DO NOTHING` inside the caller's transaction. |
| `SubscriptionStatus` / `DunningStage` | `SubscriptionStatus ∈ trial|active|dunning|expired|cancelled` (no `suspended`, no `past_due`); `DunningStage ∈ d_minus_7|d0|d_plus_3|expired`; `Invoice.kind ∈ subscription|credit_pack|manual`, `Invoice.status ∈ upcoming|unpaid|paid|void|refunded`. Non-payment never suspends: J+7 ⇒ `status=expired` + free plan (02 §5). "Suspended" is only `Workspace.status='suspended'`, set by an admin (ADM-02, `SuspendReason ∈ fraud|unpaid|content|owner_request|other`). |
| `CustomerBlock`, `PlatformBlacklist`, `BlockedWord`, `Report`, `SupportTicket`/`SupportMessage`/`CannedReply`, `ModerationItem`/`ModerationAppeal`/`ModerationRule`, `AccountDeletionRequest`, `DataDeletionRequest`, `SavedView`, `AgentTestRun`/`AgentTestLink`, `StockRecommendation` (+`Mute`), `InventoryCount`/`InventoryCountLine`, `CreditPack`/`CreditPackPurchase`/`PromoCode`/`PromoRedemption`, `PlanVersion`, `AgentPresetVersion`, `ChannelEvent` | all exist with these names; the pack's prose names map 1:1. |

---

## 1. Milestone map

| M | Name | Spec phase | Depends on | Figma sections |
|---|---|---|---|---|
| M0 | Foundation: monorepo, DB, queues, error contract, design system shell | P0 | — | 00 Reference, 09 Global states |
| M1 | Auth, account, tenancy, roles, members, onboarding skeleton | P0 | M0 | 08 Auth & Onboarding, 07 Settings (profile/security/members) |
| M2 | Catalogue (GDS core): products, images, variants, categories, units, stock adjustments, import/export, services | P1 | M1 | 04 GDS (CAT-*), 14 DLG GDS |
| M3 | Channels & Meta intake: OAuth, webhooks, conversations/messages, inbox (real-time), quick replies, system messages | P1 | M1 | 05 Channels, 02 Inbox & Queue, 14 DLG Inbox / Agents & channels (connect flow) |
| M4 | AI pipeline + agents: wizard, presets, prompt assembly, tools, runs, credits, playground, insights, generate-from-page, page analysis | P1 | M2, M3 | 05 Agents, 14 DLG Agents |
| M5 | Clients, orders, COD, confirmation calls, fee grid, order print, home | P1 | M2 (M4 for AI orders) | 03 Orders/Clients, 01 Shell & Home, 14 DLG Orders I/II |
| M6 | Delivery: couriers, shipments, tracking, labels, delivery overview | P2 | M5 | 03 Delivery (DLV-*), 11 Mechanics delivery |
| M7 | GDS operations: suppliers, purchases, sales, cash register, movements, expenses, recommendations, inventory | P2 | M5 | 04 GDS (GDS-*), 14 DLG GDS I/II |
| M8 | Analytics + reports (23) + exports | P2 | M5, M6, M7 | 06 Analytics & Reports |
| M9 | Billing: plans, subscriptions, Chargily checkout, invoices, credits ledger, credit packs, promo codes, IAP receipt validation, dunning | P1 core / P2 packs | M1 (limits), M4 (credits) | 07 Billing, 14 DLG Settings & billing, 12 ADM-15 |
| M10 | Platform admin: overview, workspaces/users, plans/subscriptions, AI providers, presets, CMS, audit, jobs & health, platform settings, moderation, abuse reports, support, roles, deletion requests, viewers | P2 | M4, M9 | 12 Platform admin, 14 DLG Platform admin |
| M11 | Public pages + integrations: landing/pricing/help/legal/status/account-deletion, API keys, outbound webhooks, Google Sheets, order payment links | P2 | M5, M9 | 13 Public pages, 07 SET Integrations |
| M12 | Mobile (Flutter) app MM1 → MM5 against the stable P1 API; API side: OpenAPI → Dart client, app-link return endpoints, list ETags | P3 | M9, M10 (API) · M5 API freeze (Flutter start) | Figma "Mobile V2" (base FR) + "Screens" (AR/EN), `14-mobile-app.md`; ADM-13 app versions |

Cross-cutting tracks that run in every milestone: i18n keys (06), WebSocket events (03-events), BullMQ jobs (03-events), audit (07-non-functional), tests (13), Figma states (12).

---

## 2. Milestones in detail

### M0 — Foundation

**Scope**
- Turborepo + pnpm: `apps/api`, `apps/worker`, `apps/web`, `packages/db`, `packages/shared`, `packages/ui` (07 §2).
- Postgres 16 + Prisma (`prisma migrate` only — 09 §1), Redis 7, BullMQ, Socket.IO + Redis adapter, S3-compatible storage, Pino, Sentry, `/health`.
- `packages/shared`: error codes (11), Zod validators (04 §2: name, phone DZ, wilaya, commune, address, email, price, qty, SKU), enums (every Postgres enum of 05), i18n key list.
- NestJS skeleton per `01-nest-module-map.md`: `AppExceptionFilter` (error envelope 06 §1), `TenantGuard` (`X-Workspace-Id`), `RequirePermission`, `IdempotencyInterceptor`, `AuditInterceptor`, throttler, config schema, feature flags.
- Seeds: 69 wilayas, communes (official list), 7 system units, 4 agent presets, 4 quick replies × 3 locales, default fee table, system messages defaults (4 keys `handoff|out_of_hours|out_of_stock|welcome` × fr/ar/en, 11 §9), plans `free|starter|pro` + packs `pack-500|pack-2000|pack-6000` (R-O values), `AppVersion` rows for `android` and `ios`.
- Mobile-facing endpoints exposed from M0 (14 §6): `GET /app/version?platform&version` (public, reads `AppVersion`), `POST /me/devices { token, platform, appVersion, deviceName?, locale }` (≤ 20, 422 `DEVICE_LIMIT`), `DELETE /me/devices/:token`, `GET /workspaces`.
- Next.js shell: `packages/ui` primitives restyled (08 §1 tokens), merchant shell (sidebar/top bar), GLOBAL states (skeleton, empty, filtered-empty, error, offline, 403, 404, session expired), toast/banner stack, dialog primitive, `next-intl` fr/ar/en with RTL (logical properties, Changa for AR), CI i18n missing-key check.
- CI: lint, typecheck, unit (Vitest), integration (Jest + embedded Postgres / redis-memory-server, per root `CLAUDE.md`), e2e (Playwright) skeleton, `prisma migrate deploy`, docker images (api, worker, web).

**Figma frames**: `REF — Component sheet (status pills per enum, patterns)`, `GLOBAL — States, toasts, banners & system dialogs catalogue`, `GLOBAL — 404`, `GLOBAL — Offline`, `RESP — Responsive — 1024 icon sidebar · 390 mobile web · simple-mode sidebar`.

**Spec sections**: 07 §1–§3, §6; 06 §1; 11; 12 §0; 05 conventions.

**Exit criteria**: `pnpm infra:up && pnpm dev` (no Docker locally — see root `CLAUDE.md` "Prerequisites") gives API `/health` 200, worker connected, web renders the shell with all GLOBAL states in Storybook; cross-workspace 404 integration test harness runs (table-driven, AT-AUTH-11 scaffold); error envelope snapshot test passes for every code in 11.

**Risks**: design-token drift between Figma variables and `packages/ui` (mitigate: copy `docs/implementation/design-tokens.css` — already exported from the Figma variables and text styles — to `packages/ui/src/tokens.css`; never hand-edit values); RTL regressions (mitigate: AT-UX-02 snapshots from M0).

---

### M1 — Auth, tenancy, members, onboarding skeleton

**Scope**: AUTH-01…09 (register, login, refresh rotation + reuse detection, forgot/reset page, verify e-mail + day-7 reminder, TOTP 2FA with `mfaToken`, profile, e-mail change, delete account, rate limits), D30 ownership rules + ownership transfer `POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }` (Owner only, target must be an Admin member, R-I), `POST /workspaces` for invited-only users, `GET /workspaces` (switcher), legal re-acceptance `GET /legal/pending` + `POST /legal/accept { key, version }`, memberships/invitations (FL-13, `GET /invitations/:token`), workspace settings (SET: profile, logo, language, stock mode, quick replies, system messages, auto-pause, handoff reminder, free-delivery threshold), danger zone (FL-14 soft delete + 30-day purge job), onboarding tunnel ONB-01 (`Workspace.onboardingStep`), Get Started checklist ONB-02 (computed from real entities — steps for channel/agent/order are stubs returning false until M3/M4/M5), workspace switcher (> 1 membership), user menu, language switch.

**Figma frames**: `AUTH — Login — default`, `AUTH — Login — 2FA step`, `AUTH — Sign up — field errors`, `AUTH — Reset password — expired`, `AUTH — Verify e-mail — done + reminder`, `AUTH — Accept invitation — logged out`, `AUTH — States catalogue (…)`, `ONB-01 — Onboarding — step 1…6`, `SET — Settings — Profile · Workspace · Security`, `SET — Settings — Members & invitations`, `SET — Settings — Quick replies · System messages · Notifications · Stock mode · Danger zone`, `DLG — Settings & billing — dialogs catalogue` (2FA, password, e-mail change, delete account, logo, quick reply, system message reset, delete workspace, invite member, language), `PUB — Public account deletion page`.

**Spec sections**: 03 §1, §2, §20; 02 §1–§4; 04 §9 (member/workspace rows); 05 §1; 06 Auth/Workspace; FL-04, FL-13, FL-14; 11 §2.

**Exit criteria**: AT-AUTH-01…12, AT-ONB-01/02, AT-SET-01 (quick replies + system messages part), AT-UX-02 (RTL shell). Login → empty dashboard FR/AR/EN on staging (P0 exit). Meta App Review submission prepared (privacy/terms/data-deletion pages from M11 may be published early as static CMS seeds — do it here, see §5 "pulled-forward items").

**Risks**: refresh-cookie across `api.` / `app.` subdomains (decided: `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` cookie on the API origin, web fetches with `credentials: 'include'`; mobile sends the refresh token in the body; web and API on two different sites — the live Vercel + VPS split — set `REFRESH_COOKIE_CROSS_SITE=true` ⇒ `SameSite=None; Secure; Partitioned`, specs 07 §6 / §12); TOTP clock drift (decided: accept ±1 step, 30 s).

---

### M2 — Catalogue (GDS core)

**Scope**: CAT-01…11 (product CRUD with shared validation, images with re-encode/thumbnails/AI caption hook, variants, categories/units with reassign-on-delete, stock adjustments → movements, low-stock evaluation per product and variant, import preview → commit job, export job, from-photo (AI call stubbed until M4 then wired), archive/restore with SKU re-check, services list), stock dashboard GDS-01 (simple/advanced), movements GDS-02, product expenses & margins GDS-09 (advanced mode, P2 — build the model now, UI in M7), moderation model hooks (D36: `ModerationItem` row created on create/update; auto-approve path only until M10 adds the admin queue), plan limit `maxProducts` (02 §5) once M9 plan table exists — until then read from seeded free plan.

**Figma frames**: `CAT-08 — Products — list (advanced)`, `CAT-01 — Product form — edit with variants`, `CAT-09 — Product page — full (…)`, `CAT-04 — Categories & units — list + edit sheet + reassign dialog`, `CAT-06 — Import wizard — preview with row errors`, `CAT-11 / GDS-06b — Services list · …`, `GDS-01 — Stock dashboard (advanced) + adjust dialog`, `GDS-05 — Movements — list + filter panel`, `CAT-08 — Products — bulk bar + row actions menu`, `CAT-08 — Products — filter panel open`, `CAT-01 — Product — quick edit sheet + relations`, `CAT-01 — Product form — AR (RTL)`, `DLG — GDS (stock) — dialogs catalogue`, `DLG — GDS (stock) II — dialogs & inline states catalogue`, `MOD — Merchant side — product moderation states`, `MOD — Product — rejected view + appeal dialog`.

**Spec sections**: 03 §8, §14 (GDS-01…04, 09); 04 §2, §3 (adjustment row), §9; 05 §5; 06 Catalogue; FL-12; 11 §5.

**Exit criteria**: AT-CAT-01…13; import of a 2 000-row file previews in < 5 s and commits atomically; products list p95 < 500 ms on 10 k products (07-non-functional §3).

**Risks**: SKU uniqueness across products and variants (decided, §0 "SKU registry table": partial unique index `(workspaceId, sku) WHERE deletedAt IS NULL` on `Product` and on `ProductVariant` via raw SQL migration, cross-table check in the same transaction, `P2002` ⇒ `409 PRODUCT_SKU_ALREADY_EXISTS`; restore re-checks and raises the same code); image re-encoding CPU in the API process (decided: `media.reencode-image` job in the worker, UI shows "ENVOI…" per image until WS `product.updated`).

---

### M3 — Channels, Meta intake, inbox

**Scope**: CHN-01…12 (FB OAuth with signed state, per-page connect report, linked IG child channel, IG Business Login, token encryption, 190 → `needs_reconnect`, pause/resume/disconnect, page overview + insights, sync history ≤ 25 × 25, token refresh job, App Review status endpoint), MSG-01…09 (signature-verified webhook, raw `InboundEvent`, `meta-inbound` queue, dedup, find-or-create conversation/client identity, attachment download to S3 via `media` queue, batching window job, outbound rules incl. 24 h window & tags, product card sends, data-deletion callback, retention purge), INB-01…09 (3-pane inbox, tabs with server counts, thread with every message type, composer, quick replies, pause/resume AI, resolve/reopen/archive, assign, notes, client panel, soft delete), WebSocket gateway (06 §6) + polling fallback, notification producers for `conversation.*`, `channel.*`, block/report customer (D37 merchant side: `CustomerBlock`, `Report` creation; admin handling in M10).

**Figma frames**: `CHN-06 — Channels — list with statuses`, `CHN-07 — Channel page — overview`, `CHN-07b — Channel page — Messages · AI settings · History tabs`, `INB — Inbox — thread with handoff`, `INB — Inbox — AR (RTL)`, `INB — Inbox — filter sheet + conversation menu`, `QUEUE — File d'attente — items`, `DLG — Inbox & queue — popovers, message types, banners, composer states`, `DLG — Agents & channels — dialogs, connect flow & generate-from-page` (disconnect, resume swap at limit, OAuth outcomes, per-page report, connect explainer, sync history), `SAFE — Trust & safety (merchant)`, `MECH — Agents filters + row menu · Channels row actions`, `PUB — Legal (CMS) · Landing & help · Meta data-deletion status` (data-deletion status page only).

**Spec sections**: 03 §3, §4, §5; 04 §5 (statuses, new-message rules, 24 h), §9 (conversation/channel rows); 05 §3; 06 Channels/Conversations/§3/§6; FL-01 steps 1–5 + F-7, FL-03 steps 2–6, FL-05, FL-06; 11 §3; 07 §7.

**Exit criteria**: AT-CHN-01…12, AT-MSG-01…09, AT-INB-01…13; a real FB page and IG account receive messages into the inbox and a human can reply (no AI yet); webhook ack p99 < 200 ms under 1 000-message burst (k6).

**Risks**: Meta App Review timing (mitigate: dev-mode test users for all AT-CHN; `GET /channels/app-review-status` drives "approval pending" UI); Instagram outside-window sends (design: never attempted, `skipped_window`); socket scale-out (Redis adapter from day one).

---

### M4 — AI pipeline and agents

**Scope**: AGT-01…09 (list, presets, 5-step wizard per Figma — identity, knowledge (catalogue scope, policies, FAQ, extraction), behaviour (capabilities, order-taking fields, limits, handoff rules), channels (move dialog), test & activate), agent versions (AGT-03 Figma: `AgentVersion` with restore), insights queue, generate-from-page job, playground dry-run (60 turns/h), metrics; AI-01…14 per `04-ai-pipeline.md` (prompt assembly, structured output, tool schemas, 2-pass vision, transcription with fallback, handoff, idempotent `AiRun`/`AiToolCall`, provider routing + fallback, credit reservation/settlement, blocked words, abuse guard); page analysis job CHN-08; product AI caption at upload (CAT-02) and "create from photo" (CAT-07) wired; credits ledger + header pill (reads `monthlyCredits` of the seeded free plan until M9).

**Figma frames**: `AGT-01 — Agents — list`, `AGT-02 — Agent wizard — step 1…5`, `AGT-03 — Agent page — overview (tabs, versions, rollback)`, `AGT-04 — Agent page — Configuration tab`, `AGT-07 — Agent playground — dry run with tool calls`, `AGT-08 — Agent page — Insights queue tab`, `CHN-08 — Channel page — analysis review (import)`, `DLG — Agents & channels — …` (delete, pause, resolve insight, model unavailable, generate-from-page flow), `GLOBAL — Credits exhausted — thread state (Inbox)`.

**Spec sections**: 03 §6, §7, CHN-08; 04 §5; 02 §6; 05 §4; 06 Agents & AI; FL-01 steps 6–15 + F-1…F-9, FL-02, FL-03 step 1, FL-15; 11 §4; 07 §3 core flow.

**Exit criteria**: AT-AI-01…19, AT-AGT-01…08, AT-BIL-03 (reservation), AT-CHN-10; FL-01…FL-03 end to end on a staging page with COD order creation (needs M5 orders — M4 and M5 overlap; the `create_order` tool is built in M5 and the eval suite runs after both). AI p95 generation < 5 s on fixtures.

**Risks**: provider rate limits (fallback routing + `ai-reply` concurrency cap per workspace); prompt size with ≤ 60 products in context (measure tokens; D34 threshold tunable via feature flag); evals require fixture corpus (darija/arabizi) — start collecting from V1 anonymised data in M3.

---

### M5 — Clients, orders, COD, fee grid, home

**Scope**: CLI-01…05 (normalised phone, merge rule, paginated list + filters, soft delete, export, risk level ORD-12), ORD-01…12 (numbering with legacy, manual create, status machine 04 §1.2 + D14, calls 04 §1.3, payment 04 §1.4, `OrderEffects` 04 §3, list with KPIs/tabs/filters/bulk/export/print, order page, confirm dialog, cancel/return/delete, optimistic `version`, callback reminder (Figma "Programmer un rappel" — `Order.callbackAt` + `ConfirmationStatus.callback`, `POST|DELETE /orders/:id/callback`, notification `order.callback_due`), delivery address edit (`POST /orders/:id/address`), record payment, tags, assign), DLV-01/02/09 (fee grid seed/fill/reset, free-delivery rule, quote endpoint, geo endpoints), `create_order`/`cancel_order`/`get_order_status`/`get_shipping_fee` tools wired into M4, Home ANA-01 (queue, KPIs, quick actions, my pages, Get Started, banners), notifications module NTF-01…03 (list with filter by every type, unread count, preferences, FCM device tokens; producers for `order.*`, `stock.*`), A5 order slip PDF, Sheets/webhook outbox hooks (consumers in M11).

**Figma frames**: `ORD-05 v2 — Orders — list (…)`, `ORD-05 v2 — Orders — list — AR (RTL)`, `ORD-06 — Order page — new`, `ORD-07 — Confirm order dialog — outcome step`, `ORD-02 — New order — form (…)`, `ORD-02 — New order — form — AR (RTL)`, `ORD-05 — Orders — filter panel open`, `ORD-05 — Orders — row actions menu + bulk results dialog`, `CLI-03 — Clients — list with detail sheet`, `CLI-03 — Clients — filter panel + row menu`, `DLV-01/03 — Delivery — fee grid + couriers settings` (fee grid half), `DLV-06 / ORD-09 — Labels viewer (…) + order print preview A5` (A5 half), `ANA-01 — Home — default`, `ANA-01 — Home — new workspace + banners`, `ANA-01 — Home — AR (RTL)`, `ANA-01b — Home & Notifications — states catalogue`, `NTF-01 — Notifications — list`, `DLG — Orders & delivery — dialogs catalogue`, `DLG — Orders, delivery & clients II — dialogs catalogue` (record payment, delete order, conflict 409, fees actions, new client, delete client, tags).

**Spec sections**: 03 §9, §10, §11 (DLV-01/02/09), §12 PAY-01, §15, §16 ANA-01/03; 04 §1–§4, §8, §10, §11; 05 §6, §7 (Order…Commune, DeliveryFeeRule); 06 Clients/Orders/Delivery(fees, geo)/Notifications; FL-02 step 7–8, FL-07; 11 §6; 08 §6 Orders/Clients rows.

**Exit criteria**: AT-CLI-01…05, AT-ORD-01…22, AT-DLV-09/10, AT-NTF-01…05, AT-ANA-01, AT-DAT-01, AT-UX-01/03/04/05 for these screens; P1 exit: real FB + IG page answer customers and create COD orders end to end (FL-01…07 ACs pass).

**Risks**: status-matrix and effects duplication (one `OrderEffects` service, controllers never touch stock/cash — 04 §3); Figma extra statuses on pills (`RAPPEL`, `FAUX NUMÉRO`) map to `confirmationStatus` (`callback` + `Order.callbackAt`, `wrong_number` + `CancelReason.fake`), not new enum values (see `06-i18n-copy-deck.md` §4 mapping).

---

### M6 — Delivery & couriers

**Scope**: DLV-03…08, 10, 11 (courier accounts with per-provider required fields + encrypted credentials + test, `CourierAdapter` for ZR Express, EcoTrack, Yalidine (+ `manual`), send single/bulk with queued retries, shipment states, tracking sync (webhook or polling cadence, per-account limiter), status mapping tables, labels + Djaber fallback + merged PDF job, delivery overview (failures, stale, returns), courier live rates + copy-to-grid, `CourierCommuneMap` seed, customer notifications at shipped/out_for_delivery/delivered/failed, Analytics › Delivery data source).

**Figma frames**: `DLV-01/03 — Delivery — fee grid + couriers settings` (couriers half), `DLV-05 — Delivery — send to courier dialog (validation error)`, `DLV-06 / ORD-09 — Labels viewer (single · merged job · Djaber fallback) …`, `DLV-08 — Delivery — overview + tracking panel`, `MECH — Delivery filters + row menu + bulk send results`, `DLG — Orders & delivery — dialogs catalogue` (marquer livrée manuellement, marquer retournée, imprimer bordereaux), `DLG — … II` (courier add/test, delete courier blocked, label unavailable, cancel parcel).

**Spec sections**: 03 §11; 04 §1.5, §3 (returned row), §9 (order delete with active shipment); 05 §7 (CourierAccount, Shipment, ShipmentEvent, CourierCommuneMap); 06 Delivery/§3 courier webhook; FL-08; 11 §6; `05-integrations.md` §2.

**Exit criteria**: AT-DLV-01…08; contract tests with recorded payloads for the three providers; tracking sync of 10 k shipments in one batch run within limiter budget (k6/integration).

**Risks**: EcoTrack contract must be verified against live docs before build (03 DLV-10); ZR Express has no label API (fallback label is mandatory, not optional); Yalidine stop-desk IDs need the commune map seed.

---

### M7 — GDS operations

**Scope**: GDS-05…10 model + UI except reports (suppliers, purchases with receive/cancel/payments, sales with client link and partial payment, cash register with immutable auto rows and day close (Figma `CASH_DAY_CLOSED`), movements filters, product expenses & margins UI, inventory count (Figma "Lancer un inventaire" / "Valider l'inventaire" → `InventoryCount` + `INVENTAIRE` movements), REC-01…03 (rules, generation job, impressions/conversions, manual rules dialog), `SaleEffects` / `PurchaseEffects`.

**Figma frames**: `GDS-06 — Suppliers — list + detail sheet`, `GDS-07 — Purchases — list + receive dialog`, `GDS-08 — Sales (counter) — list + new sale with partial payment`, `GDS-09 — Cash register — ledger with locked automatic rows`, `GDS-10 — Recommendations — list + generate job + stats`, `CAT-11 / GDS-06b — … New purchase form · Purchase & sale detail`, `DLG — GDS (stock) — dialogs catalogue` (supplier, supplier payment, cancel sale, collect remaining, cash manual entry, start/validate inventory), `DLG — GDS (stock) II — …` (product expense, purchase locks, sale locks, cash locks, recommendation rule).

**Spec sections**: 03 §13, §14 (GDS-05…09); 04 §3 (sale/purchase rows), §4 money, §9, §10; 05 §5 (Recommendation*, ProductExpense), §8; 06 Recommendations/GDS operations; 11 §7.

**Exit criteria**: AT-ORD-10/11 (revenue + P&L inputs), AT-CLI-05 (sales aggregate), cash register period pills ↔ table in sync (09 §4 regression), recommendations job removes stale pairs (D18).

**Risks**: cash-register invariants (auto rows only via effects services); inventory count (D55): `InventoryCount` + `InventoryCountLine` (`InventoryScope ∈ all|category|alerts_only`, `InventoryStatus ∈ draft|counting|validated|cancelled`), endpoints `GET|POST /inventories`, `PUT /inventories/:id/lines`, `POST /inventories/:id/validate|cancel`; validation writes one `StockMovement` per line with delta ≠ 0, `type=inventory`, `reason=inventory`, `refType=inventory` (manual corrections elsewhere use `adjustment_in` / `adjustment_out`).

---

### M8 — Analytics & reports

**Scope**: ANA-02 overview + 8 tabs (`GET /analytics/overview` + `GET /analytics/{conversations|responses|consumption|agents|channels|products|orders|delivery}`, `compare=previous` on every tab) with period presets/custom ≤ 732 d (Africa/Algiers buckets, `REPORT_RANGE_TOO_LONG`), named money figures (04 §4), AI consumption from `AiRun` tokens × `AiModel` prices, ANA-03 reports hub + ANA-04 template with 23 V1 reports, XLSX/PDF export jobs (> 5 000 rows ⇒ job; `GET /jobs?kind&status`, `POST /jobs/:id/cancel|retry`), monthly scheduled report e-mail (`ReportSchedule`, feature `scheduled_reports`), report favourites (`PATCH /me/prefs { reportFavorites }`), comparison with previous period (Figma), wilaya choropleth.

**Figma frames**: `ANA-02 — Analytics — overview tab + period picker`, `ANA-02b — Analytics — tabs Conversations · IA · Agents · Canaux · Produits · Commandes · Livraison`, `ANA-03 — Reports — hub (23 reports) + export jobs`, `ANA-04 — Report — template (Ventes par produit) + large export banner`.

**Spec sections**: 03 §16 ANA-02, §14 GDS-10; 04 §4, §8; 06 Notifications/home/analytics, GDS `GET /reports`; 01 §3 KPIs; 11 §7 (report ranges).

**Exit criteria**: AT-ORD-10 identical figures across home/analytics/reports; AT-ORD-13 export job; every report renders [S]/[E]/data states; analytics endpoints p95 < 500 ms on 100 k orders with pre-aggregated daily rollups.

**Risks**: query cost (decided: the schema model `DailyStat(workspaceId, day, metrics Json, computedAt)` `@@unique([workspaceId, day])` is recomputed nightly by `sched-daily-stats` (never incremented) + live query for today merged in `AnalyticsService`; `GET /analytics/overview?from&to&compare=previous` + the 8 tab endpoints read it); PDF rendering of 23 report layouts (decided: one `report` HTML template + a per-report column map in `gds/reports/definitions.ts`); monthly scheduled report e-mails = `ReportSchedule(workspaceId, reportKey, email, dayOfMonth, createdById)` + `POST|DELETE /reports/:key/schedule { email, dayOfMonth }` (plan feature `scheduled_reports`, job `sched-report-schedules`).

---

### M9 — Billing, credits, packs, IAP

**Scope**: BIL-01…05 + 02 §5–§6 (plans page, Chargily checkout `POST /billing/checkout` + return page `GET /billing/checkout/return?ref` polling + webhook, invoices with PDF + `POST /billing/invoices/:id/pay → { checkoutUrl }`, cancel/downgrade at period end, upgrade immediate, trial end + expiry daily job applying the 02 §5 single rule, limit enforcement in every creating transaction, credit periods monthly, 80 %/100 % notifications), D40 credit packs (web via Chargily `POST /credits/packs/checkout { packId }`; mobile via store IAP `POST /credits/packs/iap/validate` + store server notifications `POST /webhooks/store/{google-play|app-store}`; pack credits never expire, consumed after plan credits; store refunds write `action=store_refund` rows ⇒ `credits.negative`), promo codes (Figma ADM-15 / DLG "Changer de plan": `PROMO_*` codes), manual payments (finance, `POST /admin/invoices/:id/mark-paid`), dunning per R-J (J−7 `subscription.expiring` → J0 `dunning` + `invoice.unpaid` → J+3 `invoice.unpaid` → J+7 `expired` ⇒ free plan; never a suspension), credit calculator, admin grant credits.

**Figma frames**: `BIL-01 — Settings — Plan & billing`, `BIL-04 / BIL-03 — Credits page (ledger) · Invoices · Checkout return`, `GLOBAL — Plan expired — free limits applied (Channels)`, `PUB — Pricing page (plans · FAQ · CTA)`, `DLG — Settings & billing — …` (change plan/cycle/downgrade/promo, credit calculator, checkout return states), `ADM-15 — Platform admin — credit packs & promo codes`.

**Spec sections**: 03 §17; 02 §5, §6; 05 §2; 06 Billing & credits; FL-09; 11 §8; `05-integrations.md` §4–§5.

**Exit criteria**: AT-BIL-01…07, AT-CHN-03, AT-AI-14/16; expiry job pauses excess resources and restores on renewal; IAP receipt validation sandbox tests for both stores.

**Risks**: gateway = Chargily only, behind `PaymentGateway` (§0). Store IAP requires published apps (M12 MM5) — build `POST /credits/packs/iap/validate` server side now, test with sandbox receipts.

---

### M10 — Platform admin & moderation & support

**Scope**: ADM-01…08 (overview KPIs, workspaces/users with filters + detail sheet + suspend + force-release channel + grant credits + create workspace for client + schedule deletion, plans editor with versions, subscriptions & invoices incl. manual payment, AI providers/models/routes + pricing calculator, agent presets with versions/locales, CMS per locale with scheduling, audit log + diff + signed export), Figma-added: ADM-10 moderation queue (D36), ADM-11 abuse reports + blocked words + platform blacklist (D37), ADM-12 support tickets + merchant HELP center (D38), ADM-13 platform settings (app versions/force update, feature flags, maintenance, legal doc versions + re-acceptance, Meta permissions, providers health, limits) (D39), ADM-14 jobs & health (BullMQ, DLQ, incidents, Meta webhook stats), ADM-16 platform roles (D41) + account deletion requests, ADM-17 read-only viewers + read-only impersonation (D21-bis: `ImpersonationSession` 30 min, roles `super_admin`/`support`, every non-GET ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`, audited), trust levels (R-L: `sched-trust-levels` + manual changes), admin shell.

**Figma frames**: `ADM-01` … `ADM-17` (17 frames), `DLG — Platform admin — dialogs catalogue`, `HELP — Help & support (merchant)`, `SAFE — Trust & safety (merchant)` (admin-side effects), `PUB — Public status page`.

**Spec sections**: 03 §19; 05 §9; 06 Platform admin + §8.11; 11 §8; `01-nest-module-map.md` §3.2 (platform keys `admin.<area>.read` / `admin.<area>.write`); D21-bis, D36–D42, D52.

**Exit criteria**: every admin list has [S]/[E]/[FE] + filters + detail; every sensitive action writes `AuditLog` with `reason`; role matrix enforced by `@RequirePlatformRole`; moderation SLA job raises `URGENT` after 2 business hours; AT-CHN-08 (release), AT-API-02-style replay from DLQ works.

**Risks**: scope creep — these are Figma-only features; keep each to the drawn frame. Impersonation is read-only (D21-bis) — no write mode is built.

---

### M11 — Public pages & integrations

**Scope**: public landing/features/pricing/help/legal CMS pages (server-rendered, locale fallback), status page (public incidents from M10), account deletion public page, Meta data-deletion status page; API-01…04 (keys with scopes, whitelist guard, Swagger, Postman export); outbound webhooks (endpoints, HMAC, retries, deliveries log, replay, auto-disable, re-enable); GSH-01…08 (Google OAuth, Picker/URL/create, column map, upsert by `djaber_id`, debounce, backfill job, health + `sheets.error`); PAY-02…04 order payment links + refunds (D4, P2) via `PaymentGateway`.

**Figma frames**: `PUB — Legal (CMS) · Landing & help · Meta data-deletion status`, `PUB — Pricing page`, `PUB — Public status page (status.djaber.ai)`, `PUB — Public account deletion page`, `SET — Settings — Integrations (Sheets · API keys · webhooks)`, `DLG — Settings & billing — …` (Sheets picker/backfill, webhook), `DLG — … II` (payment link P2, refund P2), `HELP — Help & support (merchant)` (help center part).

**Spec sections**: 03 §12 PAY-02…04, §18, §22, ADM-06 (CMS public); 06 §4, §5, Integrations; FL-10, FL-11; 11 §8.

**Exit criteria**: AT-API-01/02, AT-GSH-01, AT-BIL-01 (order payment variant), AT-MSG-07 (status URL page); Google OAuth verification submitted; Swagger published at `/api/docs`.

**Risks**: Google verification lead time (≤ 100 test users meanwhile); webhook consumer endpoints of merchants being slow (5 s timeout, async queue).

---

### M12 — Mobile app (Flutter, P3)

Reference: `docs/specs/14-mobile-app.md` (final, wins over 03 §21) and `docs/implementation/10-flutter-mobile.md` (stack, packages, folder layout). Mobile is phase P3 and starts after the P1 API is stable (M5 API freeze); it needs no backend change because the API already exposes the mobile-only endpoints: from M0 `GET /app/version`, `POST /me/devices`, `DELETE /me/devices/:token`, `GET /workspaces`; from M1 `GET /legal/pending`, `POST /legal/accept { key, version }`; from M9 `POST /credits/packs/iap/validate`; push payload contract in `03-events-and-jobs.md` §5.2.

**API-side scope (stream C, before MM1)**: OpenAPI → Dart client generation in CI (`packages/mobile_api`), app-link return endpoints for Meta OAuth / Google OAuth / invitation / e-mail verification (`djaber://oauth/return`, `djaber://invite?token=`, `djaber://verify?token=` + universal links; no checkout return on mobile — plan purchase is web-only, D73), `ETag` on list endpoints for the read-only cache (MOB-R04), `X-App-Platform` / `X-App-Version` headers read by the version gate (`426 APP_UPDATE_REQUIRED { minVersion, storeUrl, message }`), `503 MAINTENANCE_MODE` when `PlatformSetting.maintenance.enabled`.

**Flutter milestones** (each ends with the listed Figma sections of page "Mobile V2" implemented as drawn, AR/EN from page "Screens"):
- **MM1 — Shell & auth**: M01 (splash, onboarding, login + 2FA, sign-up, forgot, verify, invitation, workspace switcher), M02 tutorial, M11 system screens (version gate, maintenance, legal re-acceptance, offline, session expired, suspended, push pre-prompt, banner priority), biometrics (D76), device registration, deep-link router.
- **MM2 — Inbox & orders**: M03 home/menu/notifications, M04 channels (read + reconnect via system browser), M05 inbox (thread, composer, menu, report/block), M06 orders/delivery/clients incl. bottom-sheet row actions from `ActionDescriptor[]` (D77), call result, callback, cancel, COD delivered, bulk results, failures to handle.
- **MM3 — GDS**: M07 stock (products with moderation pills, product form + photo capture, create from photo, variants, adjustments, categories/units, suppliers, purchases, sales with barcode scan, movements, cash register + day close, inventory count, recommendations), CSV/XLSX product import via the system file picker (D29).
- **MM4 — Agents, analytics, settings**: M08 agent list, 5-step wizard, versions, insights, playground; M09 analytics overview + tabs + reports (share PDF of the visible report only); M10 settings menu, notifications, blocked customers, security (biometrics, password), delete account, credits balance/ledger, IAP pack purchase (D74), plan page read-only "Le changement de plan et le paiement se font sur le web" (D73), help centre / contact support / ticket thread; every web-only item shown as "Uniquement sur le web" (D72).
- **MM5 — Store release**: Play Console + App Store Connect listings, IAP product tiers matching `CreditPack.storeProductIds`, store review requirements (in-app account deletion MOB-R15, UGC reporting/blocking MOB-R13), `AppVersion` rows set in ADM-13, staged rollout.

**Figma frames**: page "Mobile V2" sections `M01`…`M11` (frames with prefix `V2 —` / `V2 CHANGED —`; `⛔ REMPLACÉ —` frames in `M99` are not implemented, D78); `ADM-13 — Platform admin — platform settings` (app versions) on page "Web V2".

**Spec sections**: 14 (all); 03 §21 (as refined by 14); 06 §11; 07 §5; D5, D29, D39, D40, D72–D78.

**Exit criteria**: Flutter integration suite green against staging for MM1–MM4; store review passes (account deletion in-app, UGC reporting/blocking, moderation evidence export); version gate verified with an `AppVersion.minVersion` bump on staging.

---

## 3. Definition of done — per screen

A screen (one Figma frame, or one route in `02-next-route-map.md`) is done when all of the following hold:

1. **States** — every state from `12-screen-states.md` §0 (global) and the screen's own row is implemented, and matches the GLOBAL catalogue patterns: list = skeleton (5 rows, 300 ms delay) → empty (icon + one line + one CTA) → filtered-empty ("Aucun résultat … Effacer les filtres") → error (message + ref + Retry) → offline (stale banner, mutations disabled) → loading more; form = saving (disabled + spinner, fields locked) → inline validation with summary + scroll to first error → 409 conflict dialog (Recharger / Écraser, draft kept) → leave guard; detail = 404 / deleted (restorable 30 d) / 403.
2. **Row actions** — every data list row uses the `Actions ⌄` dropdown (D42): items of the current state, first = primary (Enter), forbidden items greyed with the readable reason in the footer (no error code on merchant screens — retest 11/11 UX-056), keyboard shortcuts shown; exceptions per `figma-web-coverage.md` (banners, notification rows, export jobs, sessions, API keys, blocked customers, order line items keep one explicit button).
3. **Filters in URL** — all filters, sort, page, density, and tab are URL state; KPIs follow the filters; status tabs are the status filter (ORD-05 fix).
4. **i18n** — zero hardcoded strings; keys follow `06-i18n-copy-deck.md` naming; fr complete, ar/en present (may be machine-filled in dev but CI fails on missing keys); RTL snapshot for the screens listed in 08 §5 (shell, inbox, orders list, order form, product form, home).
5. **Permissions** — forbidden controls hidden or disabled with tooltip reason (never dead); server returns 403; Operator/Admin/Owner matrix test for every mutation on the screen (keys and columns of `01-nest-module-map.md` §3.2, the single permission table).
6. **Errors** — every error code the screen can receive (11) is rendered per its UI column (inline/toast/dialog/banner/state), inside the open dialog when applicable, form content preserved.
7. **Real-time** — if the screen shows a WS-updated entity (03-events §2), the TanStack Query cache is updated by the event, with polling fallback and "reconnexion…" pill.
8. **Tests** — unit tests for any rule; integration tests for each endpoint used (happy, validation, permission, cross-workspace 404, idempotency where required, 409 where versioned); Playwright e2e for the screen's AT ids; Storybook stories for each state (AT-UX-01 snapshot); a11y check (axe) on the default state.
9. **Audit** — mutations flagged sensitive in `01-nest-module-map.md` §6 write `AuditLog`.
10. **Figma parity** — reviewer compares against the frame at 1440 and the RESP frame at 1024/390 for the shell; pill colours per enum match `REF — Component sheet`.

---

## 4. Parallelism and team split (suggestion)

- Backend stream A (tenancy/catalogue/orders/GDS): M1 → M2 → M5 → M7 → M8.
- Backend stream B (channels/AI/delivery/integrations): M3 → M4 → M6 → M11.
- Backend stream C (billing/admin): M9 → M10 → M12.
- Web stream follows each backend milestone with a one-sprint lag, starting with M0 shell + GLOBAL states.
- Mobile (M12 MM1 → MM5) starts after M5 API freeze (P1 stable), against the generated OpenAPI Dart client; it runs in parallel with M6–M11 and never waits for M10.

Pulled-forward items (needed earlier than their milestone for external lead times): privacy / terms / data-deletion CMS pages + Meta App Review submission (during M1), Google OAuth verification request (during M3), Chargily merchant account + API keys (during M5), store developer accounts + IAP product IDs (during M9).

---

## 5. Do / Don't (sequencing)

**Do**
- Build strictly in milestone order; stub a later-milestone dependency behind its interface with `TODO(M<n>)` and a line in `docs/implementation/assumptions-log.md`.
- Close a milestone only when every exit criterion and every listed AT id is green.
- Pull forward only the external lead-time items listed in §4 (App Review, Google verification, Chargily merchant account, store accounts).
- Add the Figma frame name and spec IDs to every PR.

**Don't**
- Don't start a screen before its endpoints exist and are tested.
- Don't add features that are in neither the Figma nor the specs; apply `08-coder-playbook.md` §6 "If something seems missing" and log the assumption in `docs/implementation/assumptions-log.md` (one line: date | file/route | rule applied | value). Never stop to ask.
- Don't reorder milestones to "unblock" UI work with mocks inside app code.
- Don't let two streams edit the same module in the same sprint without a shared interface agreed first.

---

## 6. Decisions carried into this pack (closed 2026-10-11)

Each item is the final rule; the coder implements it as written (rationale and rejected options: `docs/audit/decisions-log-2026-10-11.md`).

1. **Payment gateway**: Chargily Pay is the only gateway (D4, R-N). `PaymentGateway` interface with `ChargilyGateway` as its only implementation; `PAYMENT_PROVIDER=chargily`; CIB and Edahabia are payment methods inside Chargily (`PaymentMethodBilling.cib|edahabia`); manual payments are recorded by finance (`BillingProvider.manual`). Web credit packs = Chargily checkout; mobile credit packs = store IAP validated by `POST /credits/packs/iap/validate`; plan purchase is web-only.
2. **Admin impersonation**: read-only only (D21-bis, R-F). `ImpersonationSession(adminUserId, workspaceId, reason ≥ 10 chars, ticketId?, startedAt, expiresAt = +30 min, endedAt?, actionsCount)`, roles `super_admin` and `support`, header `X-Impersonation-Session`, every non-GET ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`, expiry ⇒ `401 ADMIN_IMPERSONATION_EXPIRED`, audit `impersonation.start|action|stop`.
3. **Customer system messages**: 4 workspace-editable keys `handoff`, `out_of_hours`, `out_of_stock`, `welcome` × `fr|ar|en` in `Workspace.systemMessages` (R-G), seeded at workspace creation, edited in Settings › Messages système (preview, reset to default), `GET|PUT /workspace/system-messages`. `out_of_hours` is sent once per conversation per 24 h when `Agent.businessHours` is set and now (Africa/Algiers) is outside it; `out_of_stock` is injected in the system prompt with the `{product}` placeholder; `welcome` is sent before the first AI reply of a new conversation (empty ⇒ not sent). Fixed platform texts (`customer.unavailable`, `customer.unsupportedMedia`, `customer.voiceFailed`, `customer.outsideWindowSkipped`) are i18n keys of 11 §9, not workspace-editable. `Agent` has no handoff / out-of-hours text columns.
4. **Error codes**: all codes live in `11-error-catalogue.md`; aliases only in 11 §13 (mirrored by `packages/shared/src/errors/aliases.ts`). No alias appears in any other document, in any API response or in code; `06-i18n-copy-deck.md` §5 is a pointer to 11.
5. **Order reminders**: `Order.assigneeId`, `Order.callbackAt`, `ConfirmationStatus.callback`, `POST|DELETE /orders/:id/callback`, job `sched-order-reminders`, notification `order.callback_due` (§0).
6. **Inventory count and category parent**: `InventoryCount`/`InventoryCountLine` (`InventoryScope ∈ all|category|alerts_only`, `InventoryStatus ∈ draft|counting|validated|cancelled`, D55) and `Category.parentId` (2 levels max, `CATEGORY_DEPTH_EXCEEDED`, deleting a parent offers "move sub-categories to root", D66), both in M7.
7. **Outbox dedup**: `Outbox @@unique([topic, key])` exists in the schema; `OutboxService.enqueue` uses `ON CONFLICT (topic, key) DO NOTHING` inside the caller's transaction.
