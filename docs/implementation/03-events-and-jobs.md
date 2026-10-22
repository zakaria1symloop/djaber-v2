# 03 — Events, queues, scheduled jobs, webhooks, notifications

All names are final. WebSocket event names are `<entity>.<verb>`; queue names are kebab-case; job names inside a queue are kebab-case; scheduled job names are prefixed `sched-`.

---

## 1. Transactional outbox (the only way domain code emits anything)

`core/outbox/OutboxService.enqueue(tx, { topic, key, payload })` writes an `Outbox` row **inside the caller's Prisma transaction**. `OutboxRelay` (worker, every 500 ms, batch 200, `SELECT … FOR UPDATE SKIP LOCKED WHERE processedAt IS NULL`) dispatches by topic:

| topic | Dispatch |
|---|---|
| `ws` | `WsEmitter.emit(room, event, payload)` via Redis pub/sub |
| `notification` | `NotificationProducer.emit(...)` |
| `job` | add the job described by the payload `{ queue, name, data, opts }` to its queue, job id = key (`QueueOutbox.add`): `meta-send` (`send:<messageId>` on queue `outbox`), `fetch-attachment`, `process-event` (`inbound:<externalId>`), every `jobs` job |
| `webhook` | add job to `outbox` name `webhook-dispatch` per active endpoint subscribed to the event |
| `sheets` | add job to `outbox` name `sheets-upsert` (job id = `sheets:<orderId>`, delay 5 s, replaces pending) |
| `audit` | insert `AuditLog` |

`key` is unique per topic (`U(topic, key)`); duplicates are ignored (`ON CONFLICT DO NOTHING`), which is what makes retried transactions safe.

---

## 2. WebSocket event catalogue (Socket.IO namespace `/ws`)

Handshake: `auth: { token }` (access JWT, claims `{ sub, wid, role, pr, imp }`). Server joins `user:<sub>` and `ws:<wid>` (client reconnects with a new token after switching workspace). Users with `pr !== 'none'` additionally join `admin:platform` (contract §5: `health.updated`, `moderation.queue`, `reports.queue`, `tickets.queue`, plus `platform.alert` below). Contract-listed events also emitted: `moderation.updated`, `report.updated`, `ticket.updated`, `inventory.updated`, `cash.updated`, `agent.version_created`, `impersonation.started/ended`. Server emits `auth.expiring` 60 s before expiry; client refreshes and reconnects. On reconnect client sends `resync { since: ISO }` and receives `resync { conversations: Conversation[], orders: OrderSummary[], notificationsUnread: number }` (rows with `updatedAt > since`, max 200 each).

| Event | Room | Payload | Triggered by |
|---|---|---|---|
| `message.created` | `ws:<wsId>` | `{ conversationId, message: Message /* full row incl. attachments, author, deliveryStatus */, conversation: { id, status, unreadCount, lastMessageAt, lastMessagePreview, aiPaused } }` | inbound stored (FL-01 step 5), AI/human/system message stored, outbound status change (`sent`/`failed`/`skipped_window`) |
| `message.updated` | `ws:<wsId>` | `{ conversationId, messageId, deliveryStatus, error?, transcript?, attachments? }` | send result, transcription finished, media stored |
| `conversation.updated` | `ws:<wsId>` | `{ conversation: { id, status, aiPaused, assigneeId, unreadCount, clientId, lastMessageAt, version, blocked } }` | status/assign/read/pause/resume/handoff/merge/block |
| `conversation.deleted` | `ws:<wsId>` | `{ id }` | soft delete |
| `order.created` | `ws:<wsId>` | `{ order: OrderSummary /* id, number, status, confirmationStatus, paymentStatus, deliveryStatus, source, clientName, clientPhone, total, amountPaid, wilayaId, riskLevel, assigneeId, orderedAt, version */ }` | manual / AI / API create |
| `order.updated` | `ws:<wsId>` | `{ order: OrderSummary, changed: string[] }` | any PATCH/status/call/payment/assign/reminder |
| `order.deleted` | `ws:<wsId>` | `{ id }` | delete |
| `shipment.updated` | `ws:<wsId>` | `{ shipment: { id, orderId, status, trackingNumber, failureReason, lastSyncedAt, labelUrl }, event?: ShipmentEvent }` | create, sync, webhook, cancel, retry |
| `notification.created` | `user:<userId>` | `{ notification: { id, type, title, body, data, createdAt }, unreadCount }` | NotificationProducer |
| `notification.read` | `user:<userId>` | `{ ids: string[] | 'all', unreadCount }` | read / read-all (other tabs) |
| `credits.updated` | `ws:<wsId>` | `{ planUsed, planLimit, packBalance, exhausted: boolean }` | settle/release/grant/pack purchase/period reset |
| `job.updated` | `user:<createdById>` + `ws:<wsId>` | `{ job: { id, kind, status: 'queued'|'running'|'done'|'failed'|'cancelled', progress: 0–100, message?, result?, error? } }` | JobService progress/finish |
| `channel.updated` | `ws:<wsId>` | `{ channel: { id, status, pausedReason, agentId, lastSeenAt } }` | connect/reconnect/pause/disconnect/token error/plan pause |
| `agent.updated` | `ws:<wsId>` | `{ agent: { id, status, pausedReason, pendingInsights, version } }` | pause/resume/activate/insight created or resolved |
| `product.updated` | `ws:<wsId>` | `{ product: { id, stock, isActive, moderationStatus, lowStock, archived } }` (hard delete: `{ product: { id, deleted: true } }`) | stock change, edit, image re-encoded, archive / restore, moderation decision |
| `workspace.updated` | `ws:<wsId>` | `{ workspace: { status: 'active'\|'suspended'\|'deletion_scheduled', stockMode, locale, subscription: { planSlug, status, dunningStage, currentPeriodEnd } } }` | settings/subscription/status change (suspend, reactivate, deletion scheduled/cancelled) |
| `member.updated` | `ws:<wsId>` | `{ membership: { userId, role, readOnly, removed? } }` | role change/remove |
| `auth.expiring` | socket | `{ expiresAt }` | 60 s before JWT exp |
| `resync` | socket | see above | client `resync` |
| `platform.alert` | `admin:platform` | `{ kind: 'queue_lag'|'ai_error_rate'|'provider_down'|'sla_breach'|'incident', payload }` | JobsHealth / monitors |

Client → server: `resync { since }`, `typing { conversationId }` (optional; not forwarded to Meta), `presence` (none).

---

## 3. BullMQ queues and jobs

Global defaults: `removeOnComplete: 1000`, `removeOnFail: false` (kept for DLQ view), `attempts` and `backoff` per job below. Every job carries `{ workspaceId, requestId, enqueuedAt }` in `data` and sets `TenantContext` in the processor. A job is **idempotent by job id** (BullMQ dedups on `jobId`) and by the persistence keys listed. Failed jobs after the last attempt land in the queue's failed set = the DLQ shown on ADM-14 ("Échecs récents (DLQ)": payload, stack, Rejouer). `JobsHealthService.replay(queue, jobId)` re-adds with `attempts` reset and `replayedBy` audit.

| Queue | Job name | Payload | jobId / idempotency | Concurrency | Attempts / backoff | On final failure |
|---|---|---|---|---|---|---|
| `meta-inbound` | `process-event` | `{ inboundEventId }` | `inbound:<externalId>`; message `U(conversationId, externalId)` | 16 | 5 / exponential 2 s ×2 (2, 4, 8, 16, 32 s) | `InboundEvent.error`, Sentry, `platform.alert queue_lag` if > 100 failures / 10 min |
| `ai-reply` | `reply` | `{ workspaceId, conversationId, batchKey, scheduledFor }` | `ai:<conversationId>` (delayed; re-scheduling moves the delay instead of adding — `BatchingService.schedule` uses `job.changeDelay`) | 8 (per-workspace cap 2: Redis semaphore `sem:ai-reply:<workspaceId>`, a capped job is re-delayed 2 s without consuming an attempt — BullMQ OSS has no group keys) | 3 / fixed 10 s, 60 s, 300 s | `AiRun.status='error'`, insight `error`, conversation `needs_human`, `ai.error` notification if ≥ 3 failures / 10 min / workspace, credits released |
| `ai-reply` | `playground-turn` | `{ workspaceId, agentId, userId, sessionId, messages[] }` | `pg:<sessionId>:<turn>` | 4 | 1 | HTTP 503 `AI_PROVIDER_ERROR` to the caller (request waits on the job via `QueueEvents`, 45 s timeout) |
| `media` | `fetch-attachment` | `{ messageId, index, url, mime }` | `media:<messageId>:<index>` | 8 | 3 / 5 s, 30 s, 2 min | attachment kept with original Meta URL + `error`; thread shows "media indisponible" |
| `media` | `transcribe` | `{ messageId, storageKey, workspaceId }` | `stt:<messageId>` | 4 | 2 (Groq then OpenAI inside one attempt; attempt 2 only on network error) | `Message.transcript=null, transcriptError`, FL-01 F-5 message, 0 credits |
| `media` | `reencode-image` | `{ uploadId | productImageId }` | `img:<id>` | 4 | 3 / 5 s | keep original, warning |
| `media` | `caption-image` | `{ productImageId }` | `cap:<id>` | 2 | 2 / 30 s | `aiCaption=null` (vision pass 1 falls back to name/description) |
| `outbox` | `meta-send` | `{ workspaceId, channelId, conversationId, messageId, kind: 'ai'|'human'|'transactional'|'system', runId? }` | `send:<messageId>` | 16 (per-channel limiter 10/s: Redis 1-s window `rl:meta-send:<channelId>:<sec>`, over budget ⇒ job moved back to delayed, no attempt consumed — BullMQ OSS has no `limiter.groupKey`) | 5 / exponential 15 s (15, 30, 60, 120, 240 s) — only for Meta codes 4/613/32 and network; other codes fail immediately | `Message.deliveryStatus='failed'`, `error`, WS `message.updated`; 10/2018278 ⇒ `needs_human` + note; 190 ⇒ channel `needs_reconnect` + `channel.needs_reconnect` notification |
| `outbox` | `webhook-dispatch` | `{ deliveryId, attempt, workspaceId }` | `wh:<deliveryId>:<attempt>` | 8 | 1 + 6 retries = 7 attempts (`ping`: 1), each retry a new delayed job written by the attempt's transaction: 60 s, 300 s, 1 800 s, 7 200 s, 43 200 s, 86 400 s (06 §4) | every failed attempt: endpoint `failureCount++` (a success resets it); at 50 consecutive ⇒ `isActive=false` + `webhook.disabled` notification + audit; last attempt ⇒ `WebhookDelivery.status='exhausted'` (M11) |
| `outbox` | `sheets-upsert` | `{ connectionId, orderId, workspaceId }` | `sheets:<orderId>` (delay 5 s; new enqueue replaces) | 4 (global limiter 50/min) | 5 / exponential 30 s (429 included) | `SheetsConnection.status='error'`, `lastError`, `sheets.error` notification (token / missing sheet ⇒ immediately, no retry) |
| `outbox` | `sheets-revoke` | `{ sealed, workspaceId }` (refresh token, AES-GCM) | `sheets-revoke:<hash>` | 4 | 3 / 60 s | ignored (the token is already unusable for Djaber) — M11, disconnect / reconnect |
| `outbox` | `email-send` | `{ to, template, locale, params, notificationId? }` | `mail:<notificationId|uuid>` | 8 | 3 / 30 s | log; bounce handling via provider webhook sets `User.emailBounced` |
| `outbox` | `push-send` | `{ userId, notificationId }` | `push:<notificationId>:<userId>` | 8 | 2 / 10 s | invalid tokens pruned (`UNREGISTERED`) |
| `jobs` | `product-import-preview` | `{ jobId, workspaceId }` (file key and mapping live in `Job.payload`) | `job:<jobId>`, then `job:<jobId>:map<n>` for each re-mapping | 2 | 1 | `Job.status='failed'`, error code (`IMPORT_*`) |
| `jobs` | `product-import-commit` | `{ jobId, workspaceId }` | `job:<jobId>:commit<n>` (n = preview revision) | 1 per workspace | 1 (transaction; rerun is safe: `Job.result.stage = committed` makes it a no-op) | `Job.failed`, nothing written |
| `jobs` | `export` | `{ jobId, kind: 'orders'|'products'|'clients'|'report'|'audit'|'ledger'|'movements'|'conversation-eval'|'cash'|'shipments'|'purchases'|'sales', filters, format: 'csv'|'xlsx'|'pdf', label? }` | `job:<jobId>` | 2 | 1 | `Job.failed` `REPORT_EXPORT_FAILED`; retry button |
| `jobs` | `page-analysis` | `{ jobId, channelId }` | `job:<jobId>` | 2 | 1 + resumable (`Job.result.cursor`) | partial results kept, "retry remaining" |
| `jobs` | `agent-generation` | `{ jobId, channelId, days }` | `job:<jobId>` | 2 | 1 | `Job.failed`, credits not debited |
| `jobs` | `faq-extract` | `{ jobId, agentId, channelId }` | `job:<jobId>` | 2 | 1 | same |
| `jobs` | `history-sync` | `{ jobId, channelId, days }` | `job:<jobId>` | 2 | 1 + resumable | `PAGE_SYNC_TOKEN_EXPIRED` ⇒ failed with code |
| `jobs` | `bulk-send` | `{ jobId, orderIds[], courierAccountId }` | `job:<jobId>` | 1 per workspace | 1 (each order enqueues its own `courier.create-parcel`) | per-row results in `Job.result.results[]` |
| `jobs` | `labels-merge` | `{ jobId, shipmentIds[], layout: 'a6'|'thermal' }` | `job:<jobId>` | 2 | 2 | failed |
| `jobs` | `sheets-backfill` | `{ jobId, connectionId, from, to }` | `job:<jobId>` | 1 per connection | 1 + resumable (cursor = last orderId) | `sheets.error` |
| `jobs` | `recommendations-generate` | `{ jobId, workspaceId }` | `job:<jobId>` (limiter 1/10 min/workspace) | 2 | 1 | failed |
| `jobs` | `client-export`, `report-export` | alias of `export` | | | | |
| `jobs` | `daily-stats` | `{ workspaceId, day }` | `daily-stats:<workspaceId>:<day>` | 2 | 3 / exponential 60 s | rows of that run are rewritten by the next run (upsert, never incremented) |
| `jobs` | `report-schedule-send` | `{ scheduleId, month: YYYY-MM }` | `report-schedule:<scheduleId>:<month>` | 1 | 3 / exponential 60 s | e-mail deduplicated by the outbox key `report-schedule:<scheduleId>:<month>`; skipped when the plan lost `scheduled_reports` |
| `jobs` | `workspace-data-export` | `{ jobId, workspaceId, userId }` (deletion flow, GDPR) | `job:<jobId>` | 1 | 1 | failed + admin alert |
| `jobs` | `account-data-export` | `{ jobId }` (`Job.kind=data_export`, no workspace; DEL-01 "Exporter mes données", `GET /me/data-export`) — M11 | `job:<jobId>` | 2 | 1 | `Job.status='failed'` |
| `courier` | `create-parcel` | `{ shipmentId }` | `parcel:<shipmentId>` (Shipment row is the lock: status `pending`) | 4 (limiter per `courierAccountId` 5/s) | 6 / custom 60 s, 300 s, 1 800 s, 7 200 s, 7 200 s, 7 200 s (FL-08 F-3) — only on `COURIER_UNAVAILABLE`; validation errors fail immediately | `Shipment.status='failed'`, `lastError`, order stays `confirmed/preparing`, notification `shipment.failed` with `data.reason='courier_unavailable'` (no customer message in this case), manual retry |
| `courier` | `cancel-parcel` | `{ shipmentId }` | `cancel:<shipmentId>` | 4 | 3 / 60 s | `COURIER_CANCEL_NOT_ALLOWED` surfaced on the order |
| `courier` | `track-batch` | `{ courierAccountId, shipmentIds[] }` (≤ 50 per job) | `track:<courierAccountId>:<bucketTs>` | 4 (limiter per account 2/s) | 2 / 60 s | `Shipment.lastError`, `nextSyncAt` pushed +2 h |
| `courier` | `fetch-label` | `{ shipmentId }` | `label:<shipmentId>` | 4 | 3 / 30 s | `LABEL_UNAVAILABLE` ⇒ fallback label generated |
| `courier` | `courier-webhook` | `{ inboundEventId }` | `cwh:<externalId>` | 8 | 3 / 10 s | event stored, status unchanged |
| `payments` | `payment-webhook` | `{ inboundEventId }` | `pay:<externalId>` | 4 | 5 / 30 s | admin alert |
| `payments` | `iap-validate` | `{ receiptId }` | `iap:<receiptId>` | 2 | 3 / 60 s | purchase stays `pending`; polled by `sched-payment-reconcile` for 72 h (FL-20 F-3) |
| `payments` | `store-notification` | `{ inboundEventId }` | `store:<externalId>` (`gp:<messageId>` / `as:<notificationUUID>`) | 2 | 3 / 60 s | event kept unprocessed (`InboundEvent.error`) |
| `payments` | `order-link-create` | `{ paymentId, workspaceId }` | `olink:<orderPaymentId>` | 4 | 3 / 10 s (only on gateway unavailable) | `OrderPayment.status='failed'`, order back to its derived payment status |
| `notifications` | `fanout` | `{ notificationId }` | `nf:<notificationId>` | 8 | 2 / 10 s | log |
| `scheduled` | see §4 | | `sched-<name>:<slot>` | 1 | 1 | `platform.alert`, Sentry |

Queue-level settings: `ai-reply` and `outbox` use `QueueScheduler` delayed jobs; `courier` and `outbox:sheets-upsert` use BullMQ `limiter`; `outbox:meta-send` uses the per-channel Redis window above (M10). Pausing a queue from ADM-14 (`POST /admin/queues/:name/pause`) is allowed for all except `meta-inbound`.

### 3.1 `ai-reply` processor contract (summary; full flow in `04-ai-pipeline.md`)

1. Load conversation + channel + agent; abort (no run, no credits) if not eligible (04 §5).
2. `AiRunService.start({ conversationId, agentId, kind:'reply', attempt: job.attemptsMade+1 })` ⇒ existing `running` run for this `batchKey` is reused (idempotent replay).
3. `CreditService.reserve(runId, plannedCost)`.
4. Build prompt → model loop with tool replay → structured output.
5. `OutboxService.enqueue(tx, { topic:'meta-send', key:`send:${messageId}` })` for text + cards.
6. `AiRunService.finish(runId, 'ok')`, `CreditService.settle(runId)`.
7. Status handling: `UNCLEAR` ⇒ insight; `UNKNOWN|HANDOFF` ⇒ FL-03.

### 3.2 Admin "Tâches & santé" (ADM-14) data contract

`GET /admin/health` → `{ data: { queues: [{ name, waiting, active, failed, delayed, completedLastHour, p95Ms, state: 'ok'|'warning'|'incident'|'paused', note }], metaWebhooks: { received24h, byType: { messages, postbacks, reads }, invalidSignatures, ackP95Ms, ackOver5s, medianInboundToReplyMs, dedupedCount }, ai: { errorRate24h, failoverActive }, duplicates7d, workers: [{ host, lastHeartbeatAt }] } }` (queue state: `warning` when `failed(1 h) > 10` or `p95 > 3× baseline`; `incident` when an open `Incident` references the queue; `paused` when paused from ADM-14).
`POST /admin/queues/:name/{pause|resume|drain-failed|replay-failed|run-now}` (`admin.health.write`; `meta-inbound` cannot be paused ⇒ `409 CONFLICT`).
`GET /admin/queues/:name/failed?page` → `{ data: [{ queue, jobId, name, workspaceId, failedAt, attemptsMade, reason, payload, stacktrace }], meta }`; `GET /admin/queues/failed/:jobId` → one row with the full payload and stack trace.
`POST /admin/queues/failed/:jobId/replay` (`admin.health.replay`: super_admin and support) re-adds the job with `attempts` reset, same `jobId` + suffix `:replay<n>`, audit `queue.replay` with `replayedBy`.
`Incident { id, title, status: 'open'|'resolved', startedAt, resolvedAt?, affectedWorkspaces, queue?, bannerPublished: boolean, postMortemUrl? }` (+ `IncidentUpdate` rows) feeds `GET /status` and the CMS incident banner; endpoints `GET|POST /admin/incidents`, `PATCH /admin/incidents/:id`, `POST /admin/incidents/:id/updates`, `POST /admin/incidents/:id/resolve`.

---

## 4. Scheduled jobs (`apps/worker`, `@Cron`, timezone `Africa/Algiers`, singleton lock in Redis `lock:sched:<name>` 10 min)

| Name | Schedule | What it does | Spec |
|---|---|---|---|
| `sched-credit-periods` | `0 0 * * *` | For every subscription whose period day-of-month is today: open a new credit period (`CreditLedger` row `action='renewal', kind='credit', bucket='plan', credits=monthlyCredits, periodStart=today, balanceAfter`, idempotencyKey `renewal:<subscriptionId>:<periodStart>`), reset conversation quota counter, emit `credits.updated` (ledger label "RENOUVELLEMENT"). | 02 §6, AT-BIL-05 |
| `sched-subscription-expiry` | `15 0 * * *` | Applies the 02 §5 single rule to subscriptions that end without a renewal attempt: `status='trial'` with `trialEndsAt <= now` (R-K), and `status='active'` with `cancelAtPeriodEnd=true` and `currentPeriodEnd <= now` ⇒ `status='expired'` + new free `Subscription(provider=none, status=active)`; `LimitService.applyFreeLimits`: pause channels beyond `maxPages` (newest first, `pausedReason='plan'`), agents beyond `maxAgents`, members beyond `maxMembers` ⇒ `readOnly=true`; emit `subscription.expired`, `channel.paused_by_plan`; nothing is deleted, nothing is read-only at workspace level. Restoring a plan reverses the pauses (`LimitService.restore`). Paid renewals are handled by `sched-dunning` (no reminder is sent by this job). | 02 §5, FL-09, R-K |
| `sched-payment-reconcile` | every 10 min | 05-integrations §4.2: pending Chargily checkouts (`BillingPayment.status='pending'`) younger than 24 h are verified once (`verify`), older ones become `expired`; order links past `expiresAt` are verified then expired (`payment.failed`); pending store purchases younger than 72 h are validated again. Idempotent (only `pending` rows move). | FL-28, FL-10, FL-20 |
| `sched-dunning` | `30 0 * * *` | Paid subscriptions (`billingCycle ≠ none`, `cancelAtPeriodEnd=false`), per R-J, idempotent on `(subscriptionId, dunningStage)`: **J−7** (`currentPeriodEnd − 7 d`): ensure the renewal `Invoice(kind=subscription, status=upcoming)` exists, `dunningStage=d_minus_7`, notification `subscription.expiring` (in-app + e-mail + push). **J0** (`currentPeriodEnd`): invoice `status=unpaid`, `Subscription.status=dunning`, `dunningStage=d0`, Chargily checkout link created (`POST /billing/invoices/:id/pay` semantics) and sent by e-mail + in-app `invoice.unpaid` (+ push; SMS when enabled); paid-plan limits stay in force. **J+3**: `dunningStage=d_plus_3`, `invoice.unpaid` again (same channels). **J+7**: `Subscription.status=expired`, `dunningStage=expired`, then the 02 §5 single rule (new free subscription, `LimitService.applyFreeLimits`, banner "Plan expiré") + `subscription.expired`; the unpaid invoice stays `unpaid`; nothing is deleted, no read-only, never a suspension. Paying the invoice at any stage (Chargily webhook or `POST /admin/invoices/:id/mark-paid` for the full amount) ⇒ `status=active`, new period, `dunningStage=null`, pauses lifted. This job never writes `Workspace.status` and never emits `workspace.suspended`. ADM-05 shows the stage (`RELANCE J+3`). | R-J, BIL-04, ADM-05 |
| `sched-nightly-recommendations` | `0 3 * * *` | For every workspace with ≥ 1 delivered order in 90 d: `recommendations-generate` job (rule engine; stale pairs removed). | REC-02, D18 |
| `sched-daily-stats` | `30 3 * * *` | Enqueues one `jobs/daily-stats` job per workspace (id `daily-stats:<workspaceId>:<day>`) that recomputes the `DailyStat(workspaceId, day, metrics Json, computedAt)` row for yesterday and the 7 days before it (late deliveries, edits) plus every day without a current-version row back to the first activity (≤ 732 d) (`@@unique([workspaceId, day])`, upsert; `metrics = { conversations, aiReplies, handoffs, orders, revenue, credits, byChannel, byAgent, byWilaya }` + shipments figures) and the platform totals; never incremented, a rerun overwrites. `AnalyticsService` merges these rows with a live query for today. | ANA-02, ADM-01, DailyStat |
| `sched-trust-levels` | `45 3 * * *` | R-L: workspaces with `trustLevel='new'` having ≥ 10 `approved` moderation items and 0 `rejected` in the last 30 d ⇒ `standard` (also evaluated synchronously on each approval); any workspace with `count(rejected, decision=counterfeit, last 90 d) ≥ 3` ⇒ `watch` (every item then goes to human review); at ≥ 5 the workspace is listed in ADM-01 "Suspension proposée" (an admin decides; nothing automatic). `standard → trusted` and `watch → standard` are manual only (`POST /admin/workspaces/:id/trust-level`, moderator, reason, audited). Every automatic change writes `AuditLog actorType='system'`. | D52, R-L |
| `sched-report-schedules` | `0 7 * * *` | For every `ReportSchedule` whose `dayOfMonth` is today (Africa/Algiers; `dayOfMonth > days in month` ⇒ last day) and whose workspace plan has the feature `scheduled_reports`: run the report for the previous calendar month, render PDF + XLSX, `email-send` job (template `reports/scheduled`, attachments ≤ 10 MB else download link 7 d) to `ReportSchedule.email`. Workspaces without the feature are skipped silently (the schedule is kept). | D62, R-M |
| `sched-preset-updates` | `0 6 * * *` | For every published `AgentPresetVersion` newer than the `presetVersion` snapshotted on an active or paused `Agent` ⇒ one `agent.preset_update_available` notification per agent (idempotent on `(agentId, presetVersion)`), shown on AGT-03 with "Appliquer la mise à jour" (`POST /agents/:id/apply-preset-update`). | D53, AGT-03 |
| `sched-risk-recompute` | `0 4 * * *` | `Client.riskLevel` nightly (`high` if ≥ 3 cancelled orders in 30 d); `riskLevel` also recomputed synchronously on each cancellation. | ORD-12 |
| `sched-tracking-sync` | every 10 min | First, parcels whose last courier event (`Shipment.lastEventAt`) is older than 30 d ⇒ `status='stale'` (no further sync). Then select shipments with `nextSyncAt <= now` and status in `sent|picked_up|in_transit|out_for_delivery|failed`, group by `courierAccountId`, enqueue `track-batch` (≤ 50, job id `track:<courierAccountId>:<10-min slot>:<n>`). Cadence: `nextSyncAt = +2 h` while `createdAt < 3 d`, else `+12 h`. Manual "Actualiser" bypasses with limiter 1/5 min/shipment. | DLV-04 |
| `sched-token-refresh` | `0 2 * * *` | IG long-lived tokens with `tokenExpiresAt < now + 10 d` ⇒ `GET graph.instagram.com/refresh_access_token`; FB page tokens weekly (`sched-token-health`, Monday 02:30) via `GET /debug_token`; failure ⇒ `needs_reconnect` + notification. | CHN-12 |
| `sched-channel-webhook-retry` | every 30 min | Channels with `webhookSubscribed=false` ⇒ retry `subscribed_apps`; success clears the warning. | CHN-01 warning |
| `sched-handoff-unattended` | every 5 min | Conversations `needs_human` with `handoffAt < now − handoffReminderMin` and no human reply and not yet reminded ⇒ `conversation.handoff_unattended` to Owner (`handoffReminderMin = 0` ⇒ skip). | FL-03 F-1 |
| `sched-low-stock-digest-guard` | `0 8 * * *` | Clears the 1/day notification throttle keys for `stock.low`/`stock.out` (throttle itself is in `NotificationProducer`). | CAT-09 |
| `sched-order-reminders` | every minute | `Order.callbackAt <= now AND confirmationStatus='callback'` ⇒ notification `order_callback_due` (idempotency key `cb:<orderId>:<callbackAt ISO>`) to `assigneeId` (or all operators), optional customer message `customer.reminderScheduled` was sent at scheduling time; the pill stays `RAPPEL` until the next call result. | Figma "Programmer un rappel" |
| `sched-moderation-sla` | every 15 min (business hours 09–18 Africa/Algiers, Sun–Thu) | `ModerationItem.status='pending'` waiting > 2 business hours ⇒ `urgent=true`, `platform.alert sla_breach`; support tickets past `slaDueAt` ⇒ `slaBreached=true`. | D36, D38 |
| `sched-ai-run-reaper` | every minute | `AiRun.status='running'` and `startedAt < now − 5 min` ⇒ `error('reaped')`, credits released. | 04 §5 |
| `sched-retention` | `0 1 * * *` | Purge: `Message`/attachments older than 12 months (conversation row anonymised: `externalSenderId` hashed, `lastMessagePreview=null`) (D28); `InboundEvent` > 7 d; `WebhookDelivery` > 30 d; `IdempotencyKey` expired; `RefreshToken` expired > 30 d; `EmailToken` used/expired; placeholder clients with no orders/conversations > 90 d. | 04 §9 |
| `sched-workspace-purge` | `0 1 * * *` | Workspaces with `status='deletion_scheduled'` and `deletionScheduledAt <= now` (04 §16) ⇒ hard purge in dependency order (one transaction per workspace, S3 prefix deleted after commit), `workspace.deleted` e-mail to the former owner. | D31, FL-14 |
| `sched-account-anonymise` | `10 1 * * *` | `AccountDeletionRequest(status='grace')` with `scheduledAt <= now` ⇒ anonymise the user per 04 §16 (`firstName='Membre supprimé'`, e-mail `deleted+<id>@anon.djaber.ai`, phone/avatar null, TOTP and sessions cleared, `status='anonymised'`); a user who still owns a workspace goes back to `blocked`; invoices kept 10 y. | D50, ADM-16 |
| `sched-email-verify-reminder` | `0 9 * * *` | Users unverified for exactly 7 d ⇒ `account.verify_reminder` e-mail. | D32 |
| `sched-credits-exhausted-daily` | `0 9 * * *` | Workspaces with balance 0 ⇒ `credits.exhausted` to Owner (1/day). | 02 §6 |
| `sched-abuse-auto-rules` | hourly | Same phone blocked by ≥ 3 workspaces in 7 d ⇒ `Report(type='customer', reporterKind='system')` proposing blacklist; ≥ 3 reports on one workspace in 30 d ⇒ report `type='merchant'`; AI message reported ≥ 5× ⇒ `platform.alert`. | D37 |
| `sched-sheets-health` | hourly | Connections with `status='error'` ⇒ retry one upsert; success ⇒ `active`. | GSH-07 |
| `sched-meta-review-poll` | `0 6 * * *` | Reads Meta app permissions status (manual table on ADM-13, or Graph `/<appId>/permissions` when available) ⇒ `MetaPermission` rows; IG channels `status='pending_review'` become `active` when `instagram_manage_messages` is approved, with `ChannelEvent(kind=approved)` + notification `channel.approved`. | CHN-03/11 |
| `sched-key-rotation` | weekly Sunday 02:00 | Re-encrypt rows still on an old key version (batch 500). | 07 §6 |
| `sched-backup-verify` | `0 5 * * *` | Checks last backup timestamp (`pg_dump` artefact head) < 25 h else `platform.alert`. | 07-non-functional §6 |

---

## 5. Notification fan-out

`NotificationProducer.emit(type, { workspaceId, target: { userIds?: string[]; roles?: Role[]; owner?: true; all?: true }, data, customer?: { conversationId, messageKey, params } })`:

1. Throttle check (Redis `nt:<type>:<scopeKey>`), per the Throttle column of §5.1: e.g. `conversation.needs_human_message` 10 min per conversation; `stock.low`/`stock.out` 24 h per product; `credits.exhausted` 24 h per workspace; `product.approved` grouped per day per workspace (one row "n produits validés"); `ai.error` 10 min per workspace; `channel.needs_reconnect` 24 h per channel.
2. Insert one `Notification` row per target user (title/body stored as i18n key + params; rendered in the user's locale at read time) → WS `notification.created` to `user:<id>`.
3. For each user: `NotificationPreference(membershipId, type)` → `email-send` job (template `notification/<type>`), `push-send` job (FCM data message, see §5.2).
4. `customer` ⇒ `OutboundSendService.sendSystemMessage(conversationId, messageKey, params)` subject to MSG-06 window rules (FB `POST_PURCHASE_UPDATE` tag for transactional; IG only inside 24 h else `skipped_window`).

### 5.1 Type → producer → channels → deep link (same rows as 03 §15, the canonical list; this table adds the producer and the throttle)

One row per value of the Postgres enum `NotificationType` (56 values, schema order). Web target is relative to `/{locale}` and is a route of `02-next-route-map.md` §3; mobile deep link is `djaber://` + the same path; `data` fields are the URL params. **Spelling**: the enum value is snake_case (`order_ai_created`) and is what is stored, sent in WS payloads and in the FCM `data.type`; the dotted slug is the i18n key suffix (`notification.order.ai_created.title`) and the name used in prose. The slug is given explicitly in the first column (the dot position is not always derivable from the underscore). Channels: ● = always; `pref` = per `NotificationPreference` (default on); — = never. Push always goes with an in-app row except where "push only" is stated. Default target when a row has none: the object's page (R-Q). Throttle keys live in Redis `nt:<type>:<scopeKey>`; "—" = one notification per event.

| Enum value · slug | Producer (service or job) | In-app | E-mail | Push | Customer msg | Throttle | Web target | `data` |
|---|---|---|---|---|---|---|---|---|
| `order_ai_created` · `order.ai_created` | `OrderService.createFromAi` (tool `create_order` inside `AiRunService`), via `OrderEffects` outbox | ● | pref | ● | — (the AI reply itself carries the recap and the order number, FL-02 step 8) | — | `/orders/:id` | `{ orderId, number, total }` |
| `conversation_handoff` · `conversation.handoff` | `AiRunService` FL-03 handoff (status `HANDOFF`/`UNKNOWN`, keyword, risky client) | ● | pref | ● | workspace system message `handoff` | — | `/inbox/:conversationId` | `{ conversationId, reason }` |
| `conversation_needs_human_message` · `conversation.needs_human_message` | `InboundProcessor` when a customer message arrives on a `needs_human` conversation | ● | — | ● | — | 10 min per conversation | `/inbox/:conversationId` | `{ conversationId }` |
| `conversation_handoff_unattended` · `conversation.handoff_unattended` | `sched-handoff-unattended` | ● (Owner) | — | ● | — | once per handoff (`Conversation.handoffRemindedAt`) | `/inbox/:conversationId` | `{ conversationId, handoffAt }` |
| `agent_insight` · `agent.insight` | `InsightService.create` (called by `AiRunService` on `UNCLEAR`/error/out-of-catalog) | ● | — | — | — | 1 per `(agentId, topicHash)` while the insight is `pending` | `/agents/:id/insights` | `{ agentId, insightId, type }` |
| `ai_error` · `ai.error` | `ReplyProcessor` final failure (≥ 3 failures / 10 min / workspace) | ● | ● | ● | — | 10 min per workspace | `/queue` | `{ provider, failures }` |
| `stock_low` · `stock.low` | `LowStockEvaluator` called by `OrderEffects` / `SaleEffects` / `StockService.adjust` / import commit | ● | pref | — | — | 24 h per product (reset by `sched-low-stock-digest-guard`) | `/products?lowStock=1` | `{ productId, variantId?, stock, minStock }` |
| `stock_out` · `stock.out` | same as `stock_low` (stock reaches 0) | ● | pref | — | — | 24 h per product | `/products?lowStock=1` | `{ productId, variantId?, stock: 0, minStock }` |
| `shipment_created` · `shipment.created` | `CourierSendProcessor` success / `ShipmentService.shipManual` | ● | — | — | tracking number (`customer.orderShipped`) | — | `/orders/:id#delivery` | `{ orderId, shipmentId, trackingNumber }` |
| `shipment_out_for_delivery` · `shipment.out_for_delivery` | `TrackingSyncProcessor` / `CourierWebhookController` status mapping | ● | — | — | status (`customer.orderOutForDelivery`) | — | `/orders/:id#delivery` | `{ orderId, shipmentId }` |
| `shipment_delivered` · `shipment.delivered` | `TrackingSyncProcessor` / `CourierWebhookController` / `POST /shipments/:id/mark-delivered` / `POST /orders/:id/deliver` | ● | — | — | status (`customer.orderDelivered`) | — | `/orders/:id#delivery` | `{ orderId, shipmentId }` |
| `shipment_failed` · `shipment.failed` | `TrackingSyncProcessor` / `CourierWebhookController` (`failureReason ∈ FailureReason`), `POST /shipments/:id/mark-failed`, and `CourierSendProcessor` final failure with `data.reason='courier_unavailable'` | ● | ● | ● | status (`customer.orderFailed`) — not sent when `reason='courier_unavailable'` | — | `/delivery?tab=all&ids=:orderId&sheet=:shipmentId` (list narrowed to the order, tracking panel open; tab Tous so a parcel no longer failed still shows; the older `/delivery?tab=failed&order=:id` is still read) | `{ orderId, shipmentId, failureReason?, reason?: 'courier_unavailable' }` |
| `shipment_returned` · `shipment.returned` | `TrackingSyncProcessor` / `CourierWebhookController`, `POST /shipments/:id/mark-returned`, `POST /orders/:id/return` | ● | ● | ● | — | — | `/orders/:id#delivery` | `{ orderId, shipmentId, failureReason? }` |
| `payment_received` · `payment.received` | `PaymentWebhookController` (order payment link paid, Chargily) | ● | ● | — | confirmation (`customer.paymentReceived`) | — | `/orders/:id#payment` | `{ orderId, paymentId, amount }` |
| `payment_failed` · `payment.failed` | `PaymentWebhookController` (Chargily `failed`/`expired`, amount mismatch) | ● | ● | — | retry link (`customer.paymentFailed`) | — | `/orders/:id#payment` | `{ orderId, paymentId, reason }` |
| `channel_needs_reconnect` · `channel.needs_reconnect` | `MetaGraphClient` error-190 mapping (from `meta-send` final failure, `sched-token-refresh`, `sched-token-health`, history sync) | ● | ● | ● | — | 24 h per channel | `/channels/:channelId` | `{ channelId }` |
| `channel_paused_by_plan` · `channel.paused_by_plan` | `LimitService.applyFreeLimits` (`sched-subscription-expiry`, `sched-dunning` J+7, downgrade) | ● | ● | — | — | — | `/settings/billing` | `{ channelId }` |
| `credits_80` · `credits.80` | `CreditService.settle` when plan usage crosses 80 % | ● | ● | ● | — | once per credit period (`CreditPeriod.notified80At`) | `/settings/credits` | `{ used, limit }` |
| `credits_exhausted` · `credits.exhausted` | `CreditService.settle`/`reserve` reaching 0 (plan + pack) and `sched-credits-exhausted-daily` | ● | ● | ● | fixed text `customer.unavailable` (FL-01 F-4) | 24 h per workspace | `/settings/credits` | `{ used, limit }` |
| `quota_80` · `quota.80` | `ReplyProcessor` eligibility check (`maxConversationsPerMonth` at 80 %) | ● | ● | — | — | once per period | `/settings/billing` | `{ used, limit }` |
| `quota_100` · `quota.100` | `ReplyProcessor` eligibility check (quota reached; AI stops) | ● | ● | — | — | once per period | `/settings/billing` | `{ used, limit }` |
| `subscription_expiring` · `subscription.expiring` | `sched-dunning` J−7 (once; no J−1) | ● | ● | ● | — | once per period (`dunningStage`) | `/settings/billing` | `{ periodEnd, invoiceId }` |
| `subscription_expired` · `subscription.expired` | `sched-dunning` J+7 and `sched-subscription-expiry` (trial end, cancelled at period end) | ● | ● | ● | — | — | `/settings/billing` | `{ periodEnd, planSlug: 'free' }` |
| `member_invited` · `member.invited` | `InvitationService.create` / `resend` | ● (Owner + Admins) | ● (invitee, template `workspace/invitation`) | — | — | resend cooldown 60 s | `/settings/members` | `{ invitationId, email, role }` |
| `member_joined` · `member.joined` | `InvitationService.accept` | ● (Owner + Admins) | — | — | — | — | `/settings/members` | `{ userId, role }` |
| `account_verify_reminder` · `account.verify_reminder` | `sched-email-verify-reminder` (day 7) | — | ● | — | — | once per user | — | — |
| `workspace_deleted` · `workspace.deleted` | `sched-workspace-purge` (after the 30-day grace) | — | ● (former owner) | — | — | — | — | `{ workspaceName }` |
| `sheets_error` · `sheets.error` | `SheetsRowSyncProcessor` / `SheetsBackfillProcessor` final failure (token errors immediately) | ● | ● | — | — | 1 h per connection | `/settings/integrations/sheets` | `{ code }` |
| `webhook_disabled` · `webhook.disabled` | `WebhookDispatchProcessor` at 50 consecutive failed deliveries | ● | ● | — | — | — | `/settings/integrations/webhooks` | `{ endpointId }` |
| `job_finished` · `job.finished` | `JobService.finish` (to `createdById`) | ● | — | — | — | — | by `kind` (`notification.catalog.ts` `jobPath`): import `/products/import?job=:id`, orders import (job name `order-import-*`) `/orders/import?job=:id`, analysis `/channels/:channelId/analysis`, history sync `/channels/:channelId/history`, bulk-send / tracking refresh / labels `/delivery?job=:id`, generation `/agents/generate?job=:id`, FAQ extraction `/agents/:agentId/configuration`, every other kind (export/report) `/reports?job=:id` (job banner, download) | `{ jobId, kind, resultUrl?, name?, channelId?, agentId? }` |
| `order_callback_due` · `order.callback_due` | `sched-order-reminders` (`Order.callbackAt <= now AND confirmationStatus='callback'`) | ● (assignee, else every Operator+) | — | ● | — | idempotency `cb:<orderId>:<callbackAt>` | `/orders/:id#calls` | `{ orderId, callbackAt }` |
| `order_status_changed` · `order.status_changed` | `OrderStateMachine.transition` when the actor ≠ assignee (bulk, courier, AI, API) | ● (assignee) | — | — | per MSG-06 (status templates) | — | `/orders/:id` | `{ orderId, from, to, actorType }` |
| `order_assigned` · `order.assigned` | `OrderAssignService` (`POST /orders/:id/assign`, `POST /orders/bulk/assign`, `notify=true`) | ● (assignee) | — | ● | — | — | `/orders/:id` | `{ orderId, assignedById }` |
| `conversation_assigned` · `conversation.assigned` | `ConversationService.assign` (`PATCH /conversations/:id { assigneeId }`, bulk assign) | ● (assignee) | — | ● | — | — | `/inbox/:conversationId` | `{ conversationId, assignedById }` |
| `channel_approved` · `channel.approved` | `sched-meta-review-poll` (IG `pending_review → active`) | ● | ● | — | — | — | `/channels/:channelId` | `{ channelId }` |
| `product_approved` · `product.approved` | `ModerationService.decide` (approve, incl. rule auto-approve) | ● grouped per day ("n produits validés") | — | — | — | grouped 24 h per workspace | `/products?moderationStatus=approved` (single: `/products/:id`) | `{ productIds[] }` |
| `product_rejected` · `product.rejected` | `ModerationService.decide` (reject) | ● | ● | ● | — | — | `/products/:id` | `{ productId, reason, rejectedFields[] }` |
| `product_changes_requested` · `product.changes_requested` | `ModerationService.decide` (request-changes) | ● | ● | — | — | — | `/products/:id` | `{ productId, merchantMessage }` |
| `moderation_appeal_result` · `moderation.appeal_result` | `ModerationService.decideAppeal` | ● | ● | — | — | — | `/products/:id` | `{ productId, outcome: 'upheld'\|'overturned' }` |
| `report_resolved` · `report.resolved` | `AbuseReportService.decide` (`notifyReporter=true`) | ● | ● | — | — | — | `/settings/security` | `{ reportId, outcome }` |
| `customer_auto_blocked` · `customer.auto_blocked` | `CustomerBlockService` auto rule (`safety/rules`: only when `autoBlockEnabled`, threshold `autoBlockAfterUncollected`) and `sched-abuse-auto-rules` | ● | — | — | — | — | `/settings/security` | `{ clientId, rule }` |
| `support_reply` · `support.reply` | `SupportTicketService.reply` (admin message with `isInternal=false`, status changes) | ● (ticket author) | ● | — | — | — | `/help/tickets/:id` | `{ ticketId }` |
| `credits_pack_purchased` · `credits.pack_purchased` | `CreditPackService.credit` (Chargily `payment-webhook`) and `IapService.validate` (`iap-validate`) | ● | ● | — | — | — | `/settings/credits` | `{ purchaseId, credits, channel }` |
| `credits_negative` · `credits.negative` | `IapService` store refund (`POST /webhooks/store/*` ⇒ `CreditLedger action=store_refund`) | ● | ● | ● | — | — | `/settings/credits` | `{ balance }` |
| `invoice_unpaid` · `invoice.unpaid` | `sched-dunning` J0 and J+3 | ● | ● | ● (+ SMS when `PlatformProvider.sms` enabled) | — | once per `dunningStage` | `/settings/billing` | `{ invoiceId, dueAt, checkoutUrl }` |
| `workspace_suspended` · `workspace.suspended` | `AdminWorkspaceService.suspend` (ADM-02 "Suspendre") — never a billing job | ● | ● | ● | — | — | `/home` | `{ reason ∈ SuspendReason }` |
| `workspace_reactivated` · `workspace.reactivated` | `AdminWorkspaceService.reactivate` | ● | ● | ● | — | — | `/home` | `{}` |
| `workspace_deletion_scheduled` · `workspace.deletion_scheduled` | `WorkspaceDeletionService` (owner `DELETE /workspace`) and `AdminWorkspaceService.scheduleDeletion` | ● | ● | — | — | — | `/settings/danger` | `{ at }` |
| `account_deletion_confirmed` · `account.deletion_confirmed` | `AccountDeletionService.confirm` (`POST /account-deletion/confirm/:token`, `POST /me/deletion-request`) | — | ● (template `auth/account-deletion-confirm`) | — | — | — | — | `{ scheduledAt }` |
| `member_role_changed` · `member.role_changed` | `MembershipService.changeRole` and `OwnershipTransferService` (both parties) | ● | ● | — | — | — | `/settings/members` | `{ userId, from, to }` |
| `agent_preset_update_available` · `agent.preset_update_available` | `sched-preset-updates` | ● | — | — | — | once per `(agentId, presetVersion)` | `/agents/:id` | `{ agentId, presetVersion }` |
| `app_update_required` · `app.update_required` | `PlatformSettingsService.saveAppVersion` (`PUT /admin/app-versions/:platform` when `minVersion` rises) — push only, to every `DeviceToken` of that platform | — | — | ● | — | once per `(platform, minVersion)` | — (`data.storeUrl`; the app shows the blocking screen) | `{ platform, minVersion, storeUrl }` |
| `app_update_recommended` · `app.update_recommended` | same, when `recommendedVersion` rises — push only | — | — | ● | — | once per `(platform, recommendedVersion)` | — (`data.storeUrl`) | `{ platform, recommendedVersion, storeUrl }` |
| `legal_reacceptance_required` · `legal.reacceptance_required` | `LegalDocumentService.publish` with `isMajor=true` | ● | ● | — | — | once per `(userId, key, version)` | `/legal/:key` (the layout interstitial opens on next load) | `{ key, version }` |
| `platform_announcement` · `platform.announcement` | `CmsService.publish` for `CmsType=announcement` (target scope paid/free/trial, plans, workspaces) | ● | pref | pref | — | — | `/notifications?announcement=:cmsEntryId` | `{ cmsEntryId, title }` |
| `job_failed` · `job.failed` | `JobService.fail` (to `createdById`) | ● | — | — | — | — | same targets as `job_finished` | `{ jobId, kind, error }` |

### 5.2 Push payload (FCM HTTP v1, data-only + notification block)

```json
{ "message": { "token": "<DeviceToken.token>",
  "notification": { "title": "<rendered>", "body": "<rendered>" },
  "data": { "type": "shipment_failed", "notificationId": "…", "path": "/delivery?tab=all&ids=…&sheet=…", "workspaceId": "…", "params": "{\"orderId\":\"…\",\"reason\":\"courier_unavailable\"}" },
  "android": { "priority": "high", "notification": { "channel_id": "djaber_default", "sound": "default" } },
  "apns": { "payload": { "aps": { "sound": "default", "badge": <unreadCount> } } } } }
```
`data.type` is always the snake_case `NotificationType` enum value (never the dotted slug); `data.path` is the web route of §5.1, which the mobile app opens as `djaber://` + path. `UNREGISTERED` / `INVALID_ARGUMENT` ⇒ delete the token. Max 20 tokens per user (`POST /me/devices` rejects the 21st with 422 `DEVICE_LIMIT { max: 20 }`; `DELETE /me/devices/:token` frees one).

### 5.3 E-mail templates (TypeScript render functions in `apps/api/src/core/mail/templates/index.ts`, locales fr/ar/en, RTL for ar)

`auth/verify`, `auth/verify-reminder`, `auth/reset`, `auth/email-change`, `auth/email-change-notice` (to the current address), `auth/2fa-disabled`, `auth/account-deletion-confirm`, `auth/account-deleted`, `workspace/invitation`, `workspace/deletion-scheduled`, `workspace/deleted`, `workspace/suspended`, `billing/invoice`, `billing/unpaid`, `billing/expiring`, `billing/expired`, `billing/payment-received`, `notification/<type>` (generic layout: title, body, CTA deep link, unsubscribe link to `/settings/notifications`), `support/ticket-reply`, `moderation/product-rejected`, `reports/resolved`, `reports/scheduled` (monthly report, `sched-report-schedules`), `workspace/ownership-transferred`, `legal/reacceptance-required`.

---

## 6. Outbound webhooks (06 §4)

Payload:
```json
{ "id": "evt_01J…", "event": "order.created", "createdAt": "2026-10-06T10:58:00Z", "workspaceId": "ws_…", "data": { … } }
```
Headers: `X-Djaber-Event`, `X-Djaber-Delivery: <deliveryId>`, `X-Djaber-Signature: t=<unixSeconds>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>`, `Content-Type: application/json`, `User-Agent: Djaber-Webhooks/1`. Receivers must reject if `|now − t| > 300 s`. Timeout 5 s; 2xx = delivered; anything else = failure.

Events and `data` shapes:

| Event | `data` |
|---|---|
| `order.created` | `OrderPublic` = `{ id, number, source, status, confirmationStatus, paymentStatus, deliveryStatus, client:{ id, name, phone }, wilayaId, communeName, address, isStopdesk, items:[{ productId, variantId, name, sku, quantity, unitPrice, total }], subtotal, discount, deliveryFee, total, amountPaid, orderedAt }` |
| `order.status_changed` | `{ order: OrderPublic, from, to, actorType, reason }` |
| `order.paid` | `{ order: OrderPublic, amountPaid, method }` |
| `order.shipped` | `{ order: OrderPublic, shipment:{ id, provider, trackingNumber } }` |
| `order.delivered` | `{ order: OrderPublic, deliveredAt }` |
| `stock.low` / `stock.out` | `{ productId, variantId?, sku, name, stock, minStock }` |
| `customer.new` | `{ client:{ id, name, phone, source, createdAt } }` |
| `payment.failed` | `{ orderId, paymentId, reason }` |
| `conversation.escalated` | `{ conversationId, channelId, clientId, reason, lastMessage }` |
| `product.updated` (Figma webhook dialog) | `{ productId, sku, changed:[…] }` |
| `ping` (test) | `{ endpointId }` |

Retry delays 1 min, 5 min, 30 min, 2 h, 12 h, 24 h; after 50 consecutive failed deliveries endpoint `isActive=false` + `webhook.disabled`; `POST /webhooks/:id/enable` resets `failureCount`; `POST /webhooks/deliveries/:id/replay` creates a new delivery with the same payload. Deliveries retained 30 d.

---

## 7. Do / Don't

**Do**
- Emit every side effect (WS, notification, send, webhook, Sheets) through `OutboxService` inside the transaction that changed the data.
- Give every job a deterministic `jobId`; make the processor safe to run twice.
- Set `TenantContext` at the top of every processor from `job.data.workspaceId`.
- Record `AiRun`/`Shipment`/`WebhookDelivery` state transitions before calling external APIs.
- Keep `removeOnFail: false` so ADM-14 can show and replay the DLQ.

**Don't**
- Don't call Meta, couriers, Chargily, Google, the store IAP APIs or an AI provider from an HTTP request handler (exceptions: `POST /delivery/couriers/:id/test`, `POST /admin/ai-providers/:key/test`, `POST /admin/providers/:key/test`, `GET /billing/checkout/return` (one Chargily status read per poll), `POST /billing/checkout` and `POST /credits/packs/checkout` (checkout creation), `GET /channels/callback/*` and `GET /integrations/google-sheets/callback` (OAuth code exchange), `PUT /integrations/google-sheets` (sheet validation / creation shown in the dialog) and `POST /integrations/google-sheets/picker-token` (M11) — all with 10 s timeouts).
- Don't process webhook bodies synchronously; persist `InboundEvent`, enqueue, ack.
- Don't emit WS events from controllers directly; go through the outbox.
- Don't retry on validation/4xx provider errors; retry only on network/5xx/429.
- Don't send promotional customer messages; only the system message keys and transactional notifications listed here.
