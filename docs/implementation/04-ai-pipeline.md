# 04 — AI pipeline

Module `ai` (+ `agents`, `messaging`). Vercel AI SDK (`ai` package, `generateText` with `tools` and `experimental_output` / `generateObject` for structured output) over provider packages `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`. All thresholds below are constants in `apps/api/src/modules/ai/ai.constants.ts`.

---

## 1. Ingestion → eligibility (messaging module, FL-01 steps 1–9)

`InboundProcessor.process(inboundEventId)`:

1. Parse the Meta entry (05-integrations §1.3). Ignore: `is_echo`, `read`, `delivery`, `reaction`, events without `message` or `postback`.
2. `Channel` by `(platform, externalId=recipient.id)`; status not `active` ⇒ stop (log `channel_inactive`).
3. `Conversation` find-or-create `(channelId, externalSenderId=sender.id)`; `Client` via `ClientIdentity(channelId, externalSenderId)` else create placeholder `Client{ name: 'FB User ·'+last6 | 'IG User ·'+last6, isPlaceholder: true, source: 'ai' }` and fetch profile once (`GET /<psid>?fields=first_name,last_name,profile_pic` with page token; failure ⇒ keep placeholder).
4. Insert `Message{ direction:'in', author:'customer', externalId: mid, text, attachments:[{type,url,mime?}], payload:{ postback?, quickReply?, stickerId? } }`; `U(conversationId, externalId)` violation ⇒ stop silently (MSG-03). Enqueue `media.fetch-attachment` per attachment. `unreadCount++`, `lastCustomerMessageAt=now`, `lastMessageAt`, `lastMessagePreview`; status `resolved|archived` ⇒ `active`. Outbox `ws:message.created`.
5. Blocked customer (`CustomerBlock` for this client or platform blacklist by phone) ⇒ stop (stored for evidence, no notification, no AI).
6. Eligibility (04 §5): `needs_human` or `aiPaused` ⇒ F-1 (`conversation.needs_human_message` throttled) and stop. No agent linked (`AgentChannel`) or agent not `active` ⇒ stop.
7. Attachment gates: audio and `agent.voiceTranscription=false` ⇒ system message `unsupportedMedia` (once/24 h) and stop; images and `agent.imageRecognition=false` ⇒ drop images, continue if text else `unsupportedMedia`; video/file/location/sticker only ⇒ `unsupportedMedia`.
8. Credit gate: `plannedCost = max(1, hasAudio?3:0, hasImage?5:0)`; `CreditService.balance(ws) < plannedCost` or monthly conversation quota exceeded (first inbound of a conversation in the period counts) ⇒ F-4: system message `unavailable` (once/24 h), `needs_human`, `credits.exhausted` (1/day) and stop.
9. Blocked words on inbound: mark `Message.flags=['blocked_word']` (does not stop the AI; used by reports).
10. Typing indicator `sender_action=typing_on` (fire-and-forget, 5 s timeout).
11. `BatchingService.schedule(conversationId)`: window = `agent.responseDelaySec` (default 3; UI 0–10); abuse guard: inbound count in 60 s ≥ 20 ⇒ window 10 s; in 10 min ≥ 50 ⇒ handoff (`handoff` system message once, `needs_human`, insight `handoff` detail `abuse_guard`) and stop. Existing delayed `ai-reply` job for the conversation ⇒ `changeDelay` so all messages are answered together.

---

## 2. Conversation state

`Conversation.context` JSON (versioned, `schemaVersion: 1`):
```ts
type ConversationContext = {
  schemaVersion: 1;
  lastLanguage?: 'ar' | 'arabizi' | 'fr' | 'en' | 'mixed';     // detected from the last customer message (§3.6)
  cart?: { items: { productId: string; variantId?: string; quantity: number }[]; recapShownAt?: string; orderId?: string; updatedAt: string };
  collected?: { name?: string; phone?: string; wilayaId?: number; communeId?: number; communeText?: string; address?: string; isStopdesk?: boolean; stopdeskId?: string };
  lastProductIds?: string[];                                     // ≤ 10, most recent first (used for retrieval context)
  handoff?: { at: string; reason: string; messageSent: boolean };  // one handoff message per episode
  // workspace system messages (R-G keys of `Workspace.systemMessages`) + the 3 fixed platform texts of 11 §9, tracked the same way (once per conversation per 24 h)
  systemMessageSentAt?: Partial<Record<'handoff'|'out_of_hours'|'out_of_stock'|'welcome'|'unavailable'|'unsupportedMedia'|'voiceFailed', string>>;
  unclearStreak?: number;                                        // 3 ⇒ handoff rule "3 messages incompréhensibles"
};
```
Cart is cleared on `create_order` or 7 days after `recapShownAt` (abandon KPI reads carts with `recapShownAt` in period and no `orderId`). Context updates are written with the conversation `version` increment inside the run's transaction.

---

## 3. Prompt assembly (`PromptBuilder.build(ctx) → { system, messages, tools }`)

Sections in this exact order; each section is a function in `prompt/sections/*.ts` and is unit-tested with a snapshot. Language of the prompt itself: English (model-facing); customer-facing strings come verbatim from `Workspace.systemMessages` (keys `handoff`, `out_of_hours`, `out_of_stock`, `welcome` × `fr|ar|en`, R-G) and from the `Agent` columns. `lang` below = the locale picked by §3.6 from `context.lastLanguage`.

1. **Identity & personality** — `You are "{agent.name}", the sales assistant of "{workspace.name}". Personality: {personality}` with the four V1 personality blocks (professional / friendly / casual / technical) stored in `prompt/personalities.ts`.
2. **Shop policies** (agent knowledge step 2): `DELIVERY:`, `PAYMENT:`, `RETURNS:`, `HOURS:` from `Agent.policies { delivery, payment, returns, hours }` (each ≤ 500 chars; empty ⇒ section omitted). Out-of-hours: if `agent.businessHours` is set and `now` (Africa/Algiers) is outside it ⇒ append `OUT_OF_HOURS: true — keep answering and taking orders`, and the processor sends the workspace system message `out_of_hours[lang]` as a standalone message before the AI reply, once per conversation per 24 h (`context.systemMessageSentAt.out_of_hours`).
3. **Custom instructions** — `Agent.customInstructions` (≤ 10 000) under `OWNER INSTRUCTIONS` (they override the personality and every style habit; the OUTPUT section ends with a check against them — tester report 2026-10-20).
4. **FAQ** — `AgentFaq` entries (≤ 50, total ≤ 20 000 chars) as `Q: … / A: …`.
5. **Catalogue** (D34): if `scope.count ≤ 60` ⇒ full list, one product per block:
   ```
   #{n} {name} [ID:{id}] SKU:{sku} PRICE:{price} DA{oldPrice? ' (was {oldPrice} DA)'} STOCK:{stock|'service'}
   {description ≤ 300 chars}
   VARIANTS: {name} [VID:{id}] {price} DA stock {stock}; …
   ALSO: {recommendedName} [ID:{id}] {price} DA — {reason}
   ```
   else ⇒ `CATALOGUE: {count} products. Use search_products before naming any product.` + the last-mentioned products (`context.lastProductIds`, full blocks) + products matched by trigram on the current batch text (top 30 via `ProductSearch.search(workspaceId, agentScope, text, 30)`).
   Scope = `AgentProduct` rows when `sellAllProducts=false`, else `Agent.catalogScope='categories'` ⇒ products in `scopeCategoryIds`, else all; always filtered `isActive && deletedAt IS NULL && moderationStatus IN ('approved','not_required')` (AI-14, D36). Out-of-stock handling: the workspace system message `out_of_stock[lang]` is injected verbatim as `OUT_OF_STOCK_SENTENCE: "{systemMessages.out_of_stock[lang]}"` (the `{product}` placeholder is kept; the model fills it with the product name) and `Agent.outOfStockBehavior` adds `suggest_alternative` ⇒ `OUT_OF_STOCK: say OUT_OF_STOCK_SENTENCE, then suggest an alternative from the same category`; `say_unavailable` ⇒ `OUT_OF_STOCK: say OUT_OF_STOCK_SENTENCE only`; `Agent.showMissingVariants` ⇒ `MISSING_VARIANT: say which sizes remain`.
6. **Delivery** — `DELIVERY FEES: use quote_delivery. Free delivery from {freeDeliveryThreshold} DA.` + sender wilaya.
7. **Order-taking rules** (agent behaviour step 3, fields from `Agent.orderFields` JSON): required fields in order `product+variant → quantity → name → phone (10 digits, 05/06/07) → wilaya → commune → address or stop-desk`; optional `secondPhone`, `note`; `MAX_QTY_PER_ORDER={agent.maxQtyPerOrder ?? 10}`, `MAX_AMOUNT={agent.maxAmountPerOrder ?? 50000} DA` ⇒ above ⇒ handoff; `RISKY_CLIENT_POLICY={agent.riskyClientBehavior ?? 'take_and_flag'}`; `RECAP={agent.recapMode ?? 'always'}`; "ask one field at a time; never invent; re-ask invalid values with an example (0555123456)"; duplicate rule; cancel rule (`cancel_order` only, never create).
8. **Image rule** (when `imageRecognition`): `IMAGE RESULT: {vision pass-2 result}` injected as a system note per image: `{productId, confidence}` or `unsure` or `multiple` or `blurry` + the behaviour: `< 0.7 ⇒ ask the customer for confirmation; never state a price for an unconfirmed match`.
9. **Cross-sell** — `Suggest at most 1 complementary product per conversation, only from ALSO lines, only after the customer chose a product.` (M11: dedicated section "CROSS-SELL (RECOMMENDATIONS)" with the source → recommended pairs of the catalogue, ≤ 30 lines, and the REC-01 hard cap of 3 suggestions per reply in `recommendations`.)
10. **Product card template** — `When presenting a product use this template: {productCardTemplate}` (placeholders `{name} {price} {description} {stock}`) else default `{name} — {price} DA`.
11. **Closing instructions** — `Agent.closingInstructions`.
12. **Handoff rules** — built-ins (customer asks for a human / refund / complaint; angry tone; 3 unclear in a row; off-catalogue question; order above limits; blocked/risky client policy; custom keywords `agent.handoffKeywords[]`) + `Agent.humanHandoffRules` free text. Instruction: `status=HANDOFF with statusDetail=<rule id>`.
13. **Language rule (strict)** — AI-01 text: same language and script as the last customer message (Arabic-script darija, Latin arabizi with 3/7/9, French, English, mixed); never switch; product names/SKUs/prices verbatim with Latin digits and "DA" (Arabic script replies use "دج").
14. **Output contract** — the JSON schema of §4.1 is passed as `experimental_output: Output.object({ schema })`; the system text ends with `Return only the structured output.`

Messages: last 30 `Message` rows of the conversation (customer ⇒ `user`, ai/human ⇒ `assistant` with prefix `[human: {name}]` for human replies, system events skipped), audio replaced by `[voice note transcript]: …`, images replaced by `[image]` + the vision note; the current batch's messages are concatenated into the final `user` message separated by newlines.

Token budget: `AiModel.contextTokens − maxTokens − 512`; if exceeded, drop oldest history messages first, then truncate FAQ, then catalogue descriptions to 100 chars.

### 3.6 Language detection
`detectLanguage(text)`: Arabic script ratio > 0.4 ⇒ `ar`; Latin text with ≥ 2 arabizi markers (`3`, `7`, `9`, `kh`, `ch`, `wach`, `rani`, `bghit`, `kayen`) ⇒ `arabizi`; French stop-words ⇒ `fr`; else `en`; mixed scripts ⇒ `mixed`. Stored in `context.lastLanguage`; used to pick system messages (`ar` for `ar`, `fr` for `arabizi|fr|mixed`, `en` for `en`).

---

## 4. Structured output & tools

### 4.1 Output schema (`AiReplyOutput`, zod → JSON Schema)
```json
{ "type": "object", "additionalProperties": false, "required": ["reply", "status", "intent", "productCards", "recommendations", "confidence"],
  "properties": {
    "reply": { "type": "string", "maxLength": 2000 },
    "status": { "enum": ["OK", "UNCLEAR", "UNKNOWN", "HANDOFF"] },
    "statusDetail": { "type": "string", "maxLength": 200 },
    "intent": { "enum": ["SALE", "INFO", "TRACKING", "COMPLAINT", "GREETING", "OTHER"] },
    "productCards": { "type": "array", "maxItems": 5, "items": { "type": "string", "description": "productId" } },
    "recommendations": { "type": "array", "maxItems": 3, "items": { "type": "object", "required": ["sourceId", "recommendedId"], "properties": { "sourceId": { "type": "string" }, "recommendedId": { "type": "string" } } } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "language": { "enum": ["ar", "arabizi", "fr", "en", "mixed"] }
  } }
```
Malformed ⇒ one retry with an appended `user` message `Format reminder: respond with the JSON object only.`; still malformed ⇒ F-6.

### 4.2 Tool schemas (`ToolRegistry`; names are final; `maxSteps = 4` = 3 tool rounds + final answer)

Tool result codes (`PRODUCT_NOT_AVAILABLE`, `ORDER_NOT_CANCELLABLE`, `NO_OPEN_ORDER`, `WILAYA_NOT_SERVED`, `VARIANT_REQUIRED`, `ORDER_INSUFFICIENT_STOCK`, `CUSTOMER_BLOCKED`, hint `order_limit`) are internal to the AI run, never returned by the API, not in 11.

Validation inside every tool uses `packages/shared` validators; a validation failure returns `{ ok:false, error:{ code, field, example } }` to the model (never throws), so the model re-asks.

```json
{ "name": "search_products", "description": "Find products in the shop catalogue by free text (name, keywords, category, colour, size).",
  "parameters": { "type": "object", "required": ["query"], "additionalProperties": false,
    "properties": { "query": { "type": "string", "minLength": 1, "maxLength": 200 }, "limit": { "type": "integer", "minimum": 1, "maximum": 30, "default": 10 } } },
  "returns": { "products": [ { "id": "", "name": "", "sku": "", "price": 0, "oldPrice": null, "stock": 0, "hasVariants": false, "variants": [ { "id": "", "name": "", "price": 0, "stock": 0 } ], "imageUrl": null, "category": "" } ] } }
```
```json
{ "name": "get_product", "parameters": { "type": "object", "required": ["productId"], "properties": { "productId": { "type": "string" } } },
  "returns": "same product block + description + recommendations; { ok:false, error:{ code:'PRODUCT_NOT_AVAILABLE' } } when archived/inactive/not approved (FL-01 F-9)" }
```
```json
{ "name": "quote_delivery", "aliases": ["get_shipping_fee"],
  "description": "Delivery fee for a wilaya from the merchant's grid (home or stop-desk). Apply free-delivery threshold.",
  "parameters": { "type": "object", "additionalProperties": false,
    "properties": { "wilayaId": { "type": "integer", "minimum": 1, "maximum": 69 }, "wilayaName": { "type": "string" }, "isStopdesk": { "type": "boolean", "default": false }, "subtotal": { "type": "integer", "minimum": 0 } } },
  "returns": { "ok": true, "wilayaId": 19, "wilayaName": "Sétif", "isStopdesk": false, "fee": 400, "free": false, "freeFrom": 5000, "stopdeskAvailable": true, "stopdeskFee": 350, "etaDays": "2–5" } }
```
One of `wilayaId` / `wilayaName` is required, but **not** through a top-level `anyOf` (Anthropic refuses `anyOf` / `oneOf` / `allOf` at the top level of a tool schema; §6 "Provider compatibility"): the handler answers `{ ok:false, error:{ code:'INVALID_ARGS' } }` when both are missing. `wilayaName` resolved by normalised match on `Wilaya.nameFr|nameAr` (+ darija / arabizi / Arabic spellings table `modules/ai/tools/wilaya-aliases.ts`, including the wilayas 59–69); inside a sentence the **longest** official name or spelling it contains wins ("Ksar El Boukhari"); `DeliveryFeeRule.isActive=false` ⇒ `{ ok:false, error:{ code:'WILAYA_NOT_SERVED', stopdeskAvailable } }` (FL-02 F-2).

```json
{ "name": "create_order", "description": "Create a cash-on-delivery order ONLY after the customer explicitly confirmed the recap.",
  "parameters": { "type": "object", "additionalProperties": false,
    "required": ["clientName", "clientPhone", "wilayaId", "items", "customerConfirmed"],
    "properties": {
      "clientName": { "type": "string", "minLength": 3, "maxLength": 80 },
      "clientPhone": { "type": "string", "pattern": "^(\\+213|00213|0)?[5-7][0-9]{8}$" },
      "secondPhone": { "type": "string" },
      "wilayaId": { "type": "integer", "minimum": 1, "maximum": 69 },
      "communeName": { "type": "string", "maxLength": 100 },
      "address": { "type": "string", "maxLength": 500 },
      "isStopdesk": { "type": "boolean", "default": false },
      "stopdeskId": { "type": "string" },
      "items": { "type": "array", "minItems": 1, "maxItems": 20, "items": { "type": "object", "required": ["productId", "quantity"], "properties": { "productId": { "type": "string" }, "variantId": { "type": "string" }, "quantity": { "type": "integer", "minimum": 1 } } } },
      "notes": { "type": "string", "maxLength": 500 },
      "customerConfirmed": { "const": true } } },
  "returns": { "ok": true, "orderId": "", "number": "CMD-1042", "subtotal": 0, "deliveryFee": 0, "total": 0, "items": [ { "name": "", "variant": null, "quantity": 1, "unitPrice": 0 } ], "duplicateOf": null, "paymentOptions": ["cod"] } }
```
Server-side rules (04 §5, FL-02): phone normalised; `address ≥ 10 chars` when `!isStopdesk` (`validation.address`); `commune` must belong to wilaya when seeded else free text; `Σ quantity ≤ (agent.maxQtyPerOrder ?? 10)` and `total ≤ (agent.maxAmountPerOrder ?? 50000)` else `{ ok:false, hint:'order_limit', maxQty, maxAmount }` ⇒ model must set `status=HANDOFF` with `statusDetail='order_limits'` (no order created, no error code); variant required when `hasVariants` (`VARIANT_REQUIRED` + `availableVariants[]`); conditional stock decrement failure ⇒ `{ ok:false, error:{ code:'ORDER_INSUFFICIENT_STOCK', productId, available } }` and the whole order rolled back (F-1); duplicate guard: same normalised phone + same item set within 10 min ⇒ returns the existing order with `duplicateOf` (F-4); client merge by phone (CLI-02) inside the transaction; `Client.riskLevel='high'` ⇒ order created with `riskLevel='high'` + `order.ai_created` notification carries `risk:true` (F-3) unless `agent.riskyClientBehavior='handoff'` (then `{ ok:false, hint:'risky_client' }` ⇒ HANDOFF); blocked client ⇒ `{ ok:false, error:{ code:'CUSTOMER_BLOCKED' } }` ⇒ HANDOFF. Order: `status='new'`, `source='ai'`, `conversationId`, `channelId`, `paymentMethod='cash'`, `agentId`. After commit: cart cleared, `order.ai_created`, WS, outbox Sheets/webhook, recommendation conversion attribution (impression in same conversation ≤ 7 d). 0 credits.

```json
{ "name": "cancel_order", "description": "Cancel one of THIS customer's open orders. Never creates an order.",
  "parameters": { "type": "object", "additionalProperties": false, "properties": { "orderNumber": { "type": "string" }, "reason": { "type": "string", "maxLength": 200 }, "customerConfirmed": { "type": "boolean" } } },
  "returns": "{ ok:true, cancelled:{ number } } | { ok:true, candidates:[{ number, total, status, orderedAt }] } (ask which) | { ok:false, error:{ code:'ORDER_NOT_CANCELLABLE' | 'NO_OPEN_ORDER' } } ⇒ HANDOFF" }
```
Scope: orders of `conversation.clientId` with `status ∈ new|confirmed|preparing` and `deliveryStatus='not_sent'`; `customerConfirmed=false` ⇒ returns candidates only. Cancellation runs `OrderEffects.cancel` (stock restored, cash rows removed) with `actorType='ai'`, reason `customer_request`.

```json
{ "name": "lookup_order", "aliases": ["get_order_status"], "parameters": { "type": "object", "properties": { "orderNumber": { "type": "string" } } },
  "returns": { "orders": [ { "number": "", "status": "shipped", "deliveryStatus": "in_transit", "courier": "ZR Express", "trackingNumber": "", "lastEvent": { "at": "", "label": "" }, "total": 0, "orderedAt": "" } ] } }
```
This client's orders not in `delivered|cancelled|returned` older than 30 d; empty ⇒ model says so (AI-13).

```json
{ "name": "handoff_to_human", "description": "Escalate to the merchant team. Use when a rule requires it or the customer asks.",
  "parameters": { "type": "object", "required": ["reason"], "properties": { "reason": { "enum": ["customer_request", "refund", "complaint", "angry", "unclear_streak", "off_catalogue", "order_limits", "risky_client", "keyword", "other"] }, "detail": { "type": "string", "maxLength": 200 } } },
  "returns": { "ok": true } }
```
Calling it is equivalent to `status=HANDOFF`; the processor treats either as FL-03.

```json
{ "name": "add_faq_candidate", "description": "Record a customer question the shop has no answer for, so the merchant can add it.",
  "parameters": { "type": "object", "required": ["question"], "properties": { "question": { "type": "string", "maxLength": 300 }, "topic": { "type": "string", "maxLength": 80 } } },
  "returns": { "ok": true } }
```
Creates/increments `AgentFaqCandidate(agentId, normalizedQuestion, count, lastConversationId)`; surfaced as "SUGGÉRÉ PAR L'IA (n clients l'ont demandé)" in the wizard and as insight `unknown_topic` when `count ≥ 3`.

```json
{ "name": "create_payment_link", "enabledWhen": "workspace.onlinePaymentEnabled && flag online_payment", "parameters": { "type": "object", "required": ["orderId"], "properties": { "orderId": { "type": "string" } } }, "returns": { "ok": true, "url": "", "expiresAt": "" } }
```

Tool availability per run: `search_products`, `get_product`, `quote_delivery`, `lookup_order`, `add_faq_candidate`, `handoff_to_human` always; `create_order`, `cancel_order` always (order-taking always on, D23); `create_payment_link` conditional. Playground (§8) swaps `create_order`/`cancel_order`/`create_payment_link` for dry-run implementations.

---

## 5. Idempotent run (`AiRunService`, 04 §5)

```
start(batchKey):  AiRun upsert on (conversationId, batchKey) [columns `AiRun.batchKey`, unique with `conversationId`; `AiRun.flags[]`, `AiRun.meta` = §13 metrics] → if exists && status='running' reuse (replay) else create { status:'running', attempt }
loop:             for each model tool call with callId:
                    AiToolCall find (aiRunId, callId) → if result exists → return stored result (no execution)
                    else insert { callId, name, args, executedAt:null } → execute → update { result, executedAt }
welcome:          first AI reply of a conversation created in this run's batch (no earlier Message with author ∈ ai|human) ⇒ Message(author:'system', payload.system.kind='welcome') with Workspace.systemMessages.welcome[lang] ({shop} = workspace.name) enqueued BEFORE the reply; empty string ⇒ skipped; context.systemMessageSentAt.welcome set
send:             Message(author:'ai', aiRunId) created BEFORE enqueueing meta-send; outbox key send:<messageId>; cards as separate messages payload.cards
finish:           AiRun { status: ok|unclear|unknown|handoff, inputTokens, outputTokens, latencyMs, confidence, modelId, finishedAt }
```
`callId` = `sha256(name + canonicalJson(args))` + its ordinal among identical calls of the run (provider tool-call ids change when the model is re-prompted on a retry, so they are never the persisted key). A replayed `create_order` therefore returns the already-created order (AT-AI-05). Runs older than 5 min in `running` are reaped (`sched-ai-run-reaper`) with credits released; a reaped run is not resumed (the next customer message starts a new batch).

---

## 6. Provider routing & fallback

`AiRoute(capability ∈ text|vision|transcription|embeddings, primaryModelId, fallbackModelId, creditCost, timeoutSec=20, errorThresholdPct=2, failoverActive, failoverSince)` edited on ADM-06; window for the error rate is fixed at 10 min; `timeoutSec` applies per model call (the 45 s figure below is the whole-run budget).

- Agent model = `Agent.modelId`, assigned by the platform routing (R-H): at every agent save `Agent.modelId = AiRoute(capability='text').primaryModelId` (or `fallbackModelId` while `failoverActive=true`); at run time, if `Agent.modelId` is not `AiModel.isActive && supportsTools` or the circuit breaker is open, the run uses the route's other model and writes it back to `Agent.modelId`. The merchant never chooses a model; the UI shows a read-only model badge; `temperature` / `maxTokens` come from the agent's preset (`AgentPreset`) and are not editable by the merchant.
- Vision capability = model with `supportsVision`; voice = Groq `whisper-large-v3-turbo` primary, OpenAI `whisper-1` fallback (fixed, not in `AiRoute` UI except timeout); embeddings = P3 (`embeddings_retrieval` flag; `text-embedding-3-small`; off by default).
- Failure classes: `provider_error` (5xx, network, 429 after SDK retry 2×, timeout 45 s) ⇒ one retry on the fallback model within the same attempt; `provider_rejected` (401/403) ⇒ `AI_PROVIDER_KEY_REJECTED` platform alert, fallback immediately; `content/format` ⇒ format retry (§4.1) then F-6.
- Circuit breaker per model: Redis window counters; error rate over `errorRateThresholdPct` in `windowMin` ⇒ route to fallback for 5 min (ADM-01 alert "bascule Anthropic active"); half-open after.
- Cost: `AiRun.costUsd = inputTokens × inputPricePerM/1e6 + outputTokens × outputPricePerM/1e6` computed at finish (ANA-02 consumption, ADM-01).
- **Provider compatibility** (live, 2026-10-14, `LiveAiGateway`): (a) the SDK always sends a `temperature`; a model that answers 400 "`temperature` is deprecated for this model" (Claude 5.x) is asked again without it, and its `provider:modelId` is remembered in the process so later calls omit it at once (one request per reply, not two; the memory is per process and resets on restart); (b) tool input schemas never use `anyOf` / `oneOf` / `allOf` at the top level (Anthropic answers 400 "input_schema does not support oneOf, allOf, or anyOf at the top level"); required-one-of rules are checked by the handler (`INVALID_ARGS`), and a unit test (`tool-registry.spec.ts`) keeps every tool schema provider-safe; (c) a failed call logs the provider's error type and the parameters it cites, never its free text (PII). Live routes: text + vision on `claude-haiku-5-5`, fallback `claude-haiku-4-5` (07 §12).

---

## 7. Credits (02 §6, D17)

| Run kind | Cost | Reserve at | Settle |
|---|---|---|---|
| `reply` text only | 1 | job start | debit when the reply message is enqueued to `meta-send` (status `ok|unclear|unknown|handoff` with a reply) |
| `reply` with ≥ 1 image | 5 (replaces 1) | job start | debit when vision pass 2 succeeded (even if the final send fails) |
| `reply` with audio | 3 (if no image) | job start | debit when transcription succeeded |
| `create_order` tool | 0 | — | — |
| `test` (playground) | 0 | — | rate limit 60/h/workspace |
| `page_analysis`, `agent_generation`, `faq_extract` | 0 credits; rate-limited 3 per day per workspace (`ANALYSIS_RATE_LIMITED`) | — | — |
| `caption` | 0 | — | — |
| `vision` for "create from photo" (`POST /products/ai-fill`) | 5 (06 §8.6; `AiRun.kind = vision`) | request start | debit when the model answered; released on any failure; also 3/day via `analysis` throttler |

Ledger rows (`CreditLedger`, append-only, `balanceAfter` stored on every row): reserve ⇒ `action='reserve', kind='reserved', credits=-cost, idempotencyKey='run:<id>:reserve'`; settle ⇒ `action ∈ text_reply|image_recognition|voice_transcription, kind='debit', credits=-cost, idempotencyKey='run:<id>:debit'` plus a compensating `action='release', kind='release', credits=+cost, idempotencyKey='run:<id>:unreserve'` so that Σ rows = the debit; release ⇒ `action='release', kind='release', credits=+cost, idempotencyKey='run:<id>:release'`. `bucket='plan'` while plan balance ≥ cost, else `bucket='pack'` (consumed after plan credits, D40). Balance(plan) = Σ `bucket='plan'` rows in the current period (the `renewal` credit row + grants − debits − open reservations); balance(pack) = Σ `bucket='pack'` rows (never expires). 80 % ⇒ `credits.80` once per period; 0 ⇒ F-4; negative (store refund) ⇒ `credits.negative`, AI blocked until ≥ 0.

---

## 8. Playground (AGT-07)

`POST /agents/:id/test { sessionId, messages:[{ role:'user'|'assistant', text, imageUploadId?, audioUploadId? }], scenario? }` → `{ reply, status, statusDetail, intent, confidence, language, model:{ id, temperature, maxTokens }, tokens:{ input, output }, latencyMs, toolCalls:[{ name, args, result, simulated }], cards:[{ productId, name, price, imageUrl, variantLabel }], creditsWouldCost, promptSections:[{ key, chars }] }`.
- `AiRun.kind='test'`, `conversationId=null`, no credits, throttler `playground` 60/h/workspace (`PLAYGROUND_RATE_LIMITED`).
- Dry-run tools: `create_order` validates everything and returns `{ ok:true, number:'TEST-'+seq, simulated:true, … }` without writing; `cancel_order` returns candidates from real orders but never cancels; `quote_delivery`, `search_products`, `lookup_order` are real reads.
- Scenarios (buttons, `TestScenarioKey`): `darija_price`, `arabizi_delivery`, `photo`, `voice`, `off_catalog`, `anger`, `qty_limit`, `refund` ⇒ seeded first user message from `prompt/scenarios.ts`; each run stored as `AgentTestRun(status ∈ pass|fail|error)` with `AiRun.kind='test_scenario'`.
- "Ajouter une instruction depuis ce tour" ⇒ `PATCH /agents/:id` append `- …` to `customInstructions`; "Signaler une mauvaise réponse (eval)" ⇒ `POST /agents/:id/test/flag { sessionId, turn, note }` stores `AiEvalCase` (fixtures for nightly evals); "Exporter la conversation (eval)" ⇒ `GET /agents/:id/test/export?sessionId=` JSON download.
- Step 5 of the wizard ("8 auto scenarios") runs the 8 `TestScenarioKey` scenarios sequentially (job `agent_test_scenarios`) and shows pass/fail per readiness check (`replied`, `language_respected`, `no_invented_product`, `handoff_on_complaint`, `order_created_simulated`, `limits_respected`).

---

## 9. Vision (AI-06) and voice (AI-07)

**Vision pass 1** (`VisionService.describe(imageUrl)`): vision model, prompt "Describe the product in this photo: category, colours, visible text/brand, shape. Reply as JSON { category, colors[], text, description, multipleProducts: boolean, quality: 'ok'|'blurry' }" → `search_products(description + text, limit 10)` within the agent scope.
**Pass 2** (`VisionService.match(imageUrl, candidates)`): vision model receives the customer photo + ≤ 10 candidate primary images (with `aiCaption`) → `{ productId | null, confidence 0–1, alternatives:[productId] }`. Result injected as the §3.8 note. `quality='blurry'` ⇒ note `blurry`; `multipleProducts` ⇒ note `multiple`. Credits 5 debited after pass 2 success. Customer images > 5 MB or unreachable ⇒ note `unavailable` (no credits).
**Captioning at upload** (`caption-image` job): "Caption this product image in one sentence for search: type, colour, material, notable text" → `ProductImage.aiCaption` (≤ 200 chars), 0 credits. Product image limits (every entry point: web, mobile, import, page analysis): 10 images per product, 5 MB each, min 600 px on the shorter side (`IMAGES_LIMIT`, `IMAGE_TOO_LARGE`, warning `IMAGE_SMALL {px}`).
**"Create from photo"** (CAT-07): vision model ⇒ `{ name, description, categoryName, unitName, attributes:[{ name, values[] }] }` → fills only empty fields, never price; the photo becomes the first product image under the same limits.

**Voice**: `transcribe` job downloads to S3 (≤ 25 MB, > 2 min ⇒ `transcriptError='too_long'` + `unsupportedMedia`), Groq `whisper-large-v3-turbo` (`language` auto, `response_format=verbose_json`) → fallback OpenAI `whisper-1` on error → `Message.transcript` + `transcriptLanguage`; `ai-reply` waits for the transcript (the `ai-reply` job is scheduled after `transcribe` completes via `QueueEvents`, max 30 s, else F-5 `voiceFailed`). 3 credits on success.

---

## 10. Handoff & insights (AI-08, FL-03)

On `status ∈ UNKNOWN|HANDOFF` or `handoff_to_human` call: in one transaction — `Conversation { status:'needs_human', aiPaused:true, context.handoff:{ at, reason } }`, `AgentInsight { type: status==='HANDOFF' ? 'handoff' : 'unknown_topic', customerMessage, aiResponse, detail: statusDetail }`, system message `handoff` (once per episode: skipped if `context.handoff.messageSent` within 24 h), notification `conversation.handoff` (all members; email per prefs), outbox webhook `conversation.escalated`, WS `conversation.updated`. The model's `reply` is still sent before the handoff message when non-empty and `status==='HANDOFF'`; for `UNKNOWN` the reply is sent and the handoff message is not (the conversation only goes to the queue).
`UNCLEAR` ⇒ `AgentInsight{ type:'unclear' }` only; `context.unclearStreak++` (reset on OK); streak 3 ⇒ next turn gets the handoff rule.
`error` insights come from F-6. Resolution actions (`POST /agent-insights/:id/resolve`): `resolve { newInstruction }` appends `\n- {text}` to `customInstructions` and creates an `AgentVersion`; `createFaq { question, answer }`; `dismiss { muteDays: 30 }` adds the normalised topic to `Agent.mutedTopics[]`.

---

## 11. Blocked words (D37)

`BlockedWordsService.check(text) → { blocked: boolean, matches[] }` against the platform list (`PlatformSetting.blockedWords`, admin ADM-11) + workspace list (`Workspace.blockedWords`, SAFE frame). Applied to every outbound AI reply **before** send: match ⇒ reply replaced by the `handoff` system message, conversation `needs_human`, insight `error` detail `blocked_word:<word>`, `AiRun.flags=['blocked_word']`, `Report(type='ai_message', reporterKind='system')` when the word is on the platform list. Inbound matches only flag the message.

---

## 12. 24 h window rules applied to AI sends (MSG-06)

`WindowRules.canSend(channel, conversation, kind)`:
- `kind='ai'`: FB and IG — only if `lastCustomerMessageAt ≥ now − 24 h`; otherwise the run is aborted before generation (credits released) and the conversation gets `needs_human` with insight detail `outside_window`. AI never uses message tags.
- `kind='human'`: FB inside 24 h ⇒ standard; FB outside ⇒ `messaging_type=MESSAGE_TAG, tag=HUMAN_AGENT` (one attempt; Meta refusal ⇒ 422 `REPLY_OUTSIDE_WINDOW`); IG outside ⇒ 422 `REPLY_OUTSIDE_WINDOW` without attempting.
- `kind='transactional'` (order/shipment/payment system messages): FB ⇒ `messaging_type=MESSAGE_TAG, tag=POST_PURCHASE_UPDATE` regardless of window; IG inside 24 h ⇒ standard, outside ⇒ `Message.deliveryStatus='skipped_window'` (thread label).
- `kind='system'` (workspace system messages `handoff`, `out_of_hours`, `out_of_stock`, `welcome` + fixed platform texts `unavailable`, `unsupportedMedia`, `voiceFailed`): same as `ai` (inside window only; they are always replies to a fresh customer message so this holds). `out_of_stock` is never sent on its own: it is the sentence the AI reply contains (§3.5).

---

## 13. Insights generation and analytics inputs

Per run, `AiRunService.finish` also writes `AiRunMetrics` fields used by ANA-02 (`intent`, `language`, `toolNames[]`, `cardsSent`, `handoff`); daily rollups aggregate resolution rate (conversations with ≥ 1 AI reply and no human reply, resolved), first response time (`firstAiReplyAt − firstInboundAt`), conversion (AI orders ÷ conversations), credits, cost.

---

## 14. Generate-from-page (AGT-03) and page analysis (CHN-08) jobs

**`agent-generation`** job: read ≤ 25 conversations (or `days` window, ≤ 1 000 messages) via Graph (`/<pageId>/conversations?fields=messages.limit(25){message,from,created_time}`), chunk into ≤ 20 k-token batches, model (route `text` primary) with `generateObject` schema `{ summary, languages:[{ code, pct }], topQuestions:[{ question, count }], tone, proposedInstructions, proposedFaq:[{ q, a }], proposedPolicies:{ delivery?, payment?, returns?, hours? } }`, merge batches, `Job.result`. Apply: `POST /agents/generate/:jobId/apply { agentId? }` ⇒ create agent (preset `vendeur-pro` + proposals) or update the agent linked to the channel (new `AgentVersion`, confirm dialog). Throttler `analysis` 3/day/workspace (`ANALYSIS_RATE_LIMITED`), 0 credits, needs `pages_read_user_content` else `PAGE_ANALYSIS_PERMISSION_REQUIRED`.

**`page-analysis`** job (FL-15): `GET /<pageId>/posts?fields=message,full_picture,created_time&limit=100` (IG: `/<igId>/media?fields=caption,media_url,media_type`), cursor stored in `Job.result.cursor` (resumable), per post with image: vision `generateObject { isProduct, name, description, price, category }`; dedup by normalised name; `Job.result.items[]`; progress = posts processed / total. Import: `POST /channels/:id/analysis/import { items:[{ name, description, price, category, imageUrl, quantity }] }` ⇒ products `sku='FB-'+seq`, image re-hosted via `media.reencode-image`, moderation per D36, `maxProducts` enforced.

---

## 15. Evals (07 §9)

Fixtures in `apps/api/test/ai-evals/fixtures/{darija,arabizi,fr,en,mixed,vision,voice}/*.json` (`{ messages, expect:{ status, intent, language, toolCalls?, noProductOutsideCatalogue:true, orderCreated?:boolean } }`); runner `pnpm test:evals` executes against a seeded catalogue with the primary route model, asserts the structured output and tool call sequence, and records cost/latency; runs nightly and on any change under `modules/ai/prompt/**`. Pass threshold 95 % per fixture group; language-respect 100 %.

---

## 16. Do / Don't

**Do**
- Persist `AiToolCall` before executing a tool; return the stored result on replay.
- Reserve credits at job start and settle only on the conditions of §7.
- Filter the catalogue with `isActive && deletedAt IS NULL && moderationStatus IN ('approved','not_required')` in every tool and prompt section.
- Validate every tool argument with the shared validators and return `{ ok:false, error }` to the model.
- Send the text reply first, then ≤ 5 cards, each as its own outbox send keyed by message id.

**Don't**
- Don't let the model set prices, fees or stock; all numbers come from tool results.
- Don't call `create_order` without `customerConfirmed:true`; don't create an order from `cancel_order`.
- Don't use Meta message tags for AI sends.
- Don't send the handoff message twice in 24 h for the same conversation.
- Don't charge credits on provider errors, malformed output, reaped runs or playground turns.
- Don't include non-approved, archived or out-of-scope products in prompts, cards or search results.
