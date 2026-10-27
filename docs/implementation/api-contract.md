# Djaber v2 — API contract (implementation reference)

Companion of `../specs/06-api.md` (endpoints) and `../specs/05-data-model.md` (entities). This file fixes the **wire format** so that NestJS (API), Next.js (web) and Flutter (mobile) agree without reading each other's code. Types are TypeScript-like; every DTO lives in `packages/shared/src/schemas` and is the single source for zod schemas (API validation), web types and Flutter codegen. M11: the OpenAPI 3 document is generated from the running routes and their zod DTOs (`zodToOpenAPI` of nestjs-zod) and published at `/api/docs` (Swagger UI), `/api/docs/openapi.json` and `/api/docs/postman.json` (Postman v2.1).

Frame names in brackets `[FIG …]` point at the Figma page "Web V2" (id `898:24126`). Every feature is decided (`../specs/README.md` Decisions D1–D78, closed 2026-10-11); no DTO below is provisional.

---

## 1. Conventions

### 1.1 Base, versioning, content

| Topic | Rule |
|---|---|
| Base URL | `https://api.djaber.ai/api/v1` (`/api/v1` relative in web/mobile) |
| Content | `application/json; charset=utf-8`, camelCase keys, ISO-8601 UTC timestamps (`2026-10-06T10:58:00.000Z`), integer DZD for money, `null` for absent optional values (never omitted on reads) |
| Ids | UUID v7 strings |
| Dates vs instants | `*At` = instant; date-only inputs (`from`, `to`, `day`) = `YYYY-MM-DD` interpreted in `Africa/Algiers`, `to` inclusive end of day |
| Localized text | Server returns strings already localized for `Accept-Language` **except** admin resources that edit all locales (`{ fr, ar, en }` objects) |
| Request id | Every response carries `X-Request-Id`; echoed as `error.ref` |
| Deprecation | `Deprecation`/`Sunset` headers; breaking changes ⇒ `/api/v2` |

### 1.2 Authentication

| Client | Mechanism |
|---|---|
| Users (web) | `Authorization: Bearer <access JWT>`; access token **15 min**; refresh token in `httpOnly; Secure; SameSite=Lax` cookie `djaber_rt` (`Path=/api/v1/auth`; `Secure` in production; `REFRESH_COOKIE_CROSS_SITE=true` — web and API on two sites, as live (Vercel + VPS) — ⇒ `SameSite=None; Secure; Partitioned`), rotated on every `POST /auth/refresh`; revoking a session (logout, revoke-all, admin `POST /admin/users/:id/revoke-sessions`, block) puts its family id (`sid` claim) on a Redis denylist (`auth:revoked-sid:<familyId>`, TTL = access TTL + 60 s) ⇒ its access token gets 401 `UNAUTHORIZED` at once (family id + reuse detection ⇒ whole family revoked, `AUTH_REFRESH_REUSED`) |
| Users (mobile) | Same JWT; refresh token returned in the body and kept in secure storage; `POST /auth/refresh { refreshToken }` |
| 2FA | `POST /auth/login` → `{ mfaToken }` (5 min, single use) when `totpEnabled`; `POST /auth/2fa/verify { mfaToken, code | recoveryCode }` → tokens. Platform roles **must** have 2FA (`TWO_FA_REQUIRED_FOR_ROLE`) |
| Sensitive actions | Re-authentication by `password` and/or `totpCode` in the body (role changes, force update, ownership transfer, account deletion, 2FA disable) — never via a second token |
| API clients | `X-API-Key: dj_live_…` / `dj_test_…` (prefix 8 chars shown in UI); scopes per 06 §5; bound to one workspace; `X-Workspace-Id` ignored |
| Impersonation (read-only only, R-F) | `super_admin` or `support` opens `POST /admin/impersonation/sessions { workspaceId, reason (≥ 10 chars), ticketId? } → { data: { sessionId, token, expiresAt } }` (30 min); every request then carries `Authorization: Bearer <token>` + `X-Impersonation-Session: <sessionId>`; every non-GET request ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`; after `expiresAt` ⇒ `401 ADMIN_IMPERSONATION_EXPIRED`; every request audited `impersonation.action`; `DELETE /admin/impersonation/sessions/:id` ends it |

JWT access payload: `{ sub: userId, wid?: workspaceId (last used), role?: MemberRole, pr: PlatformRole, imp?: impersonationSessionId, iat, exp }`. The WebSocket handshake reuses the access token (06 §6); `auth.expiring` is emitted 60 s before `exp`.

### 1.3 Tenancy

- `X-Workspace-Id: <uuid>` on every user request. Missing ⇒ the user's `ownedWorkspaceId`, else last used, else `400 WORKSPACE_REQUIRED`.
- Not a member ⇒ `404 NOT_FOUND` (never 403, to avoid leaking existence). `Workspace.status='suspended'` ⇒ `403 WORKSPACE_SUSPENDED` (except `GET /workspace`, `/me*`, `/support/*`). `Workspace.status='deletion_scheduled'` ⇒ every mutation ⇒ `409 WORKSPACE_DELETION_SCHEDULED {at}` (except `POST /workspace/deletion/cancel`).
- `readOnly` members (plan limit) get `403 READ_ONLY_MEMBER` on every mutation.
- Admin routes (`/admin/*`) ignore `X-Workspace-Id` and take `workspaceId` as a path/query param.

### 1.4 Success envelope

```ts
// single resource
{ data: T, meta?: { warnings?: Warning[] } }
// list (offset)
{ data: T[], meta: { page: number, pageSize: number, total: number, warnings?: Warning[] } }
// list (cursor: messages, notifications, inbox)
{ data: T[], meta: { nextCursor: string | null, hasMore: boolean } }
// async job
202 { data: { jobId: string } }
// bulk
200 { data: { results: BulkResult[] }, meta: { ok: number, failed: number } }

type Warning = { code: string; params?: Record<string, string | number>; field?: string };
type BulkResult = { id: string; ok: boolean; error?: ApiErrorBody; data?: unknown };
```

The 06 §1 envelope above is the only success shape; any `{ items, page, pageSize, total }`, `{ results: [...] }` or `{ jobId }` shorthand in the specs reads as `data` / `meta.page` / `meta.pageSize` / `meta.total`, `{ data: { results } }` and `{ data: { jobId } }`.

### 1.5 Error envelope

```ts
type ApiErrorBody = {
  code: string;                       // 11-error-catalogue key, e.g. "ORDER_INVALID_TRANSITION"
  message: string;                    // localized (Accept-Language), safe to display
  params?: Record<string, string | number>; // interpolation values ({from, to, limit…})
  fields?: Record<string, string>;    // field → validation key ("validation.phone")
  details?: unknown;                  // provider message, per-item errors, courier field mapping
  ref: string;                        // request id (X-Request-Id) — shown in support tickets
};
// HTTP body
{ error: ApiErrorBody }
```

Status codes: 400 malformed · 401 unauthenticated · 402 `INSUFFICIENT_CREDITS` · 403 forbidden / plan / suspended / `LEGAL_REACCEPT_REQUIRED` · 404 not found or other workspace · 409 conflict (`CONFLICT` with `details: { changedBy, changedAt, current }` for merge-by-section `[FIG DLG Modifié par quelqu'un d'autre]`; `WORKSPACE_DELETION_SCHEDULED`) · 410 expired tokens · 413/415 uploads · 422 validation / business rule · 426 `APP_UPDATE_REQUIRED {minVersion, storeUrl, message}` · 429 `RATE_LIMITED` (+ `Retry-After`) · 500 `INTERNAL` · 503 provider down / `MAINTENANCE_MODE {until}`.

### 1.6 Pagination, filtering, sorting

| Param | Format | Notes |
|---|---|---|
| `page`, `pageSize` | ints; `pageSize ∈ {25, 50, 100}` (default 25; inbox/messages/notifications use `cursor` + `limit ≤ 50`, default 50) | `[FIG "1–25 sur 31 · 25 / page"]` |
| `cursor` | opaque base64 of `(sortValue, id)` | stable under inserts |
| multi-value | comma list: `status=new,confirmed` | arrays also accepted as `status[]=` |
| ranges | `min<Field>` / `max<Field>` ints | `minTotal=1000&maxTotal=20000` |
| dates | `from=YYYY-MM-DD&to=YYYY-MM-DD` **or** `period=today\|7d\|30d\|month\|last_month\|90d\|year\|custom` | custom ≤ 732 d (`REPORT_RANGE_TOO_LONG`) |
| search | `q=` server-side (ILIKE / trigram), min 2 chars, client debounces 300 ms | |
| sort | `sort=-orderedAt,clientName` (leading `-` = desc); whitelisted per list (§4) | unknown field ⇒ `400 BAD_REQUEST` |
| saved views | `view=<savedViewId>` expands stored filters; explicit params override | D42 |
| KPIs | `GET …/stats` accepts the same filters as the list; "KPIs follow the filters" `[FIG ORD-05 filter panel]` | |
| includes | `include=client,items` on detail endpoints only (documented per DTO) | |
| state in URL | the web app mirrors all list params in the URL (shareable, back-navigation) | `[FIG REF Filtres]` |

### 1.7 Idempotency

- Header `Idempotency-Key: <uuid v4>` generated per submit attempt and reused on retry.
- **Required** (400 `IDEMPOTENCY_KEY_MISSING`) on: `POST /orders`, `/orders/:id/payments`, `/orders/:id/status`, `/orders/bulk/*`, `/orders/:id/shipments`, `/shipments/bulk`, `/sales`, `/sales/:id/payments`, `/purchases`, `/purchases/:id/receive`, `/purchases/:id/payments`, `/stock/adjustments`, `/inventories/:id/validate`, `/cash`, `/cash/close`, `/conversations/:id/messages`, `/billing/checkout`, `/credits/packs/checkout`, `/credits/packs/iap/validate`, `/products/import/:jobId/commit`, `/orders/import/:jobId/commit`, every AI tool write (`create_order`, keyed by `aiRunId:callId`).
- Optional elsewhere. Scope = `(workspaceId, actorKey, key)`; stored 24 h; same key + different body ⇒ `422 IDEMPOTENCY_MISMATCH`; replay ⇒ stored status + body + header `Idempotent-Replayed: true`.
- Mobile: queue nothing offline (MOB-07); the key is created when the user taps submit and kept until a 2xx/4xx arrives.

### 1.8 Optimistic concurrency

`PATCH` bodies of Order, Product, Agent, Conversation, Workspace settings carry `version`; mismatch ⇒ `409 CONFLICT` with `details.current` (full current resource) so the client can merge by section and resubmit `[FIG AGT-04 CONFLIT 409]`.

### 1.9 Rate limits (per 02 AUTH-08 + Figma)

| Scope | Limit | Code |
|---|---|---|
| Login | 5 failures / 15 min / IP+email | `RATE_LIMITED` |
| Forgot password, verify resend, public account deletion | 3 / h / email (deletion: 3 / h / IP) | |
| 2FA verify | 5 / 15 min / mfaToken | |
| Users | 1 200 req / min / user | |
| API keys | 600 req / min / key (`X-RateLimit-Limit/Remaining/Reset` headers) | |
| Playground | 60 turns / h / workspace | `PLAYGROUND_RATE_LIMITED` |
| Page analysis / agent generation | 3 / day / workspace (generation 1 / page / 24 h) | `ANALYSIS_RATE_LIMITED` |
| Channel info sync | 1 / 10 min / channel | `RATE_LIMITED` |
| Shipment sync | 1 / 5 min / shipment | `TRACKING_SYNC_RATE_LIMITED {retryAfter}` |
| Stock recommendations regenerate | 1 / 10 min / workspace | `RECO_RATE_LIMITED` |
| Invitation resend | 60 s cooldown | `RATE_LIMITED` |

### 1.10 Uploads

`POST /uploads` multipart `{ file, kind }` → `{ id, url, mime, size, width?, height? }`. Limits: image ≤ 5 MB (jpeg/png/webp/gif), pdf ≤ 10 MB, audio ≤ 25 MB, csv/xlsx ≤ 5 MB, docx/txt ≤ 5 MB. Errors `UPLOAD_TOO_LARGE {max}`, `UPLOAD_TYPE_INVALID`, `IMAGE_TOO_LARGE`, `IMAGE_TYPE_INVALID`; warning `IMAGE_SMALL {px}` below 600 px. Product images: 10 images per product (`IMAGES_LIMIT`), 5 MB each, min 600 px.

### 1.11 Jobs

`202 { data: { jobId } }` → `GET /jobs/:id` → `JobDto`; WebSocket `job.updated`; `job.finished` / `job.failed` notification. Job results with files expose `resultUrl` (signed, 24 h).

```ts
type JobDto = {
  id: string; kind: JobKind; status: 'queued'|'running'|'done'|'partial'|'failed'|'cancelled';
  progress: number; total: number | null;           // 0–100, or processed/total
  result: unknown | null;                            // per-kind payload (e.g. BulkResult[] for bulk jobs)
  resultUrl: string | null; error: ApiErrorBody | null;
  createdAt: string; updatedAt: string; expiresAt: string | null;
};
```

### 1.12 Role enforcement

Every handler declares `@RequirePermission('<group>.<action>')` (02 §3 + 06 §9) or `@PlatformRole(...)`; the API never relies on the UI hiding a button. "Actions ⌄" menus `[FIG ORD-05 v2]` are built from `GET …/:id` → `actions: ActionDescriptor[]` so that forbidden items are greyed with the right code:

```ts
type ActionDescriptor = { key: string; enabled: boolean; reasonCode?: string; primary?: boolean; shortcut?: string };
```

---

## 2. Shared primitives

Every enum union not written inline (`ChannelStatus`, `SubscriptionStatus`, `MemberRole`, `PlatformRole`, `NotificationType`, `CreditAction`, `PaymentMethod`, `PaymentMethodBilling`, `DeliveryStatus`, `MovementType`, `CallResult`, `CashCategory`, `JobKind`, `ReportType`, `TicketCategory`, …) = the Prisma enum of the same name in `prisma-schema.prisma`, values verbatim.

```ts
type Locale = 'fr' | 'ar' | 'en';
type LocalizedText = { fr: string; ar?: string; en?: string };
type Money = number;                       // integer DZD
type Pill<T extends string> = T;           // enum rendered with the Component sheet colours [FIG REF]
type UserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
type ClientRef = { id: string; name: string; phone: string | null; riskLevel: 'normal'|'high'; isPlaceholder: boolean; blocked: boolean; orderCount: number };
type ChannelRef = { id: string; platform: 'facebook'|'instagram'; name: string; avatarUrl: string | null; status: ChannelStatus };
type AgentRef = { id: string; name: string; status: 'draft'|'active'|'paused' };
type ProductRef = { id: string; name: string; sku: string; price: Money; primaryImageUrl: string | null; hasVariants: boolean; trackStock: boolean };
type Address = { wilayaId: number; wilayaName: string; communeId: number | null; communeText: string | null; address: string | null; isStopdesk: boolean; stopdeskId: string | null; stopdeskName?: string | null };
type SourceBadge = { source: 'ai'|'manual'|'mobile'|'api'|'import'; agent?: AgentRef; channel?: ChannelRef; user?: UserRef; apiKeyName?: string; importFileName?: string }; // [FIG ORD-05 v2 SOURCE column]
```

---

## 3. Per-module DTOs

Only the main resources; secondary ones follow the same `XxxDto` / `CreateXxxDto` / `UpdateXxxDto` pattern with the fields of 05.

### 3.1 Auth & account

```ts
type LoginDto = { email: string; password: string; device?: { platform: 'web'|'android'|'ios'; name?: string; appVersion?: string } };
type LoginResult = { accessToken: string; refreshToken?: string /* mobile only */; expiresIn: 900; user: MeDto } | { mfaToken: string };
type MeDto = {
  id: string; email: string; firstName: string; lastName: string; phone: string | null; locale: Locale; avatarUrl: string | null;
  emailVerifiedAt: string | null; totpEnabled: boolean; platformRole: PlatformRole; status: 'active'|'blocked'|'deletion_scheduled';
  ownedWorkspaceId: string | null; prefs: UserPrefs; memberships: { workspaceId: string; name: string; logoUrl: string | null; role: MemberRole; readOnly: boolean }[];
  pendingLegal: { key: 'terms'|'privacy'|'account_deletion'|'content_rules'; version: number; url: string }[];   // D39; same rows as GET /legal/pending
  deletionScheduledAt: string | null;
};
type UserPrefs = { listDensity: 'compact'|'comfortable'; soundOnMessage: boolean; dismissedAnnouncementIds: string[]; reportFavorites: string[] };
type SavedViewDto = { id: string; page: SavedViewPage; name: string; filters: Record<string, unknown>; sort: string | null; columns: string[]; density: 'compact'|'comfortable'|null; isDefault: boolean; isShared: boolean; sharedBy: UserRef | null };
type DeletionRequestDto = { id: string; status: 'pending_confirmation'|'grace'|'blocked'|'anonymised'|'cancelled'; requestedAt: string; scheduledAt: string | null; blockedReason: 'ACCOUNT_OWNS_WORKSPACE'|'WORKSPACE_HAS_DEBT'|null; exportUrl: string | null };
type DeviceDto = { token: string; platform: 'android'|'ios'|'web'; appVersion: string; deviceName: string | null; locale: Locale; lastSeenAt: string };   // POST /me/devices (≤ 20 per user, DEVICE_LIMIT {max: 20}; upsert on token) · DELETE /me/devices/:token
type LegalPendingDto = { key: 'terms'|'privacy'|'account_deletion'|'content_rules'; version: number; url: string }[];   // GET /legal/pending · POST /legal/accept { key, version } → 204
```

### 3.2 Workspace & members

```ts
type WorkspaceDto = {
  id: string; name: string; slug: string; logoUrl: string | null; phone: string | null; address: string | null; senderWilayaId: number | null;
  locale: Locale; timezone: string; stockMode: 'simple'|'advanced'; onboardingStep: number; freeDeliveryThreshold: Money | null;
  autoPauseOnManualReply: boolean; handoffReminderMin: number; onlinePaymentEnabled: boolean; autoSendToCourier: boolean; defaultCourierAccountId: string | null;
  targetMarginPct: number; systemMessages: Record<'handoff'|'out_of_hours'|'out_of_stock'|'welcome', LocalizedText>;   // R-G; defaults seeded at creation
  status: 'active'|'suspended'|'deletion_scheduled'; suspendReason: 'fraud'|'unpaid'|'content'|'owner_request'|'other'|null; deletionScheduledAt: string | null;
  trustLevel: 'new'|'standard'|'trusted'|'watch';                                   // D36, D52
  safetyRules: { riskAfterReturns: number; autoBlockEnabled: boolean /* default false: the auto-block rule is OFF until switched on */; autoBlockAfterUncollected: number /* its threshold, ≥ 1, default 3 */; handoffOnRisk: boolean }; blockedWords: string[]; // D37
  billingInfo: { companyName?: string; nif?: string; address?: string } | null;
  plan: { slug: string; name: string; limits: PlanLimits; usage: PlanUsage; periodEnd: string; status: SubscriptionStatus };
  version: number;
};
type PlanLimits = { maxPages: number; maxAgents: number; maxProducts: number; maxConversationsPerMonth: number; maxMembers: number; maxApiKeys: number; maxWebhooks: number; monthlyCredits: number; features: string[] }; // -1 = unlimited
type PlanUsage = { pages: number; agents: number; products: number; conversationsThisMonth: number; members: number; creditsUsed: number };
type MemberDto = { id: string; user: UserRef & { email: string }; role: MemberRole; readOnly: boolean; joinedAt: string; lastSeenAt: string | null };
type InvitationDto = { id: string; email: string; role: MemberRole; sentAt: string; expiresAt: string; resendAvailableAt: string };
```

### 3.3 Channels & inbox

```ts
type ChannelStatus = 'active'|'paused'|'pending_review'|'needs_reconnect'|'disabled'|'disconnected';
type ChannelDto = {
  id: string; platform: 'facebook'|'instagram'; externalId: string; name: string; avatarUrl: string | null; followersCount: number | null;
  status: ChannelStatus; pausedReason: 'manual'|'plan'|null; parentChannelId: string | null; agent: AgentRef | null; icebreaker: string | null;
  counts: { conversations: number; active: number; needsHuman: number; unread: number; messages7d: number; inbound7d: number; productsInScope: number };
  health: { webhookSubscribed: boolean; tokenValid: boolean; tokenCheckedAt: string | null; permissions: Record<string, 'granted'|'pending'|'missing'>; lastInboundAt: string | null; lastSyncAt: string | null };
  connectedAt: string; connectedBy: UserRef; actions: ActionDescriptor[];
};
type ConversationListItemDto = {
  id: string; channel: ChannelRef; client: ClientRef; status: 'active'|'needs_human'|'resolved'|'archived'; aiPaused: boolean; agent: AgentRef | null;
  pageHasAgent: boolean;                                                                // an agent is linked to the page: pauseAi / resumeAi descriptors refused with `CONVERSATION_NO_AGENT` otherwise (unless `agent` answered it)
  assignee: UserRef | null; unreadCount: number; lastMessageAt: string; lastMessagePreview: string; lastMessageDirection: 'in'|'out';
  within24h: boolean; lastAiIntent: AiIntent | null; language: string | null; handoffReason: string | null; blocked: boolean; cart: { items: number; recapShownAt: string | null; orderId: string | null } | null;
};
type MessageDto = {
  id: string; direction: 'in'|'out'; type: MessageType; author: 'customer'|'ai'|'human'|'system'; authorUser: UserRef | null; agent: AgentRef | null;
  text: string | null; attachments: { type: string; url: string; mime: string; size: number; caption?: string; width?: number; height?: number; durationSec?: number }[];
  transcript: string | null; transcriptStatus: 'pending'|'done'|'failed'|'too_long'|null;
  payload: { cards?: { productId: string; name: string; price: Money; imageUrl: string | null; variants?: string }[]; postback?: string; quickReplies?: string[]; system?: { kind: string; params: Record<string, unknown> } } | null;
  sentAt: string; deliveryStatus: 'pending'|'sent'|'failed'|'skipped_window'; error: string | null; aiRunId: string | null; customerReaction: 'like'|'dislike'|null;
};
type SendMessageDto = { text?: string; uploadId?: string; quickReplyId?: string };    // Idempotency-Key required
type ConversationCounts = { all: number; active: number; needs_human: number; resolved: number; archived: number; unread: number; blocked: number };
```

### 3.4 Agents & AI

```ts
type AgentDto = {
  id: string; name: string; description: string | null; status: 'draft'|'active'|'paused'; pausedReason: 'manual'|'plan'|null; isActive: boolean;
  personality: 'professional'|'friendly'|'casual'|'technical'; customInstructions: string; productCardTemplate: string | null; closingInstructions: string | null; humanHandoffRules: string | null;
  model: { id: string; label: string; provider: string }; temperature: number; maxTokens: number; responseDelaySec: number;   // model/temperature/maxTokens are read-only (R-H: assigned by AiRoute + preset)
  sellAllProducts: boolean; productCount: number; imageRecognition: boolean; voiceTranscription: boolean;
  channels: ChannelRef[]; preset: { key: string; name: string; version: number; updateAvailable: number | null } | null;
  currentVersion: number; lastActiveAt: string | null; scheduledActivateAt: string | null; wizardStep: number | null;
  wizard: AgentWizardFields | null;                                                     // 05 §15, D54: the structured Agent columns, compiled server-side into customInstructions / humanHandoffRules at every save
  metrics30d: { conversations: number; handledWithoutHuman: number; orders: number; confirmedPct: number; delivered: number; avgLatencyMs: number; p95LatencyMs: number; credits: number; satisfaction: { score: number; votes: number } | null };
  pendingInsights: number; version: number; actions: ActionDescriptor[];
};
type AgentWizardFields = {
  displayName: string | null; avatarMode: 'page'|'upload'|'initials'; avatarUrl: string | null;
  languages: ('darija'|'arabizi'|'fr'|'ar'|'kabyle'|'en')[]; defaultLanguage: string | null; tone: 'warm'|'professional'|'casual'|'premium'|null; formality: 'follow_customer'|'tu'|'vous'|null; emojiLevel: 'none'|'moderate'|'many'|null;
  catalogScope: 'all'|'categories'; scopeCategoryIds: string[]; outOfStockBehavior: 'say_unavailable'|'suggest_alternative'; showMissingVariants: boolean;
  policies: { delivery?: string; payment?: string; returns?: string; hours?: string }; faqCount: number;
  capabilities: { replyText: boolean; imageRecognition: boolean; voiceTranscription: boolean; takeOrders: boolean; quoteDelivery: boolean; crossSell: boolean };
  orderFields: { key: 'product'|'quantity'|'name'|'phone'|'wilaya'|'commune'|'address'|'phone2'|'note'; required: boolean; locked: boolean }[];
  maxQtyPerOrder: number | null; maxAmountPerOrder: Money | null; riskyClientBehavior: 'take_and_flag'|'handoff'; recapMode: 'always'|'when_unsure';
  handoffRules: { kind: 'human_request'|'refund'|'complaint'|'anger'|'3_unclear'|'off_topic'|'over_limits'|'risky_client'|'keyword'; enabled: boolean }[]; handoffKeywords: string[];
  businessHours: { from: string; to: string; days: number[] } | null;               // handoff / out-of-hours texts = Workspace.systemMessages (R-G)
};
type UpdateAgentDto = Partial<Omit<AgentDto, 'id'|'metrics30d'|'actions'|'channels'|'model'|'temperature'|'maxTokens'>> & { channelIds?: string[]; productIds?: string[]; step?: 1|2|3|4|5; version: number; note?: string };
type AgentVersionDto = { version: number; createdAt: string; createdBy: UserRef; note: string | null; source: string; isCurrent: boolean };
type AgentReadinessDto = { ready: boolean; checks: { key: string; ok: boolean; label: string; count?: number; link?: string }[] };
type PlaygroundTurnDto = { reply: string; status: 'OK'|'UNCLEAR'|'UNKNOWN'|'HANDOFF'; intent: AiIntent; confidence: number; model: string; tokens: { input: number; output: number }; latencyMs: number; toolCalls: { name: string; args: unknown; result: unknown; simulated: boolean }[]; cards: ProductRef[]; creditsInProd: number; language: string; promptPreview: string[] };
type AgentInsightDto = { id: string; type: 'unclear'|'unknown_topic'|'handoff'|'error'; customerMessage: string; aiResponse: string | null; detail: string | null; conversationId: string; messageId: string | null; status: 'pending'|'resolved'|'dismissed'; topicKey: string | null; occurrences: number; channel: ChannelRef; createdAt: string };
type AiRunDto = { id: string; kind: string; status: string; intent: AiIntent | null; model: string; provider: string; usedFallback: boolean; tokens: { input: number; output: number }; latencyMs: number | null; confidence: number | null; credits: number; toolCalls: { name: string; args: unknown; result: unknown }[]; error: string | null; startedAt: string };
```

### 3.5 Catalogue & stock

```ts
type ProductListItemDto = {
  id: string; sku: string; name: string; category: { id: string; name: string; color: string } | null; unit: { id: string; abbreviation: string } | null;
  price: Money; oldPrice: Money | null; costPrice: Money | null; marginPct: number | null; trackStock: boolean; sellOutOfStock: boolean /* orders accepted at zero stock, PV 22/10 */; stock: number | null; minStock: number; stockState: 'ok'|'low'|'out'|'untracked';
  hasVariants: boolean; variantSummary: string | null; isActive: boolean; archived: boolean; primaryImageUrl: string | null;
  aiState: 'proposed'|'excluded'; moderation: { status: 'not_required'|'pending'|'approved'|'rejected'|'appealed'; etaLabel?: string; reason?: string } | null; // [FIG MOD list pills]
  updatedAt: string; actions: ActionDescriptor[];
};
type ProductDto = ProductListItemDto & {
  description: string | null; weightGrams: number | null; keywords: string[]; images: { id: string; url: string; width: number; height: number; isPrimary: boolean; altText: string | null; moderationFlag: string | null }[];
  variants: VariantDto[]; stockDetail: { total: number | null; reserved: number; availableForAi: number; lastInventoryAt: string | null }; // `stock` stays the number of ProductListItemDto
  pricing: { weightedCost: Money | null; expensesPerUnit: Money; trueCost: Money | null; marginDzd: Money | null; marginPct: number | null; sales30d: { units: number; revenue: Money } };
  agents: AgentRef[]; mentions30d: { conversations: number; orders: number }; moderationDetail: ModerationDetailDto | null; version: number;
};
type VariantDto = { id: string; name: string; sku: string | null; attributes: Record<string, string>; price: Money; costPrice: Money | null; stock: number; minStock: number; isActive: boolean; stockState: 'ok'|'low'|'out' };
type ModerationDetailDto = { status: string; submittedAt: string; decidedAt: string | null; decision: string | null; merchantMessage: string | null; rejectedFields: string[]; rules: string[]; history: { at: string; status: string; actor: 'system'|'moderator'|'merchant'; note: string | null }[]; appeal: { status: 'available'|'used'|'expired'; deadlineAt: string | null; decision: string | null } };
type StockAdjustmentDto = { productId: string; variantId?: string; type: 'in'|'out'|'set'; quantity: number; reason: 'breakage'|'loss'|'initial'|'inventory'|'correction'|'other'; note?: string; force?: boolean };
type StockMovementDto = { id: string; product: ProductRef; variant: { id: string; name: string } | null; type: MovementType; quantity: number; before: number; after: number; reason: string | null; note: string | null; reference: { type: string; id: string; label: string } | null; actor: UserRef | null; createdAt: string };
type InventoryCountDto = { id: string; number: string; scope: 'all'|'category'|'alerts_only'; categoryId: string | null; status: 'draft'|'counting'|'validated'|'cancelled'; blockCounterSales: boolean; lines: { productId: string; variantId: string | null; name: string; expectedQty: number; countedQty: number | null; difference: number; differencePct: number; note: string | null }[]; summary: { lines: number; discrepancies: number; value: Money }; startedBy: UserRef; startedAt: string; validatedAt: string | null };
type BulkPriceDto = { ids: string[]; op: 'increase'|'decrease'|'set'; value: number; unit: 'percent'|'dzd'; roundUpTens?: boolean; applyToVariants?: boolean; preview?: boolean };
type StockRecommendationDto = { id: string; type: 'restock'|'stockout_imminent'|'promote'|'price'|'supplier'|'agent'; priority: 'high'|'medium'|'low'; status: string; title: string; body: string; rule: string; suggestedAction: { kind: string; label: string; params: Record<string, unknown> }; product: ProductRef | null; supplier: { id: string; name: string } | null; agent: AgentRef | null; estimatedValue: Money | null; generatedAt: string; snoozedUntil: string | null }; // GDS-10, /stock-recommendations*
```

### 3.6 Clients

```ts
type ClientListItemDto = ClientRef & { phone2: string | null; source: 'manual'|'ai'|'import'|'api'; totalSpent: Money; lastOrderAt: string | null; tags: string[]; channels: ChannelRef[]; quality: ('placeholder'|'no_phone'|'no_address'|'duplicate')[]; createdAt: string; actions: ActionDescriptor[] };
type ClientDto = ClientListItemDto & { email: string | null; notes: string | null; addresses: (Address & { id: string; isDefault: boolean })[]; metrics: { orders: number; spent: Money; returns: number; returnPct: number; cancels: number; conversations: number }; mergedFrom: { id: string; name: string; at: string }[]; recentOrders: OrderListItemDto[]; conversations: ConversationListItemDto[] };
type MergeClientsDto = { keepId: string; mergeId: string };
```

### 3.7 Orders

```ts
type OrderStatus = 'new'|'confirmed'|'preparing'|'shipped'|'delivered'|'cancelled'|'returned';
type OrderListItemDto = {
  id: string; number: string; orderedAt: string; client: ClientRef; source: SourceBadge; assignee: UserRef | null;
  items: { name: string; variant: string | null; qty: number }[]; itemCount: number; total: Money; amountPaid: Money; remaining: Money;
  status: OrderStatus; confirmationStatus: 'pending'|'no_answer'|'confirmed'|'rejected'|'wrong_number'|'callback'; callAttempts: number; callbackAt: string | null;
  paymentStatus: 'unpaid'|'partial'|'paid'|'pending_link'|'refunded'; paymentMethod: PaymentMethod; deliveryStatus: DeliveryStatus; shipment: { provider: string; trackingNumber: string | null; status: ShipmentStatus; stale: boolean } | null;
  wilaya: { id: number; name: string } | null; isStopdesk: boolean; riskLevel: 'normal'|'high'; channel: ChannelRef | null; conversationId: string | null; labelPrintedAt: string | null; actions: ActionDescriptor[];
};
type OrderDto = OrderListItemDto & {
  clientName: string; clientPhone: string; clientPhone2: string | null; address: Address | null; items: OrderItemDto[];
  subtotal: Money; discount: Money; tax: Money; deliveryFee: Money; courierCost: Money | null; returnFee: Money | null; feeExplanation: string; // "GRILLE SÉTIF · DOMICILE 400 → OFFERTE"
  notes: string | null; cancelReason: string | null; cancelNote: string | null;
  payments: PaymentEntryDto[]; paymentLink: { url: string; status: string; expiresAt: string } | null;
  calls: { id: string; user: UserRef; result: CallResult; callbackAt: string | null; notes: string | null; calledAt: string }[];
  history: { at: string; effectiveAt: string | null; actor: { type: string; name: string }; field: string; from: string | null; to: string; reason: string | null }[];
  shipments: ShipmentDto[]; orderNotes: { id: string; author: UserRef; body: string; createdAt: string }[]; sheetsSynced: boolean;
  confirmedAt: string | null; shippedAt: string | null; deliveredAt: string | null; cancelledAt: string | null; version: number;
};
type OrderItemDto = { id: string; product: ProductRef; variantId: string | null; productName: string; variantName: string | null; sku: string | null; unitPrice: Money; costPrice: Money | null; quantity: number; discount: Money; total: Money; stockWarning: 'last_unit'|'insufficient'|null };
type CreateOrderDto = {
  client: { id: string } | { name: string; phone: string; phone2?: string; email?: string };
  items: { productId: string; variantId?: string; quantity: number; unitPrice?: Money; discount?: Money }[];
  delivery?: { wilayaId: number; communeId?: number; communeText?: string; isStopdesk: boolean; stopdeskId?: string; address?: string; deliveryFee?: Money /* Admin+ override */ };
  paymentMethod: PaymentMethod; amountPaid?: Money; discount?: Money; notes?: string; status: 'new'|'confirmed'; orderedAt?: string; conversationId?: string; assigneeId?: string;
};
type OrderStatusChangeDto = { to: OrderStatus; reason?: string; note?: string; effectiveAt?: string; amountCollected?: Money; restoreStock?: boolean; returnFee?: Money; notifyCustomer?: boolean; version: number };
type CallLogDto = { result: CallResult; callbackAt?: string; notes?: string };
type PaymentEntryDto = { id: string; amount: Money; method: PaymentMethod; reference: string | null; note: string | null; paidAt: string; createdBy: UserRef };
type OrderStatsDto = { total: number; toConfirm: number; noAnswer: number; uncalledOver2h: number; confirmedNotSent: number; inTransit: number; staleOver5d: number; delivered30d: number; deliveredPct30d: number; returns: number; revenue30d: Money; sourceMix: { ai: number; manual: number; mobile: number; api: number; import: number } }; // [FIG ORD-05 v2 KPIs]
type ExportOrdersDto = { scope: 'selection'|'filter'|'all'; ids?: string[]; format: 'csv'|'xlsx'|'pdf'; columns: 'standard'|'all'; includeItems?: boolean; courierFormat?: 'zrexpress' };
```

### 3.8 Delivery

```ts
type ShipmentStatus = 'pending'|'sent'|'picked_up'|'in_transit'|'out_for_delivery'|'delivered'|'failed'|'returned'|'cancelled'|'stale';
type ShipmentDto = {
  id: string; orderId: string; orderNumber: string; client: ClientRef; provider: 'manual'|'zrexpress'|'ecotrack'|'yalidine'; courierAccount: { id: string; displayName: string } | null;
  status: ShipmentStatus; trackingNumber: string | null; labelUrl: string | null; publicTrackingUrl: string; codAmount: Money; weightKg: number | null; contentSummary: string | null;
  address: Address; courierCost: Money | null; failureReason: 'address'|'unreachable'|'refused'|'damaged'|'other'|null; deliveryAttempts: number; lastError: string | null;
  lastSyncedAt: string | null; syncAvailableAt: string | null; portalUrl: string | null; events: { at: string; rawStatus: string; mappedStatus: ShipmentStatus | null; description: string | null; location: string | null; source: string; actor: UserRef | null }[];
  createdAt: string; actions: ActionDescriptor[];
};
type CreateShipmentDto = { courierAccountId?: string; wilayaId: number; communeId?: number; communeText?: string; address?: string; isStopdesk: boolean; stopdeskId?: string; codAmount?: Money; weightKg?: number; contentSummary?: string };
type DeliveryOverviewDto = { toSend: number; pendingPickup: number; inTransit: number; staleOver5d: number; failedToday: number; delivered30d: number; deliveredPct30d: number; returned30d: number; returnedPct30d: number; avgDays: number | null; byCourier: { provider: string; sent: number; delivered: number; failed: number; returned: number; avgDays: number | null; codCollected: Money }[] };
type CourierAccountDto = { id: string; provider: 'zrexpress'|'ecotrack'|'yalidine'; displayName: string; baseUrl: string; isActive: boolean; isDefault: boolean; sender: { name: string | null; phone: string | null; address: string | null; wilayaId: number | null }; capabilities: { parcel: boolean; tracking: boolean; label: boolean; rates: boolean; stopdesk: boolean; cancel: boolean; retry: boolean }; lastTest: { at: string; ok: boolean; latencyMs: number | null; error: string | null } | null; stats: { sent: number; failed30d: number; activeShipments: number }; credentialsSet: true };
type FeeRuleDto = { wilayaId: number; code: string; nameFr: string; nameAr: string; homePrice: Money; stopdeskPrice: Money; returnPrice: Money; isActive: boolean; source: 'default'|'custom'; courierCost: Money | null };
type FeeQuoteDto = { fee: Money; base: Money; free: boolean; reason: string; courierCost: Money | null; wilayaServed: boolean };
```

**M6 additions** (zod schemas and view types in `packages/shared/src/schemas/delivery.ts`; names there are the wire names):

- `ShipmentDto` also carries `error: { code, field, message } | null` (courier validation field), `lastEventAt`, `noMovement` ("Sans mouvement"), `returnPending` (courier return not yet confirmed), `labelSource: 'courier'|'djaber'`; `labelUrl` is always null (labels through `GET /shipments/:id/label`); `actions` = `sync, label, retry, retry_delivery, change_courier, cancel, mark_failed, mark_delivered, mark_returned, open_order, call_client`.
- `CourierAccountDto` also carries `credentialHints` (masked `••••3f9a`, EcoTrack `baseUrl` in clear), `webhookUrl`, `webhookSecretSet`, `createdAt`, `updatedAt`, `actions`; `capabilities` adds `webhook`, `batchTrack`. `GET /delivery/couriers/providers` → `CourierProviderView[]` (per-provider fields, `labelSource`; `manual` = "Livraison propre", `account: false`). Create body = discriminated union on `provider` (`credentials` = `{ token, key }` | `{ baseUrl, token }` | `{ apiId, apiToken }`, + `displayName?`, `isDefault?`, `isActive?`, `sender?`, `webhookSecret?`); ZR Express: `credentials` = `{ apiKey, tenantId }` (new platform, account `baseUrl` = `https://api.zrexpress.app`) or `{ token, key }` (Procolis, `baseUrl` ''); `CourierAccountDto.platform` = `app` | `procolis` (null for the other providers), capabilities per platform; the ZR entry of `/providers` adds `platforms[]` (`app` first) with their own fields / capabilities / `labelSource`. `POST /delivery/couriers/:id/test` → `CourierTestResultView` (200 also when the test fails: `ok:false`, `error: COURIER_CREDENTIALS_INVALID|COURIER_UNAVAILABLE`).
- `POST /orders/:id/shipments` → **202** `{ data: ShipmentDto }` (`pending`); body adds `note?`. `POST /shipments/bulk { orderIds, courierAccountId?, weightKg? }` → 202 `{ data: { jobId } }`, `Job.result = { results: BulkSendRowResult[], ok, failed, queued }`. `POST /shipments/bulk/sync { ids }` → 202 job; `POST /shipments/bulk/ship-manual { ids }` (order ids) → bulk results.
- `POST /shipments/:id/cancel { then: confirmed|cancelled, reason?, note? }` → 200 (not created yet / manual) or 202 (courier asked by the worker); `retry`, `retry-delivery`, `change-courier`, `sync` → 202 `{ data: ShipmentDto }`; `mark-failed { reason, note? }`, `mark-delivered { amountCollected?, reason?, deliveredAt?, notifyCustomer? }`, `mark-returned { reason?, restoreStock, returnFee?, note? }` → 200.
- `GET /shipments/:id/label?format=a6|thermal|a5&source=auto|djaber` → `{ url, fileName, size, source, format, expiresAt }` (+ `meta.warnings: LABEL_UNAVAILABLE` for couriers without labels); `POST /shipments/labels { orderIds?|shipmentIds?, format, markPrinted }` → 202 job (`LabelsJobResult`: `count, pages, skipped[{ id, code: SHIPMENT_NOT_CREATED|NOT_FOUND }], courierLabels, djaberLabels`); `POST /products/bulk/labels { ids, copies?, withPrice?, includeVariants? }` → 202 job.
- `GET /shipments` (`ShipmentsQuery` + `courierAccountId`, `ids`; sort `lastSyncedAt|createdAt|orderNumber`) → `DeliveryRowView[]` (one row per order with its latest parcel); tabs = `DELIVERY_TABS` presets. `GET /delivery/overview` → `{ kpis: DeliveryOverviewDto, tabs, failures[], stale[], couriers: { active, defaultId } }`.
- `GET /delivery/rates?courierAccountId&wilayaId?&stopdesk?` → `{ courierAccountId, provider, rates[{ wilayaId, homePrice, stopdeskPrice, price, fetchedAt }], fetchedAt, stale, refreshing, supported }`; `POST /delivery/fees/copy-from-courier { courierAccountId, wilayaIds?, dryRun? }` → `{ rows[{ wilayaId, nameFr, before, after, changed }], missing, written, dryRun, refreshing }`.
- `PATCH /workspace` accepts `autoSendToCourier` (D9). WS `courier.updated { id, reason }` (account created / updated / deleted / rates).

### 3.9 GDS (suppliers, purchases, sales, cash)

```ts
type PurchaseDto = { id: string; number: string; supplier: { id: string; name: string } | null; status: 'draft'|'pending'|'partial'|'received'|'cancelled'; supplierInvoiceRef: string | null; items: { id: string; product: ProductRef; variantId: string | null; productName: string; variantName: string | null; quantity: number; receivedQty: number; unitCost: Money; total: Money }[]; subtotal: Money; tax: Money; shippingCost: Money; total: Money; amountPaid: Money; paymentStatus: 'unpaid'|'partial'|'paid'; paymentMethod: PaymentMethod | null; payments: PaymentEntryDto[]; purchasedAt: string; expectedAt: string | null; receivedAt: string | null; late: boolean; notes: string | null; createdBy: UserRef; actions: ActionDescriptor[] };
type ReceivePurchaseDto = { items: { id: string; receivedQty: number; unitCost?: Money }[]; receivedAt?: string; supplierInvoiceRef?: string; paymentNow?: { amount: Money; method: PaymentMethod } };
type SaleDto = { id: string; number: string; client: ClientRef | null; status: 'draft'|'completed'|'cancelled'; items: { product: ProductRef; variantId: string | null; productName: string; variantName: string | null; quantity: number; unitPrice: Money; discount: Money; total: Money }[]; subtotal: Money; discount: Money; tax: Money; total: Money; amountPaid: Money; remaining: Money; paymentStatus: 'unpaid'|'partial'|'paid'; paymentMethod: PaymentMethod; payments: PaymentEntryDto[]; seller: UserRef; soldAt: string; cancelReason: string | null; actions: ActionDescriptor[] };
type CreateSaleDto = { clientId?: string; items: { productId: string; variantId?: string; quantity: number; unitPrice?: Money; discount?: Money }[]; discount?: Money; tax?: Money; paymentMethod: PaymentMethod; amountPaid: Money; notes?: string; status?: 'draft'|'completed' };
type CashTransactionDto = { id: string; type: 'income'|'expense'; amount: Money; category: CashCategory; method: 'cash'|'ccp'|'card'|'transfer'|'other'; description: string | null; reference: { type: string; id: string; label: string } | null; date: string; isAutomatic: boolean; locked: boolean; lockReason: 'CAISSE_EDIT_AUTOMATIC'|'CASH_DAY_CLOSED'|null; balanceAfter: Money; createdBy: UserRef | null; proofUrl: string | null };
type CashClosingDto = { day: string; openingBalance: Money; income: Money; expense: Money; closingBalance: Money; closed: boolean; closing: { id: string; theoreticalBalance: Money; countedBalance: Money; difference: Money; note: string | null; closedBy: UserRef; closedAt: string; reopenedBy: UserRef | null; reopenedAt: string | null } | null };   // GET /cash/days (one row per day, open and closed) · POST /cash/days/:day/reopen { reason }
type CloseCashDto = { day: string; countedBalance: Money; note?: string };   // POST /cash/close (Idempotency-Key required); note required when difference ≠ 0
```

**M7 additions** (zod schemas and view types in `packages/shared/src/schemas/gds.ts` and `recommendations.ts`; names there are the wire names):

- Suppliers: `SupplierListItemView` (`purchaseCount`, `purchases12m { count, total }`, `totalSpent` (cancelled and drafts excluded), `balance`, `lastPurchaseAt`, `actions`) / `SupplierView` (+ `terms`, `paymentTermsDays`, `avgLeadDays`, `leadDaysMeasured`, `productCount`, `recentPurchases`). `POST /suppliers/:id/payments` → `{ supplier, allocations[{ purchaseId, number, amount }] }`.
- Purchases: `PurchaseDto` above + `units { ordered, received }`, `remaining`, `items[].remainingQty`, `cancelReason`, `cancelledAt`. `ReceivePurchaseDto` adds `newItems[{ productId, variantId?, receivedQty, unitCost }]` (lines added in the receive dialog); `items[].receivedQty` = units received now. `PATCH` edits lines only while `draft|pending` (else `409 CONFLICT details.reason=PURCHASE_LOCKED`). `GET /purchases/stats` → `PurchaseStatsView`.
- Sales: `SaleDto` above + `customerName`, `customerPhone`, `items[].catalogPrice` (the catalogue price when the line price was edited — `SaleItem.catalogPrice` column, M7), `items[].costPrice`, `cancelledBy`, `stockRestored`, `cancellableUntil`. `CreateSaleDto` accepts `client { name, phone }` (found by phone or created) instead of `clientId`, and `soldAt`; `UpdateSaleDto` accepts the same `client { name, phone }` on a draft (finishing a draft with a new client). `GET /sales/stats` → `SaleStatsView`.
- Members: `PATCH /workspace/members/:id { role?, hiddenSections? }` (Owner); `MemberDto.hiddenSections` and `/me` `memberships[].hiddenSections` (`MEMBER_SECTIONS`); a key of a hidden section answers `403 FORBIDDEN`.
- Orders: `client: { id, phone? }` — a client without a phone is ordered for only with `phone` (it completes the client); without it `422 fields[client.phone]`, a phone of another client `409 CLIENT_PHONE_EXISTS`.
- Products: `ProductListItemView.priceRange { min, max } | null` = price range of the active variants (null without variants); `marginPct` and the `minMargin` / `maxMargin` filters use the true cost of `GET /products/:id/margins` (expenses included). Inbox `MessageCardView.priceMax?` closes the price range of a card of a product with variants.
- Cash: `CashTransactionDto` above + `correctsTransactionId`, `createdAt`, `actions`; `reference.type ∈ order|sale|purchase|closing|cash` (a manual correction carries the document of the row it corrects, `cash` only when that row has none; manual corrections have `open_reference`, rows with a proof `view_proof`). `proofUrl` and every other signed link (`/files/<key>?exp&sig`) is served by the API whatever the storage driver; `&dl=<file name>` answers `Content-Disposition: attachment`. `GET /cash` takes `day` (default today) or `period|from|to`; `meta` adds `openingBalance`, `from`, `to`; `GET /cash/stats` (same filters) → `CashStatsView { openingBalance, income, expense, net, currentBalance, counts, unclosedDays, day }`; `GET /cash/days` → `CashDayView` (= `CashClosingDto` + `theoreticalCash`, `actions`); `GET /cash/:id`.
- Inventories: `InventoryCountDto` above + `summary.counted`, `categoryName`, `validatedBy`, `lines[].currentExpectedQty` (expected + movements since the start), `lines[].noteRequired`, `actions`; `GET /inventories/scope-preview?scope&categoryId` → `{ products, variants, lines }`.
- KPIs: `GET /stock/movements/stats` (filters of `GET /stock/movements`) → `MovementStatsView`; `GET /products/stats` (filters of `GET /products`) → `ProductStatsView`; `GET /stock/overview` adds `purchasing: StockPurchasingView | null` (advanced mode + `gds.read`).
- Recommendations: `StockRecommendationDto` above + `ruleLabel`, `suggestedAction.label`, `appliedAt`, `applied`, `dismissedAt`, `actions`; `GET /stock-recommendations/stats` → `StockRecoStatsView`; `DELETE /stock-recommendations/mute?productId&type` (unmute). Cross-sell: `RecommendationView`, `GET /recommendations/stats` → `RecommendationStatsView`; job result `RecommendationsJobResult`.
- Order import: `POST /orders/import/mapping { jobId, mapping }` → 202; preview / commit results `OrderImportPreviewResult` in `Job.result`.

**M8 additions — analytics & reports** (zod schemas and view types in `packages/shared/src/schemas/analytics.ts` and `reports.ts`; names there are the wire names):

- Analytics (`analytics.read`, every member): `GET /analytics/overview` and `GET /analytics/{conversations|responses|consumption|agents|channels|products|orders|delivery}` with `AnalyticsQuerySchema { period?, from?, to?, compare?: 'previous'|'none', channelId? }` → `AnalyticsViewOf[tab]`. Every view: `range: AnalyticsRange { period, from, to, days, compare, previous, timezone, channelId, includesToday, source { rollupDays, liveDays } }`, `generatedAt`, `empty`, `hasChannels`, `kpis: Record<key, AnalyticsKpi { value, unit, previous?, deltaPct?, deltaPts?, figure?: 'revenue'|'net_revenue'|'pipeline'|'cash_collected'|'ai_revenue', hint? }>`, `series: { keys, points[{ day, values, previousDay, previous }] }` + per-tab tables. Period errors `REPORT_CUSTOM_RANGE_REQUIRED`, `INVALID_DATE_RANGE`, `REPORT_RANGE_TOO_LONG` (> 732 d).
- Reports (`reports.read`, Owner + Admin): `GET /reports` → `ReportsHubView`; `GET /reports/schedules` → `ReportScheduleView[]`; `GET /reports/:key` with `ReportQuerySchema` (`format=json|csv|xlsx|pdf`, `page`, `pageSize`, `sort`, `q`, `categoryId`, `productId`, `supplierId`, `clientId`, `days`, `lang` + the period) → json `ReportDataView` + `meta.page/pageSize/total`; csv ≤ 5 000 rows / pdf → `ReportFileView { url, fileName, size, expiresAt, rows, format }`; csv > 5 000 / xlsx → `202 { jobId }` (Job `kind: export`, `result: ReportJobResult { kind: 'report', reportKey, from, to, format, rows?, fileName?, size? }` from creation). `POST /reports/:key/schedule { email, dayOfMonth 1–28 }` (`reports.schedule`, plan feature `scheduled_reports` ⇒ `403 PLAN_FEATURE_REQUIRED { feature }`) → `ReportScheduleView` (201 new / 200 same e-mail updated); `DELETE /reports/:key/schedule { email }` (or `?email=`) → 204.
- Exports added: `GET /orders/export?format=pdf`, `GET /delivery/export` (`ShipmentsExportQuerySchema`, `delivery.send`), `GET /purchases/export` (`PurchasesExportQuerySchema`), `GET /sales/export` (`SalesExportQuerySchema`) (`gds.read`) → `202 { jobId }`.
- Other M8 fields: `ChannelSummaryView.aiResolutionPct30d`, `GET /agent-insights` → `meta.counts { pending, resolved, dismissed }`, `HomeQueueItem.handled?: { at, by }`.

### 3.10 Billing & credits

```ts
type PlanPublicDto = { id: string; slug: string; name: string; description: string; priceMonthly: Money; priceYearly: Money; yearlyDiscountPct: number; trialDays: number; limits: PlanLimits; isFeatured: boolean; current?: boolean };
type SubscriptionDto = { id: string; plan: PlanPublicDto; status: SubscriptionStatus; billingCycle: 'monthly'|'yearly'|'none'; provider: 'none'|'chargily'|'manual'; appliedPrice: Money; discountPct: number | null; currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; dunningStage: 'd_minus_7'|'d0'|'d_plus_3'|'expired'|null; trialEndsAt: string | null; usage: PlanUsage; pausedResources: { type: 'channel'|'agent'|'member'; id: string; name: string }[] };
type CheckoutPreviewDto = { amountNow: Money; prorataDays: number | null; nextAmount: Money; nextAt: string; creditsNow: number; pausedResources: { type: string; name: string }[]; promo: { code: string; kind: string; value: number; periods: number | null } | null };
type InvoiceDto = { id: string; number: string; kind: 'subscription'|'credit_pack'|'manual'; date: string; label: string; amount: Money; status: 'upcoming'|'unpaid'|'paid'|'void'|'refunded'; method: PaymentMethodBilling | null; paidAt: string | null; pdfUrl: string | null; dueAt: string | null; remaining: Money };   // POST /billing/invoices/:id/pay → { data: { checkoutUrl } }
type CreditsDto = { plan: { used: number; limit: number; remaining: number; periodStart: string; periodEnd: string }; packs: { remaining: number }; total: number; negative: boolean; burnRatePerDay: number; exhaustedEta: string | null; pricePerCreditDzd: number; packPricePerCreditDzd: number | null };
type CreditLedgerRowDto = { id: string; at: string; action: CreditAction; bucket: 'plan'|'pack'; credits: number; balanceAfter: number; detail: string; agent: AgentRef | null; conversationId: string | null; aiRunId: string | null };
type CreditPackDto = { id: string; slug: string; name: string; credits: number; priceWebDzd: Money; googleProductId: string | null; appleProductId: string | null; storePriceLabel: string | null; isFeatured: boolean };
type IapValidateDto = { platform: 'google_play'|'app_store'; productId: string; transactionId: string; receipt?: string /* app_store: signed transaction JWS */; purchaseToken?: string /* google_play: required */ }; // POST /credits/packs/iap/validate (D74; Idempotency-Key required; idempotent on transactionId)
type IapValidateResult = { status: 'credited'|'already_credited'|'invalid'|'pending'; creditsAdded: number; balance: CreditsDto };   // errors: 404 IAP_PRODUCT_UNKNOWN · 422 IAP_RECEIPT_INVALID · 409 IAP_RECEIPT_ALREADY_USED (mobile treats as success) · 503 IAP_STORE_UNAVAILABLE
```

**M9 additions — billing, credits, packs, IAP, order payments** (zod schemas and view types in `packages/shared/src/schemas/billing.ts`; names there are the wire names):

- `SubscriptionDto` adds `nextPlan { id, slug, name, cycle, at } | null` (downgrade booked for the renewal), `unpaidInvoice { id, number, amount, remaining, dueAt } | null`, `expiredFrom { planSlug, planName, at } | null` (02 §5 banner), `actions[{ key: change_plan|cancel|pay_invoice|buy_pack, enabled, reasonCode? }]`.
- `CheckoutPreviewDto` adds `mode: 'upgrade'|'new_period'|'renewal'|'downgrade'`, `targetPlan { id, slug, name, cycle }`, `amountBeforePromo`, `effectiveAt`. `POST /billing/checkout` → `{ checkoutUrl: string|null, ref: string|null, prorata: number|null, preview }` (`checkoutUrl: null` = downgrade booked or amount waived). Prorata (02 §5 corrected): same cycle `round((new − current) × daysLeft / periodDays)`; cycle change upward / from trial: new period, unused value deducted.
- `GET /billing/checkout/return?ref` → `CheckoutReturnDto { status: verifying|success|pending|failed|expired, kind: subscription|pack|invoice, invoiceId, invoiceNumber, planUntil, planName, credits, failureReason }`; one gateway `verify` per poll.
- `POST /billing/cancel { reason? }`, `DELETE /billing/cancel` (= `POST /billing/cancel/undo`) → `SubscriptionDto`. `GET|PUT /billing/info`, `GET /billing/payments` → `BillingPaymentDto`.
- `InvoiceDto` adds `dunningStage`, `lines[{ label, amount, quantity? }]`; `pdfUrl` = `/api/v1/billing/invoices/:id/pdf` (authenticated, null for `upcoming`). `POST /billing/invoices/:id/pay` → `{ checkoutUrl, ref }`.
- `CreditPackDto` adds `pricePerCreditDzd`; `POST /credits/packs/checkout` → `{ checkoutUrl, ref, purchaseId }`; `GET /credits/packs/purchases` → `PackPurchaseDto`; `IapValidateResult` adds `purchaseId`. `GET /credits/ledger/export?format=csv|xlsx&…` → `202 { jobId }`. `CreditsCalculatorDto` adds `plans[]` and `suggestion` (AT-PCK-04 formula).
- `POST /billing/promo/validate` → `PromoCheckDto { code, kind, value, periods, planSlugs, referral }`; `POST /billing/promo/redeem` → `PromoRedeemDto` (+ `creditsAdded`, `trialEndsAt`, `balance`).
- Orders: `OrderDetailView.paymentLink = { id, url: string|null, status: creating|pending|paid|failed|expired|refunded|mismatch, expiresAt: string|null, amount } | null`; `POST /orders/:id/payment-link { send? }` → `201 OrderPaymentLinkDto` (checkout created by the worker); `GET /orders/:id/payment-link`; `POST /orders/:id/refunds { amount, reason, method? }` → order detail; order `actions` add `payment_link`, `refund`. `PATCH /workspace` accepts `onlinePaymentEnabled`.
- `WorkspaceDto.plan` adds `cancelAtPeriodEnd`, `dunningStage`, `expired { at, planName } | null`, `paused { channels, agents, members }`.
- Admin (M9 endpoints): `POST /admin/invoices/:id/mark-paid` → `AdminMarkPaidResultDto { invoice, paymentId, remaining, reactivated }` (+ `meta.warnings` `INVOICE_PARTIAL_PAYMENT`); `POST /admin/workspaces/:id/credits { credits, reason, type? }` → `{ ledgerEntryId, balance }` (+ in-app notification `credits.granted` to the Owner); `POST /admin/workspaces/:id/credits/remove { credits, reason }` (`admin.billing.write`, tester report 22/10 UX-019) → `{ ledgerEntryId, balance }` — plan credits only, more than what is left ⇒ 422 `VALIDATION_ERROR` (`fields.credits = validation.range`, `details.max`); the Owner gets the e-mail `billing/credits-removed` and the notification `credits.removed` with the reason (tester log 26/10 UX-040).
- Simulators (fake drivers): `GET|POST /dev-payments/:checkoutId` (fake Chargily checkout page) and `GET /dev/google/consent` (simulated Google consent) are served in development, test and on the staging test site, 404 in production (tester reports 22/10 UX-029, 25/10; production refuses to start with `PAYMENT_DRIVER=fake`); `POST /dev/billing/{subscription|clock|pack|store-refund}`, `GET /dev/billing/help` are development / test only (404 in staging and production).

### 3.11 Safety, support, moderation (merchant side) — D36–D38

```ts
type CustomerBlockDto = { id: string; client: ClientRef | null; phone: string | null; reason: BlockReason | null; note: string | null; source: 'manual'|'auto_rule'|'platform'; blockedBy: UserRef | null; blockedAt: string; reportStatus: 'open'|'reviewing'|'actioned'|'dismissed'|null; unblockable: boolean };
type CreateReportDto = { type: 'conversation'|'customer'|'ai_message'|'product'; conversationId?: string; clientId?: string; messageId?: string; productId?: string; reason: 'harassment'|'fraud'|'spam'|'inappropriate_content'|'ai_incorrect'|'other'; details?: string; blockAlso?: boolean };
type SupportTicketDto = { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; channel: TicketChannel; status: 'open'|'pending_customer'|'resolved'|'closed'; createdAt: string; lastMessageAt: string; awaitingMe: boolean; slaDueAt: string; satisfaction: number | null; messages: { id: string; authorKind: 'user'|'support'|'system'; author: UserRef | null; body: string; attachments: { name: string; url: string; size: number }[]; at: string }[]; context: Record<string, string> };
type CreateTicketDto = { category: TicketCategory; priority: 'normal'|'urgent'; message: string /* ≥ 20 */; attachments?: string[] /* uploadIds */; context?: Record<string, string> };
type AppealDto = { message: string /* ≤ 500 */; attachmentUploadId?: string };
```

### 3.12 Notifications

```ts
type NotificationDto = { id: string; type: NotificationType; group: 'orders'|'queue'|'ai'|'stock'|'parcels'|'payments'|'pages'|'credits_plan'|'members'|'integrations'|'jobs'|'moderation'|'safety'|'support'|'platform'; title: string; body: string; deepLink: { web: string; mobile: string }; readAt: string | null; createdAt: string }; // type → group and deep links: see 03 §15; `deepLink.mobile` = `djaber://` + `deepLink.web`
type NotificationPreferenceDto = { type: NotificationType; inApp: true; email: boolean; push: boolean; sound: boolean };
```

### 3.13 Platform admin (main resources)

Localized names in admin responses (plan, credit pack: `plan.name`, `planName`, `pack.name`, `PlanAdminDto.name`) are in the request language (`Accept-Language` / `?lang`, the language the admin is viewed in), French when that translation is empty; a workspace without subscription shows the free plan's name in that language (`Gratuit` / `Free` / `مجاني`).

```ts
type AdminWorkspaceRowDto = { id: string; name: string; owner: UserRef & { email: string; emailVerified: boolean; totpEnabled: boolean }; plan: { slug: string; name: string }; subscriptionStatus: SubscriptionStatus; status: 'active'|'suspended'|'deletion_scheduled'; trustLevel: string; credits: { used: number; limit: number; exhausted: boolean }; pages: { count: number; platforms: string[] }; orders30d: number; conversations30d: number; createdAt: string; lastActivityAt: string | null; actions: ActionDescriptor[] };
type ModerationItemDto = { id: string; type: 'product'|'product_image'|'agent_prompt'|'category'; workspace: { id: string; name: string; trustLevel: string; plan: string; priorRejections: number; approvedProducts: number }; product: { id: string; name: string; price: Money; marketReference: Money | null; category: string | null; variants: number; images: { url: string; flag: string | null }[]; description: string | null } | null; aiScore: number | null; aiFlags: { code: string; field?: string; message: string }[]; priority: 'normal'|'urgent'; waitingMinutes: number; slaBreached: boolean; status: ModerationItemStatus; assignee: UserRef | null; reviewer: UserRef | null; decision: string | null; merchantMessage: string | null; rejectedFields: string[]; submittedAt: string; decidedAt: string | null; source: string; appeal: { message: string; attachmentUrl: string | null; submittedAt: string; deadlineAt: string } | null };
type ModerationDecisionDto = { decision?: 'counterfeit'|'prohibited'|'inappropriate_image'|'misleading'|'missing_info'|'other'; reasonTemplateKey?: string; merchantMessage: string; rejectedFields?: string[] };
type ReportAdminDto = { id: string; type: ReportType; reporterKind: ReporterKind; reporter: UserRef | null; workspace: { id: string; name: string } | null; target: { kind: string; id: string; label: string; meta?: Record<string, string> }; reason: ReportReason; details: string | null; excerpt: { author: string; text: string; at: string }[]; severity: Severity; status: ReportStatus; assignee: UserRef | null; decision: ReportDecision | null; createdAt: string; signals: string[] };
type AdminTicketDto = SupportTicketDto & { workspace: { id: string; name: string; plan: string; status: string }; user: UserRef & { email: string; role: MemberRole | null; platform: string }; assignee: UserRef | null; firstResponseAt: string | null; slaHours: number; slaRemainingMin: number; incident: { id: string; title: string } | null; previousTickets: { count: number; avgSatisfaction: number | null }; internalNotes: boolean };
type PlanAdminDto = PlanPublicDto & { version: number; isActive: boolean; isVisible: boolean; archivedAt: string | null; subscribers: number; maxApiKeys: number; maxWebhooks: number; syncHistoryDays: number; features: string[]; sortOrder: number };
type PlanImpactDto = { subscribers: number; overLimit: { limit: string; count: number }[]; priceChangeAt: string; emailDueBy: string };
type AiRouteDto = { capability: 'text'|'vision'|'transcription'|'embeddings'; primary: { modelId: string; label: string; provider: string }; fallback: { modelId: string; label: string; provider: string } | null; realCostUsdPer1k: number; credits: number; marginPct: number; state: 'ok'|'failover'|'degraded'; failoverSince: string | null; timeoutSec: number; errorThresholdPct: number };
type AppVersionDto = { platform: 'android'|'ios'; latestVersion: string; latestBuild: number | null; minVersion: string; recommendedVersion: string; storeStatus: 'published'|'in_review'|'rejected'|'rollout'; rolloutPct: number | null; storeUrl: string; updateMessage: LocalizedText; devicesBelowMin: { count: number; pct: number } };
type FeatureFlagDto = { key: string; description: string | null; webPct: number; mobilePct: number; targeting: { planSlugs?: string[]; workspaceIds?: string[]; abTest?: boolean }; isActive: boolean; updatedBy: UserRef; updatedAt: string };
type AuditLogDto = { id: string; at: string; actor: { type: string; id: string | null; name: string; role: string | null }; action: string; target: { entity: string; id: string | null; label: string; workspace?: { id: string; name: string } }; reason: string | null; context: { ip: string | null; userAgent: string | null; impersonationSessionId: string | null; twoFactor: boolean }; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
type HealthDto = { queues: { name: string; waiting: number; active: number; failed: number; delayed: number; p95Ms: number; state: 'ok'|'warning'|'incident'|'paused'; note: string | null }[]; metaWebhooks: { received24h: number; invalidSignatures: number; ackOver5s: number; p95Ms: number; medianToReplyMs: number }; ai: { errorRate24hPct: number; failoverActive: boolean; provider: string }; duplicates7d: number; incidents: { id: string; title: string; status: string; startedAt: string }[] };
type CreditPackAdminDto = CreditPackDto & { storeTier: string | null; isActive: boolean; visibleWeb: boolean; visibleMobile: boolean; sales30d: number; sortOrder: number };
type PromoCodeDto = { id: string; code: string; kind: 'percent_discount'|'fixed_discount'|'credits'|'trial_extension'; value: number; periods: number | null; planSlugs: string[]; target: 'new_workspaces'|'existing'|'all'|'workspace'; targetWorkspaceId: string | null; maxUses: number | null; perWorkspaceLimit: number; validFrom: string | null; validTo: string | null; isActive: boolean; uses: number; createdBy: UserRef | string; state: 'active'|'used'|'expired'|'inactive' };
type DeletionRequestAdminDto = DeletionRequestDto & { user: UserRef & { email: string }; workspaces: { id: string; name: string; role: MemberRole; status: string }[]; blockedReason: 'ACCOUNT_OWNS_WORKSPACE'|'WORKSPACE_HAS_DEBT'|null; exportSentAt: string | null };
type ImpersonationSessionDto = { id: string; admin: UserRef; workspace: { id: string; name: string }; reason: string; ticketId: string | null; startedAt: string; expiresAt: string; endedAt: string | null; actionsCount: number };   // read-only sessions (R-F); POST → { sessionId, token, expiresAt }
type CmsEntryAdminDto = { id: string; key: string; type: CmsType; category: string | null; target: Record<string, unknown>; channels: string[]; startsAt: string | null; endsAt: string | null; link: string | null; sortOrder: number; status: CmsStatus; currentVersion: number; locales: { locale: Locale; title: string; body: string; status: CmsLocaleStatus; fallbackToFr: boolean; updatedBy: UserRef; updatedAt: string }[]; versions: { version: number; publishedAt: string; publishedBy: UserRef }[]; createdBy: UserRef; createdAt: string; updatedAt: string };
```

**M10 admin core (api-a) — wire details beyond 06 §2 / §8.11** (zod + types: `packages/shared/src/schemas/admin.ts`): every platform route answers `403 TWO_FA_REQUIRED_FOR_ROLE` while the caller has no 2FA; list rows carry `actions: ActionDescriptor[]`; extra read routes used by the frames: `GET /admin/channels?q&workspaceId` (find the holder of a page before `POST /admin/channels/:id/release`), `GET /admin/payments?provider&status&from&to&q` (ADM-05 tab "Paiements manuels"), `GET /admin/ai-routes` (all capabilities), `GET /admin/audit-logs/:id`, `GET /admin/jobs/:id` (the caller's workspace-less jobs: audit / invoices exports, CMS translation), `POST /admin/plans/:id/restore`; `PATCH /admin/plans/:id { …, dryRun? }` → `{ plan, impact: PlanImpactDto }`; `POST /admin/workspaces/:id/extend { days: 3|7|30 | until, reason }`; `GET /admin/conversations/:id?reason=` (reason ≥ 10 chars, audited `viewer.open`); `POST /admin/impersonation/sessions` → `{ sessionId, token, expiresAt, workspace }`. Connect report code `PLAN_LIMIT_GRANDFATHERED` (D63) joins `ConnectReportCode`.

### 3.14 Public pages

```ts
type AppVersionCheckDto = { minVersion: string; recommendedVersion: string; latestVersion: string; forceUpdate: boolean; recommendUpdate: boolean; message: string; storeUrl: string; maintenance: { until: string | null; text: string } | null };
type StatusPageDto = { overall: 'operational'|'degraded'|'incident'; components: { key: string; name: string; status: 'operational'|'degraded'|'incident'; uptime90d: number }[]; incidents: { id: string; title: string; status: string; severity: string; startedAt: string; resolvedAt: string | null; updates: { at: string; status: string; body: string }[] }[]; banner: string | null; updatedAt: string };
type CmsEntryDto = { key: string; type: CmsType; locale: Locale; requestedLocale: Locale; fallback: boolean; title: string; body: string; version: number; publishedAt: string; versions: { version: number; publishedAt: string }[] };   // GET /cms/:key?lang= · GET /legal/:key · GET /help/articles/:key (public, published locales only)
type DataDeletionStatusDto = { code: string; status: 'pending'|'done'|'not_found'; requestedAt: string | null; completedAt: string | null };
type TrackingPublicDto = { orderNumber: string; shopName: string; status: ShipmentStatus; statusLabel: string; events: { at: string; status: ShipmentStatus; label: string; location: string | null }[]; courier: string; trackingNumber: string | null; wilayaName: string | null; isStopdesk: boolean; updatedAt: string; reportUrl: string };   // GET /track/:publicToken · POST /track/:publicToken/report { reason, details?, email? } (3 / h / IP)
```

---

## 4. List query params per Figma page

Exhaustive table in `../specs/06-api.md` §10 (one row per filter panel). Below, the TypeScript query types the API validates (zod) — the same objects are stored in `SavedView.filters`.

```ts
type Period = 'today'|'7d'|'30d'|'month'|'last_month'|'90d'|'year'|'custom';
type Paging = { page?: number; pageSize?: 25|50|100; sort?: string; view?: string };

type OrdersQuery = Paging & { status?: OrderStatus[]; confirmationStatus?: ConfirmationStatus[]; minCalls?: number; neverCalled?: boolean; paymentStatus?: PaymentStatus[]; paymentMethod?: PaymentMethod[]; hasRemaining?: boolean; deliveryStatus?: DeliveryStatus[]; shipmentProvider?: string[]; source?: ('ai'|'manual'|'mobile'|'api'|'import')[]; channelId?: string[]; agentId?: string[]; assigneeId?: string | 'me' | 'none'; wilayaId?: number[]; isStopdesk?: boolean; minTotal?: number; maxTotal?: number; period?: Period; from?: string; to?: string; productId?: string; riskLevel?: 'normal'|'high'; clientId?: string; callbackDue?: boolean; q?: string }; // sort: orderedAt|total|status|clientName
type ProductsQuery = Paging & { categoryIds?: string[]; status?: ('active'|'inactive'|'archived')[]; type?: ('stock'|'service'|'variants'|'no_variants')[]; stockState?: ('low'|'out'|'in_stock')[]; minQty?: number; maxQty?: number; minPrice?: number; maxPrice?: number; minCost?: number; maxCost?: number; minMargin?: number; maxMargin?: number; agentId?: string[]; noAgent?: boolean; moderationStatus?: string[]; createdFrom?: string; createdTo?: string; updatedFrom?: string; updatedTo?: string; q?: string }; // sort: name|sku|price|cost|stock|updatedAt
type ClientsQuery = Paging & { source?: string[]; quality?: ('placeholder'|'no_phone'|'no_address'|'duplicates')[]; tags?: string[]; riskLevel?: 'high'; channelId?: string[]; noConversation?: boolean; minOrders?: number; maxOrders?: number; neverOrdered?: boolean; unconfirmed?: boolean /* « À relancer »: an order new / cancelled or a conversation, no order confirmed or beyond, no completed sale; blocked clients left out */; returned?: boolean; minSpent?: number; maxSpent?: number; lastOrder?: 'lt30'|'30_90'|'gt90'|'never'; wilayaId?: number[]; createdFrom?: string; createdTo?: string; blocked?: boolean; q?: string }; // sort: lastOrderAt|name|totalSpent|createdAt
type InboxQuery = { channelIds?: string[]; status?: ConversationStatus; ai?: 'active'|'paused'|'no_agent'; agentId?: string[]; unread?: boolean; assigneeId?: string | 'me' | 'none'; order?: 'with'|'cart'|'abandoned'|'without'; intent?: AiIntent[]; client?: ('risk'|'placeholder'|'vip')[]; language?: string[]; lastMessage?: 'lt24h'|'gt24h'|'7d'|'custom'; from?: string; to?: string; blocked?: boolean; q?: string; sort?: 'lastMessageAt'|'oldestWaiting'|'unreadFirst'; cursor?: string; limit?: number };
type AgentsQuery = { status?: ('active'|'paused'|'draft')[]; channelId?: string[]; modelId?: string[]; capabilities?: ('voice'|'image'|'orders')[]; presetKey?: string[]; activeDays?: 7|30; defaultLanguage?: string; hasPendingInsights?: boolean; q?: string; sort?: 'lastActiveAt'|'name' };
type ChannelsQuery = { platform?: 'facebook'|'instagram'; status?: ChannelStatus[]; agentId?: string; noAgent?: boolean; pausedBy?: 'plan'; q?: string };
type ShipmentsQuery = Paging & { shipmentStatus?: ('not_sent'|ShipmentStatus)[]; provider?: string[]; deliveryType?: 'home'|'stopdesk'; wilayaId?: number[]; communeId?: number[]; orderStatus?: OrderStatus[]; lastEvent?: 'lt24h'|'2_5d'|'gt5d_stale'; failureReason?: string[]; lastError?: string[]; from?: string; to?: string; q?: string }; // sort: lastSyncedAt
type MovementsQuery = Paging & { productId?: string; variantId?: string; type?: MovementType[]; reason?: string[]; refType?: string[]; refId?: string; createdById?: string | 'system'; from?: string; to?: string; minQty?: number; maxQty?: number; categoryId?: string; q?: string };
type PurchasesQuery = Paging & { status?: string[]; supplierId?: string[]; paymentStatus?: string[]; late?: boolean; from?: string; to?: string; q?: string };
type SalesQuery = Paging & { paymentStatus?: string[]; status?: string[]; createdById?: string[]; clientId?: string; from?: string; to?: string; q?: string };
type SuppliersQuery = Paging & { hasBalance?: boolean; lastPurchase?: Period; isActive?: boolean; q?: string };
type CashQuery = { day?: string; direction?: 'income'|'expense'; category?: CashCategory[]; method?: string[]; createdById?: string[]; source?: 'auto'|'manual'; q?: string; from?: string; to?: string };
type StockRecosQuery = { type?: string[]; priority?: ('high'|'medium'|'low')[]; status?: string; categoryId?: string };
type NotificationsQuery = { types?: NotificationType[]; unread?: boolean; from?: string; to?: string; cursor?: string; limit?: number };
type MembersQuery = { role?: MemberRole[]; state?: ('active'|'invited'|'read_only')[]; q?: string };
type LedgerQuery = Paging & { from?: string; to?: string; action?: CreditAction[]; agentId?: string; bucket?: 'plan'|'pack' };
type InsightsQuery = Paging & { agentId?: string; status?: InsightStatus; type?: InsightType[]; channelId?: string; period?: Period; groupByTopic?: boolean };

// Admin
type AdminWorkspacesQuery = Paging & { planSlug?: string[]; status?: string[]; credits?: 'lt20'|'exhausted'; createdFrom?: string; createdTo?: string; wilayaId?: number; withPages?: boolean; withAgents?: boolean; inactiveDays?: number; minPages?: number; maxPages?: number; minProducts?: number; maxProducts?: number; minRevenue?: number; maxRevenue?: number; trustLevel?: string[]; q?: string };
type AdminUsersQuery = Paging & { platformRole?: PlatformRole[]; status?: UserStatus[]; emailVerified?: boolean; totpEnabled?: boolean; lastLogin?: Period; workspaceId?: string; q?: string };
type AdminModerationQuery = Paging & { status?: ModerationItemStatus[]; priority?: 'urgent'; aiFlag?: string[]; scoreMin?: number; scoreMax?: number; trustLevel?: string[]; categoryId?: string; workspaceId?: string; waitingOver?: number /* minutes */; assigneeId?: string | 'me'; q?: string }; // sort: urgency (default), submittedAt
type AdminReportsQuery = Paging & { type?: ReportType[]; severity?: Severity[]; status?: ReportStatus[]; reporterKind?: ReporterKind[]; workspaceId?: string; assigneeId?: string | 'me'; from?: string; to?: string; q?: string };
type AdminTicketsQuery = Paging & { status?: TicketStatus[]; category?: TicketCategory[]; priority?: TicketPriority[]; channel?: TicketChannel[]; planSlug?: string[]; assigneeId?: string | 'me'; slaBreached?: boolean; q?: string };
type AdminSubscriptionsQuery = Paging & { planSlug?: string[]; status?: SubscriptionStatus[]; cycle?: ('monthly'|'yearly')[]; method?: string[]; renewal?: 'lt7d'|'overdue'; q?: string };
type AdminAuditQuery = Paging & { actorId?: string; action?: string[]; entity?: string[]; workspaceId?: string; from?: string; to?: string; impersonation?: 'only'|'exclude'; q?: string };
type AdminCmsQuery = Paging & { type?: CmsType[]; status?: CmsStatus[]; missingLocale?: Locale; target?: string; updatedById?: string; q?: string };
```

---

## 5. WebSocket events (additions to 06 §6)

`moderation.updated { productId, status }` · `report.updated { id, status }` · `ticket.updated { id, status, lastMessageAt }` · `inventory.updated { id, progress }` · `cash.updated { day }` · `agent.version_created { agentId, version }` · `workspace.updated { status, trustLevel }` · `impersonation.started/ended { sessionId }` (to the admin room and the impersonated workspace room; the merchant banner reads "Vous agissez en tant que {workspace} · lecture seule · {mm} min · Quitter" on the admin side only). Admin room `admin:platform` receives `health.updated`, `moderation.queue { pending, urgent }`, `reports.queue`, `tickets.queue`.

## 6. Outbound webhook events (additions to 06 §4)

`order.delivered` (already listed), `order.cancelled`, `order.returned`, `product.updated`, `product.moderation_changed` (D36), `customer.blocked` (D37). Payload stays `{ id, event, createdAt, workspaceId, data }`.

## 7. M11 — integrations and public pages (wire details; zod + types: `packages/shared/src/schemas/integrations.ts`, `public-pages.ts`)

- **API keys** (`integrations.manage`): `GET /api-keys` → `ApiKeysOverviewDto { keys: ApiKeyDto[], used, limit, featureEnabled, rateLimitPerMinute: 600, scopes, actions }`; `POST /api-keys { name, scopes[], environment }` → 201 `ApiKeyDto & { key }` (full key once; SHA-256 stored; prefix `dj_live_xxxxxxxx`); `POST /api-keys/:id/revoke` (and `DELETE /api-keys/:id`) → `ApiKeyDto`. Plan: feature `api_keys` (`PLAN_FEATURE_REQUIRED`) and `Plan.maxApiKeys` (`PLAN_LIMIT {resource:'api_keys'}`). Use: `X-API-Key` (or `Authorization: Bearer dj_…`), `X-RateLimit-Limit/Remaining/Reset`; 06 §5 whitelist via `@ApiScope` / `@ApiScopes({ read, write })`; any other route ⇒ `403 API_SCOPE_FORBIDDEN {scope}`.
- **Outbound webhooks** (`integrations.manage`; API key `webhooks:manage`): `GET /webhooks` → `WebhooksOverviewDto`; `POST /webhooks { url, events[] }` → 201 `WebhookEndpointDto & { secret }` (`whsec_…`, once); `GET|PATCH|DELETE /webhooks/:id`; `POST /webhooks/:id/test` → 202 `WebhookDeliveryDto` (`ping`); `POST /webhooks/:id/enable`; `POST /webhooks/:id/rotate-secret` → `& { secret }`; `GET /webhooks/:id/deliveries?status&event&page&pageSize` and `GET /webhooks/deliveries?endpointId&…` (journal) → paged `WebhookDeliveryDto`; `GET /webhooks/deliveries/:id`; `POST /webhooks/deliveries/:id/replay` → 202. Events: `WEBHOOK_EVENTS` (15). Attempts: 7 (`ping` 1), `failureCount` = consecutive failed attempts, disabled at 50 (`WEBHOOK_ENDPOINT_DISABLED`). Signature 03-events §6.
- **Google Sheets** (`integrations.manage`): `GET /integrations/google-sheets` → `SheetsIntegrationDto { state: not_connected|pick_sheet|active|error, driver, featureEnabled, verificationPending, googleEmail, spreadsheetId, spreadsheetTitle, spreadsheetUrl, sheetName, filters, columns, lastSyncAt, lastError, rowsSynced, backfill, connectedAt, actions }`; `GET …/status` → `SheetsStatusDto`; `GET …/connect?returnTo` → `{ url }`; `GET …/callback` (public, 302 to `PUBLIC_WEB_URL + returnTo + ?sheets=connected|error&code=`); `POST …/picker-token` → `SheetsPickerTokenDto`; `PUT … { spreadsheetId? | spreadsheetUrl? | createNew?, sheetName, filters? }`; `POST …/backfill { from, to }` → 202 `{ jobId }` (job kind `backfill`); `DELETE …` → `SheetsIntegrationDto` (not_connected).
- **Public**: `GET /cms/:key?lang&preview` and `GET /legal/:key` → `CmsEntryDto` (+ `category`, `previousBody`, `preview`); `GET /cms/preview/:token`; `GET /cms?type&category&lang` → `CmsListItemDto[]`; `GET /cms/announcements?lang` → `AnnouncementView[]` (live, channel `web`, target = every workspace); merchant `GET /announcements` → `AnnouncementView[]` (channel `banner`, my workspace targeted, not dismissed), `GET /announcements/:id` → `AnnouncementView` (`state` live|scheduled|ended|withdrawn, `dismissed`; 404 when never published or not for my workspace), `POST /announcements/:id/dismiss` → 204 (`workspace.read`; kept in `User.prefs.dismissedAnnouncementIds`, 100 max); `GET /captcha/config` → `{ provider: none|fake|turnstile, siteKey }` (public forms send `captchaToken`; `422 VALIDATION_ERROR fields.captchaToken = validation.captcha`); account deletion `POST /account-deletion/request { email, consent: true, locale? }` → `{ sent: true }` (3 / h / IP), `GET|POST /account-deletion/confirm/:token` → `AccountDeletionPublicDto` (POST body `{ exportData? }`, returns `cancelToken`), `POST /account-deletion/cancel/:token`; `GET /me/data-export` → 202 `{ jobId }`, `GET /me/data-export/:jobId` → `DataExportDto`.
- **Audit fixes 2026-10-15** (fix/gaps-agents-inbox-orders): `DELETE /agents/:id/activate` → `AgentDto` (cancels a scheduled activation: `scheduledActivateAt` → null, the draft stays a draft; idempotent; not a draft ⇒ `409 CONFLICT`; `agents.manage`); readiness row `emailVerified.link` = `/settings/security`; `ConversationListItemDto.pageHasAgent`; deep links: failed parcel ⇒ `/delivery?tab=all&ids=<orderId>&sheet=<shipmentId>`, jobs ⇒ the screen that started them (`/orders/import?job=` for `order-import-*`, `/products/import?job=`, `/delivery?job=` for `bulk_send` / `tracking_refresh` / `labels`, `/channels/:id/analysis|history`, `/agents/:id/configuration` for `faq_extraction`, else `/reports?job=`); `job_finished` / `job_failed` data carry `channelId` / `agentId` of the job payload.
- **Live additions 2026-10-14…16** (go-live and tester fixes): (a) **Meta connect** — `GET /channels/connect/facebook` asks the permissions of `META_FACEBOOK_SCOPES` when set (live: `pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement`), else the full list of 05-integrations §1.5; `redirect_uri` = `PUBLIC_API_URL` + `META_OAUTH_CALLBACK_PATH`; with `META_LEGACY_PATHS=true` the V1 paths `/api/webhooks/meta`, `/api/webhooks/meta/data-deletion`, `/api/pages/callback/{platform}` reach the v2 routes (06 §3). The callback page posts the report to its opener, else redirects to `<PUBLIC_WEB_URL>/channels/connect/return?connectReport=<id>|connectError=<CODE>`; the web hands it over a `BroadcastChannel` to the starting window, which reads `GET /channels/connect/reports/:id`. Page analysis (`GET|POST /channels/:id/analysis`) treats `pages_read_engagement` **or** `pages_read_user_content` as the read permission of page analysis (`PAGE_ANALYSIS_PERMISSION_REQUIRED` only without both). (b) **Geo** — every wilaya field (orders, clients, addresses, delivery, workspace `senderWilayaId`, admin filters, AI tools) accepts 1–69 (`WILAYA_COUNT`); `GET /geo/wilayas` answers 69 rows (`max-age=86400`); courier adapters receive `courierWilayaId()` (parent code for 59–69); `GET /delivery/fees` answers 69 rows. (c) **Clients** — `email` trimmed + lower-cased, blank optional `email` / `phone2` ⇒ `null`, malformed ⇒ 422 `validation.email`. (d) **Lists** — `pageSize` stays `25 | 50 | 100` (the onboarding tunnel reads products / agents with 25; `pageSize=1` is a 422). (e) **Sales** — `UpdateSaleDto.client { name, phone }` on a draft (above). (f) **Inbox** — `ConversationListItemDto.pageHasAgent` + `CONVERSATION_NO_AGENT` (above).
- **Carry-over additions**: `POST /agents/:id/pause { confirm?, sendOutOfHours? }`; `POST /agents/generate/:jobId/apply { …, override?: { instructions?, faq?, policies? } }`; `GET /agents?productId=`; `GET /clients/tags?q=` → `{ tag, count }[]`; `GET /products?supplierId=`; `POST /shipments/labels { …, onePdfPerOrder?, includeRecap? }`; report filters `source`, `channelId`, `groupBy` where `REPORT_DEFINITIONS` lists them; WS `resync { since }` → `{ at, since, conversations, orders, notificationsUnread }`, `conversation.typing { conversationId, userId?, ai?, active?, at }`, `product.updated.originSessionId`.
