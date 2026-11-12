# 10 — User flows with failure branches

Every flow: numbered steps. `U` = user action, `S` = system action, `→` = outcome. Each **F-n** is a failure branch with its exact handling. Error codes refer to [11-error-catalogue.md](11-error-catalogue.md); screens to [12-screen-states.md](12-screen-states.md). Source baseline is V1 behaviour unless marked **fix** (a V1 defect closed) or **new** (CDC/invoice requirement).

---

## FL-01 Customer message → AI reply (core loop) `[CDC UC01][V1 webhook.controller.ts]`

Preconditions: channel active, agent linked and active, workspace has credits.

| # | Step |
|---|---|
| 1 | S: Meta POSTs the event. Verify `X-Hub-Signature-256` (**fix**). Store raw event, enqueue, respond 200 in < 200 ms. |
| 2 | S (worker): ignore echoes/read receipts. Dedup on `(conversationId, externalId)` (MSG-03) — duplicate ⇒ stop silently. |
| 3 | S: find channel by `(platform, externalId)`; inactive/needs_reconnect ⇒ stop, log. |
| 4 | S: find-or-create Conversation `(channelId, senderId)`; find-or-create Client via `ClientIdentity`; first time ⇒ fetch sender name/avatar from Graph (failure ⇒ placeholder "FB/IG User ·last6"). |
| 5 | S: store inbound Message (text, attachments). Emit WS `message.created`, bump `unreadCount`. |
| 6 | S: eligibility: conversation `needs_human` or `aiPaused` ⇒ **F-1**. Status `resolved/archived` ⇒ set `active`, continue. No agent / agent paused ⇒ stop (human inbox only). |
| 7 | S: attachment gates — audio & `voiceTranscription` off ⇒ **F-2**; images & `imageRecognition` off ⇒ drop images and continue with text, or **F-3** if the message had no text; video/file/location/sticker only ⇒ **F-3**. |
| 8 | S: credit gate (planned cost = highest of text 1 / voice 3 / image 5) **and** monthly conversation-quota gate (02 §5). Insufficient ⇒ **F-4**. |
| 9 | S: send `typing_on`; schedule/merge delayed `ai-reply` job keyed by conversationId (`responseDelaySec`, default 3; abuse guard D33). New messages within the window re-use the same job. |
| 10 | S (job): create `AiRun(running)` and **reserve** the planned credits (ledger row `reserved`); reload conversation; abort (release) if now `needs_human`/paused. Build context: last 30 messages, agent config, catalogue slice (all or `AgentProduct`), recommendations, fee grid. Transcribe audio (**F-5** on failure). |
| 11 | S: call model with tools (`search_products`, `get_product`, `get_shipping_fee`, `create_order`, `cancel_order`, `get_order_status`), max 3 tool rounds. Provider error ⇒ **F-6**. |
| 12 | S: parse structured output `{reply, status, intent, productCards[], recommendations[], confidence}`. Malformed ⇒ one retry with "format reminder"; still malformed ⇒ **F-6**. |
| 13 | S: on a newly created conversation, first send the workspace system message `welcome` as a standalone message (empty string ⇒ not sent); when `Agent.businessHours` is set and now (Africa/Algiers) is outside it, send the workspace system message `out_of_hours` once per conversation per 24 h (the AI still answers and takes orders). Then send the reply text; then product cards (≤ 5; image + text on both platforms in P1; generic template on FB in P2). Send failure ⇒ **F-7**. |
| 14 | S: store outbound Message(author=ai), `AiRun(ok)`, settle the reservation to a debit (02 §6). Record recommendation impressions. |
| 15 | S: `status=UNCLEAR` ⇒ insight only, AI continues. `UNKNOWN`/`HANDOFF` ⇒ FL-03. `OK` ⇒ done. |

**Failure branches**

| F | Condition | Handling |
|---|---|---|
| F-1 | Conversation paused for a human | No AI reply. Push + in-app "Customer replied while you handle this" to assignee (or all members). Unread badge. |
| F-2 | Voice note, transcription disabled on agent | Reply once per conversation per 24 h with the fixed platform text `customer.unsupportedMedia` (11 §9; FR/AR/EN by last customer language; default FR; not workspace-editable). Store it. No credits. |
| F-3 | Unsupported attachment only | Same as F-2 (`customer.unsupportedMedia`). |
| F-4 | Credits exhausted | Send the fixed platform text `customer.unavailable` (11 §9, localized by last customer language; V1 hardcoded FR — **fix**) once per conversation per 24 h. Set conversation `needs_human`. Notify Owner (`credits.exhausted`: in-app + email + push, once per day). No further AI on this workspace until credits > 0. |
| F-5 | Transcription provider fails | Retry once on fallback provider (Groq → OpenAI — **fix**, V1 had none). Still failing ⇒ send the fixed platform text `customer.voiceFailed` once per conversation per 24 h. No credits. |
| F-6 | LLM/provider error or timeout (> 45 s) | Retry once with fallback model (same provider tier). Still failing ⇒ no customer message; conversation flagged `needs_human` with insight `type=error`; Owner notified if ≥ 3 failures in 10 min ("AI provider down"). No credits. |
| F-7 | Meta send fails | Error 10/2018278 (outside 24 h) ⇒ AI never uses `HUMAN_AGENT` tag (**fix**); mark message `failed`, flag `needs_human`, note "outside 24 h window — reply manually". Rate limit (4/613/32) ⇒ exponential retry up to 5× over 10 min. Token error 190 ⇒ channel `needs_reconnect`, Owner notified, stop. Any other ⇒ retry 3×, then `failed` + inbox badge. |
| F-8 | Abuse guard (D33) | 20+ inbound in 1 min ⇒ batch window 10 s; 50+ in 10 min ⇒ workspace system message `handoff` once and `needs_human`. |
| F-9 | Product referenced by the model no longer exists / inactive | Card skipped; model told in next turn via tool result; no error to customer. |

## FL-02 Customer orders through the AI `[CDC UC02][V1 ai.service.ts create_order]`

| # | Step |
|---|---|
| 1 | U(customer): "I want this in size M". |
| 2 | S(AI): if product has variants and none chosen ⇒ ask variant (tool returns `availableVariants`). Stock 0 ⇒ the AI answers with the workspace system message `out_of_stock` (`{product}` placeholder, injected verbatim in the system prompt) and, when `Agent.outOfStockBehavior=suggest_alternative`, appends alternatives; a race at confirmation ⇒ **F-1**. |
| 3 | S(AI): collect **name → phone → wilaya → commune → address (or stop-desk)** one at a time, in customer's language. Each value validated with the shared validators; invalid ⇒ ask again with example ("0555123456"). Never invent a value. |
| 4 | S(AI): `get_shipping_fee(wilayaId, isStopdesk, subtotal)` ⇒ grid quote incl. free-delivery rule; wilaya inactive in grid ⇒ **F-2**. |
| 5 | S(AI): recap — items × qty × price, delivery fee, **total** — and asks explicit confirmation ("نأكد الطلب؟ / Je confirme ?"); `context.cart.recapShownAt` set (abandon KPI). |
| 6 | U(customer): confirms ⇒ `create_order`. Anything else ⇒ keep conversation, cart stays in `Conversation.context.cart` (abandon KPI). |
| 7 | S(tool, one transaction): resolve/merge Client by normalised phone (placeholder client merged into phone owner, conversation re-linked — **fix**); `Counter` → `CMD-n`; create Order(`new`, source `ai`, COD, fee snapshot); conditional stock decrement per item/variant (`quantity >= qty`) — fails ⇒ **F-1** (whole order rolled back); StockMovement `out`; recompute client aggregates. |
| 8 | S: after commit — notification `order.ai_created` (in-app, push, email per prefs), WS `order.created`, Sheets row (P2), webhook `order.created` (P2), recommendation conversion attribution. No credits for the order itself (D17). |
| 9 | S(AI): confirms with order number and "we'll call you for confirmation" (COD). Online payment chosen (P2) ⇒ FL-10. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Insufficient stock at confirmation (race) | Tool returns error with available qty; AI offers lower qty or alternative (recommendation); no order created. |
| F-2 | Wilaya not served (`DeliveryFeeRule.isActive=false`) | AI tells customer delivery unavailable there, offers stop-desk if active, else hands off (`HANDOFF`). |
| F-3 | Phone belongs to a client with ≥ 3 cancelled orders in 30 d | Order created with flag `riskLevel=high` + notification; AI does not mention it. (**new**, CDC §6.5.4 fraud basic.) |
| F-4 | Same customer creates a second identical order within 10 min | Tool returns the existing order; AI confirms it instead of duplicating. |
| F-5 | Customer asks to cancel | `cancel_order` lists this client's open orders (`new/confirmed/preparing`, `deliveryStatus=not_sent`); one ⇒ confirm then cancel (stock restored, notification); several ⇒ ask which; none/shipped ⇒ HANDOFF. **Never** `create_order` (**fix**). |

## FL-03 Handoff to a human `[CDC UC06]`

| # | Step |
|---|---|
| 1 | S: AI returns `UNKNOWN`/`HANDOFF`, or customer explicitly asks for a human, or complaint intent. |
| 2 | S: conversation `status=needs_human`, `aiPaused=true`; AgentInsight created; the workspace system message `handoff` (`Workspace.systemMessages.handoff`, locale of the customer's last language) is sent once. |
| 3 | S: notify members (in-app + push; email per prefs). WS `conversation.updated`. Queue badge +1. |
| 4 | U(operator): opens thread (web/mobile), sees handoff banner with reason, replies (text/image). First reply auto-assigns the conversation to them. |
| 5 | U: "Resume AI" ⇒ `aiPaused=false`, `status=active`; or "Resolve" ⇒ `resolved`. |
| 6 | S: new customer message while `needs_human` ⇒ FL-01 F-1. |

| F | Condition | Handling |
|---|---|---|
| F-1 | No operator reacts within `handoffReminderMin` (default 30, 0 = off) | Notify Owner (`conversation.handoff_unattended`); conversation stays `needs_human`. (CDC UC06 A1.) |
| F-2 | Operator reply outside 24 h window | Send with `HUMAN_AGENT` tag (allowed for humans); if Meta still refuses ⇒ `REPLY_OUTSIDE_WINDOW` shown inline with "customer must write first". |
| F-3 | Two operators reply simultaneously | Both sent (no lock); assignment = first replier; thread shows both with author names. |

## FL-04 Sign-up → onboarding `[Mobile V2 (base FR) + Screens (AR/EN): T1a–T6][V1][D60]`

| # | Step |
|---|---|
| 1 | U: sign-up form. S: validate (email format, password ≥ 8 with letter+digit, names 1–80). Duplicate ⇒ **F-1**. Coming from `/pricing` (`/signup?plan=<slug>&cycle=monthly\|yearly`, paid plans only) the form shows "Plan choisi (mensuel/annuel) : vous commencez par 14 jours d’essai Pro gratuits…" (`auth.signup.planIntent`) — the choice never changes the trial (D60); it is kept in the browser and offered once, after the tunnel, by the lowest-priority info banner of the shell "Voir ce plan" → `/settings/billing?change=<slug>&cycle=` (Owner, `billing.plan`); following or dismissing the banner clears it. Links between auth pages keep `returnTo` (invitation; unsafe values dropped) and "Mot de passe oublié" carries the typed e-mail (`/forgot-password?email=`). |
| 2 | S: create User + Workspace (Owner) + `Subscription(status=trial, plan=pro, billingCycle=none, provider=none, currentPeriodEnd=+14 d, trialEndsAt=+14 d)` + `CreditLedger(action=grant, kind=credit, bucket=plan, credits=300)` (D60); `Workspace.systemMessages` seeded with the 4 default keys × 3 locales (D43); send verification email (non-blocking — unverified users can do everything except connect a channel, `AUTH_EMAIL_UNVERIFIED`; reminder e-mail at day 7, D32). |
| 3 | S: onboarding tunnel: Welcome → Stock mode → First product → Agent preset → Connect page → Ready. Progress stored server-side (`Workspace.onboardingStep`); resumable; every step has "Skip". **Progress never moves back**: leaving step n writes `onboardingStep = max(saved, n + 1)`; the stepper and "← Retour" keep every step up to the saved progress reachable; a reopened step offers what was already created instead of creating it again (see 3a–3c). Lists read by the tunnel use `pageSize=25` (the API accepts 25 / 50 / 100 only). |
| 3a | Step 3 First product: minimal form **name, price, stock, photo** (no category select, no "Importer un fichier" / "Extraire depuis ma page" links: a new shop has no category and no page yet, and the (app) pages redirect to the tunnel; the description says the rest of the catalogue is imported / extracted from Produits once the setup is finished). "✦ Remplir avec l'IA" opens the product form's "Créer depuis une photo" dialog (`POST /products/ai-fill`), which fills the empty name only (never the price). Product already created ⇒ notice with "Continuer" / "Ajouter un autre produit". |
| 3b | Step 4 Agent: 4 Preset Cards ⇒ `POST /agents { presetKey }` (draft). "Partir de zéro (assistant 5 étapes)" opens the agent wizard `/agents/new?start=scratch` ("De zéro" preselected): wizard steps 1–3 (Identité, Connaissances, Comportement) run **inside the tunnel** while the saved step is 4; cancel / "Enregistrer et quitter" / breadcrumb lead back to `/onboarding/agent`, links to other app pages (categories, system messages) are hidden, the "par catégorie" scope is disabled when the shop has no category, and the main button of wizard step 3 "Enregistrer et passer à la page" saves the draft, writes onboarding step 5 and opens `/onboarding/connect` (wizard steps 4–5 need the page and stay redirected to the tunnel). Agent already created ⇒ no card preselected, "Continuer avec « nom »"; picking a card creates another agent. |
| 3c | Step 5 Connect page ⇒ FL-05 (the return page `/channels/connect/return` runs during the tunnel). Pages already connected are listed with "Continuer" next to the connect button. The Instagram "approbation en attente" note follows `GET /channels/app-review-status` (`instagramApproved`), as on `/channels`. |
| 4 | U: Connect page ⇒ FL-05. |
| 5 | S: Ready screen (step 6) → Home with Get Started checklist reflecting real data (agent step done only when an active agent is linked to a channel — **fix**). Next actions: "Tester mon agent" opens the agent's playground `/agents/:id/playground` (an active agent first, else the latest draft, whose test is wizard step 5 "Test & activation" `?draft=`); without agent it is disabled with "Aucun agent pour l'instant : créez-le à l'étape Agent."; "Importer mon catalogue" (`/products/import`) and "Inviter mon équipe" (`/settings/members`) are disabled with `PLAN_LIMIT` (products / members) at the plan limit or `FORBIDDEN` without the permission; Accueil. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Email already used | `AUTH_EMAIL_TAKEN` inline on email field + link to login/forgot. |
| F-2 | Verification email fails to send | Account still created; banner "verify later" with resend; logged. |
| F-3 | User closes browser mid-tunnel | Next login resumes at the saved step. |
| F-4 | Invited member signs up with the invite email | Lands in the inviter's workspace as the invited role, no new workspace, tunnel skipped. |

## FL-05 Connect a Facebook page (+ linked Instagram) `[V1 pages.controller.ts]`

| # | Step |
|---|---|
| 1 | U: "Connect Facebook" (explainer first). S: `GET /channels/connect/facebook` builds the OAuth URL with an encrypted `state` (workspaceId + userId + nonce, 10 min — **fix**). Requested permissions = `META_FACEBOOK_SCOPES` when set (the permissions enabled in the Meta app — live: `pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement`, the V1 set), else the full list of `05-integrations.md` §1.5; `redirect_uri` = `PUBLIC_API_URL` + `META_OAUTH_CALLBACK_PATH` (`{platform}` replaced; default `/api/v1/channels/callback/{platform}`, live = the V1 path `/api/pages/callback/{platform}` registered in the Meta app, answered through `META_LEGACY_PATHS`, 07 §12). Web opens a pop-up and the waiting dialog ("Annuler"); pop-up blocked ⇒ "Ouvrir dans cet onglet" (same-tab flow). |
| 2 | U: Meta consent (chooses pages there). |
| 3 | S(callback): verify state; exchange code; list `/me/accounts` (paginate, cap 200); per page: no token ⇒ skipped `PAGE_ACCESS_TOKEN_MISSING`; missing MESSAGING task ⇒ skipped `PAGE_MESSAGING_PERMISSION_MISSING`; owned by another workspace ⇒ skipped `PAGE_ALREADY_CONNECTED_ELSEWHERE`; else upsert Channel (token encrypted), subscribe `messages,messaging_postbacks` (fail ⇒ `warning PAGE_WEBHOOK_SUBSCRIBE_FAILED`, retry job); linked IG business account ⇒ second Channel (platform instagram, parent = page). |
| 4 | S: the callback page relays the result: opener present ⇒ `postMessage` to the opener and the pop-up closes; **no opener** (Meta's login pages set `Cross-Origin-Opener-Policy`, which cuts `window.opener`) or same-tab flow ⇒ redirect to `<PUBLIC_WEB_URL>/channels/connect/return?connectReport=<id>` (or `?connectError=<CODE>`), which hands the result over a `BroadcastChannel` to the window that started the flow; once that window acknowledges, the pop-up closes (a browser that refuses to close it shows "Connexion terminée : le résultat est affiché dans Djaber. Vous pouvez fermer cette fenêtre."); no acknowledgement within 1.5 s ⇒ same-tab return to the screen that started the flow (default `/channels`) with the query. The return page also runs during the onboarding tunnel. UI shows per-page report (connected / skipped / warning with reason). Plan limit reached ⇒ **F-2**. |
| 5 | U: sees new Page Cards; prompted to link an agent if none. |

| F | Condition | Handling |
|---|---|---|
| F-1 | User refuses consent (`error=access_denied`) | `OAUTH_CANCELLED` report "connexion annulée", nothing changed. A pop-up that **looks closed is not a cancellation**: once Meta's pages cut the opener, `window.closed` reads true while the merchant is still choosing pages, so the waiting dialog stays until the result arrives or the merchant clicks "Annuler". |
| F-2 | `maxPages` reached | Pages beyond the limit skipped with `PLAN_LIMIT` (resource pages, limit n); upgrade CTA. Already at the limit when the explainer opens ⇒ "Continuer avec Facebook" stays (reconnecting a page is allowed) with the warning "Limite de pages atteinte (current / limit) : les nouvelles pages choisies sur Facebook seront ignorées…" (`PLAN_LIMIT`) + "Changer de plan" (`billing.read`). |
| F-3 | State invalid/expired | `OAUTH_STATE_INVALID`, ask to retry. |
| F-4 | Token later invalid (190) on any call | Channel `needs_reconnect`, banner on Home + page card, notification; AI stops for that channel; reconnect = same flow, token replaced, history kept. |
| F-5 | IG long-lived token nearing expiry | Daily job refreshes when `tokenExpiresAt < now + 10 d` (CHN-12); refresh fails ⇒ F-4. (**fix**) |
| F-6 | Same page reconnected by same workspace | Token/avatar updated, no duplicate, status back to `active`. |

## FL-06 Operator handles the inbox `[Mobile V2 (base FR) + Screens (AR/EN): 10][CDC §7.4]`

| # | Step |
|---|---|
| 1 | U: opens Inbox; S: list by workspace, filtered by channel when `channelId` is set, tabs with server counts, WS subscription. |
| 2 | U: opens thread ⇒ `POST /conversations/:id/read` (unread 0, WS update to other clients). Messages cursor-paginated (50). |
| 3 | U: types reply (text, optional image ≤ 5 MB) or picks quick reply. S: send via Meta; optimistic bubble; on success store Message(author=human, authorUserId), **AI paused** (D19, `autoPauseOnManualReply`) with banner "AI paused — Resume". |
| 4 | U: Resolve / Archive / Reopen / Assign / Note. All emit WS. |
| 5 | U: client panel: view client, orders; "Create order" prefilled from client. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Send fails outside 24 h | FL-03 F-2. |
| F-2 | Image upload fails / too large | Inline error on composer; text not sent. |
| F-3 | Conversation modified elsewhere (status changed by teammate) | WS updates the view; action on stale state ⇒ `409 CONFLICT` with refresh prompt. |
| F-4 | WS disconnected | Client polls every 15 s and shows "reconnecting…" pill; reconnect replays missed events via `since` cursor. |
| F-5 | Channel `needs_reconnect` | Composer disabled with reason + "Reconnect" link; reading still works. |

## FL-07 Manual order → confirmation call → delivery → COD cash `[V1 orders][Mobile V2 (base FR) + Screens (AR/EN): Orders]`

| # | Step |
|---|---|
| 1 | U: New order: pick client (search by name/phone) or type name+phone; items (variant required when product has variants); wilaya (select 69, loi 26-06), commune, address or stop-desk; fee auto-quoted (editable, Admin+); discount; notes. Validate per 04 §2; stock checked. Save ⇒ Order `new`, stock out, counters, WS. |
| 2 | U: "Call & confirm" on a `new` order ⇒ dialog: review contact (editable, validated), items, total; outcome = a `CallResult` value `picked_up` / `no_answer` / `busy` / `voicemail` / `rejected` / `wrong_number` / `callback` + note; each outcome writes one `OrderCall` row. |
| 3 | S: `picked_up` ⇒ `confirmationStatus=confirmed`, `status=confirmed` (address required — else dialog shows missing-address state and blocks). `no_answer/busy/voicemail` ⇒ `confirmationStatus=no_answer`, attempts+1 (3/3 ⇒ dialog proposes cancel or callback). `callback` ⇒ `confirmationStatus=callback`, `Order.callbackAt` set (presets 1 h · 16:00 · demain 10:00 · custom; past ⇒ `ORDER_CALLBACK_IN_PAST`), notification `order.callback_due` to the assignee at that time. `wrong_number` ⇒ `confirmationStatus=wrong_number`, order cancelled with reason "faux numéro" when `deliveryStatus=not_sent` and status ∈ new/confirmed/preparing, client `riskLevel=high`. `rejected` ⇒ cancelled only if `deliveryStatus=not_sent` and status ∈ new/confirmed/preparing (stock restored); otherwise logged with warning. |
| 4 | U: Prepare ⇒ `preparing` (optional). Send to courier (P2) ⇒ FL-08, or Mark shipped manually. |
| 5 | S/U: `delivered` ⇒ if unpaid: `amountPaid=total`, `paymentStatus=paid`, cash income row (total, "COD - delivered"); client aggregates; customer notified. |
| 6 | U (Admin+ from `delivered`, Operator+ from `shipped`): `returned` ⇒ auto income rows removed, return-cost expense (D27), aggregates recomputed; stock restored when "return received" is ticked. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Insufficient stock on save | `ORDER_INSUFFICIENT_STOCK {product, available}` inline on the item row; nothing saved. |
| F-2 | Duplicate phone belongs to another client | Picker suggests the existing client; creating a second with the same phone ⇒ `CLIENT_PHONE_EXISTS`. |
| F-3 | Invalid transition (e.g. delivered → confirmed) | `ORDER_INVALID_TRANSITION`; UI never offers it (actions computed from the matrix). |
| F-4 | Two users change status at once | Optimistic concurrency on `Order.version`; loser gets `409 CONFLICT` "order changed, reload". |
| F-5 | Delete | Allowed unless `delivered`; non-terminal orders rolled back first; auto cash rows only (**fix**). Confirm dialog with order number. |
| F-6 | Operator tries to delete / edit fee | `403 FORBIDDEN` per role matrix; buttons hidden. |

## FL-08 Send to courier + tracking `[PH2 #05–07][V1 user-delivery.controller.ts]` (P2)

| # | Step |
|---|---|
| 1 | U: on a `confirmed/preparing` order (bulk allowed): choose courier (default preselected); dialog prefilled with **order's** wilaya/commune/address/stop-desk (**fix**), COD amount = total, weight optional. |
| 2 | S: adapter `createParcel`; success ⇒ Shipment(`status=sent`, trackingNumber, label), `deliveryStatus=sent`, `status=shipped`, movement none, notification `shipment.created`, customer message with tracking number. |
| 3 | S: tracking sync — webhook if offered, else batch polling every 2 h for the first 3 days after `sent`, then every 12 h; after 30 d without event ⇒ `ShipmentStatus.stale`; each change ⇒ ShipmentEvent, mapped `Shipment.status` (`picked_up` is a status) and `deliveryStatus`, customer notified at out_for_delivery / delivered / failed; terminal courier state ⇒ `status=delivered` (COD rule) or `returned`. |
| 4 | U: print label(s) (PDF, single or merged). |

| F | Condition | Handling |
|---|---|---|
| F-1 | No courier configured | Dialog empty state with link to Delivery settings. |
| F-2 | Courier validation error (unknown commune, bad phone) | Error shown on the order with the courier's message mapped to a field; order stays `confirmed`; fix and retry. |
| F-3 | Courier API down/timeout | Shipment `pending` queued, retried with backoff (1, 5, 30 min, 2 h × 6); order shows "sending…"; after final failure ⇒ notification `shipment.failed` (`data.reason=courier_unavailable`), manual retry button. |
| F-4 | Unknown raw status from courier | Stored as event, mapped status unchanged, logged for mapping update. |
| F-5 | Courier reports returned after delivered | Order `returned` (allowed transition), cash reversed, stock restored on "return received" confirmation by user (not automatic). |
| F-6 | Label unavailable (ZR) | "Label not provided by courier" + fallback printable Djaber label (order, client, address, COD). |

## FL-09 Credits & plan lifecycle `[V1][Mobile V2 (base FR) + Screens (AR/EN): 11][D49, D60]`

| # | Step |
|---|---|
| 1 | S: every AI turn reserves then debits a ledger row; balance = `monthlyCredits` − Σ debits in the current monthly credit period (02 §6). 80 % ⇒ notification once; 100 % ⇒ FL-01 F-4. |
| 2 | U: Settings › Plan: pick plan + cycle ⇒ `POST /billing/checkout { planId, cycle, promoCode? }` ⇒ Chargily checkout (15 min); return URL `/settings/billing/return?ref=`. |
| 3 | S: webhook (signature verified, idempotent on checkout id) **or** `GET /billing/checkout/return?ref=` from the return page (states: verifying… / success / pending — auto-poll 5 s × 12 / failed) ⇒ activate: one Subscription per workspace (existing active one ends), `Plan` limits applied, new credit period. |
| 4 | S (daily job, dunning D49 — paid subscriptions with `billingCycle ≠ none` and `cancelAtPeriodEnd=false`; the renewal `Invoice(kind=subscription, status=upcoming)` exists from J−7): **J−7** `subscription.expiring` (e-mail + in-app + push), `Subscription.dunningStage=d_minus_7`. **J0** (`currentPeriodEnd`): invoice `unpaid`, `Subscription.status=dunning`, `dunningStage=d0`, Chargily payment link sent by e-mail + in-app `invoice.unpaid` (+ SMS when enabled); paid-plan limits stay in force. **J+3**: second reminder `invoice.unpaid`, `dunningStage=d_plus_3`. **J+7**: `Subscription.status=expired`, `dunningStage=expired`, then the 02 §5 single rule at once: new free `Subscription(provider=none, status=active)`, free-plan limits, excess resources paused by plan, banner "Plan expiré", `subscription.expired`; nothing deleted, no read-only, no suspension for non-payment. Paying the unpaid invoice at any stage (checkout or manual payment by finance) ⇒ `status=active`, new period, pauses lifted. Trials: at `trialEndsAt` the same 02 §5 rule applies (D60). |

| F | Condition | Handling |
|---|---|---|
| F-1 | Payment failed/cancelled | Return page shows failure + retry; nothing changed. |
| F-2 | Webhook arrives twice / verify replayed | Idempotent — second call no-op. |
| F-3 | Webhook signature invalid | 401, logged, alert `super_admin`. |
| F-4 | Downgrade with more pages than new limit | Pages beyond the limit paused automatically (newest first, 02 §5); the Owner may swap which pages are active from the Channels list (resume one ⇒ pause another, confirm dialog, FL-31). |
| F-5 | Manual payment recorded by finance (ADM-05) | method ∈ `manual_transfer` / `manual_ccp` / `manual_cash`, reference, amount, date, proof; amount = remaining ⇒ invoice `paid` + immediate reactivation; amount < remaining ⇒ invoice stays `unpaid`, `200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`; amount > remaining ⇒ `422 VALIDATION_ERROR` (`fields.amount = validation.range`, max = remaining); no credit-note record exists in v2 (D71). |

## FL-10 Online payment link for an order `[CDC UC03]` (P2, D4)

1. U/AI: "Pay online" ⇒ S: Chargily checkout for order total, 15 min expiry, link sent on chat. 2. Customer pays. 3. Webhook ⇒ `OrderPayment paid`, `paymentStatus=paid`, cash income row, customer + merchant notified. Failures: expired ⇒ new link on request; failed ⇒ customer offered retry or COD; amount mismatch ⇒ flagged, not marked paid.

## FL-11 Google Sheets sync `[PH2 #03]` (P2)

1. U: Settings › Integrations › Connect Google (OAuth). 2. Pick/create sheet. 3. S: on order create/update ⇒ debounced row upsert (5 s). Failures: token revoked ⇒ status `error` + notification, sync paused; quota (429) ⇒ retry with backoff; sheet deleted ⇒ `error` "sheet not found"; row manually deleted in sheet ⇒ re-appended on next update.

## FL-12 Catalogue import `[V1 import controller]`

1. U: upload CSV/XLSX (≤ 5 MB, ≤ 2000 rows). 2. S: parse headers (FR/EN aliases), validate every row, return **preview** with per-row errors. 3. U: confirm ⇒ S writes valid rows in one transaction, creates missing categories, `in` movements, returns report. Failures: required columns missing ⇒ `IMPORT_COLUMNS_MISSING`; duplicate SKU in file / in catalogue ⇒ row error; > limits ⇒ `IMPORT_TOO_LARGE`; mid-transaction failure ⇒ nothing written.

## FL-13 Member invitation & roles

1. Owner invites email + role. 2. S: email with 7-day token; resend (60 s cooldown) or revoke. 3. Invitee accepts (login, or sign-up with the same email — creates no workspace, D30) ⇒ Membership. Failures: expired ⇒ "ask for a new invite"; already member ⇒ no-op; `maxMembers` (members + pending invitations) reached ⇒ invitation refused `403 PLAN_LIMIT {resource: members}` — "Inviter un membre" and "Envoyer l'invitation" are greyed with "Limite du plan atteinte : n / max membres et invitations (PLAN_LIMIT)" + "Changer de plan" (`billing.plan`); read-only only concerns a member joining while the workspace is already over the limit (12 §Invitation); revoking an invitation and demoting an Admin are confirmed; the Owner cannot be removed or demoted by anyone else (`OWNER_IMMUTABLE`, D30); the Owner may transfer ownership to an Admin with `POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }` (D51: `password` always required ⇒ `AUTH_INVALID_CREDENTIALS` on mismatch; `totpCode` required when the Owner has 2FA enabled ⇒ `TWO_FA_CONFIRMATION_REQUIRED`, ignored otherwise; target not an Admin ⇒ `OWNERSHIP_TRANSFER_TARGET_INVALID`; old owner → `admin`, new owner → `owner`, `User.ownedWorkspaceId` moved, audit `workspace.transfer_ownership`, e-mail + `member.role_changed` to both).

## FL-14 Account & workspace deletion

1. Owner: Danger zone ⇒ type password + workspace name (`DELETE /workspace { password, confirmName }`). 2. S: `Workspace.status=deletion_scheduled`, `deletionScheduledAt=+30 d` (04 §16); channels disconnected; AI stops; every mutation ⇒ `409 WORKSPACE_DELETION_SCHEDULED {at}` (reads allowed; the Owner may cancel with `POST /workspace/deletion/cancel`); e-mail `workspace.deletion_scheduled`; purge job at the date (D31) with the e-mail `workspace.deleted`. Failure: active paid subscription ⇒ warn (no refund) but allow.

## FL-15 Page analysis → product import `[V1 page-analysis.service.ts]`

1. U: Page › Analyse. 2. S: job (not synchronous — **fix**): fetch posts/media (reading the page's posts needs `pages_read_engagement` **or** `pages_read_user_content` — V1 read `/<pageId>/posts` with the former, the live Meta app grants only it; neither ⇒ `PAGE_ANALYSIS_PERMISSION_REQUIRED` with reconnect CTA), per post vision extraction, dedup by name, progress via WS. 3. U: review grid, edit, select ⇒ import (SKU `FB-…`, qty from input). Failures: 0 products found ⇒ empty state; provider error ⇒ partial results kept + "retry remaining".

---

## Cross-cutting behaviours

| Topic | Rule |
|---|---|
| Optimistic UI | Only for inbox send and read marks; everything else waits for the server. |
| Unsaved changes | Any dirty form ⇒ leave-guard dialog "Quitter sans enregistrer ?" (GLOBAL catalogue, 12 §16) — also when closing a dialog with typed content (12 §16 "close guard"). A form is clean again right after a successful save (the saved server version becomes the baseline, new variant rows included); "Annuler" / "Fermer" drop only unsaved edits. |
| Offline / network error | Toast "No connection" + automatic retry for GETs; mutations never auto-retried except idempotent ones (`Idempotency-Key`). |
| Session expiry | Silent refresh; refresh failed ⇒ redirect to login with return URL; form drafts kept in memory. |
| Permissions | Hidden controls for forbidden actions; server still enforces (`403`). |
| Deleted/foreign resource | `404` ⇒ "not found or no access" page, never a blank screen. |
| Long jobs (analysis, import, bulk send, backfill) | Job with progress; survives navigation; result in notifications. |
| Time | All "today/period" in Africa/Algiers; date-only inputs end-of-day inclusive. |


---

# Flows added from the Figma web design (2026-10-06)

Same notation. Decisions D36–D78 (README) are final (DECIDED 2026-10-11); the Figma frames named in each title are the wording reference, and where a Figma text differs from a spec value the spec wins (D65, `../audit/figma-text-fixes.md`).

## FL-16 Product moderation: submit → review → reject → appeal `[D36][FIG MOD, MOD rejected, ADM-10]`

| # | Step |
|---|---|
| 1 | U(merchant): creates a product (form, duplicate, CSV import row, page-analysis import) or edits title / images / category / description / price ±50 %. |
| 2 | S: saves the product; creates `ModerationItem(pending)`; new product ⇒ hidden from AI/search/cards; edited product ⇒ last approved snapshot keeps selling (IA column "ANCIENNE VERSION"). Form banner "Soumis le … · validation en cours (< 2 h)". |
| 3 | S(job `moderation-prescreen`): `aiScore` + flags. `score ≥ 0.9 ∧ trust ∈ {standard, trusted} ∧ category not sensitive` ⇒ `approved` (**→ step 8**, 5 % sampled). Else queue (`slaDueAt = +2 h business`). |
| 4 | U(moderator): ADM-10 › À vérifier (sorted urgency, age); opens the review panel (context, flagged fields with evidence, history). |
| 5 | U(moderator): Approuver ⇒ step 8 · Demander une modification ⇒ `changes_requested`, product unchanged, merchant notified (`product.changes_requested`) · Rejeter ⇒ reason template + message (FR, auto AR) required. |
| 6 | S: reject ⇒ `rejected`, product hidden from AI and public lists (stock, counter sales allowed); notification `product.rejected` (in-app + e-mail + push) with deep link; list pill REFUSÉ · motif; rejected view highlights the refused fields; counterfeit counter per workspace updated (3 / 90 d ⇒ `trustLevel=watch`). |
| 7 | U(merchant): "Enregistrer et resoumettre" ⇒ new item (**→ 2**) **or** "Contester (1 fois)" ⇒ message ≤ 500 + attachment ⇒ `appealed` (pill CONTESTATION, still hidden). S: routes to a different moderator (tab "Appels du marchand", due < 24 h). Moderator decides (final) ⇒ `moderation.appeal_result`. |
| 8 | S: approve ⇒ snapshot goes live: visible to AI (grounding refresh), cards, search, recommendations; `product.approved` grouped notification; CAT-09 "Validation Djaber" shows date + content version + next-review rule. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Second appeal | `MODERATION_APPEAL_ALREADY_USED` (button hidden, toast via API). |
| F-2 | Appeal after 7 days | `MODERATION_APPEAL_WINDOW_EXPIRED`; only resubmit remains. |
| F-3 | Moderator decides an already decided item (two tabs) | `MODERATION_ITEM_ALREADY_DECIDED`, panel refreshes. |
| F-4 | Reject without reason/message | `MODERATION_REASON_REQUIRED` inline. |
| F-5 | Pre-screen job fails | item stays `pending` with `aiScore=null`, goes to the human queue, flag "pré-filtrage indisponible". |
| F-6 | Customer asks the AI for a pending/rejected product | AI answers "ce produit n'est pas disponible pour le moment", no card, no handoff. |
| F-7 | SLA exceeded | `urgent=true`, red row, ADM-01 alert "n depuis > 2 h". |
| F-8 | Import of 118 products | 118 items; list banner "118 produits en attente"; trusted merchant ⇒ auto-approved except sensitive categories. |

## FL-17 Report a customer → admin decision `[D37][FIG SAFE, ADM-11, DLG Inbox]`

| # | Step |
|---|---|
| 1 | U(operator): conversation menu › "Signaler à Djaber" (or "Bloquer ce client" first). Dialog: reason, details, checkbox "Bloquer aussi ce client maintenant". |
| 2 | S: `Report(status=open)` with the 10 surrounding messages (read-only extract, phone masked); optional `CustomerBlock(source=manual)`; toast + e-mail acknowledgement; `slaDueAt=+24 h`. |
| 3 | S: platform auto-rules run (same phone blocked by ≥ 3 workspaces / 7 d ⇒ system report proposing blacklist). |
| 4 | U(moderator): ADM-11 › À traiter; opens the treatment panel; decision checkboxes: confirm merchant block · platform blacklist (`CustomerBlock(source=platform)` for every workspace) · report to Meta (manual, link) · dismiss; "Clore & notifier" or "Demander plus d'infos" (status `reviewing`, ticket-like reply to the merchant). |
| 5 | S: `actioned` / `dismissed`; `report.resolved` notification to the reporter with the outcome; `AuditLog` row; blacklist ⇒ affected workspaces see the row "PLATEFORME 🔒" in their blocked list. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Same reporter reports the same target while a report is open | `ABUSE_REPORT_ALREADY_OPEN` (dialog shows the existing report state). |
| F-2 | Merchant tries to unblock a platform-blacklisted number | `CUSTOMER_BLOCKED_BY_PLATFORM` tooltip + "contester via le support". |
| F-3 | Blocked customer writes | message stored, no AI, no notification, thread under "Bloqués"; Home/Queue untouched. |
| F-4 | AI message reported | `Report(type=ai_message)` + `AgentInsight(error)`; ≥ 5 / 30 d on one agent ⇒ preset alert in ADM-01. |
| F-5 | End customer reports a merchant from the tracking page / e-mail | `Report(reporterKind=end_customer, type=merchant)`; ≥ 3 / 30 d ⇒ "revue de l'espace" system report. |
| F-6 | > 20 reports / day from one workspace | `ABUSE_REPORT_RATE_LIMITED`. |

## FL-18 Support ticket `[D38][FIG HELP, ADM-12]`

| # | Step |
|---|---|
| 1 | U(member): Aide › Contacter le support (or "?" panel): subject category, priority, message ≥ 20 chars, attachments; auto-context block shown (editable); the form suggests a matching guide. |
| 2 | S: `SupportTicket(status=open, channel=web|mobile, slaDueAt per plan: Pro 1 h / Starter 4 h / Free 24 h business hours)`; `SupportMessage` with the auto-context; toast + e-mail "#T-n reçu"; appears in "Mes demandes". |
| 3 | U(support): ADM-12 › Ouverts (over-SLA in red); replies (`CannedReply`, attachments, internal notes); "Envoyer & attendre le client" ⇒ `status=pending_customer`; may open a read-only impersonation session from the ticket (FL-29, `ticketId`) or link an incident / escalate. |
| 4 | S: `firstResponseAt` set; notification `support.reply` (push on mobile, e-mail). U(member): replies from Aide › ticket (status back to `open`). |
| 5 | U(support): "Résoudre" ⇒ `resolved`; member gets a satisfaction prompt (1–5) in the ticket; score stored. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Message < 20 chars | `VALIDATION_ERROR` inline. |
| F-2 | Reply on a ticket resolved > 30 d ago (daily job sets `status=closed` at resolvedAt + 30 d) | `TICKET_CLOSED` ⇒ "ouvrir une nouvelle demande". |
| F-3 | Operator picks "Facturation" | category hidden for Operators (403 `FORBIDDEN` via API). |
| F-4 | SLA breached | pill "DÉPASSÉ DE n", ADM-01 alert, ticket sorted first. |
| F-5 | > 10 tickets / h / workspace | `RATE_LIMITED`. |

## FL-19 Plan creation and edition (admin) `[D63][FIG ADM-04, DLG Platform admin "Créer un plan"]`

| # | Step |
|---|---|
| 1 | U(finance / super admin): Plans › + Nouveau plan: slug (immutable), names FR/AR/EN, descriptions, monthly / yearly price (−17 % label computed), trial days, display order, limits (−1 unlimited: pages, agents, products, conversations / month, members, credits / month, API keys, webhooks, sync history days, scheduled reports), features[], visibility (active, featured, visible on pricing). Card preview on the right. |
| 2 | S: validation (slug unique `PLAN_SLUG_TAKEN`; yearly ≥ 0; ≥ 1 limit > 0; one featured plan) ⇒ `Plan(version=1)`; audited `plan.create`; pricing page shows it when visible. |
| 3 | U: edit an existing plan ⇒ form shows "Plan.version n → n+1" and the impact line (subscribers; limits lowered below usage ⇒ n workspaces `PLAN_LIMIT_GRANDFATHERED`; prices apply at next renewal, e-mail 30 d before). |
| 4 | S: `Plan.version+1`; subscriptions keep `planVersion` until renewal; audit row with before/after diff (ADM-09). |
| 5 | U: delete ⇒ blocked when subscribers (`PLAN_IN_USE n`) ⇒ "Migrer les abonnés vers … (à la prochaine période)" then archive, or archive only (hidden, subscribers kept). |

| F | Condition | Handling |
|---|---|---|
| F-1 | Private offer | "visible sur la page tarifs" unchecked ⇒ only assignable by admin (subscription create dialog). |
| F-2 | Merchant checkout on an archived plan | `PLAN_NOT_FOUND` toast, plans reloaded. |

## FL-20 Credit pack purchase on mobile (IAP) + refund `[D40][FIG ADM-15, BIL-04]`

| # | Step |
|---|---|
| 1 | U(owner, mobile): Crédits › Acheter un pack ⇒ packs with `mobileVisible` and store prices (tier). Taps a pack ⇒ store purchase sheet (Google Play / App Store). |
| 2 | S(app): on store success, `POST /credits/packs/iap/validate { platform, productId, receipt }`; UI "validation du reçu…". |
| 3 | S(API): verifies the receipt with the store API; `transactionId` unique ⇒ `CreditPackPurchase`, `CreditLedger(bucket=pack, action=pack_purchase, kind=credit, +credits)`, `Invoice(kind=credit_pack, method=google_play|app_store, status=paid, net of the 30 % store fee)`, response with the new balance; app shows "crédité", pill updates; notification `credits.pack_purchased` (in-app + e-mail). |
| 4 | Later, store refund ⇒ server notification (RTDN / App Store Server Notifications) ⇒ `CreditLedger(bucket=pack, action=store_refund, kind=debit, −credits)`; balance may go negative ⇒ `credits.negative` (in-app + e-mail + push), red banner, AI blocked (`CREDITS_NEGATIVE_BALANCE` on runs, customers get the fixed text `customer.unavailable` once per conversation per 24 h); restored by a new purchase or an admin grant. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Receipt invalid / tampered | `IAP_RECEIPT_INVALID`; no credit; app offers "Réessayer" (store restores purchases); support link. |
| F-2 | Same receipt posted twice (retry) | `IAP_RECEIPT_ALREADY_USED` ⇒ treated as success (idempotent) in the app. |
| F-3 | Store API unavailable | `IAP_STORE_UNAVAILABLE`; app keeps the pending purchase and retries on next launch; server also polls pending receipts. |
| F-4 | Web-only pack id posted from mobile | `IAP_PRODUCT_UNKNOWN`. |
| F-5 | Web purchase | `POST /credits/packs/checkout { packId }` ⇒ Chargily checkout, same return flow as FL-28; ledger `bucket=pack, action=pack_purchase`, `Invoice(kind=credit_pack)`. |

## FL-21 Forced app update `[D39][FIG ADM-13]`

1. U(super admin): Paramètres plateforme › Applications › sets `AppVersion.minVersion` (e.g. 2.1.0; also `recommendedVersion`, `latestVersion`) and `updateMessage` FR/AR/EN ⇒ dialog shows the impact (n devices below, %) and asks a 2FA code (`TWO_FA_CONFIRMATION_REQUIRED`). 2. S: `AppVersion` saved (`forceUpdateAt`) + audited `app_version.force_update`; push `app.update_required` / `app.update_recommended`. 3. Mobile (`GET /app/version?platform&version` at launch and on every API call via `X-App-Version`): version `< minVersion` ⇒ `426 APP_UPDATE_REQUIRED {minVersion, storeUrl, message}` ⇒ blocking screen "Mise à jour requise" with the store button; `< recommendedVersion` ⇒ `200` + `X-App-Update: recommended`, banner dismissible 7 d. Failures: store page not yet live (`storeStatus` ≠ `published`, iOS "EN REVUE APPLE") ⇒ the dialog warns and blocks `minVersion` above the published version; invalid 2FA ⇒ `AUTH_2FA_INVALID`.

## FL-22 Account deletion (in-app and public page) `[D50, D51][FIG PUB deletion, DLG Settings, ADM-16]`

| # | Step |
|---|---|
| 1a | U(in-app): Paramètres › Profil › Supprimer mon compte: password + 2FA code (if enabled). |
| 1b | U(public): `/compte/suppression`: e-mail + consent checkbox ⇒ "si un compte existe, un e-mail a été envoyé" (always); link valid 24 h. |
| 2 | S: guards — owner of a live workspace ⇒ `ACCOUNT_OWNS_WORKSPACE` (`AccountDeletionRequest.blockedReason=ACCOUNT_OWNS_WORKSPACE`; dialog: "Transférer la propriété" = `POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }` (D51, `totpCode` required when 2FA is enabled) or "Supprimer l'espace" = FL-14 with its own 30-day grace); unpaid invoice ⇒ `WORKSPACE_HAS_DEBT` (`blockedReason=WORKSPACE_HAS_DEBT`); pending request ⇒ `ACCOUNT_DELETION_PENDING`. |
| 3 | S(on confirmation): `AccountDeletionRequest(status=grace, scheduledAt=+30 d)`, `User.status=deletion_scheduled`, sessions + device tokens revoked, memberships removed; e-mail `account.deletion_confirmed` (e-mail only) with "Exporter mes données" (job `data_export`, JSON + CSV, 7 d) and "Annuler (se connecter)". Admin queue shows EN GRÂCE. |
| 4 | U(any time within 30 d): logs in ⇒ dialog "Annuler la suppression ?" ⇒ `cancelled`, `status=active` (memberships re-invited by Owners). |
| 5 | S(at `scheduledAt`): anonymisation job (04 §16) ⇒ `anonymised`; invoices kept 10 y without personal data; admin row ANONYMISÉ. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Link expired / reused | `ACCOUNT_DELETION_TOKEN_EXPIRED` page "Refaire une demande". |
| F-2 | > 3 public requests / h / IP | `RATE_LIMITED` (same neutral message to the user, logged). |
| F-3 | Owner with debt | admin "Résoudre (transférer / régler)"; request `blocked` until solved. |
| F-4 | Partial deletion wanted (one Meta page, export only) | link to support (ticket category "Sécurité & données"). |
| F-5 | Meta data-deletion callback for an end customer | not this flow — MSG-08 (PUB status page `/data-deletion/:code`). |

## FL-23 Workspace deletion scheduled by admin (and owner cancel) `[D31][FIG ADM-02, DLG Platform admin]`

1. U(super admin): Espaces › row › "Programmer la suppression": typed workspace name + reason. 2. S: `deletionScheduledAt=+30 d`; export job e-mailed to the Owner; channels disconnected (webhooks unsubscribed, tokens cleared); subscription cancelled at once (no refund); AI stops; Owner banner "Suppression programmée le … — Annuler"; status pill SUPPRESSION J+30. 3. Until the date, any mutation except cancel ⇒ `WORKSPACE_DELETION_SCHEDULED`; Owner or admin may cancel (reason) ⇒ channels stay `disconnected` (reconnect needed), subscription must be re-purchased. 4. Purge job at the date (D31). Owner-initiated deletion (FL-14) sets the same field and follows steps 2–4.

## FL-24 Agent creation in 5 steps + versions / rollback `[D53, D54][FIG AGT-02 ×5, AGT-03, AGT-04, DLG Agents]`

| # | Step |
|---|---|
| 1 | U: Agents › + Nouvel agent ⇒ step 1 Identité: starting point (4 presets / De zéro), internal name, display name, description, avatar, languages + default, tone, tutoiement, emojis; live preview. S: `Agent(status=draft)` created on first "Continuer" or autosave (12 s). |
| 2 | U: step 2 Connaissances: catalogue scope (all / categories), out-of-stock behaviour, missing variants, 4 policies, FAQ (add / extract from FB page via CHN-08 / import file / unanswered insights). |
| 3 | U: step 3 Comportement: capabilities, order fields, `maxQtyPerOrder` / `maxAmountPerOrder`, `riskyClientBehavior`, `recapMode`, handoff checklist (`handoffRules`) + `handoffKeywords`, business hours (`Agent.businessHours`; outside them the workspace system message `out_of_hours` is sent, D43), `responseDelaySec`. The handoff text itself is the workspace system message `handoff` (Settings › Messages système), not an agent field. |
| 4 | U: step 4 Canaux: select free channels; a channel LIÉE À « X » ⇒ dialog "Déplacer … vers ce nouvel agent ?" (AGT-05). |
| 5 | U: step 5 Test & activation: readiness checklist (S computes), 8 automatic scenarios run in the playground (dry-run, 0 credits), "Tester moi-même", "Envoyer un lien de test (24 h)"; then Activer maintenant / Enregistrer en brouillon / Activer à une date. "Activer maintenant" and "Activer à une date" are greyed with "À corriger avant d'activer : <labels of the ✕ readiness rows>" while a blocking row fails (else with the reason of the server `activate` descriptor); the date input has `min` = now; a scheduled activation shows "Annuler la programmation" (`DELETE /agents/:id/activate`). Readiness "E-mail vérifié › Voir" opens `/settings/security`. |
| 6 | S(activate): checks (`AGENT_NO_CHANNEL`, `PLAN_LIMIT {resource: agents}` counted on agents with `status ∈ {active, paused}` only — drafts never count (D67), `AUTH_EMAIL_UNVERIFIED`, `AGENT_DRAFT_INCOMPLETE`); compiles the structured columns into `customInstructions` / `humanHandoffRules` (R-H; `Agent.modelId` assigned by `AiRoute`, never chosen by the merchant); `status=active`; `AgentVersion v1`; links channels; new conversations use the agent (`AGENT_CHANNEL_SWITCH_NEXT_THREAD` info); toast + Home checklist step done. |
| 7 | U(later): AGT-04 Configuration tab edits a section ⇒ Enregistrer ⇒ `AgentVersion v2` ("Version v2 créée"); AGT-03 › Versions: Diff · Restaurer v1 ⇒ `v3 = snapshot(v1)` with note "Restauré depuis v1"; preset v8 available ⇒ "Voir les changements · Appliquer" ⇒ v4 (merchant edits win on conflict). |

| F | Condition | Handling |
|---|---|---|
| F-1 | User leaves mid-wizard | draft kept with step; list pill BROUILLON; "Reprendre" returns to the saved step. |
| F-2 | Channel pending Meta approval selected | allowed; agent activates on that channel automatically at approval (`channel.approved`). |
| F-3 | A scenario fails (e.g. wrong price) | row shows the diff; link opens the playground turn; "Ajouter une instruction depuis ce tour". |
| F-4 | Two admins edit the configuration | `409 CONFLICT` dialog with per-section merge (Recharger) or Écraser. |
| F-5 | FAQ > 50 entries / 20 000 chars | `AGENT_FAQ_LIMIT` inline. |
| F-6 | Test link opened after 24 h | `AGENT_TEST_LINK_EXPIRED` page. |
| F-7 | Pause with open threads | dialog `AGENT_PAUSED_WITH_OPEN_THREADS n` (confirm ⇒ threads to À traiter; checkbox "envoyer le message hors horaires" sends the workspace system message `out_of_hours` once to each open thread). |
| F-8 | Delete with channels | `AGENT_HAS_CHANNELS` ⇒ "Changer les canaux" first. |
| F-9 | Cancel a scheduled activation | `DELETE /agents/:id/activate` (idempotent, `agents.manage`, audit `agent.unschedule`): `scheduledActivateAt → null`, the agent stays a draft; once it is no longer a draft ⇒ `409 CONFLICT`. |
| F-10 | "Annuler" at step 1 / leaving a never-saved draft | dirty form ⇒ leave guard; a confirmed leave drops the sessionStorage copy (it no longer comes back on the next "Nouvel agent"); a reload keeps it. |
| F-11 | Wizard opened from a page without agent ("Créer un agent" on `/channels`) | `/agents/new?channel=<id>`: step 1 says the page will be linked; the draft creation links it (`PUT /channels/:id/agent`; refusal ⇒ warning toast, step 4 still links pages). |

## FL-25 Delivery failure handling `[DLV-08][FIG DLV-08, MECH Delivery, DLG Orders]`

| # | Step |
|---|---|
| 1 | S: courier event mapped to `failed` with `failureReason` (unreachable / address / refused / damaged / other) and attempt n/3 ⇒ `shipment.failed` notification (in-app + e-mail + push), Home "À traiter" card COLIS, Delivery › Échecs row, order delivery block "échec + actions". |
| 2 | U(operator): row `Actions ⌄` or tracking panel: **Relancer la livraison** (adapter `retryDelivery`, else cancel + new parcel; customer message per MSG-06) · **Corriger l'adresse → relancer** (address dialog; parcel must be cancelled first if locked) · **Marquer retournée** (dialog: reason, restock, courier return fee, client +1) · **Appeler le client** (tel: link + call log on the order) · **Ouvrir la commande**. |
| 3 | S: retry ⇒ `Shipment.attempts+1`, status back to `in_transit`/`out_for_delivery` per courier; returned ⇒ order `returned`, cash reversed, stock restored when the restock box is ticked (04 §3), `shipment.returned`. |
| 4 | After 3 failed attempts the UI proposes return by default; "Sans mouvement > 5 j" list offers Actualiser · Contacter le transporteur (portal link + n°) · Marquer livrée / retournée manuellement. |

| F | Condition | Handling |
|---|---|---|
| F-1 | Retry unsupported by the adapter and parcel already picked up | `COURIER_CANCEL_NOT_ALLOWED` ⇒ only "Marquer retournée" (at reception) remains. |
| F-2 | Address edit on a sent parcel | `COURIER_ADDRESS_LOCKED` ⇒ "Annuler le colis" first (if allowed). |
| F-3 | Refresh clicked twice within 5 min | `TRACKING_SYNC_RATE_LIMITED` (button shows "Limite 1 / 5 min"). |
| F-4 | Courier down during retry | `COURIER_UNAVAILABLE`, retry queued (FL-08 F-3). |
| F-5 | Manual "Marquer livrée" on a failed parcel | allowed (COD rule) with amount cashed + date. The failure is then handled (F-8). |
| F-6 | Opened from the `shipment.failed` notification / Home "colis en échec" | deep link `/delivery?tab=all&ids=<orderId>&sheet=<shipmentId>` (`ids` = order ids, tab "Tous" so a parcel no longer failed still shows): the list is narrowed to that order and its tracking panel opens; the older form `/delivery?tab=failed&order=<id>` is still read the same way. |
| F-7 | Bulk "Marquer expédiées (livraison propre)" | confirmed; sends only the rows whose `ship_manual` descriptor is enabled. Raw `lastError` codes are labelled (filter, chips) and the failed row shows the courier message. |
| F-8 | Order delivered by hand, cancelled or returned while its parcel is `failed` (UX-064) | the failure is handled (04 §22 "Order closed"): Home COLIS card greyed "fait par <member>" 24 h then gone, out of Livraison › Échecs, LIVRAISON block "Livrée à la main — cet envoi en échec est réglé" (or annulée / retournée), no send action anywhere ("Corriger et renvoyer", "Changer de transporteur", "Envoyer au transporteur", "Marquer expédiée (livraison propre)" not offered — UX-060 rule); the API refuses them with `422 DELIVERY_ORDER_DELIVERED / _CANCELLED / _RETURNED`. |

## FL-26 Inventory count `[D55][FIG DLG GDS "Lancer / Valider l'inventaire", GDS-05]`

1. U(admin, advanced mode): Stock › "Lancer un inventaire": `scope ∈ InventoryScope (all | category | alerts_only)`, "Bloquer les ventes comptoir" ⇒ S: `POST /inventories` creates `InventoryCount(status=draft, number=#INV-n)` with the expected quantities snapshot (`InventoryCountLine.expectedQty`), then `status=counting` as soon as the first line is saved; printable sheet; entry on web (table) or mobile (scan). 2. U/operators (`stock.count`): enter counted quantities (`PUT /inventories/:id/lines`, saved per line). 3. U(admin): "Valider l'inventaire" (`POST /inventories/:id/validate`): variances with before → after and %, total value; note required when a line > 10 % (`INVENTORY_VARIANCE_NOTE_REQUIRED`); "Reprendre le comptage" or "Valider (n mouvements)". 4. S: one `StockMovement(type=inventory)` per variance (variant level), `lastInventoryAt` per product, low-stock alerts (`Product.minStock`) recomputed, recommendation alert for > 10 % variances; `status=validated`; report "Écarts d'inventaire" updated. Failures: a second count started while one is `draft`/`counting` ⇒ `INVENTORY_IN_PROGRESS`; counter sale during a blocking count ⇒ `SALE_BLOCKED_BY_INVENTORY`; cancel ⇒ `status=cancelled`, no movement.

## FL-27 Cash day closing `[D56][FIG GDS-09]`

1. U(admin): Caisse › "Clôturer la journée" (day = selected day; list shows "02, 03, 04 oct. → à clôturer"). 2. Dialog: theoretical cash (cash method rows of the day), counted cash input, difference computed, note (mandatory if difference ≠ 0). 3. S: `POST /cash/close` ⇒ `CashClosing(day, theoreticalBalance, countedBalance, difference, note, closedById)` (unique per workspace and day) and, when `difference ≠ 0`, `CashTransaction(category=correction, amount=difference, isAutomatic=true, sourceType=closing)`; next day's opening = counted; toast; day rows locked. 4. Any later row on that day ⇒ `CASH_DAY_CLOSED` (dialog "rouvrir la journée" = `POST /cash/days/:day/reopen` for Admin+, reason, audited, `CashClosing.reopenedById` / `reopenedAt`; reopening reverses the correction by a new correction). Failures: manual row edit after 24 h ⇒ `CASH_ENTRY_EDIT_WINDOW_EXPIRED`; auto row edit ⇒ `CAISSE_EDIT_AUTOMATIC`, delete ⇒ `CAISSE_DELETE_AUTOMATIC`; auto cash rows generated later for a closed date are dated today.

## FL-28 Checkout return (plans and packs, web) `[BIL-01][FIG BIL-04 "Retour de paiement", DLG Settings]`

1. U: Changer de plan (cycle, promo code, prorata shown; `POST /billing/checkout { planId, cycle, promoCode? }`) or Acheter un pack (`POST /credits/packs/checkout { packId }`) ⇒ "Payer n DA (CIB / Edahabia)" ⇒ Chargily checkout (15 min). 2. Return to `/settings/billing/return?ref=` ⇒ VÉRIFICATION… (`GET /billing/checkout/return?ref=`, polled every 5 s × 12). 3. SUCCÈS ⇒ "Paiement confirmé · Pro actif jusqu'au …" + invoice number + Retour; plan / credits applied at once (FL-09 step 3). 4. EN ATTENTE (bank not confirmed after 12 polls) ⇒ message + "nous vous notifions"; Facturation shows "en attente"; webhook completes later (`payment.received`). Failures: ÉCHEC `PAYMENT_FAILED` (bank reason, Réessayer / Changer de carte / Autre moyen (manual payment recorded by finance ⇒ support ticket)); EXPIRÉ `PAYMENT_EXPIRED` (Recommencer); amount mismatch ⇒ not applied, admin alert; promo invalid at checkout ⇒ `PROMO_*` inline before redirect. Unpaid renewal invoice (dunning): "Payer maintenant" = `POST /billing/invoices/:id/pay → { checkoutUrl }`, same return flow.

## FL-29 Admin impersonation (read-only) `[D21-bis][FIG ADM-02, ADM-12]`

1. U(`support` / `super_admin`): Espaces › row › "Se connecter en tant que" (or from a ticket): reason ≥ 10 chars, optional ticket ⇒ `POST /admin/impersonation/sessions { workspaceId, reason, ticketId? } → { data: { sessionId, token, expiresAt } }`. The session is read-only; there is no other mode. 2. S: `ImpersonationSession { adminUserId, workspaceId, reason, ticketId?, startedAt, expiresAt = startedAt + 30 min, endedAt?, actionsCount }`, audit `impersonation.start`; merchant shell opens with the token in `X-Impersonation-Session` and the red banner "Vous agissez en tant que {workspace} · lecture seule · {mm} min · Quitter". 3. Every request is audited `impersonation.action` and increments `actionsCount`; every non-GET request ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION` (toast under the banner, nothing changed). 4. Quitter (`DELETE /admin/impersonation/sessions/:id`) or expiry (`401 ADMIN_IMPERSONATION_EXPIRED`, back to the admin shell) ⇒ `endedAt`, `impersonation.stop` with duration; ADM-09 shows start → actions → stop; `GET /admin/impersonation/sessions` lists sessions. Failures: reason missing or < 10 chars ⇒ `ADMIN_REASON_REQUIRED`; role other than `support` / `super_admin` ⇒ `FORBIDDEN`.

## FL-30 Legal re-acceptance and maintenance `[D39, D58][FIG ADM-13, GLOBAL]`

1. U(super admin): publishes a major version of a legal document (`CmsEntry` + `LegalDocument.version`, `key ∈ LegalDocKey (terms | privacy | account_deletion | content_rules)`); notification `legal.reacceptance_required` (in-app + e-mail). 2. S: every user without a `LegalAcceptance` for that version gets `403 LEGAL_REACCEPT_REQUIRED` on protected calls; web and mobile show the interstitial (`GET /legal/pending` → documents, "J'accepte" ⇒ `POST /legal/accept { key, version }`); `LegalAcceptance` stored (IP, UA); minor versions never prompt. Maintenance: scheduled window ⇒ banner 24 h before; during the window reads work, mutations ⇒ `MAINTENANCE_MODE {until}`, Meta events queued and replayed after; status page incident auto-created.

## FL-31 Resume a channel at the plan limit (swap) `[02 §5][FIG GLOBAL Plan expired, DLG Agents "Réactiver"]`

1. U(owner): Channels › paused card (EN PAUSE · PLAN) › "Reprendre". 2. S: `maxPages` reached ⇒ dialog "Réactiver … mettra en pause une autre page (`CHANNEL_PAUSED_BY_PLAN`)" listing the active pages with their 7-d / 30-d conversation counts + "Comparer les plans". 3. U: picks the page to pause ⇒ "Réactiver et échanger" ⇒ S: atomic swap (one `paused(plan)` → `active`, one `active` → `paused(plan)`), notifications `channel.paused_by_plan` for the paused one, AI resumes on the first. Same dialog for agents (`maxAgents`) and read-only members (`maxMembers`).

---

## Cross-cutting additions

| Topic | Rule |
|---|---|
| Confirmation flags | Dialogs that warn and proceed (`CUSTOMER_MERGE_IRREVERSIBLE`, `AGENT_PAUSED_WITH_OPEN_THREADS`, `CUSTOMER_BLOCKED` on a manual order, "sortir le stock restant") send `confirm=true`; without it the API returns the code as 409 with the data needed to render the dialog. |
| Typed confirmations | Destructive dialogs require typing the exact name/number (workspace, agent, order, admin deletion); the button stays disabled until it matches. |
| Background jobs | Export (> 5 000 rows), merged labels, bulk send, backfill, analysis, import, inventory sheet, audit export, data export: job dialog "Tâche en cours" (Annuler la tâche / Continuer en arrière-plan), toast progress, notification `job.finished`, result kept 7 d (exports) or 24 h (audit, data export). |
| Business hours | SLA clocks (moderation 2 h; support first response Pro 1 h / Starter 4 h / Free 24 h; abuse reports 24 h) run Sun–Thu 9h–18h Africa/Algiers; the UI shows "heures ouvrées". `Agent.businessHours` (merchant opening hours for the `out_of_hours` message) is a separate, per-agent setting. |
