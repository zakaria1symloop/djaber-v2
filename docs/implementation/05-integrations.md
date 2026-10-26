# 05 — Integrations

Every external system sits behind one interface in `apps/api/src/modules/<module>/adapters|gateway/`, with a fake implementation for tests and recorded fixtures under `apps/api/test/fixtures/<provider>/`. Notification types cited below are the slugs of `03-functional-modules.md` §15. Secrets are read from `core/config` (platform) or decrypted from DB rows (per workspace). V1 facts cited as `[V1 <file>]` come from `E:\Dev App\djaber\backend\src` (no secrets were read).

---

## 1. Meta (Messenger + Instagram)

### 1.1 Constants
`META_GRAPH_VERSION = 'v21.0'` for both `graph.facebook.com` and `graph.instagram.com` (V1 used v18/v21 mixed — unify). Timeouts: 10 s HTTP; typing indicator 5 s.

### 1.2 Webhook endpoint (`MetaWebhookController`, raw body)
- V1 paths (`META_LEGACY_PATHS=true`, live): `/api/webhooks/meta`, `/api/webhooks/meta/data-deletion` and `/api/pages/callback/{facebook|instagram}` are rewritten to `/api/v1/webhooks/meta`, `/api/v1/webhooks/meta/data-deletion` and `/api/v1/channels/callback/{platform}` before routing (`legacyMetaPaths` in `apps/api/src/bootstrap.ts`; query kept; the raw body is captured by the body parser, so signatures still verify). Off by default.
- `GET /webhooks/meta?hub.mode=subscribe&hub.verify_token&hub.challenge` ⇒ `200 <challenge>` when token equals `META_VERIFY_TOKEN`, else `403`.
- `POST /webhooks/meta`: compute `sha256=` + HMAC-SHA256(`META_APP_SECRET`, rawBody) and compare (constant time) with `X-Hub-Signature-256`; mismatch ⇒ `401 WEBHOOK_SIGNATURE_INVALID` (logged, metric `meta_webhook_invalid_signature_total`). Then for each `entry[]`, for each `messaging[]` item (both `object='page'` and `object='instagram'` use `entry[].messaging[]` — `entry[].changes[]` is ignored [V1 webhook.controller.ts]): insert `InboundEvent{ provider:'meta', externalId: message.mid ?? `${entry.id}:${timestamp}:${sender.id}:${hash}`, payload }` (`ON CONFLICT (externalId) DO NOTHING`), enqueue `meta-inbound.process-event { inboundEventId }` with `jobId='inbound:'+externalId`. Respond `200 EVENT_RECEIVED`. Target ack < 200 ms (no DB reads other than the insert). Postgres unavailable ⇒ `503` so Meta retries.
- `POST /webhooks/meta/data-deletion` (form `signed_request`): split `sig.payload`, verify HMAC-SHA256(`META_APP_SECRET`, payload) base64url; payload `{ user_id }` ⇒ create `DataDeletionRequest{ code, status:'pending' }`, enqueue hard delete of all `ClientIdentity/Conversation/Message` for that `externalSenderId` across channels; respond `{ url: PUBLIC_WEB_URL+'/data-deletion/'+code, confirmation_code: code }`. Public status: `GET /data-deletion/:code` ⇒ `DataDeletionStatusDto` (api-contract §3.14).

### 1.3 Inbound event fields used
`sender.id` (PSID / IGSID), `recipient.id` (page id / IG account id — channel lookup `(platform, externalId)`), `timestamp`, `message.mid`, `message.text`, `message.attachments[].type ∈ image|audio|video|file|location|fallback|template`, `message.attachments[].payload.url|coordinates`, `message.sticker_id`, `message.is_echo` + `message.app_id` (our own sends ⇒ ignored; any other echo = a manual reply typed in the Page inbox ⇒ stored as a human message and, with `Workspace.autoPauseOnManualReply`, the AI is paused on that thread), `message.quick_reply.payload`, `message.reply_to.story`, `postback.payload|title`, `read` (ignored), `delivery` (pending ⇒ sent), `reaction` (stored in `Message.customerReaction`). Instagram: `message.is_deleted`, `message.is_unsupported` ⇒ treated as unsupported media.

### 1.4 Graph send (`MetaGraphClient`)
- Facebook: `POST https://graph.facebook.com/v21.0/me/messages?access_token=<pageToken>` body `{ recipient:{ id }, messaging_type:'RESPONSE', message:{ text } }` (always set `messaging_type` — V1 omitted it). Tagged: `{ messaging_type:'MESSAGE_TAG', tag:'HUMAN_AGENT'|'POST_PURCHASE_UPDATE', … }`.
- Instagram: `POST https://graph.instagram.com/v21.0/me/messages` header `Authorization: Bearer <token>` same body (no tags).
- Image: `message:{ attachment:{ type:'image', payload:{ url, is_reusable:true } } }` then a text message `{title}\n{price} DA` — product card = image message + text message, ≤ 5 cards (MSG-07). Generic template (P2 FB) = `message:{ attachment:{ type:'template', payload:{ template_type:'generic', elements:[{ title, subtitle, image_url, buttons:[{ type:'postback', title:'Commander', payload:'ORDER:'+productId }] }] } } }` behind flag `fb_generic_template`.
- Typing: `{ recipient:{ id }, sender_action:'typing_on' }`.
- Profile: `GET /<psid>?fields=first_name,last_name,profile_pic&access_token=` (FB); IG: `GET /<igsid>?fields=name,username,profile_pic`.

Error mapping (`meta-errors.ts`, from `error.code/error_subcode`):

| code / subcode | Meaning | Handling |
|---|---|---|
| 190 (any subcode), `OAuthException` type with 102 | token invalid/expired | channel `needs_reconnect`, notification `channel.needs_reconnect`, AI stops; job fails without retry |
| 10 / 2018278 | outside 24 h window | human send ⇒ 422 `REPLY_OUTSIDE_WINDOW`; AI/system ⇒ message `failed` + `needs_human` note `outside_window`; transactional IG ⇒ `skipped_window` |
| 10 / 2018065, 2018108 | messaging permission missing | channel `needs_reconnect` (report code `PAGE_MESSAGING_PERMISSION_MISSING`) |
| 4, 17, 32, 613 | rate limit | retry with the `meta-send` backoff (5 attempts over 10 min) |
| 551 / 1545041 | user unavailable (blocked the page) | message `failed`, conversation note, no retry |
| 100 / 2534014, 2534015 | invalid attachment / URL | message `failed`, no retry, Sentry |
| 200 | permission denied (`pages_messaging` not granted) | channel `needs_reconnect` |
| 1, 2, 368 (temporary) | Meta unavailable | retry (network class) |
| network / timeout | — | retry |

### 1.5 OAuth connect (`MetaOAuthService`)
- Facebook dialog: `https://www.facebook.com/v21.0/dialog/oauth?client_id&redirect_uri=<redirect>&state&scope=<scopes>`. `<scopes>` = `META_FACEBOOK_SCOPES` (comma list) when set — the permissions enabled in the Meta app; asking for one the app lacks makes the login fail; live = `pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement` (the V1 set) — else the full list `pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement,pages_read_user_content,instagram_basic,instagram_manage_messages[,business_management]` (`FACEBOOK_SCOPES`). `<redirect>` = `PUBLIC_API_URL` + `META_OAUTH_CALLBACK_PATH` with `{platform}` replaced (default `/api/v1/channels/callback/{platform}`; live `/api/pages/callback/{platform}`, the URL registered for V1, see §1.2). Page analysis (CHN-08) needs `pages_read_engagement` **or** `pages_read_user_content` in `Channel.grantedScopes`. `state` = AES-256-GCM (`CryptoService`) of `{ workspaceId, userId, platform, nonce, exp:+10min }` — authenticated and opaque — with a single-use nonce in Redis; verified on callback (`OAUTH_STATE_INVALID`). `error=access_denied` ⇒ `OAUTH_CANCELLED`.
- Callback: `GET /oauth/access_token?client_id&client_secret&redirect_uri&code` → user token → exchange long-lived `GET /oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=` → `GET /me/accounts?fields=id,name,access_token,tasks,picture{url}&limit=100` paginated to 200 → per page: no `access_token` ⇒ `PAGE_ACCESS_TOKEN_MISSING`; `tasks` lacking `MESSAGING` ⇒ `PAGE_MESSAGING_PERMISSION_MISSING`; `Channel(platform='facebook', externalId)` in another workspace ⇒ `PAGE_ALREADY_CONNECTED_ELSEWHERE`; `LimitService.assert('pages')` ⇒ `PLAN_LIMIT`; else upsert channel (token encrypted, `tokenExpiresAt=null` for page tokens) → `POST /<pageId>/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins,message_reads` (failure ⇒ `warning PAGE_WEBHOOK_SUBSCRIBE_FAILED`, `webhookSubscribed=false`, retried by `sched-channel-webhook-retry`) → `GET /<pageId>?fields=instagram_business_account{id,name,username,profile_picture_url}` ⇒ child channel `platform='instagram', parentChannelId`, same token, status `active` if `instagram_manage_messages` approved else `pending_review` (`PAGE_INSTAGRAM_PENDING_APPROVAL`).
- Report shape returned to the popup via `postMessage({ type:'djaber:connect', report })` and stored on `Job`-less `ConnectReport` in Redis 10 min: `{ id, platform, outcome:'ok'|'error', error:{ code, message }|null, pages:[{ externalId, name, platform, avatarUrl, status:'connected'|'skipped'|'warning'|'pending_review', code, channelId, reconnected }], planLimit:{ limit, current } }` (a page beyond `maxPages` is `skipped` with `code: PLAN_LIMIT`; read back with `GET /channels/connect/reports/:id`; without an opener the page goes to `<PUBLIC_WEB_URL>/channels/connect/return?connectReport=<id>` or `?connectError=<CODE>`). Meta's login pages set `Cross-Origin-Opener-Policy`, so a pop-up usually comes back **without** `window.opener`: the web return page then hands `{ type:'handoff', reportId, error }` over a `BroadcastChannel` (`CONNECT_HANDOFF_CHANNEL`) to the window that started the flow, which answers `{ type:'ack' }`; the pop-up then closes (or shows "Connexion terminée…" when the browser refuses), and without an ack in 1.5 s it returns in the same tab to the stored start screen (default `/channels`). The return page runs during the onboarding tunnel. The starting window never treats `window.closed` as a cancellation (it reads true once the opener is cut); only "Annuler" or an `OAUTH_CANCELLED` report end the wait.
- Instagram Business Login: `https://www.instagram.com/oauth/authorize?client_id=<IG_APP_ID>&redirect_uri=<API>/channels/callback/instagram&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages&state` → `POST https://api.instagram.com/oauth/access_token` (form: `client_id, client_secret, grant_type=authorization_code, redirect_uri, code`) → `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret&access_token` (long-lived, 60 d ⇒ `tokenExpiresAt`) → `GET https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url` (failure ⇒ `PAGE_INSTAGRAM_PENDING_APPROVAL`) → `POST https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages` → channel `platform='instagram', externalId=user_id`.
- Reconnect = same flow; callback upserts by `(platform, externalId)`; `status='active'`, history kept.
- Token refresh (`sched-token-refresh`): IG `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=` when `tokenExpiresAt < now+10 d`; FB weekly `GET /debug_token?input_token=<pageToken>&access_token=<appId>|<appSecret>` ⇒ `is_valid=false` ⇒ `needs_reconnect`.
- Disconnect: `DELETE /<pageId>/subscribed_apps` (FB; IG child inherits), token cleared, `status='disconnected'`, `AgentChannel` removed.

### 1.6 History sync & insights
- Sync: `GET /<pageId>/conversations?fields=id,updated_time,participants,messages.limit(25){id,from,to,message,attachments,created_time}&limit=25` (`platform=instagram` for IG) [V1 page-sync.service.ts]; messages inserted with `externalId` (dedup), `author` = page ⇒ `human` (no run id), else `customer`; no AI replies on history. 190 ⇒ `PAGE_SYNC_TOKEN_EXPIRED`.
- Insights: `GET /<pageId>/insights?metric=page_messages_total_messaging_connections,page_fans&period=day` — any error ⇒ `INBOX_INSIGHTS_UNAVAILABLE` card state.

---

## 2. Couriers

### 2.1 `CourierAdapter` interface (`modules/delivery/adapters/courier-adapter.ts`)

```ts
// Wilayas 59–69 (loi 26-06): couriers only know the 58 historical codes. Every adapter receives courierWilayaId(wilayaId)
// (= WILAYA_PARENT for 59–69) and the parent's name for wilayaId / wilayaName / sender.wilayaId; communeName stays the real one.
export type CourierProvider = 'zrexpress' | 'ecotrack' | 'yalidine' | 'manual';

export interface CourierCredentials { zrexpress: { token: string; key: string }; ecotrack: { baseUrl: string; token: string }; yalidine: { apiId: string; apiToken: string }; manual: {} }

export interface CreateShipmentInput {
  shipmentId: string; orderNumber: string;                       // external reference
  recipient: { name: string; phone: string; phone2?: string };
  wilayaId: number; wilayaName: string; communeName: string; communeCode?: string;   // from CourierCommuneMap
  address: string; isStopdesk: boolean; stopdeskId?: string;
  codAmount: number; weightGrams?: number; productSummary: string; note?: string; declaredValue?: number;
  sender: { name: string; phone: string; wilayaId: number; address: string };
}
export interface CreateShipmentResult { trackingNumber: string; externalId?: string; labelUrl?: string; rawStatus?: string; raw: unknown }
export interface TrackResult { trackingNumber: string; rawStatus: string; mapped: ShipmentStatus | null; location?: string; at?: string; failureReason?: FailureReason; raw: unknown }
export type ShipmentStatus = 'pending'|'sent'|'picked_up'|'in_transit'|'out_for_delivery'|'delivered'|'failed'|'returned'|'cancelled'|'stale';   // = Prisma enum ShipmentStatus
export type FailureReason = 'address'|'unreachable'|'refused'|'damaged'|'other';
export interface Stopdesk { id: string; name: string; wilayaId: number; communeName: string; address?: string }

export interface CourierAdapter {
  readonly provider: CourierProvider;
  readonly capabilities: { cancel: boolean; label: boolean; batchTrack: boolean; webhook: boolean; rates: boolean; stopdesks: boolean; retry: boolean };
  testCredentials(c): Promise<{ ok: true; latencyMs: number; accountName?: string; wilayasServed?: number } | { ok: false; code: 'COURIER_CREDENTIALS_INVALID'|'COURIER_UNAVAILABLE'; message: string }>;
  createShipment(c, input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancel?(c, trackingNumber: string): Promise<{ ok: boolean; rawStatus?: string }>;
  getLabel?(c, trackingNumber: string): Promise<{ pdf: Buffer } | { url: string }>;
  track(c, trackingNumber: string): Promise<TrackResult>;
  trackMany?(c, trackingNumbers: string[]): Promise<TrackResult[]>;
  listStopdesks?(c, wilayaId: number): Promise<Stopdesk[]>;
  getRates?(c, fromWilayaId: number, toWilayaId: number): Promise<{ home: number; stopdesk: number } | null>;
  retryDelivery?(c, trackingNumber: string): Promise<{ ok: boolean }>;
  parseWebhook?(headers, rawBody, secret): { trackingNumber: string; rawStatus: string; at?: string }[] | null;   // null = invalid signature
}
```
Every adapter throws `CourierError { kind: 'validation', field?: 'phone'|'commune'|'address'|'wilaya'|'weight'|'cod', message }` ⇒ 422 `COURIER_VALIDATION {field, message}` (no retry); `kind:'auth'` ⇒ `COURIER_CREDENTIALS_INVALID` (account flagged, no retry); `kind:'unavailable'` (5xx/timeout/network) ⇒ `COURIER_UNAVAILABLE` (queued retry); `kind:'not_found'` ⇒ `TRACKING_NOT_FOUND`; `kind:'cancel_not_allowed'` ⇒ `COURIER_CANCEL_NOT_ALLOWED`.

### 2.2 ZR Express (Procolis) [V1 delivery.service.ts]
- Base `https://procolis.com/api_v1`; headers `token`, `key` (both from credentials); JSON.
- `testCredentials`: `GET /token` ⇒ `Statut === 'Accès activé'`; 401/403 ⇒ `auth`.
- `createShipment`: `POST /add_colis { Colis:[{ Tracking:'', TypeLivraison: isStopdesk?1:0, TypeColis:0, Confrimee:1, Client: recipient.name, MobileA: phone, MobileB: phone2 ?? '', Adresse: address, IDWilaya: String(wilayaId), Commune: communeName, Total: String(codAmount), Note: note ?? '', TProduit: productSummary, id_Externe: orderNumber, Source:'' }] }` ⇒ `Colis[0].MessageRetour === 'Good'` else validation error (message mapped: contains "Commune" ⇒ field `commune`, "Mobile"/"Tel" ⇒ `phone`, "Wilaya" ⇒ `wilaya`, else `other`); `trackingNumber = Colis[0].Tracking`.
- `track`: `POST /lire { Colis:[{ Tracking }] }` ⇒ `Colis[0].Situation` (raw status) + `Colis[0].DateH_Situation`.
- `trackMany`: same endpoint with ≤ 50 trackings.
- `getRates`: `POST /tarification` ⇒ row where `IDWilaya == toWilayaId` ⇒ `{ home: Domicile ?? TarifLivraison, stopdesk: Stopdesk ?? TarifStopdesk }`.
- `cancel`: not offered by the API ⇒ `capabilities.cancel=false` ⇒ UI shows "Annuler le colis" disabled with `COURIER_CANCEL_NOT_ALLOWED`.
- `getLabel`: not offered ⇒ `LABEL_UNAVAILABLE` ⇒ Djaber fallback label (§8).
- Status mapping (`zrexpress.statuses.ts`; raw strings compared case/accents-insensitive; unknown ⇒ `mapped: null`):

| Raw `Situation` (contains) | mapped | failureReason |
|---|---|---|
| `En préparation`, `Préparation` | `sent` | |
| `Ramassé`, `Ramassée`, `Collecté` | `picked_up` | |
| `Expédié`, `En transit`, `Vers wilaya`, `Centre`, `Hub` | `in_transit` | |
| `Sorti en livraison`, `En livraison`, `En cours de livraison` | `out_for_delivery` | |
| `Livré`, `Livrée`, `Encaissé` | `delivered` | |
| `Tentative échouée`, `Client injoignable`, `Ne répond pas` | `failed` | `unreachable` |
| `Adresse erronée`, `Adresse incorrecte` | `failed` | `address` |
| `Refusé`, `Client refuse` | `failed` | `refused` |
| `Endommagé` | `failed` | `damaged` |
| `Retour vers vendeur`, `Retourné`, `Retour livré` | `returned` | |
| `Annulé` | `cancelled` | |

### 2.2b ZR Express — new platform (api.zrexpress.app, public API v1; tester report 2026-10-20 D1)
- Same provider `zrexpress`; the platform is the account's `baseUrl`: `https://api.zrexpress.app` (`ZR_APP_BASE_URL`) = new platform, `''` = Procolis (§2.2). Credentials `{ apiKey, tenantId }` (the create body picks the platform by its keys; an edit keeps the platform). The host is fixed in the adapter, never read from the account. A workspace may hold one account per platform.
- Auth headers `X-Api-Key: <apiKey>` + `X-Tenant: <tenantId>`; contract = `https://api.zrexpress.app/swagger/public-v1/swagger.json`.
- `testCredentials`: `POST /api/v1/territories/search { pageNumber: 1, pageSize: 1 }` ⇒ 200 with `items`; 401/403 or another 4xx (unknown tenant) ⇒ `COURIER_CREDENTIALS_INVALID`.
- Addresses: ZR takes territory ids. `territories/search` (all pages of 1000, `includeUnavailable`) is kept 24 h per tenant in the adapter; wilayas = parents of the leaf territories (communes), matched by `code` = courier wilaya code (58 historical codes); commune = child matched by folded name (accents, case, spaces, punctuation ignored), `CourierCommuneMap.externalCode` tried first; a commune moved to a 2026 wilaya (59–69) is looked up in the wilayas whose parent code is the one sent. Not found ⇒ `validation` on `commune` (no call).
- `createShipment`: `POST /api/v1/parcels { customer: { customerId: <uuid>, name, phone: { number1, number2? } (international `+213…`) }, deliveryAddress: { cityTerritoryId, districtTerritoryId, street }, hubId? (stop-desk), orderedProducts: [{ productName: productSummary, quantity: 1, unitPrice: declaredValue ?? cod, stockType: 'none' }], deliveryType: 'home' | 'pickup-point', description: productSummary (+ note; ≥ 2 characters), amount: cod (≤ 150 000 DA, else `validation` on `cod` without a call), weight: { weight: kg ≥ 1 }, externalId: orderNumber }` ⇒ 201 `{ id, trackingNumber? }` (`Shipment.externalId` = ZR parcel id); a creation answered with the id only reads the tracking back with `GET /api/v1/parcels/{id}` (never a retry, which would create a second parcel). Checked on 26/10 against the public swagger and a maintained reference client (dz-delivery): `stockType: 'local'` needs a ZR product id + SKU, so it is `none` (tester report 25/10 UX-009). 400/422 ProblemDetails `errors { "Customer.Phone.Number1": [...] }` ⇒ `validation`, field from the key (phone / district ⇒ commune / city ⇒ wilaya / hub ⇒ stopdesk / street ⇒ address / amount ⇒ cod / weight), else from the message.
- Stop-desks: `POST /api/v1/hubs/search` (kept 24 h per tenant), visible `isPickupPoint` hubs ⇒ `CourierStopdesk` (`externalId` = hub id) through `courier.fetch-stopdesks`; a stop-desk parcel sends `hubId`. The order keeps the Djaber row id (`CourierStopdesk.id`); the send gives the courier its own id (`externalId`) — Yalidine too.
- `track`: `GET /api/v1/parcels/{trackingNumber}` ⇒ `state.name` mapped with the ZR table (new-platform rows added), `situation.name` = failure reason + description; raw = `state · situation`; date `lastSituationUpdateAt ?? lastStateUpdateAt`; 404 ⇒ `not_found`. No batch endpoint ⇒ one call per parcel (limiter).
- `cancel`: the parcel is read first and refused (`cancel_not_allowed`) once past `sent`; else `DELETE /api/v1/parcels/{id}` (a ZR refusal ⇒ `cancel_not_allowed`).
- `getLabel`: `POST /api/v1/parcels/labels/individual/pdf { trackingNumbers: [t], format: 'A6', isPreview: false }` ⇒ `fileUrl` fetched (HTTPS only; the API key is sent only to ZR's own host) and checked `%PDF-`; anything else ⇒ `LABEL_UNAVAILABLE` ⇒ Djaber label.
- `getAllRates`: `GET /api/v1/delivery-pricing/rates?fromTerritoryId=<sender wilaya>` (404 = no price list for that origin ⇒ the default list); wilaya rows only; price = `discountedPriceTtc ?? priceTtc ?? discountedPrice ?? price` of `home` / `pickup-point`.
- Capabilities `ZR_APP_CAPABILITIES`: label, cancel, stop-desks, rates; no batch tracking, no webhook, no retry. Read per account everywhere (`capabilitiesOf(provider, baseUrl)`, `CourierAdapters.get(provider, baseUrl)`).
- To confirm on the first live account (staging, `COURIER_DRIVER=live`): the territory level layout, the `format` value of the label request, the French state names (unknown ones are stored with `mapped: null` and shown raw). A new parcel stays « Commande reçue » until the merchant marks it ready on the ZR portal.
- **Simulation is said** (tester report 25/10 UX-009): with `COURIER_DRIVER` ≠ `live` every parcel, connection test and tracking is simulated (`<ZR|ECO|YAL>-<n>` numbers) — `GET /delivery/couriers/providers` returns `simulated: true` and Livraison › Transporteurs shows a warning banner; `tools/deploy/diag-couriers.cjs` (read-only, on the server) prints the driver, the accounts and the last parcels.

### 2.3 EcoTrack (one API for every courier on the EcoTrack platform: DHD, Conexlog, MSM Go, World Express … — checked on 26/10 against the reference clients dz-delivery and CourierDZ)
- Base `credentials.baseUrl` = the courier's host: `https://<courier>.ecotrack.dz`, `https://platform.dhd-dz.com` (DHD) or `https://app.conexlog-dz.com` (Conexlog) — `ECOTRACK_URL_RE`, a pasted `/api/v1` is stripped; only these hosts are ever called with the token. Endpoints under `/api/v1`; header `Authorization: Bearer <token>`. **Single-order calls take query parameters, never a JSON body.**
- `testCredentials`: `GET get/wilayas` ⇒ 200 (list, `data` or index-keyed object).
- `createShipment`: `POST create/order?reference=&nom_client=&telephone=&telephone_2=&adresse=&code_wilaya=&commune=&montant=&produit=&remarque=&type=1&stop_desk=0|1[&code_postal=][&weight=]` — `type` is required (1 = livraison), phones in the local form `0XXXXXXXXX`, `code_wilaya` 1–58 (courier code), the commune in the tenant's spelling (`GET get/communes?wilaya_id=` kept 24 h; our name when it cannot be read), `montant` = what the recipient pays (delivery included), a stop-desk parcel = `stop_desk=1` + the desk's `code_postal` (`CourierStopdesk.externalId`). Answer `{ success:true, tracking }` (also nested `data.tracking` / `order.tracking`); 422 `errors{field}` mapped (`telephone`→phone, `commune`, `code_postal`→stopdesk, `adresse`→address, `code_wilaya`→wilaya); 200 `{ success:false, error: 10001 | 10002 | 10003 }` = business refusal (10002 ⇒ wilaya).
- Then `POST valid/order?tracking=` hands the order to the courier (« Expédier »; without it the order stays « prête à expédier »). A failed validation never fails the send (`raw.validated = false`; the merchant validates it on the courier dashboard) — the parcel exists, a retry would duplicate it.
- `track`: `GET get/tracking/info?tracking=` — the entry of exactly this tracking (list / keyed / single answers), `activity[]` sorted by `date` + `time`, `notification_on_order` skipped (a remark); the API keys (`livred`, `picked`, `attempt_delivery`, `return_received` …) and the French labels are both mapped. No batch endpoint ⇒ one call per parcel (`batchTrack: false`).
- `getRates` / `getAllRates`: `GET get/fees` ⇒ `livraison[] { wilaya_id, tarif, tarif_stopdesk }` (0 = not offered). `listStopdesks`: the communes flagged `has_stop_desk` (id = `code_postal`).
- `getLabel`: `GET get/order/label?tracking=` ⇒ PDF bytes. `cancel`: `DELETE delete/order?tracking=` — refused (`cancel_not_allowed`) once validated (10001) or `delete: 'fail'`. `retryDelivery`: `POST ask/retry?tracking=`.
- Capabilities: label, cancel, rates, stop-desks, retry; no batch tracking, no webhook.
- Mapping (`ecotrack.statuses.ts`):

| Raw `event`/`status` | mapped | reason |
|---|---|---|
| `Créé`, `En préparation`, `Prêt à expédier` | `sent` | |
| `Ramassé`, `Collecté` | `picked_up` | |
| `Reçu au hub`, `Expédié`, `En transit`, `Transféré` | `in_transit` | |
| `Sorti en livraison`, `En livraison` | `out_for_delivery` | |
| `Livré` | `delivered` | |
| `Tentative échouée`, `Client absent`, `Injoignable` | `failed` | `unreachable` |
| `Adresse introuvable` | `failed` | `address` |
| `Refusé` | `failed` | `refused` |
| `Endommagé` | `failed` | `damaged` |
| `Retour`, `Retourné au vendeur`, `Retour livré` | `returned` | |
| `Annulé`, `Supprimé` | `cancelled` | |

### 2.4 Yalidine [V1 delivery.service.ts]
- Base `https://api.yalidine.app/v1`; headers `X-API-ID`, `X-API-TOKEN`.
- `testCredentials`: `GET /wilayas/`.
- `createShipment` (checked on 26/10 against the reference clients dz-delivery and CourierDZ): `POST /parcels/ [{ order_id: orderNumber, from_wilaya_name: sender wilaya, firstname, familyname (the name split on the first space; one word ⇒ the same twice), contact_phone: local form (comma-separated when two), address, to_commune_name: communeName (a stop-desk parcel: the desk's own `commune_name` / `wilaya_name` from `centers`), to_wilaya_name, product_list: productSummary ≤ 150, price: codAmount (≤ 150 000 DA, else `validation` on `cod`), do_insurance:false, declared_value: declaredValue ?? cod, length:0, width:0, height:0, weight: kg ≥ 1, freeshipping: true (price already includes the delivery fee — false made Yalidine add its fee on top), is_stopdesk, stopdesk_id (numeric, stop-desk only), has_exchange:false }]` ⇒ `data[order_id].success` ⇒ `tracking`, `label` (URL); else `data[order_id].message` mapped to field.
- `track`: `GET /parcels/{tracking}` ⇒ `data[0].last_status`; `trackMany`: `GET /parcels/?tracking=a,b,c` (≤ 50); `getLabel`: `data[0].label` URL (fetched and stored on S3); `listStopdesks`: `GET /centers/?wilaya_id=` ⇒ `{ center_id, name, commune_name, address }`; `getRates`: `GET /fees/?from_wilaya_id&to_wilaya_id` ⇒ `per_commune { express_home, express_desk }` — the wilaya rate is the lowest commune price (an older `data[0].home_fee / desk_fee` answer is read too); `cancel`: `DELETE /parcels/{tracking}` (only « En préparation »; an answer `deleted: false` ⇒ `cancel_not_allowed`); `parseWebhook`: Yalidine `parcel_status_updated` events JSON `{ events:[{ tracking, status, date_status }] }`, verification by the secret set at subscription (`X-Yalidine-Secret` header equality).
- Mapping (`yalidine.statuses.ts`, `last_status` values):

| Raw | mapped | reason |
|---|---|---|
| `Pas encore expédié`, `A vérifier`, `En préparation`, `Pas encore ramassé`, `Prêt à expédier` | `sent` | |
| `Ramassé` | `picked_up` | |
| `Transfert`, `Expédié`, `Centre`, `En localisation`, `Vers Wilaya`, `Reçu à Wilaya`, `Bloqué` | `in_transit` | |
| `En attente du client`, `Sorti en livraison`, `En attente` | `out_for_delivery` | |
| `Livré` | `delivered` | |
| `Tentative échouée` | `failed` | `unreachable` |
| `Echèc livraison` | `failed` | `other` (reason text copied) |
| `Retour vers centre`, `Retourné au centre`, `Retour transfert`, `Retour groupé`, `Retour à retirer`, `Retour en traitement` | `returned` (pending) → order `returned` after merchant confirms "return received" | |
| `Retourné au vendeur`, `Retour livré` | `returned` | |
| `Annulé`, `Supprimé` | `cancelled` | |

### 2.5 Manual (`Livraison propre`)
`createShipment` returns `{ trackingNumber: input.trackingNumber ?? 'MAN-'+orderNumber }`; no tracking; status changes only by the merchant (order page actions); capabilities all false.

### 2.6 Shipment lifecycle & tracking sync
- `POST /orders/:id/shipments` ⇒ guards: order `confirmed|preparing` (`DELIVERY_ORDER_NOT_CONFIRMED`), no active shipment (`DELIVERY_ORDER_ALREADY_SENT`), courier account active (`DELIVERY_NO_COURIER`), address complete (`ORDER_ADDRESS_REQUIRED`), stop-desk id when provider has stop-desks and `isStopdesk`. Creates `Shipment{ status:'pending', codAmount: order.total }`, order `deliveryStatus='pending'`, enqueues `courier.create-parcel`. The request returns 202 `{ shipment }`; the UI shows "sending…" until WS `shipment.updated`.
- Processor: adapter call ⇒ success: `Shipment{ status:'sent', trackingNumber, externalId, labelUrl?, nextSyncAt: now+2h }`, `OrderStateMachine.transition(order,'shipped', actor courier)`, `deliveryStatus='sent'`, notification `shipment.created`, customer transactional message `shipped {trackingNumber}`, Sheets/webhook `order.shipped`. Validation error ⇒ `Shipment{ status:'failed', lastError }` + order unchanged + WS (dialog shows mapped field). Unavailable ⇒ retry schedule; after the last attempt ⇒ `Shipment{ status:'failed', lastError:'COURIER_UNAVAILABLE' }` + notification `shipment.failed` with `data.reason='courier_unavailable'`.
- Sync (`sched-tracking-sync` → `track-batch`): for each result with `mapped !== null && mapped !== shipment.status` ⇒ `ShipmentEvent{ rawStatus, mappedStatus, location, at, source:'poll' }`, `Shipment.status`, `Order.deliveryStatus` (never backwards: ordering `sent < picked_up < in_transit < out_for_delivery < delivered`; `failed`/`returned`/`cancelled` allowed from any non-terminal), customer notification at `out_for_delivery|delivered|failed`, `delivered` ⇒ `OrderStateMachine` to `delivered` (COD rule), `returned` ⇒ order `returned` only after `POST /orders/:id/status { to:'returned', returnReceived:true }` by the merchant (the shipment shows "retour en cours" meanwhile; `Shipment.returnPending=true`). Unknown raw ⇒ event stored, `mapped=null`, status unchanged, metric `courier_unknown_status_total{provider,raw}`. `mapped === shipment.status` ⇒ only `lastSyncedAt`, `nextSyncAt`.
- Webhook `POST /webhooks/couriers/:courierAccountId`: `parseWebhook` (null ⇒ 401); for each event enqueue `courier-webhook` which **re-fetches** `track()` before applying (06 §3) and writes `source:'webhook'`.
- Cadence (DLV-04): `nextSyncAt = +2 h` for 3 days from `createdAt`, then `+12 h`; no event for 30 d ⇒ `stale`; terminal states (`delivered`, `returned`, `cancelled`) stop sync. "Sans mouvement" (overview tab) = no event for more than 5 d while `status ∈ sent|picked_up|in_transit`. Manual sync 1/5 min/shipment (`TRACKING_SYNC_RATE_LIMITED`).

### 2.7 Rates
`GET /delivery/rates?courierAccountId&wilayaId&stopdesk` ⇒ adapter `getRates(sender.wilayaId, wilayaId)` cached in `CourierRateCache(courierAccountId, fromWilayaId, toWilayaId, home, stopdesk, fetchedAt)` for 1 h; rates are fetched for the historical courier codes (up to `COURIER_WILAYA_COUNT` = 58) and expanded to 69: a wilaya 59–69 the courier does not price takes its parent's rate (a rate returned for 59–69 wins); Yalidine stop-desks (`listStopdesks`) are matched to the communes of the parent and of its new wilayas (`wilayasOfCourierCode`); stop-desks cached in `CourierStopdesk`; shown in the send dialog and used for margin analytics only (D15). `POST /delivery/fees/copy-from-courier { courierAccountId, wilayaIds?: number[] }` ⇒ overwrites `homePrice/stopdeskPrice` for the chosen rows, returns the diff.

---

## 3. Google Sheets (one-way, GSH)

- OAuth: `https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri=<API>/integrations/google-sheets/callback&response_type=code&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file&state=<signed>` → `POST https://oauth2.googleapis.com/token` ⇒ `refresh_token` (encrypted on `SheetsConnection.refreshToken`), `id_token.email` ⇒ `googleEmail`. While the Google OAuth app is in "testing" publishing status (`GOOGLE_OAUTH_VERIFIED=false`) the Sheets dialog shows the notice "≤ 100 utilisateurs test".
- Sheet selection: Picker (web gets a short-lived access token via `GET /integrations/google-sheets/picker-token`, scope `drive.file`, developer key `GOOGLE_PICKER_KEY`), pasted URL (`/spreadsheets/d/<id>/` regex; `GET https://sheets.googleapis.com/v4/spreadsheets/<id>?fields=sheets.properties` 404/403 ⇒ `SHEETS_SPREADSHEET_NOT_FOUND`), or create (`POST /v4/spreadsheets { properties:{ title:'Djaber · Commandes <workspace>' }, sheets:[{ properties:{ title:'Commandes' } }] }`).
- Tab `Commandes` initialised with header row (bold, frozen) and column R hidden:

| Col | Header (workspace locale fr / ar / en) | Source |
|---|---|---|
| A | Numéro / الرقم / Number | `order.number` |
| B | Date / التاريخ / Date | `orderedAt` in Africa/Algiers `yyyy-MM-dd HH:mm` |
| C | Canal / القناة / Channel | `channel.name` + ` (FB|IG)` or `—` |
| D | Client / العميل / Client | `clientName` |
| E | Téléphone / الهاتف / Phone | `clientPhone` as text (`'0555…`) |
| F | Wilaya / الولاية / Wilaya | `wilaya.nameFr` |
| G | Commune / البلدية / Commune | `commune.nameFr ?? communeText` |
| H | Adresse / العنوان / Address | `isStopdesk ? 'Stop-desk ' + stopdeskName : address` |
| I | Articles / المنتجات / Items | `items.map(i => `${i.productName}${i.variantName?' '+i.variantName:''} ×${i.quantity}`).join('; ')` |
| J | Sous-total / المجموع الفرعي / Subtotal | `subtotal` (number) |
| K | Frais / التوصيل / Delivery fee | `deliveryFee` |
| L | Total / الإجمالي / Total | `total` |
| M | Mode / طريقة الدفع / Method | `paymentMethod` label |
| N | Statut / الحالة / Status | `status` label (localized) |
| O | Transporteur / الناقل / Courier | `shipment.provider` label or `—` |
| P | Suivi / التتبع / Tracking | `shipment.trackingNumber` |
| Q | Source / المصدر / Source | `source` label |
| R | `djaber_id` (hidden) | `order.id` |

- Upsert (`sheets-upsert` job, debounced 5 s per order): find row by `R == orderId` using `GET /v4/spreadsheets/<id>/values/Commandes!R:R` (read before every write — no cache: a cached index would hit another order after a re-sort, GSH-04; M11); found ⇒ `PUT …/values/Commandes!A{row}:R{row}?valueInputOption=USER_ENTERED`; not found ⇒ `POST …/values/Commandes!A:R:append`; store `SheetsRow{ orderId, rowIndex, syncedAt }` (row index is a hint only; always re-locate by `djaber_id` — GSH-04 fix). Filters: `SheetsConnection.filters { channelIds?: string[], sources?: OrderSource[] }`; non-matching orders are skipped; rows are never deleted from the sheet (one-way).
- Errors: 401/`invalid_grant` ⇒ `status='error'`, `lastError='SHEETS_TOKEN_REVOKED'`, notification, queue skips this connection until reconnect; 404 ⇒ `SHEETS_SPREADSHEET_NOT_FOUND`; 429/403 `quotaExceeded` ⇒ `SHEETS_QUOTA`, pause 60 s, retry; others ⇒ retry then `error`.
- Backfill: `POST /integrations/google-sheets/backfill { from, to }` ⇒ `sheets-backfill` job iterating orders by `orderedAt` ascending, 100 per batch (`values:batchUpdate`), progress %.
- Disconnect: delete row, revoke `POST https://oauth2.googleapis.com/revoke?token=` from the worker job `outbox/sheets-revoke` (M11: no Google call from the handler); sheet untouched.
- Drivers (M11): `SheetsGateway` port — `GoogleSheetsGateway` (`SHEETS_DRIVER=google`, refused in development / test unless `SHEETS_ALLOW_LIVE=true`) and `FakeSheetsGateway` (`SHEETS_DRIVER=fake`, dev / test default, also served on the staging test site and 404 in production: consent page `/api/v1/dev/google/consent`, spreadsheets in Redis, dev viewer `/api/v1/dev/google/spreadsheets/:id/view`).

---

## 4. Payments — `PaymentGateway` (Chargily Pay only; `00-build-order.md` §0, R-N)

`PAYMENT_PROVIDER=chargily` is the only value; `ChargilyGateway` is the only implementation of `PaymentGateway`. Enums: `BillingProvider ∈ none|chargily|manual`, `BillingPaymentProvider ∈ chargily|manual|google_play|app_store`, `PaymentMethodBilling ∈ cib|edahabia|manual_transfer|manual_ccp|manual_cash|google_play|app_store`. Manual payments are recorded by finance with `provider='manual'` (§4.3). The return-page copy is "Confirmation du paiement en cours…".

```ts
export interface PaymentGateway {
  readonly provider: 'chargily';
  createCheckout(input: { amount: number; currency: 'DZD'; orderRef: string; description: string; returnUrl: string; failUrl: string; metadata: Record<string,string>; expiresInMin: number; locale: 'fr'|'ar'|'en' }): Promise<{ checkoutId: string; url: string; expiresAt: Date }>;
  verify(checkoutId: string): Promise<{ status: 'paid'|'pending'|'failed'|'expired'; amount: number; providerRef: string; raw: unknown; failureReason?: string }>;
  parseWebhook(headers: Record<string,string>, rawBody: Buffer): { eventId: string; checkoutId: string; status: 'paid'|'failed'|'expired'; amount: number; raw: unknown } | null;   // null = bad signature
  refund?(providerRef: string, amount: number, reason: string): Promise<{ ok: boolean; refundRef?: string }>;
}
```

### 4.1 Direct card rails
SATIM direct integration is not built in v2; Chargily Pay exposes the CIB / Edahabia rails.

### 4.2 Chargily — `ChargilyGateway` [V1 chargily.service.ts]
- Base `https://pay.chargily.net/test/api/v2` when `CHARGILY_MODE=test`, `https://pay.chargily.net/api/v2` when `CHARGILY_MODE=live`; `Authorization: Bearer <CHARGILY_SECRET_KEY>`.
- `createCheckout`: `POST /checkouts { amount, currency:'dzd', success_url, failure_url, description, webhook_endpoint:<API>/webhooks/chargily, metadata:{ workspaceId, kind, targetId }, locale }` ⇒ `{ id, checkout_url }`; `checkoutId=id`, `url=checkout_url`, `expiresAt=now+expiresInMin`.
- `verify`: `GET /checkouts/{id}` ⇒ `status ∈ paid|pending|failed|expired|canceled` (`canceled` ⇒ `failed`); past `expiresAt` and not paid ⇒ `expired`.
- `parseWebhook` (`POST /webhooks/chargily`): header `signature` = hex HMAC-SHA256(`CHARGILY_SECRET_KEY`, rawBody), compared constant-time (mismatch ⇒ `null` ⇒ 401 `WEBHOOK_SIGNATURE_INVALID`); body `{ id: eventId, type:'checkout.paid'|'checkout.failed'|'checkout.expired', data:{ id, amount, status, metadata } }`; `InboundEvent{ provider:'chargily', externalId: eventId }` dedup then job `payment.process-event`.
- Return page `/settings/billing/return?ref=<providerCheckoutId>` calls `GET /billing/checkout/return?ref=` (which runs `verify`) every 5 s × 12; still `pending` ⇒ state "EN ATTENTE"; `sched-payment-reconcile` every 10 min verifies pending checkouts younger than 24 h; older ⇒ `expired`.
- `refund`: not supported by the API ⇒ `refund` is undefined; refunds are recorded manually (`BillingPayment.status='refunded'`, audit).
- Checkout payment method is reported by Chargily in `data.payment_method ∈ cib|edahabia` ⇒ `Invoice.method`.

### 4.3 Common processing
- `BillingPayment{ workspaceId, invoiceId?, subscriptionId?, amount, status: BillingPaymentStatus, provider: BillingPaymentProvider, providerCheckoutId U, reference?, paidAt?, raw }` (prisma-schema names; what to activate — subscription change / invoice / pack — is `raw.intent { kind, … }`). Order payment links are `OrderPayment` rows (`providerRef` = Chargily checkout id).
- Activation is idempotent on `providerCheckoutId` (`UPDATE … WHERE status='pending'` returns 1 row ⇒ proceed; else no-op): subscription ⇒ `SubscriptionService.activate(planId, cycle)` (existing active ends now; new period; credit period opened; `Invoice{ kind:'subscription', number:'F-'+year+'-'+seq, status:'paid', method }` PDF); pack ⇒ `CreditPackPurchase{ channel:'web', status:'credited', creditedAt }` + `CreditLedger{ action:'pack_purchase', kind:'credit', bucket:'pack', credits:+pack.credits, idempotencyKey:'pack:<purchaseId>' }` + `Invoice{ kind:'credit_pack' }` + notification `credits.pack_purchased`; order ⇒ `OrderPayment.status='paid'`, `Order.paymentStatus='paid'`, cash row, customer + merchant notified (`payment.received`).
- Amount mismatch (`verify.amount !== expected`) ⇒ `PAYMENT_AMOUNT_MISMATCH`: payment `flagged=true`, not activated, `platform.alert`, admin dialog "accepter / rembourser".
- Manual payments (ADM-05 "Paiement manuel", finance): `POST /admin/invoices/:id/mark-paid { amount, method:'manual_transfer'|'manual_ccp'|'manual_cash', reference, paidAt, proofUploadId?, reason }` ⇒ `BillingPayment{ provider:'manual' }` then the same activation path. `amount` = remaining ⇒ invoice `paid` + immediate reactivation; `amount` < remaining ⇒ invoice stays `unpaid`, `200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`; `amount` > remaining ⇒ `422 VALIDATION_ERROR` (`fields.amount='validation.range'`, max = remaining). No credit notes in v2.
- Order payment links (FL-10): `POST /orders/:id/payment-link` ⇒ one active `OrderPayment` (previous one `expired`), `kind='order'`, `expiresInMin=15`, link sent in the conversation as a transactional message (`customer.paymentLink`); `POST /orders/:id/refunds { amount, reason }` ⇒ recorded refund (no gateway call), cash row `expense refund`, `paymentStatus='refunded'`.

---

## 5. Store in-app purchases (D40) — `IapService`

- Products: `CreditPack{ slug, name, credits, priceWebDzd, googleProductId, appleProductId, storeTier, storePriceLabel, isActive, visibleWeb, visibleMobile, isFeatured, sortOrder }` (ADM-15); mobile lists them with `GET /credit-packs?platform=google_play|app_store` (packs with a store product id only).
- `POST /credits/packs/iap/validate { platform:'google_play'|'app_store', productId, transactionId, receipt?, purchaseToken? }` (`Idempotency-Key` required; idempotent on `transactionId`) ⇒ `CreditPackPurchase{ channel: platform, status:'pending', storeTransactionId: transactionId U, storeOrderId?, receipt, purchasedById }` ⇒ synchronous validation (10 s timeout, else `503 IAP_STORE_UNAVAILABLE` and job `iap-validate` retries with the queue default) ⇒ `IapValidateResult { status:'credited'|'already_credited'|'invalid'|'pending', creditsAdded, balance }`:
  - `google_play`: Google Play Developer API `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/products/{productId}/tokens/{purchaseToken}` (service account `GOOGLE_PLAY_SERVICE_ACCOUNT`) ⇒ `purchaseState===0 && consumptionState===0` ⇒ credit, then `POST …/tokens/{purchaseToken}:consume`; `acknowledgementState===0` ⇒ `:acknowledge`.
  - `app_store`: App Store Server API `GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}` (JWT from `APPLE_IAP_KEY_ID/ISSUER_ID/PRIVATE_KEY`), verify the signed transaction (`x5c` chain), `productId` match, `revocationDate` null ⇒ credit. Sandbox base `https://api.storekit-sandbox.itunes.apple.com` when `APPLE_IAP_ENV=sandbox`.
  - Unknown `productId` for the platform ⇒ `404 IAP_PRODUCT_UNKNOWN`; store says invalid ⇒ `status='invalid'`, `422 IAP_RECEIPT_INVALID`; `storeTransactionId` already `credited` ⇒ `409 IAP_RECEIPT_ALREADY_USED` (the mobile treats it as success).
  - Credit: `CreditPackPurchase{ status:'credited', validatedAt, creditedAt }` + `CreditLedger{ action:'pack_purchase', kind:'credit', bucket:'pack', credits:+pack.credits, idempotencyKey:'pack:<purchaseId>' }` + `Invoice{ kind:'credit_pack', method: platform, lines:[store price label], no VAT line }` + WS `credits.updated` + notification `credits.pack_purchased`.
- Store notifications: `POST /webhooks/store/google-play` (Pub/Sub push, `GOOGLE_PLAY_PUBSUB_TOKEN` query check) with `voidedPurchaseNotification` ⇒ refund; `POST /webhooks/store/app-store` (App Store Server Notifications v2, JWS verified) `notificationType ∈ REFUND|REVOKE` ⇒ refund. Refund ⇒ `CreditPackPurchase{ status:'refunded', refundedAt, refundSource: platform }` + `CreditLedger{ action:'store_refund', kind:'debit', bucket:'pack', credits:−pack.credits, idempotencyKey:'pack:<purchaseId>:refund' }` + `Invoice.status='refunded'`; balance negative ⇒ AI blocked + notification `credits.negative`.
- Store rule: no subscription purchase and no subscription discount via IAP (`PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN`); promo codes of kind `credits` only on mobile.

---

## 6. E-mail, SMS, push

- E-mail: Resend (`RESEND_API_KEY`, domain `djaber.ai`), `react-email` templates (03-events §5.3), `List-Unsubscribe` header for notification mails, bounce webhook `POST /webhooks/resend` (signature `svix`) ⇒ `User.emailBounced=true` (suppresses non-critical mails). `MAIL_DRIVER ∈ file | resend | smtp`: `file` (dev / test default, `.eml` + JSON line in `.local/mail`), `resend`, `smtp` (nodemailer; `SMTP_HOST`, `SMTP_PORT` default 587, port 465 ⇒ implicit TLS, `SMTP_USER` / `SMTP_PASS` optional; live: the server's own mailbox, 07 §12). Sender `MAIL_FROM` for every driver.
- SMS (ADM-13 "SMS (OTP, relances)"): provider adapter `SmsProvider.send(to, text)` behind `SMS_DRIVER ∈ fake|none` (`fake` writes each message to `SMS_LOCAL_DIR`, `none` drops it; no live SMS provider is wired yet — a real one is a new driver behind the same interface); used only for dunning reminders (`invoice.unpaid`, J0 and J+3) when `PlatformProvider(key='sms').status='ok'`; default `fake`. No customer-facing SMS (OS3 keeps Meta as the customer channel).
- Push: FCM HTTP v1 (`FCM_SERVICE_ACCOUNT` JSON) for Android **and** iOS (APNs via FCM); payload 03-events §5.2.

---

## 7. AI providers

Platform keys in `AiProvider.apiKey` (encrypted), tested via `POST /admin/ai-providers/:key/test` (minimal `generateText` 5 tokens; 401 ⇒ `AI_PROVIDER_KEY_REJECTED`, network ⇒ `AI_PROVIDER_UNREACHABLE`, none ⇒ `AI_PROVIDER_NO_KEY`). Model factories: `openai(modelId)`, `anthropic(modelId)`, `google(modelId)`, `groq(modelId)` from the Vercel AI SDK with `apiKey` injected per call. Prices from `AiModel`. Whisper: Groq `POST https://api.groq.com/openai/v1/audio/transcriptions` (`model=whisper-large-v3-turbo`), OpenAI `POST https://api.openai.com/v1/audio/transcriptions` (`model=whisper-1`).

---

## 8. PDF generation (`core/pdf`)

Renderer: Playwright Chromium (`playwright-core` + bundled Chromium in the worker image), `page.setContent(html)`, `page.pdf({ format|width/height, printBackground:true })`; fonts Geist/Changa embedded; RTL via `dir="rtl"` for `ar`. Templates are React components rendered with `renderToStaticMarkup` in `core/pdf/templates/`:

| Template | Size | Content | Trigger |
|---|---|---|---|
| `label-djaber` | A6 (105 × 148 mm) and `thermal` 100 × 150 mm | workspace logo, order number, tracking (Code128 barcode via `bwip-js`), sender, recipient (name, phone ×2, wilaya/commune/address or stop-desk), COD amount large, items summary, "Djaber" footer | `LABEL_UNAVAILABLE` or provider `manual`; merged by `labels-merge` with `pdf-lib` |
| `order-slip` | A5 | header (logo, workspace phone), order number/date/source, client block, items table (name, variant, qty, price, total), subtotal/fee/discount/total, payment status, notes, barcode | `GET /orders/:id/print` |
| `invoice` | A4 | workspace billing info (raison sociale, NIF, address), Djaber info, invoice number/date, lines (plan/pack), VAT (19 % line when applicable), total, payment reference, Chargily (CIB / Edahabia) payment reference block | invoice creation |
| `report` | A4 landscape | title, period, KPIs row, chart (static SVG from the same `recharts` component via `react-dom/server`), table (≤ 5 000 rows; above ⇒ XLSX only) | `GET /reports/:key?format=pdf` |
| `orders-export` | A4 landscape | columns of 06 §7 | `GET /orders/export?format=pdf` |
| `audit-export` | — (CSV with SHA-256 header) | | ADM-09 |

XLSX via `exceljs` (streams for > 5 000 rows). All generated files stored on S3 under `ws/<id>/exports/` with 24 h signed URLs (`job.finished` carries the URL).

---

## 9. File storage

S3-compatible (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL`). Public-read prefixes: `ws/<id>/products/`, `ws/<id>/replies/`, `ws/<id>/avatars/`, `ws/<id>/logos/` (Meta must fetch them). Private prefixes with signed URLs (1 h): `ws/<id>/attachments/` (inbound media), `ws/<id>/labels/`, `ws/<id>/exports/`, `ws/<id>/uploads/`. Keys `ws/<workspaceId>/<kind>/<uuidv7>.<ext>`; thumbnails `…/<uuid>_t.webp` (320 px). Lifecycle rules: `exports/` 7 d, `attachments/` 12 months (D28), everything else kept until workspace purge. Local dev: MinIO.

---

## 10. Do / Don't

**Do**
- Verify every inbound webhook signature on the raw body before any parsing (Meta, Chargily, couriers, Resend, store notifications).
- Persist `InboundEvent` and enqueue; return 200 within 200 ms.
- Map every provider error to a `CourierError`/`MetaError` class before it leaves the adapter.
- Re-fetch the courier status before applying a courier webhook.
- Keep the fee shown to customers equal to the merchant grid (D15); courier rates are informational.
- Store the row-locating key (`djaber_id`) in the sheet and search by it, never by cached row index alone.

**Don't**
- Don't store plaintext tokens/credentials; use `EncryptedField`.
- Don't let Meta tags be used by AI sends; don't send IG messages outside 24 h.
- Don't trust the client-provided amount on return pages; always call `verify`.
- Don't activate a subscription twice for one checkout; use the `status='pending'` conditional update.
- Don't grant IAP credits before the store API confirms the purchase.
- Don't call any provider from a controller except the four listed in `03-events-and-jobs.md` §7.
