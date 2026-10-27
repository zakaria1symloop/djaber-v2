# 13 — Acceptance tests

One scenario per rule; IDs `AT-<area>-nn`. Columns: scenario (Given / When / Then), covers (spec IDs), level (U unit · I integration · E e2e · V AI eval · C contract · M migration). The CI gate: all U/I/C green on every PR; E/V nightly and before release; M before cut-over.

## Auth & workspace

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-AUTH-01 | Sign up with valid data ⇒ user, owned workspace (owner), `Subscription(status=trial, plan=pro, billingCycle=none, provider=none, trialEndsAt=+14 d)`, `CreditLedger(action=grant, kind=credit, bucket=plan, credits=300)`, `Workspace.systemMessages` seeded (4 keys × 3 locales), verification mail; lands in onboarding step 1 | AUTH-01, FL-04, D60, D43 | E |
| AT-AUTH-02 | Sign up with existing email ⇒ 409 `AUTH_EMAIL_TAKEN` inline; nothing created | AUTH-01 | I |
| AT-AUTH-03 | Wrong password and unknown email return identical error and timing ±50 ms | AUTH-02 | I |
| AT-AUTH-04 | 6th failed login in 15 min ⇒ 429 with retryAfter; UI countdown | AUTH-08 | I/E |
| AT-AUTH-05 | Refresh token reused after rotation ⇒ whole family revoked; next request 401; with `REFRESH_COOKIE_CROSS_SITE=true` the refresh cookie is `SameSite=None; Secure; Partitioned` (default `SameSite=Lax`) | AUTH-02 | I |
| AT-AUTH-06 | Reset link: valid ⇒ form; used twice ⇒ invalid; after 61 min ⇒ expired; success logs in and revokes other sessions | AUTH-03/04 | E |
| AT-AUTH-07 | 2FA enabled ⇒ login returns `mfaToken`; verify with code ⇒ tokens; expired/second use of `mfaToken` ⇒ 401; recovery code works once and regeneration needs password; Super Admin disable ⇒ `TWO_FA_REQUIRED_FOR_ROLE` | AUTH-05 | I |
| AT-AUTH-08 | Unverified account (day 0) cannot connect a channel (`AUTH_EMAIL_UNVERIFIED`, resend dialog); everything else works; reminder e-mail sent at day 7 | AUTH-09, D32 | I |
| AT-AUTH-09 | Owner invites operator; operator accepts; operator cannot delete an order (403, button hidden); at `maxMembers` (members + pending invitations) the invite is refused `403 PLAN_LIMIT {resource: members}` and the invite buttons are greyed with that reason | FL-13, 02 §3 | E |
| AT-AUTH-10 | Removing or demoting the Owner is blocked (`OWNER_IMMUTABLE`); the only way to change the Owner is `POST /workspaces/:id/transfer-ownership` (AT-OWN-transfer); invited user signing up owns no workspace and can later `POST /workspaces` once | FL-13, D30, D51 | I |
| AT-AUTH-11 | Every resource GET/PATCH/DELETE with an id from another workspace ⇒ 404 (table-driven over all endpoints) | 02 §1 | I |
| AT-AUTH-12 | Workspace deletion: `Workspace.status=deletion_scheduled` (+30 d), channels disconnected, AI stops, every mutation by a member ⇒ `409 WORKSPACE_DELETION_SCHEDULED {at}` (reads allowed, Owner may cancel), purge job after 30 d | FL-14 | I |

## Channels & intake

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-CHN-01 | OAuth with tampered/expired state ⇒ `OAUTH_STATE_INVALID`; nothing stored | CHN-01 | I |
| AT-CHN-02 | Callback with 3 pages (one without MESSAGING task, one connected elsewhere) ⇒ report connected / skipped ×2 with codes; linked IG becomes child channel | CHN-01/02 | I (recorded Meta) |
| AT-CHN-03 | Plan maxPages=1, 2 pages granted ⇒ second skipped `PLAN_LIMIT` | CHN-10 | I |
| AT-CHN-04 | Graph returns 190 on send ⇒ channel `needs_reconnect`, notification, AI stops; reconnect restores | CHN-04 | I |
| AT-CHN-05 | IG token `expiresAt` in 9 d ⇒ refresh job refreshes; refresh fails ⇒ `needs_reconnect` | CHN-12 | I |
| AT-CHN-06 | Disconnect ⇒ Meta unsubscribe called, token cleared, agent link removed, history readable | CHN-06 | I |
| AT-MSG-01 | Webhook with bad signature ⇒ 401, nothing stored; good ⇒ 200 < 200 ms, event persisted | MSG-01 | I |
| AT-MSG-02 | Same `mid` delivered twice ⇒ one Message, one reply | MSG-03 | I |
| AT-MSG-03 | Three messages within 3 s ⇒ one AI reply answering all three | MSG-05 | I |
| AT-MSG-04 | Video only ⇒ unsupported-media message once; second video in 24 h ⇒ silent | MSG-09 | I |
| AT-MSG-05 | Transactional notification > 24 h after last customer message ⇒ `skipped_window` on FB (Meta retired `POST_PURCHASE_UPDATE` on 2026-04-27) and on IG, thread label shown | MSG-06 | I/E |
| AT-MSG-06 | AI reply send fails with 10/2018278 ⇒ no tag retry, message `failed`, conversation `needs_human` | MSG-06, FL-01 F-7 | I |
| AT-MSG-07 | Meta data-deletion request ⇒ all conversations of that sender hard-deleted, status URL returns done | MSG-08 | I |

## AI pipeline

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-AI-01 | Customer writes darija in Arabic script ⇒ reply in Arabic script; arabizi ⇒ Latin; FR ⇒ FR (fixtures ×20) | AI-01 | V |
| AT-AI-02 | Catalogue of 200 products: question about "robe satin" ⇒ `search_products` called; reply cites only real products | AI-02 | V |
| AT-AI-03 | Model returns malformed JSON ⇒ one retry; still malformed ⇒ no customer message, insight `error`, conversation `needs_human` | AI-03, FL-01 F-6 | I |
| AT-AI-04 | Full order flow: variant asked, phone "0555 12 34 56" normalised, invalid phone re-asked, fee quoted, recap, "نعم" ⇒ order `new` source ai, stock decremented, notification, 1 credit (text) charged, 0 for order | AI-05, FL-02, 02 §6 | V/I |
| AT-AI-05 | `ai-reply` job crashes after `create_order` executed, before send ⇒ retry replays tool result, **one** order, one send | 04 §5, FL-01 | I |
| AT-AI-06 | Same customer confirms identical cart twice within 10 min ⇒ existing order returned | 04 §5 | I |
| AT-AI-07 | "annuler ma commande" with one open order ⇒ confirm then cancelled, stock restored; with a shipped order ⇒ handoff | AI-04, FL-02 F-5 | V/I |
| AT-AI-08 | Photo of a catalogue product (fixtures ×10) ⇒ correct product with confidence ≥ 0.7; non-catalogue photo ⇒ confirmation question, no price | AI-06 | V |
| AT-AI-09 | Voice note (fixtures FR/darija) ⇒ transcript stored, relevant reply, 3 credits; Groq down ⇒ OpenAI used; both down ⇒ `voiceFailed` message, 0 credits | AI-07 | V/I |
| AT-AI-10 | Handoff rule "if customer mentions refund" ⇒ status HANDOFF, `needs_human`, workspace `handoff` system message once, notification `conversation.handoff` | AI-08 | V/I |
| AT-AI-11 | Product card template set ⇒ reply text follows template; cards sent | AI-09 | V |
| AT-AI-12 | Provider 500 ⇒ fallback model used; both fail ⇒ no charge, insight error; a model answering 400 "`temperature` is deprecated" ⇒ same call retried without `temperature`, and the next call to that model goes without it at once (one request); every tool schema has no top-level `anyOf` / `oneOf` / `allOf` | AI-10 | I |
| AT-AI-13 | Archived product mentioned in cart ⇒ dropped with message; never in cards | AI-14 | V/I |
| AT-AI-14 | Credits at 1, message with text + image (per-turn cost = highest = 5) ⇒ no run, unavailable message once, `needs_human`, Owner notified; next message same day silent | FL-01 F-4, 02 §6 | I |
| AT-AI-15 | 51 inbound messages in 10 min ⇒ handoff, AI silent | FL-01 F-8 | I |
| AT-AI-16 | Playground: 61st turn in an hour ⇒ `PLAYGROUND_RATE_LIMITED`; dry-run order never persisted; 0 credits | AGT-07 | I |

## Inbox

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-INB-01 | Two browsers on the same thread: message arrives ⇒ both show it < 2 s; read mark on one clears unread on the other | INB-07 | E |
| AT-INB-02 | Human reply ⇒ AI paused banner; customer replies ⇒ AI silent, push to assignee; Resume ⇒ AI answers next message; on a page without agent (and no agent ever answered) the pause / resume menu items are greyed with `CONVERSATION_NO_AGENT` (`pageHasAgent=false`) | INB-04, FL-03 | I/E |
| AT-INB-03 | Reply outside 24 h on IG — and on FB while `META_HUMAN_AGENT_TAG` is off — ⇒ `REPLY_OUTSIDE_WINDOW` inline, text kept; FB with the approval ⇒ `HUMAN_AGENT` tag up to 7 days | FL-06 F-1 | I |
| AT-INB-04 | Image 6 MB ⇒ inline error; 4 MB ⇒ sent as attachment with public URL | INB-03 | I |
| AT-INB-05 | Teammate resolves while I edit ⇒ WS updates; my stale PATCH ⇒ 409 dialog | FL-06 F-3 | I/E |
| AT-INB-06 | WS disconnected 60 s ⇒ polling fallback; reconnect resyncs missed events | FL-06 F-4 | E |
| AT-INB-07 | Manual replies after reload are labelled with the author's name, not AI | INB-02 | E |

## Catalogue & stock

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-CAT-01 | Create product selling 0 ⇒ `validation.price`; selling < cost ⇒ saved with warning; SKU equal to a variant SKU ⇒ 409 | CAT-01, 04 §2 | I |
| AT-CAT-02 | Service product (trackStock=false): stock null, excluded from dashboard value, valuation, dead stock; adjustment ⇒ `PRODUCT_NOT_STOCK_TRACKED`; order line never decrements | CAT-01, GDS-10 | I |
| AT-CAT-03 | Variant product: product stock = Σ active variants; product-level adjustment ⇒ `PRODUCT_HAS_VARIANTS`; order line without variant ⇒ `VARIANT_REQUIRED`; variant below min ⇒ low-stock alert | CAT-03, CAT-09 | I |
| AT-CAT-04 | 11th image ⇒ `IMAGES_LIMIT`; delete primary ⇒ next becomes primary; caption generated | CAT-02 | I |
| AT-CAT-05 | Import file with 3 bad rows ⇒ preview shows row errors; commit writes only valid rows in one transaction; mid-failure ⇒ nothing written; plan limit respected | CAT-06, FL-12 | I/E |
| AT-CAT-06 | Delete category in use ⇒ dialog with reassign; after reassign deleted | CAT-04 | E |
| AT-CAT-07 | Archive product used by an agent ⇒ removed from grounding and recommendations; order history intact | CAT-10, AI-14 | I |
| AT-CAT-08 | Low-stock crossing ⇒ one notification per day max; `stock.low` webhook once | CAT-09 | I |

## Clients

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-CLI-01 | AI collects phone of an existing client while conversation is linked to a placeholder ⇒ placeholder merged, identity re-pointed, orders/conversation on the owner, aggregates recomputed | CLI-02 | I |
| AT-CLI-02 | Create client with "+213 555 12 34 56" when "0555123456" exists ⇒ `CLIENT_PHONE_EXISTS` with "use existing"; e-mail " Amel@Mail.DZ " stored `amel@mail.dz` (web shows it formatted on blur), blank e-mail / phone 2 ⇒ `null`, malformed e-mail ⇒ 422 inline | CLI-01, 04 §2 | I/E |
| AT-CLI-03 | Delete client with orders ⇒ `CUSTOMER_HAS_ORDERS`, archive ⇒ soft; orders still show the name; list hides it | CLI-05 | I |

## Orders & money

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-ORD-01 | Transition table: every (from, to) pair — allowed pairs succeed with history row, others 422 `ORDER_INVALID_TRANSITION`; terminal ⇒ `ORDER_TERMINAL` | 04 §1.2 | U |
| AT-ORD-02 | `confirmed → delivered` by operator (self-delivery) ⇒ allowed; COD unpaid ⇒ amountPaid = total, paid, cash income = total "(COD - delivered)" | D14, 04 §1.4, §3 | U/I |
| AT-ORD-03 | Call "rejected" on `new` + not sent ⇒ cancelled + stock restored + cash rows removed; on `shipped` ⇒ logged, unchanged, warning | 04 §1.3 | I |
| AT-ORD-04 | Call "picked_up" without address ⇒ dialog blocked `ORDER_ADDRESS_REQUIRED`; with address ⇒ confirmed | 04 §1.6 | E |
| AT-ORD-05 | Cancel after partial payment ⇒ amountPaid 0, auto cash rows removed, manual rows kept | 04 §3 | I |
| AT-ORD-06 | Returned ⇒ stock restored only after "return received"; cash income removed; expense `shipping` = returnPrice | 04 §3, D27 | I |
| AT-ORD-07 | Delete delivered ⇒ `ORDER_DELETE_DELIVERED`; delete shipped with manual shipment ⇒ rollback then deleted; with an active courier parcel ⇒ `409 DELIVERY_ORDER_ALREADY_SENT` | ORD-08, 04 §9 | I |
| AT-ORD-08 | Two users change status simultaneously ⇒ one 409; no double side-effects | 04 §11 | I |
| AT-ORD-09 | Fee: wilaya 16 home 400, stop-desk 250; threshold 5000 and subtotal 6000 ⇒ 0; inactive wilaya ⇒ `WILAYA_NOT_SERVED`; Admin override saved | 04 §4, DLV-01/02 | U/I |
| AT-ORD-10 | Revenue figures: sale 1000 + delivered order 2000 + pending order 500 ⇒ Revenue 3000, Pipeline 500, AI revenue only AI orders — identical in home, analytics, reports | 04 §4 | I |
| AT-ORD-11 | P&L: purchase paid 800 (cash expense) and COGS 600 ⇒ net uses COGS, not both | 04 §4 | U |
| AT-ORD-12 | Bulk status on 3 orders, one invalid ⇒ 200 with 2 ok + 1 error; UI per-item dialog | 06 §1 | I/E |
| AT-ORD-13 | Export 6 000 orders ⇒ job; download XLSX with locale columns | ORD-09 | I |
| AT-ORD-14 | Phone with 3 cancelled orders in 30 d ⇒ new order `riskLevel=high` badge | ORD-12 | I |
| AT-ORD-15 | Order filter Status is the tab; URL carries filters; KPI tiles follow filters | ORD-05, 08 §1 | E |

## Delivery (P2)

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-DLV-01 | Send from `new` ⇒ `DELIVERY_ORDER_NOT_CONFIRMED`; from `confirmed` ⇒ parcel created with the order's wilaya/commune/stop-desk (never sender default), tracking stored, order shipped, customer message; an order to a wilaya 59–69 (e.g. 68 Bou Saâda) is sent to the courier under its parent code and name (28 M'Sila) with the real commune name; a wilaya 59–69 without a courier rate takes its parent's rate | DLV-05, FL-08 | C/I |
| AT-DLV-02 | Courier returns validation error (bad commune) ⇒ inline on dialog field, order unchanged | FL-08 F-2 | C |
| AT-DLV-03 | Courier 503 ⇒ shipment pending, retries per schedule, notification after final failure, manual retry | FL-08 F-3 | I |
| AT-DLV-04 | Status mapping tables (ZR, EcoTrack, Yalidine): every known raw status → mapped; unknown ⇒ unchanged + event | DLV-04 | U/C |
| AT-DLV-05 | Polling cadence: new shipment polled every 2 h for 3 d, then 12 h, stale at 30 d; batch endpoint used when available; per-account limiter respected | DLV-04 | I |
| AT-DLV-06 | Courier reports delivered ⇒ order delivered + COD rule; reports returned after delivered ⇒ parcel returned ("retour en cours"), order returned once the merchant confirms reception ("Marquer retournée") | 04 §1.5 | I |
| AT-DLV-07 | Second shipment after a cancelled one ⇒ allowed; two active ⇒ `DELIVERY_ORDER_ALREADY_SENT` | DLV-10 | I |
| AT-DLV-08 | ZR label ⇒ `LABEL_UNAVAILABLE` + Djaber fallback PDF; merged labels for 10 orders | DLV-06 | I |

## Billing & credits

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-BIL-01 | Chargily webhook unsigned ⇒ 401; signed twice ⇒ one activation; `GET /billing/checkout/return?ref=` replay ⇒ no-op; amount mismatch ⇒ not activated + admin alert; return page `/settings/billing/return` shows pending then success when the webhook is late; `PaymentGateway` resolves to `ChargilyGateway` (`PAYMENT_PROVIDER=chargily`), no other implementation registered | BIL-02, FL-09, D4 | I/E |
| AT-BIL-02 | Subscription expires ⇒ paid row `expired`, free row `active` same instant; 3 channels with free max 1 ⇒ 2 newest paused, notification; no read-only; renew ⇒ un-paused | 02 §5 | I |
| AT-BIL-05 | Yearly plan: credits and conversation quota reset every month on the period day; free plan period advances monthly | 02 §6 | I |
| AT-BIL-03 | Credits reservation: job start reserves 5 (image); provider error ⇒ released; success ⇒ debit 5 | 02 §6 | I |
| AT-BIL-04 | maxConversationsPerMonth reached ⇒ new conversation gets unavailable message once, inbox works | 02 §5 | I |

## Notifications, Sheets, API

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-NTF-01 | Every row of the NTF matrix fires the listed channels respecting preferences (table-driven) | 03 §15 | I |
| AT-NTF-02 | Customer writes into a needs-human conversation 3× in 5 min ⇒ one push | 03 §15 | I |
| AT-GSH-01 | Order created ⇒ row appended within 10 s; status change ⇒ same row updated even after the sheet was re-sorted; token revoked ⇒ status error + notification | GSH-04/07 | C/I |
| AT-API-01 | Key with `orders:read` calling `POST /orders` ⇒ 403 `API_SCOPE_FORBIDDEN`; `GET /billing/*` ⇒ 403 always | 06 §5 | I |
| AT-API-02 | Outbound webhook endpoint failing 50× ⇒ disabled + notification; replay works | API-03 | I |

## Web UX (every screen)

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-UX-01 | For each screen in 12: loading, empty, filtered-empty, error states render (storybook snapshot) | 12 | E |
| AT-UX-02 | i18n: no missing keys fr/ar/en (CI); RTL snapshot of shell, inbox, orders, product form | 08 §1 | I/E |
| AT-UX-03 | No dead controls: every rendered button either performs an action or is disabled with a tooltip (lint rule + e2e crawl) | 08 §1 | E |
| AT-UX-04 | Form error from server renders inline inside the open dialog; content preserved | 11 §10 | E |
| AT-UX-05 | Get Started steps reflect real entities (agent step false until an active agent is linked) | ONB-02 | E |

## Migration

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-MIG-01 | Dry-run on anonymised V1 copy: per-table counts match (minus rejected with reasons); Σ order totals and Σ tracked stock per workspace equal; untracked products stock null; duplicate phones merged with report; legacy numbers preserved and counter = max+1 | 05 §10 | M |
| AT-MIG-02 | After cut-over, a Meta webhook for a migrated page is processed by v2 (same app id) | D13 | M |

## P1 coverage completion (CF-11)

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-ONB-01 | Close browser at step 3 ⇒ next login resumes at step 3; every step skippable; Ready shows done/skipped. Step 3 shows name / price / stock / photo only (no category, no import / extraction link) and "Remplir avec l'IA" opens "Créer depuis une photo"; going back from step 5 to step 3 ⇒ the product created earlier is shown ("Continuer" / "Ajouter un autre produit") and the saved step stays 5; step 4 with an agent created earlier ⇒ "Continuer avec « nom »", no card preselected; "Partir de zéro" ⇒ wizard steps 1–3 inside the tunnel, then `/onboarding/connect` at step 5; step 6 without agent ⇒ "Tester mon agent" disabled with its reason | ONB-01, FL-04 F-3, 04 §25 | E |
| AT-ONB-02 | Switch stock mode to simple ⇒ confirmation dialog (nothing deleted) then web sidebar and mobile nav hide the advanced items; API still serves them; simple → advanced is one click | ONB-03, D12 | E |
| AT-CHN-07 | IG Business Login with pending approval ⇒ `PAGE_INSTAGRAM_PENDING_APPROVAL` state with instructions; after approval ⇒ channel active | CHN-03 | I |
| AT-CHN-08 | Page connected in A, connect in B ⇒ `PAGE_ALREADY_CONNECTED_ELSEWHERE`; Super Admin release ⇒ B can connect | CHN-05, ADM-02 | I |
| AT-CHN-09 | Page overview with insights error ⇒ `INBOX_INSIGHTS_UNAVAILABLE` card; counts still shown | CHN-07 | E |
| AT-CHN-10 | Analysis without `pages_read_engagement` and without `pages_read_user_content` ⇒ permission state + reconnect; with either of them (the live set `pages_show_list, pages_messaging, pages_read_engagement` included) ⇒ job progress, review grid validation (price > 0, qty > 0), import creates products with `FB-` SKUs; 4th run today ⇒ rate-limited | CHN-08 | I/E |
| AT-CHN-11 | Sync imports ≤ 25 conversations × 25 messages; existing messages skipped; token error ⇒ `PAGE_SYNC_TOKEN_EXPIRED` | CHN-09 | I |
| AT-CHN-12 | OAuth refused ⇒ "connection cancelled", nothing stored; same page reconnected ⇒ token updated, no duplicate; a pop-up that reports `closed` while the merchant is on Meta does **not** cancel (waiting dialog stays, "Annuler" available); a pop-up without opener lands on `/channels/connect/return`, hands the report over the `BroadcastChannel` and the starting window shows it (no ack in 1.5 s ⇒ same-tab return); `META_FACEBOOK_SCOPES` set ⇒ the dialog URL asks exactly those permissions; `META_OAUTH_CALLBACK_PATH` ⇒ `redirect_uri` uses it | FL-05 F-1/F-6, CHN-01 | I/E |
| AT-MSG-08 | Each inbound type (image, audio, video, file, location, sticker, postback) stored with the right attachment type and rendered in the thread | MSG-02, INB-02 | I/E |
| AT-MSG-09 | AI reply mentions 7 products ⇒ 5 cards sent | MSG-07 | I |
| AT-INB-08 | New customer message on a resolved conversation ⇒ `active`, AI answers; on archived ⇒ `active` | INB-05 | I |
| AT-INB-09 | First human reply auto-assigns; reassign; note not sent to customer | INB-06 | I |
| AT-INB-10 | Client panel shows client + orders; "create order" prefills client; placeholder client prompts completion | INB-08 | E |
| AT-INB-11 | Admin deletes a conversation ⇒ hidden for everyone, data kept; Operator has no delete | INB-09, 02 §3 | I |
| AT-INB-12 | Tabs show server counts from `/conversations/counts`; search matches phone | INB-01 | I/E |
| AT-INB-13 | Channel `needs_reconnect` ⇒ composer disabled with reason; reading works | FL-06 F-5 | E |
| AT-AGT-01 | List shows active / paused / paused-by-plan; "New agent" always visible; at limit ⇒ plan dialog | AGT-01 | E |
| AT-AGT-02 | Create from each of the 4 presets ⇒ fields match the preset table; wizard step validation (name ≤ 100, instructions ≤ 10 000) | AGT-02 | I/E |
| AT-AGT-03 | Generate from page ⇒ job, review, "apply to new agent" creates one; "update linked agent" asks confirmation; other agents untouched | AGT-03 | I/E |
| AT-AGT-04 | Linking a channel already linked to agent B ⇒ move dialog; confirm ⇒ B loses it; cancel ⇒ unchanged | AGT-05 | I/E |
| AT-AGT-05 | Delete agent with open needs-human conversations ⇒ conversations kept, pending insights dismissed, channels unlinked | AGT-04, 04 §9 | I |
| AT-AGT-06 | Toggle image recognition off ⇒ image messages dropped to text / unsupported reply; voice off ⇒ voice reply | AGT-06, FL-01 step 7 | I |
| AT-AGT-07 | Insight "add to instructions" appends `- …` to customInstructions; resolve/dismiss filters | AGT-08 | I |
| AT-AGT-08 | Agent metrics for a period match counted conversations, AI orders, credits; `lastActiveAt` updates on each run | AGT-09 | I |
| AT-AI-17 | Every AI turn writes an AiRun with tokens, latency, tool calls; playground run kind `test` | AI-11 | I |
| AT-AI-18 | Typing indicator sent at window start and before generation | AI-12 | I |
| AT-AI-19 | "وين الطلبية ديالي؟" ⇒ `get_order_status` lists the client's open orders with courier status; none ⇒ says so | AI-13 | V/I |
| AT-CAT-09 | Adjust stock on a variant product at product level ⇒ `PRODUCT_HAS_VARIANTS`; on a variant ⇒ movement with variant; set-exact computes delta; reason required | CAT-05 | I |
| AT-CAT-10 | "Create from photo" fills only empty name/description/category/unit; never price | CAT-07 | I |
| AT-CAT-11 | Product list filters (category multi, ranges, low stock, active) and sorts return correct sets; `?lowStock=1` deep link preselects | CAT-08 | I/E |
| AT-CAT-12 | Services list shows only `trackStock=false` products | CAT-11 | E |
| AT-CAT-13 | Restore an archived product whose SKU was reused ⇒ `PRODUCT_SKU_ALREADY_EXISTS` | CAT-10 | I |
| AT-CLI-04 | Client list paginated, filters (source, tags, dates, ranges) and search by phone fragment | CLI-03 | I |
| AT-CLI-05 | Aggregates: delivering an order and recording a sale update orderCount/totalSpent/lastOrderAt; cancelling recomputes | CLI-04 | I |
| AT-ORD-16 | First order ⇒ `CMD-1001`; after migration with `ORD-20260101-0042` ⇒ counter continues; `orderedAt` back-dated 2 days ⇒ accepted, +2 days ⇒ rejected | ORD-01, 04 §10 | I |
| AT-ORD-17 | Manual order as `confirmed` without address ⇒ `ORDER_ADDRESS_REQUIRED`; with address ⇒ created confirmed with history row | ORD-02, 04 §1.2 | I |
| AT-ORD-18 | Call outcomes no_answer/busy/voicemail ⇒ `confirmationStatus=no_answer`, attempts +1, status unchanged | ORD-04 | I |
| AT-ORD-19 | Order page: contact edit validates phone; wilaya/commune shown; history lists actor and reason; delivered order shows read-only fields with Mark returned (Admin only) | ORD-06 | E |
| AT-ORD-20 | Confirm dialog result step: "Prepare" ⇒ preparing; "Send to courier" enabled only when a courier exists (tooltip otherwise) | ORD-07 | E |
| AT-ORD-21 | IG and FB AI orders identical except channel badge | ORD-11 | I |
| AT-ORD-22 | Payment: amountPaid 300 of 1000 ⇒ partial; `paymentStatus` sent without amount ⇒ 422 | PAY-01, 04 §1.4 | I |
| AT-DLV-09 | Fee seed creates 69 rules from the default table (59–69 = their parent's default fee); "fill missing" keeps custom; "reset all" overwrites after confirm; the 2026-10-15 migration copies each workspace's parent row to 59–69 and moves open orders / addresses with their commune (idempotent) | DLV-01 | I/E |
| AT-DLV-10 | Communes seeded; `validation.commune` rejects a commune from another wilaya | DLV-09, 04 §2 | I |
| AT-NTF-03 | Notification list filters by each type; unread count equals server count; deep link opens the target screen (web and mobile) | NTF-01 | E |
| AT-NTF-04 | Member disables email for `stock.low` ⇒ only in-app; push sound setting | NTF-02 | I |
| AT-NTF-05 | Invalid FCM token pruned after failure; 21st `POST /me/devices` ⇒ `422 DEVICE_LIMIT {max: 20}`; `DELETE /me/devices/:token` frees a slot | NTF-03, 14 MOB-R07 | I |
| AT-ANA-01 | Home KPIs equal the named figures; queue lists needs-human + insights; À traiter includes failed parcels, low stock, reconnect | ANA-01 | E |
| AT-BIL-06 | Plans page shows limits; checkout redirect; invoices list; cancel at period end sets `cancelledAt`, access continues to period end | BIL-01/03/05 | E |
| AT-BIL-07 | Credits ledger shows reserved/debit/release rows; calculator estimates per plan | BIL-04 | E |
| AT-SET-01 | Quick replies CRUD + reorder (`PATCH /workspace/quick-replies/order { ids[] }`); the 4 system messages (`handoff`, `out_of_hours`, `out_of_stock`, `welcome`) edited per locale via `PUT /workspace/system-messages` and used as in AT-SYS-messages; "réinitialiser" restores the 3 default locales of one key; handoff reminder 0 disables the Owner reminder | SET, 04 §5, D43, FL-03 F-1 | I/E |
| AT-DEL-01 | Disconnect channel ⇒ unsubscribe, token cleared, agent unlinked, conversations readable; member removed ⇒ sessions revoked, assignments cleared | 04 §9 | I |
| AT-DAT-01 | Period "today" and `to` date use Africa/Algiers end of day; order number date uses local date | 04 §8, §10 | U |
| AT-FL-01 | FL-05 F-3 invalid state; FL-07 F-2 phone conflict suggests existing client; FL-07 F-6 Operator cannot edit fee (hidden + 403); FL-09 F-1 payment failed return page; FL-12 missing columns state; FL-14 deletion flow and e-mail; FL-15 partial analysis results kept | 10 | E |


## Figma-driven additions (2026-10-06) — modules 03 §23–37, rules 04 §12–24, flows FL-16–31, states 12 §16–28

### Moderation, safety, support

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-MOD-01 | Create a product (standard trust, non-sensitive) with pre-screen score 0.95 ⇒ `approved` at once, visible to the AI; score 0.6 ⇒ `pending`, absent from `search_products`, cards, recommendations; list pill EN ATTENTE | MOD-01/02, 04 §12 | I |
| AT-MOD-02 | Edit only `stock` / `minStock` / SKU / cost of an approved product or of its variants ⇒ no `ModerationItem`; edit price from 4 000 to 1 800 (−55 %) ⇒ item created and the previous snapshot keeps selling (IA column ANCIENNE VERSION, AI quotes the old price) | MOD-01, 04 §12 | I |
| AT-MOD-03 | Sensitive category (electronics) with score 0.99 and trusted merchant ⇒ still human queue; `new` merchant with 0.95 ⇒ human queue | 04 §12 | U |
| AT-MOD-04 | Moderator rejects without message ⇒ `MODERATION_REASON_REQUIRED`; with reason ⇒ product hidden, `product.rejected` in-app + e-mail + push, rejected view highlights title / image 1 / price | MOD-04/07, FL-16 | I/E |
| AT-MOD-05 | Appeal once ⇒ `appealed`, routed to a different moderator, decision < 24 h, `moderation.appeal_result`; second appeal ⇒ `MODERATION_APPEAL_ALREADY_USED`; appeal on day 8 ⇒ `MODERATION_APPEAL_WINDOW_EXPIRED` | MOD-05, FL-16 F-1/F-2 | I |
| AT-MOD-06 | Two moderators decide the same item ⇒ second gets `MODERATION_ITEM_ALREADY_DECIDED`, panel refreshes | FL-16 F-3 | I/E |
| AT-MOD-07 | 3 counterfeit rejections in 90 d ⇒ `trustLevel=watch`, next product with score 0.99 goes to the human queue; ADM-01 shows "suspension proposée" at 5 | 04 §12 | I |
| AT-MOD-08 | SLA: item created 09:00 Sunday ⇒ `slaDueAt` 11:00; created 17:30 ⇒ due next business day 10:30; past due ⇒ urgent, red, ADM-01 alert | 04 §12 | U |
| AT-MOD-09 | CSV import of 118 rows by a trusted merchant ⇒ 118 items, non-sensitive auto-approved, sensitive pending, list banner "n produits en attente"; customer asks the AI for a pending product ⇒ "pas disponible pour le moment", no card | MOD-01, FL-16 F-6/F-8 | V/I |
| AT-MOD-10 | Pre-screen job fails ⇒ item pending with `aiScore=null` and flag "pré-filtrage indisponible" in the queue | FL-16 F-5 | I |
| AT-MOD-11 | Platform blocked word « motinterdit »: a variant « Bleu MotInterdit » or the keyword « motinterdit » (trusted merchant) ⇒ item `rejected` at once (no reviewer, `decision = prohibited`, `rejectedFields = [variants]` / `[keywords]`, reason naming the word in the shop's language), product hidden from the AI, `product.rejected` sent, nothing in the human queue; « motinterdits » (inside another word) ⇒ `pending` with flag `blocked_word` | 04 §12 (UX-034) | I |
| AT-MOD-12 | Trusted merchant adds a clean variant « Bleu » to an approved product ⇒ `pending` with flag `new_variant` (score ≥ 0.9), the AI keeps selling the approved variants until a moderator approves; a product created with its variants is still auto-approved | 04 §12 (UX-034) | I |
| AT-SAFE-01 | Operator blocks a customer from the inbox ⇒ thread under "Bloqués", removed from Queue/Home, customer message stored without notification, AI silent, `create_order` tool ⇒ `CUSTOMER_BLOCKED`; Operator cannot unblock (403), Admin can | SAFE-01, 04 §13 | I/E |
| AT-SAFE-02 | Manual order for a blocked client ⇒ warning + `confirm=true` required; without ⇒ 409 `CUSTOMER_BLOCKED` with data | 04 §13, cross-cutting | I |
| AT-SAFE-03 | Report dialog with "Bloquer aussi" ⇒ `Report(open)` with 10-message masked extract + `CustomerBlock`; acknowledgement toast + e-mail; moderator "Liste noire plateforme" ⇒ `CustomerBlock(source=platform)` visible with PLATEFORME 🔒 in every workspace, merchant unblock ⇒ `CUSTOMER_BLOCKED_BY_PLATFORM`; reporter gets `report.resolved` | SAFE-02/04/07, FL-17 | I/E |
| AT-SAFE-04 | Same reporter reports the same client twice ⇒ `ABUSE_REPORT_ALREADY_OPEN`; 21st report of the day ⇒ `ABUSE_REPORT_RATE_LIMITED`; own workspace ⇒ `ABUSE_REPORT_SELF` | 04 §13 | I |
| AT-SAFE-05 | AI reply containing a blocked word ("arnaque" in the workspace list) ⇒ never sent, workspace `handoff` system message instead, insight error `blocked_word`, 0 credits; inbound with the word ⇒ thread marker only | SAFE-06, 04 §13 | V/I |
| AT-SAFE-06 | Phone blocked by 3 workspaces within 7 d ⇒ system `Report` proposing blacklist; 3 end-customer reports of a merchant in 30 d ⇒ "revue de l'espace" report; 5 AI-message reports on one agent ⇒ preset alert | 04 §13, FL-17 F-4/F-5 | I |
| AT-SAFE-07 | Auto-rules: 2 returned orders ⇒ `riskLevel=high`; 3 unclaimed parcels with auto-block ON ⇒ `CustomerBlock(auto)` + `customer.auto_blocked` cancellable 24 h; risk client with handoff rule ⇒ `needs_human` | SAFE-05 | I |
| AT-HELP-01 | "Aide" opens the in-app center with CMS help entries in the user's locale (AR RTL); "?" panel lists the guides of the current page | HELP-01, D46 | E |
| AT-HELP-02 | Contact form < 20 chars ⇒ inline error; valid ⇒ `SupportTicket(status=open)` with an auto-context `SupportMessage` (no customer messages), toast, "Mes demandes" row; Operator sees no "Facturation" category (API 403); Operators see only their own tickets, Admin+ all (`support.read_all`) | HELP-03, FL-18 F-1/F-3 | I/E |
| AT-HELP-03 | Support replies ⇒ `firstResponseAt`, `support.reply` in-app + e-mail (push on mobile), `status=pending_customer`; merchant replies ⇒ `open`; resolve ⇒ `resolved` + satisfaction prompt stored; 30 d after `resolvedAt` the daily job sets `closed`; reply on a `closed` ticket ⇒ `TICKET_CLOSED` | HELP-04/05, FL-18 | I/E |
| AT-HELP-04 | SLA: Pro ticket at 10:00 ⇒ due 11:00; Free ⇒ next business day; overdue ⇒ pill DÉPASSÉ DE n + ADM-01 alert + sorted first | HELP-05, 04 cross-cutting | U/I |

### Platform settings, jobs, public pages

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-PFS-01 | Mobile with `X-App-Version 2.0.9` and `AppVersion.minVersion 2.1.0` ⇒ every call 426 `APP_UPDATE_REQUIRED {minVersion, storeUrl, message}`; 2.2.0 with `recommendedVersion 2.3.0` ⇒ 200 + `X-App-Update: recommended` banner dismissible 7 d | PFS-01, 04 §15 | I/E |
| AT-PFS-02 | Force update dialog without 2FA code ⇒ `TWO_FA_CONFIRMATION_REQUIRED`; with code ⇒ `AppVersion.minVersion` saved, impact "n appareils", audit `app_version.force_update`, push `app.update_required`; `minVersion` above the published iOS version (`storeStatus ≠ published`) ⇒ blocked with warning | FL-21 | I/E |
| AT-PFS-03 | Flag `image_recognition_v2` at 20 % Pro ⇒ deterministic per workspace; disabled workspace calls the endpoint ⇒ `FEATURE_DISABLED`; feature not in plan ⇒ `PLAN_FEATURE_REQUIRED` | PFS-02, 04 §15 | I |
| AT-PFS-04 | Maintenance window active ⇒ GET 200, POST 503 `MAINTENANCE_MODE {until}`, banner; Meta webhook during the window ⇒ 200 stored unprocessed, replayed in order after; cron paused | PFS-03, FL-30 | I |
| AT-PFS-05 | Publish terms v5.0 (major) ⇒ users get `LEGAL_REACCEPT_REQUIRED` until acceptance (web interstitial + mobile); v5.1 (minor) ⇒ no prompt; acceptance stored with IP/UA; acceptance % on ADM-13 | PFS-04, FL-30 | I/E |
| AT-PFS-06 | Marking `instagram_manage_messages` approved ⇒ job activates pending IG channels, `channel.approved` notification, agents linked to them start answering | PFS-05, 04 §15 | I |
| AT-PFS-07 | Provider "Tester" states (testing / ok latency / rejected / unreachable) for every `PlatformProvider.key` (`chargily`, `email`, `sms`, `push`, `courier_zr`, `courier_ecotrack`, `courier_yalidine`, `google_oauth`) via `POST /admin/providers/:key/test`; SMS balance < 1 000 and APNs expiry < 30 d raise ADM-01 alerts | PFS-06 | I/E |
| AT-PFS-08 | Changing a default (trial days 14 → 30) creates a `PlatformSettingVersion` + audit row; new sign-ups get 30 d trial | PFS-07, 04 §15 | I |
| AT-OPS-01 | Queue page shows BullMQ counts; "Pause" stops consumers; "Rejouer" re-enqueues DLQ jobs with the same payload; Google 403 quota ⇒ `sheets-sync` auto-paused with INCIDENT state | OPS-01/02 | I/E |
| AT-OPS-02 | OpenAI error rate 4 % > threshold 2 % ⇒ routing uses the fallback ("bascule active" on ADM-06 and ADM-14), 0 duplicated orders over the replayed jobs | OPS-04, AI-10, 04 §5 | I |
| AT-OPS-03 | "Déclarer un incident" ⇒ status page entry (static page rebuilt), optional CMS banner shown with the right priority, Help widget shows INCIDENT; resolve ⇒ history row with duration and post-mortem | OPS-05/06, PUB-07 | I/E |
| AT-PUB-01 | Pricing page lists `Plan.isActive && visibleOnPricing` only (Agence hidden), yearly toggle shows −17 %, FAQ, CTA → sign-up with 14 d trial (`/signup?plan=&cycle=` shows the plan note; after onboarding the shell offers "Voir ce plan" once); visitors' "Contact" links are `mailto:` the support mailbox | PUB-02, D60 | E |
| AT-PUB-02 | Legal page `?lang=ar` without AR version ⇒ FR content + banner "non disponible en العربية"; unpublished slug ⇒ 404; admin signed preview link works 24 h; version history shows v3 → v4 diff | PUB-03 | E |
| AT-PUB-03 | Meta data-deletion status: unknown code ⇒ 404 INTROUVABLE; pending ⇒ EN COURS with date; done ⇒ TERMINÉ listing anonymised items | PUB-05, MSG-08 | I/E |
| AT-PUB-04 | Public deletion page: unknown e-mail ⇒ same "si un compte existe…" (timing ±50 ms); 4th request in an hour from one IP ⇒ `RATE_LIMITED` with the same neutral text; expired link ⇒ `ACCOUNT_DELETION_TOKEN_EXPIRED` page | PUB-06, DEL-01, FL-22 F-1/F-2 | I/E |
| AT-PUB-05 | Public tracking page `/s/:code` shows the mapped timeline only (no phone), "Signaler ce vendeur" creates `Report(reporterKind=end_customer)` | PUB-08, SAFE-09 | I/E |

### Billing, packs, promo, plans, dunning

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-PCK-01 | Mobile IAP `POST /credits/packs/iap/validate { platform, productId, receipt }`: valid receipt ⇒ +500 credits once (`CreditLedger(bucket=pack, action=pack_purchase, kind=credit)`), `Invoice(kind=credit_pack, method=google_play` or `app_store`, net 30 %)`, `credits.pack_purchased`; same receipt again ⇒ `IAP_RECEIPT_ALREADY_USED` (app treats as success); tampered ⇒ `IAP_RECEIPT_INVALID`; web-only pack id ⇒ `IAP_PRODUCT_UNKNOWN`; store API down ⇒ `IAP_STORE_UNAVAILABLE` and pending receipt polled later | PCK-01, FL-20 | I/C |
| AT-PCK-02 | Plan 5 000 exhausted + pack 500 ⇒ AI keeps answering from the pack; pill shows "0 plan · 500 packs"; `credits.exhausted` fires only when both are 0; pack rows never expire at period rollover | PCK-02, 04 §14 | I |
| AT-PCK-03 | Store refund notification ⇒ `CreditLedger(bucket=pack, action=store_refund, kind=debit)` −500, balance −120 ⇒ `CREDITS_NEGATIVE_BALANCE` on runs, `credits.negative`, red banner, customers get the fixed text `customer.unavailable` once per conversation / 24 h; admin grant +200 ⇒ AI resumes | PCK-03, FL-20 step 4 | I/E |
| AT-PCK-04 | Calculator: 1 200 conv × 4 msgs, 15 % photo, 8 % voice ⇒ 5 988 credits ⇒ suggests Pro + 1 Petit pack | PCK-05 | U |
| AT-PRM-01 | Promo validation matrix: unknown ⇒ `PROMO_INVALID`; out of window ⇒ `PROMO_EXPIRED`; max uses ⇒ `PROMO_LIMIT_REACHED`; reused by the same workspace ⇒ `PROMO_ALREADY_USED`; plan not in list ⇒ `PROMO_PLAN_MISMATCH`; second discount ⇒ `PROMO_NOT_STACKABLE`; subscription discount on mobile ⇒ `PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN`; credit code ⇒ ledger grant immediately | PRM-02, 04 §14 | I |
| AT-PRM-02 | `PARRAIN-xyz`: referee signs up, nothing credited; referee's first paid invoice ⇒ +300 both sides, once | PRM-01, 04 §14 | I |
| AT-PRM-03 | Support grants 1 200 credits ⇒ `ADMIN_CREDIT_GRANT_LIMIT {1000}`; finance ⇒ ok, Owner e-mail, audit `credits.grant` with reason | PRM-03, PRL-01 | I |
| AT-BIL-08 | Plan edit `maxPages 3 → 2`: workspace with 3 pages keeps them, connecting a 4th ⇒ `PLAN_LIMIT_GRANDFATHERED` (no pause); `Plan.version` +1; subscriber keeps old price until renewal; e-mail scheduled 30 d before | FL-19, 04 §14 | I |
| AT-BIL-09 | Create plan: duplicate slug ⇒ `PLAN_SLUG_TAKEN`; all limits 0 ⇒ validation error; delete with 2 subscribers ⇒ `PLAN_IN_USE 2` with migrate / archive; migrated subscribers switch at next period | FL-19 | I/E |
| AT-BIL-10 | Dunning (paid monthly subscription, `cancelAtPeriodEnd=false`, not renewed): J−7 ⇒ `subscription.expiring` (e-mail + in-app + push), `dunningStage=d_minus_7`, renewal `Invoice(kind=subscription, status=upcoming)` exists; J0 ⇒ invoice `unpaid`, `Subscription.status=dunning`, `dunningStage=d0`, Chargily payment link by e-mail + in-app `invoice.unpaid` (+ SMS when enabled), paid-plan limits still enforced; J+3 ⇒ second `invoice.unpaid`, `dunningStage=d_plus_3`; J+7 ⇒ `Subscription.status=expired`, `dunningStage=expired`, new free `Subscription(provider=none, status=active)`, free-plan limits, excess channels/agents paused by plan, banner "Plan expiré", `subscription.expired`; every GET and mutation still returns 200 (no read-only), `Workspace.status` stays `active` (never `WORKSPACE_SUSPENDED`), nothing deleted; `POST /billing/invoices/:id/pay` or manual payment with amount = remaining ⇒ `paid`, `status=active`, new period, pauses lifted at once; manual payment amount < remaining ⇒ invoice stays `unpaid`, `200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`; amount > remaining ⇒ `422 VALIDATION_ERROR` (`fields.amount = validation.range`, max = remaining); no credit-note record exists | 04 §14, D49, D71 | I |
| AT-BIL-11 | Deletion of a workspace with an unpaid invoice ⇒ `WORKSPACE_HAS_DEBT`; after payment ⇒ allowed | 04 §14/§16 | I |
| AT-BIL-12 | Checkout return page `/settings/billing/return?ref=`: `GET /billing/checkout/return?ref=` pending for 12 polls ⇒ EN ATTENTE then webhook ⇒ `payment.received` and Facturation updates; Chargily checkout `PAYMENT_EXPIRED` after 15 min ⇒ Recommencer; promo applied shows the prorata line; web pack purchase `POST /credits/packs/checkout { packId }` follows the same page | FL-28 | E |
| AT-BIL-13 | Sign-up ⇒ `Subscription(trial, pro, +14 d, 300 credits)`; day 15 ⇒ free plan rule (02 §5); "Créer un espace" by an invited user ⇒ same trial | D60, FL-04 | I |

### Platform roles, deletion, impersonation, audit

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-PRL-01 | Capability matrix table-driven: each `PlatformRole` (`super_admin`, `support`, `moderator`, `finance`, `read`) × each `admin.<area>.read` / `admin.<area>.write` key ⇒ 200 / 403 exactly per `01-nest-module-map.md` §3.2 (impersonation = `super_admin` + `support` only) | PRL-01 | I |
| AT-PRL-02 | Invite `x@gmail.com` ⇒ `ADMIN_EMAIL_DOMAIN_INVALID`; invited member without 2FA ⇒ every admin route `TWO_FA_REQUIRED_FOR_ROLE`; role change without 2FA code ⇒ `TWO_FA_CONFIRMATION_REQUIRED`; own demotion ⇒ `ADMIN_CANNOT_DEMOTE_SELF` | PRL-02 | I |
| AT-DEL-01 | In-app deletion by an Owner ⇒ `ACCOUNT_OWNS_WORKSPACE` dialog; after ownership transfer (D51) ⇒ request accepted: sessions revoked, memberships removed, e-mail with export link, admin row EN GRÂCE | DEL-01/02, FL-22 | I/E |
| AT-DEL-02 | Login during grace ⇒ "Annuler la suppression ?" ⇒ `cancelled`, `status=active`, memberships not restored; after 30 d ⇒ anonymised (name, e-mail, phone, avatar), invoices intact without personal data, audit rows show "membre supprimé" | FL-22 steps 4–5, 04 §16 | I |
| AT-DEL-03 | Second request while pending ⇒ `ACCOUNT_DELETION_PENDING`; admin "Résoudre" on a blocked request with debt ⇒ stays BLOQUÉE until the invoice is paid | 04 §16, FL-22 F-3 | I |
| AT-DEL-04 | Ownership transfer to an Operator ⇒ `OWNERSHIP_TRANSFER_TARGET_INVALID`; to an Admin with password (+ `totpCode` when 2FA is enabled) ⇒ roles swapped, `ownedWorkspaceId` moved, both e-mailed, audit; old owner cannot undo without the new Owner doing the same (details in AT-OWN-transfer) | D51, 04 §16 | I |
| AT-DEL-05 | Admin "Programmer la suppression" ⇒ channels disconnected, subscription cancelled, Owner export e-mail, banner; any mutation ⇒ `WORKSPACE_DELETION_SCHEDULED`; Owner cancels ⇒ channels `disconnected` (reconnect required); purge at J+30 | DEL-05, FL-23 | I |
| AT-IMP-01 | `POST /admin/impersonation/sessions` without reason or with 9 chars ⇒ `ADMIN_REASON_REQUIRED`; by a `moderator` / `finance` / `read` role ⇒ `FORBIDDEN`; by `support` or `super_admin` ⇒ `{ sessionId, token, expiresAt = startedAt + 30 min }`, `ImpersonationSession` row without any mode column, audit `impersonation.start`; every GET under `X-Impersonation-Session` ⇒ 200 + audit `impersonation.action` + `actionsCount` +1; after 30 min ⇒ `401 ADMIN_IMPERSONATION_EXPIRED`; `DELETE /admin/impersonation/sessions/:id` ⇒ `endedAt`, `impersonation.stop` with duration; red banner "Vous agissez en tant que {workspace} · lecture seule · {mm} min · Quitter" rendered in the merchant shell; no e-mail is sent to the Owner | FL-29, 04 §17, D21-bis | I/E |
| AT-IMP-02 | Table-driven over every merchant route: each POST / PATCH / PUT / DELETE under `X-Impersonation-Session` (product edit, order status, inbox reply, checkout, workspace delete, member role, API key, ownership transfer, settings) ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`, no row changed, audit `impersonation.action` written; sessions are read-only only (`ImpersonationSession` has no `mode` column; a request body field `mode` is rejected by the DTO whitelist ⇒ 422) | 04 §17, D21-bis | I |
| AT-AUD-01 | Viewer opens a conversation ⇒ audit `viewer.open` with reason; phone masked; "Afficher" by support ⇒ 403, by super admin ⇒ unmasked + `viewer.unmask`; audit export job produces a CSV whose SHA-256 header matches, and is itself logged | 04 §17, ADM-17 | I |
| AT-AUD-02 | Plan update diff shows before/after with identical lines greyed and secrets hashed; entries filterable by impersonation session | ADM-09 | E |

### Agent drafts, trust levels, ownership, system messages

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-AGT-draft-limit | Plan `maxAgents=2` with 2 `active` agents: `POST /agents` (draft) ⇒ 201 (3rd, 4th, 5th drafts all accepted, list pill BROUILLON, no plan dialog); `POST /agents/:id/activate` on a draft ⇒ `403 PLAN_LIMIT {resource: agents, limit: 2}`; pause one active agent ⇒ activation still `PLAN_LIMIT` (count = `status ∈ {active, paused}`); delete one active agent ⇒ activation succeeds; `GET /billing/subscription` usage counts only active + paused agents | D67, 04 §18, 02 §5 | I |
| AT-TRUST-auto | New workspace `trustLevel=new`; 9 `approved` moderation items in 30 d ⇒ still `new`; 10th approval ⇒ `standard` at once (checked on approval) and audit row; workspace with 10 approvals and 1 `rejected` in the last 30 d ⇒ stays `new` until the daily job `sched-trust-levels` finds 0 rejections in the window; `standard → trusted` only via `POST /admin/workspaces/:id/trust-level { trustLevel, reason }` by a moderator (audited); 3 `rejected` with `decision=counterfeit` in 90 d ⇒ `watch` and every item goes to human review; 5 ⇒ ADM-01 "Suspension proposée"; `watch → standard` manual only | D52, 04 §12 | I |
| AT-OWN-transfer | `POST /workspaces/:id/transfer-ownership`: target Operator ⇒ `OWNERSHIP_TRANSFER_TARGET_INVALID`; wrong `password` ⇒ `AUTH_INVALID_CREDENTIALS`; Owner with 2FA enabled and a missing or wrong `totpCode` ⇒ `TWO_FA_CONFIRMATION_REQUIRED` (04 §16); Owner without 2FA ⇒ `totpCode` ignored; success ⇒ in one transaction old owner `admin`, new owner `owner` (exactly one owner at any time), `User.ownedWorkspaceId` moved, audit `workspace.transfer_ownership`, e-mail + `member.role_changed` to both; by an Admin ⇒ 403 (`workspace.transfer` = Owner only); under impersonation ⇒ `ADMIN_IMPERSONATION_FORBIDDEN_ACTION` | D51, FL-13, FL-22 | I |
| AT-SYS-messages | `Workspace.systemMessages` = 4 keys (`handoff`, `out_of_hours`, `out_of_stock`, `welcome`) × 3 locales, seeded at creation with the D43 defaults; `welcome`: first customer message of a new conversation ⇒ `welcome` sent as a standalone message before the first AI reply, never again on that conversation; `welcome` set to "" ⇒ not sent; `out_of_hours`: `Agent.businessHours` set and now outside ⇒ sent once per conversation per 24 h, AI still replies and `create_order` works; inside hours ⇒ not sent; `out_of_stock`: product with stock 0 ⇒ the reply contains the configured sentence with `{product}` replaced, then alternatives when `outOfStockBehavior=suggest_alternative`; `handoff`: AI `HANDOFF` ⇒ the configured text sent once, conversation `needs_human`; `PUT /workspace/system-messages` with an unknown key ⇒ `422 VALIDATION_ERROR`; the fixed texts `customer.unavailable` / `customer.unsupportedMedia` / `customer.voiceFailed` are not editable (key rejected) | D43, 04 §5, FL-01, FL-03 | V/I |

### Mobile app rules (14 §3)

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-MOB-01 | Version gate: `GET /app/version?platform=android&version=2.0.9` with `minVersion=2.1.0` ⇒ `status=update_required` and every other call with `X-App-Version: 2.0.9` ⇒ `426 APP_UPDATE_REQUIRED {minVersion, storeUrl, message}`; the app shows the blocking screen `V2 — Système — Mise à jour requise`, no other screen reachable; `version=2.2.0`, `recommendedVersion=2.3.0` ⇒ `status=update_recommended`, banner on Home, "Plus tard" hides it 7 days | 14 MOB-R01, FL-21 | I/E (Flutter integration) |
| AT-MOB-02 | Maintenance: any `503 MAINTENANCE_MODE {until}` ⇒ screen `V2 — Système — Maintenance`; the app retries automatically every 60 s and returns to the previous screen when a call succeeds; reads from the cache stay visible under the banner | 14 MOB-R02, FL-30 | E |
| AT-MOB-03 | Legal re-acceptance: a major `LegalDocument` version published ⇒ next call `403 LEGAL_REACCEPT_REQUIRED` ⇒ screen `V2 — Système — Conditions mises à jour` fed by `GET /legal/pending`; "J'accepte" ⇒ `POST /legal/accept { key, version }` ⇒ `LegalAcceptance` stored (IP, UA) and navigation resumes; minor version ⇒ no screen | 14 MOB-R03, FL-30 | I/E |
| AT-MOB-04 | IAP validate: store purchase ⇒ `POST /credits/packs/iap/validate { platform, productId, receipt }` ⇒ credits added once (AT-PCK-01 codes), the transaction is finished only after the 2xx; "Restaurer les achats" re-sends unfinished receipts and gets `IAP_RECEIPT_ALREADY_USED` treated as success; `IAP_STORE_UNAVAILABLE` keeps the purchase pending and retries at next launch | 14 MOB-R08, FL-20 | I/C/E |
| AT-MOB-05 | No subscription purchase on mobile: the plan screen `V2 — Plan — géré sur le web` shows no price, no checkout button, no external payment link and the text "Le changement de plan et le paiement se font sur le web"; `POST /billing/checkout` with `X-App-Platform: android|ios` ⇒ `403 FORBIDDEN`; a subscription promo code from mobile ⇒ `PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN`; credit promo codes accepted | 14 MOB-R09, D73 | I/E |

### Agents v2, versions, presets

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-AGV-01 | Wizard: leave at step 3 ⇒ draft with step saved, list pill BROUILLON, "Reprendre" returns to step 3; draft never answers a webhook | AGV-01, FL-24 F-1 | I/E |
| AT-AGV-02 | Activate with no channel ⇒ `AGENT_NO_CHANNEL`; with 0 languages ⇒ `AGENT_DRAFT_INCOMPLETE {languages}`; unverified e-mail ⇒ `AUTH_EMAIL_UNVERIFIED`; at plan limit ⇒ `403 PLAN_LIMIT {resource: agents}`; all ok ⇒ `active`, `AgentVersion v1` (`snapshot` holds the structured columns and the compiled prompt fields), compiled `customInstructions` contains the policies and FAQ sections, `humanHandoffRules` one line per checked rule + keywords; `Agent.modelId` set by `AiRoute`, `temperature` / `maxTokens` from the preset; `POST /agents/:id/activate { at }` then `DELETE /agents/:id/activate` ⇒ `scheduledActivateAt=null`, still a draft, audit `agent.unschedule`, second DELETE idempotent, on an active agent ⇒ `409 CONFLICT`; step 5 greys "Activer maintenant" / "Activer à une date" with the failing readiness rows | AGV-02/03, 04 §18 | I/E |
| AT-AGV-03 | Compiled behaviour: `maxQtyPerOrder=5`, customer orders 12 ⇒ tool refuses, handoff with reason `order_limit`; keyword "arnaque" in `handoffKeywords` ⇒ handoff with the workspace `handoff` message; `Agent.businessHours` 9h–20h ⇒ at 22:00 the workspace system message `out_of_hours` is sent once per conversation per 24 h and the AI still answers and takes the order | 04 §18, AI-08, D43 | V/I |
| AT-AGV-04 | FAQ 51 entries ⇒ `AGENT_FAQ_LIMIT`; knowledge file 6 MB ⇒ `UPLOAD_TOO_LARGE`; "Extraire depuis ma page" uses CHN-08 (free, 3/day) | AGV-02 | I |
| AT-AGV-05 | Step 5 scenarios: 8 runs in dry-run, 0 credits, 0 orders persisted; a failing scenario opens the playground turn; "Envoyer un lien de test" works for a non-member for 24 h then `AGENT_TEST_LINK_EXPIRED`; test turns count in the 60/h limit | AGV-02, 04 §18 | I/E |
| AT-AGV-06 | Configuration tab: save 2 sections ⇒ one `AgentVersion v2` + toast; concurrent save ⇒ 409 dialog with per-section merge (untouched sections take the server value); Restaurer v1 ⇒ v3 equals v1 snapshot with note; "Comparer avec v2" diff lists changed keys | AGV-05/06, FL-24 step 7 | I/E |
| AT-AGV-07 | Switch the agent on a channel: open conversation keeps the old agent until resolved, new conversation uses the new one, response carries `AGENT_CHANNEL_SWITCH_NEXT_THREAD`; detach ⇒ channel without AI, messages land in the inbox unanswered | 04 §18, CHN-07b | I |
| AT-AGV-08 | Pause with 14 open threads: without confirm ⇒ 409 `AGENT_PAUSED_WITH_OPEN_THREADS {14}`; with confirm ⇒ threads `needs_human`, with the checkbox the workspace `out_of_hours` system message is sent once per open thread; delete with channels ⇒ `AGENT_HAS_CHANNELS`; delete after detach with typed name ⇒ ok, versions kept | AGV-07, FL-24 F-7/F-8 | I |
| AT-AGV-09 | Preset v8 published ⇒ 212 agents unchanged, "Mise à jour disponible" shown on agents with `presetVersionId=v7`; Appliquer ⇒ v4 with merchant edits preserved on conflict; publish with EN missing ⇒ allowed (FR fallback), with AR missing ⇒ `PRESET_LOCALE_INCOMPLETE`; archived preset in step 1 ⇒ `PRESET_ARCHIVED`; delete published ⇒ `PRESET_PUBLISHED_IMMUTABLE` | AGV-08, 04 §18 | I/E |
| AT-AGV-10 | Model badge read-only; routing fallback when OpenAI errors > 2 % ⇒ `AiRun.modelId` = fallback model; agent's badge updates; merchant API cannot set `modelId` (422) | 04 §18, ADM-06 | I |
| AT-AGV-11 | Operator opens the Configuration tab ⇒ fields greyed, no save button; PATCH ⇒ 403 | AGV-05, 02 §3 | E/I |

### Inventory, cash, purchases, sales, movements

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-INV-01 | Start a count on "alerts" scope ⇒ 14 lines with expected snapshot; second start ⇒ `INVENTORY_IN_PROGRESS`; counter sale during a blocking count ⇒ `SALE_BLOCKED_BY_INVENTORY`; orders and AI unaffected | INV-01, 04 §19, FL-26 | I |
| AT-INV-02 | Delivered order during the count (−2) ⇒ expected adjusted at validation; counted 18 vs expected 21 ⇒ movement `inventory −3`; line 3 → 1 (66 %) without note ⇒ `INVENTORY_VARIANCE_NOTE_REQUIRED`; with note ⇒ validated, `lastInventoryAt` set, recommendation alert, report "Écarts d'inventaire" lists it | INV-02/03, 04 §19 | I |
| AT-CSH-01 | Close 05 oct.: theoretical 76 350, counted 76 000 ⇒ correction −350 (auto, locked), note required, day locked; manual row on 05 oct. ⇒ `CASH_DAY_CLOSED`; auto row created on 06 for an order delivered with effective date 05 ⇒ dated 06; reopen by Operator ⇒ 403, by Admin with reason ⇒ reversal correction + audit | CSH-02/03, 04 §20, FL-27 | I |
| AT-CSH-02 | Manual row edited at 25 h ⇒ `CASH_ENTRY_EDIT_WINDOW_EXPIRED`; auto row PATCH ⇒ `CAISSE_EDIT_AUTOMATIC`, DELETE ⇒ `CAISSE_DELETE_AUTOMATIC`; correction row links to the auto row | CSH-03 | I |
| AT-GDS-11 | Cancel a fully received purchase ⇒ `PURCHASE_ALREADY_RECEIVED`; partial purchase cancelled ⇒ received units stay, unpaid amount reversed; delete a purchase with `status ≠ draft|pending` ⇒ `PURCHASE_DELETE_NOT_PENDING`; "Commander" ⇒ `status=pending`; receive 14 of 12 ⇒ `200 ⚠ PURCHASE_OVER_RECEIVE {ordered: 12, received: 14}`, line quantity 14, weighted-average cost recomputed | 04 §20, D64 | I |
| AT-GDS-16 | Weighted-average cost: stock 10 at cost 100, receive 5 at 160 ⇒ `costPrice = round_half_up((10×100 + 5×160) / 15) = 120`; PRIX recommendation uses `Workspace.targetMarginPct` (default 35; `PATCH /workspace { targetMarginPct: 40 }` in advanced mode changes the next run); low-stock alert fires when `quantity ≤ Product.minStock` (variant: `ProductVariant.minStock`) | 04 §20, D64, D69 | U/I |
| AT-GDS-12 | Sale: partial payment without client ⇒ `SALE_PARTIAL_REQUIRES_CUSTOMER`; edit a validated sale ⇒ `SALE_IMMUTABLE`; cancel at day 8 ⇒ `SALE_CANNOT_CANCEL_AFTER_7D`; cancel at day 2 with refund ⇒ stock restored, refund cash row; "Encaisser le reste" ⇒ paid + cash row | 04 §20 | I |
| AT-GDS-13 | Supplier with purchases DELETE ⇒ `SUPPLIER_HAS_PURCHASES` ⇒ deactivate; supplier payment allocated to the oldest purchase, locked cash row, `amountPaid` updated | 04 §20, GDS-05 | I |
| AT-GDS-14 | Movement PATCH/DELETE ⇒ `GDS_MOVEMENT_IMMUTABLE`; "Contre-passer" creates the inverse adjustment with reason `correction` linked; out of 8 on stock 6 ⇒ `STOCK_INSUFFICIENT`, Admin with `force=true` + reason ⇒ stock −2 | 04 §20 | I |
| AT-GDS-15 | Archive with "sortir le stock restant" ⇒ adjustment reason `archive`; hard delete with orders ⇒ `PRODUCT_HAS_ORDERS`; variant generator 11 × 10 ⇒ `VARIANT_LIMIT`; regenerate recommendations twice in 10 min ⇒ `RECO_RATE_LIMITED`; sub-category of a sub-category ⇒ `CATEGORY_DEPTH_EXCEEDED` | 04 §20, D66 | I |

### Orders, delivery, clients, lists, deep links

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-ORD-23 | Source column: AI order ⇒ ✦ agent · channel; mobile ⇒ ▣ member; API key ⇒ { } key name; import ⇒ ⤒ file date; filter `source=api` returns only those | 04 §21, D61 | I/E |
| AT-ORD-24 | Reminder at 16:00 ⇒ pill RAPPEL 16:00, Home card RAPPEL, `order.callback_due` at 16:00 to the assignee; past time ⇒ `ORDER_CALLBACK_IN_PAST`; logging a call clears it | 04 §21 | I/E |
| AT-ORD-25 | Call outcome `wrong_number` on `new` not sent ⇒ cancelled "faux numéro", client `riskLevel=high`; AI `create_order` for that phone ⇒ confirmation step required | 04 §21 | I/V |
| AT-ORD-26 | "Confirmée (retour arrière)" from shipped before pickup ⇒ ok; after a `picked_up` event ⇒ `ORDER_INVALID_TRANSITION`; status change effective date 3 d ago ⇒ `deliveredAt` back-dated, cash row dated that day only if open | 04 §21 | I |
| AT-ORD-27 | Manual delivered with amount 8 000 of 8 300 + reason ⇒ `paymentStatus=partial`, cash row 8 000; without reason ⇒ 422 | 04 §21 | I |
| AT-ORD-28 | Returned dialog with restock unchecked ⇒ `StockMovement(type=adjustment_out)` loss movement, no `return` movement; checked ⇒ `type=return`; courier return fee from grid added; client `returnCount` +1 | 04 §21 | I |
| AT-ORD-29 | Address edit after `createParcel` ⇒ `COURIER_ADDRESS_LOCKED`; before ⇒ fee recomputed (Admin override kept), AI informs the customer inside 24 h | 04 §21 | I |
| AT-ORD-30 | Bulk "mark delivered" endpoint ⇒ 422 (forbidden in bulk); bulk confirm of 3 with one missing address ⇒ 2 ok + `ORDER_ADDRESS_REQUIRED`, dialog "Réessayer les erreurs" | 04 §21, LST-04 | I/E |
| AT-ORD-31 | Delete dialog: typed "CMD-1035" for CMD-1036 ⇒ button disabled; delivered ⇒ `ORDER_DELETE_DELIVERED`; active parcel ⇒ `DELIVERY_ORDER_ALREADY_SENT` | 04 §21 | E/I |
| AT-DLV-11 | Failure flow: courier `failed unreachable 2/3` ⇒ notification, Home card, Échecs row; "Relancer" with adapter support ⇒ attempts +1; without support after pickup ⇒ `COURIER_CANCEL_NOT_ALLOWED`; third failure ⇒ UI proposes return | FL-25 | I/E |
| AT-DLV-12 | Refresh tracking twice in 5 min ⇒ `TRACKING_SYNC_RATE_LIMITED`; no event for 6 d in transit ⇒ "Sans mouvement" tab and KPI; 31 d ⇒ `stale` | 04 §22 | I |
| AT-DLV-13 | Cancel parcel before pickup ⇒ `cancelled`, order back to `confirmed` (option) or cancelled (option); labels dialog on 6 orders with 2 unsent ⇒ 4-page PDF + 2 rows `SHIPMENT_NOT_CREATED`; thermal 100 × 150 variant; `labelPrintedAt` set when ticked | 04 §22 | I/E |
| AT-DLV-14 | "Livraison propre" courier type: no credentials, mark shipped with optional tracking, Djaber label, manual status only; change courier on a failed order recomputes courier cost not customer fee | 04 §22, D15 | I |
| AT-CLI-06 | Merge without confirm ⇒ 409 `CUSTOMER_MERGE_IRREVERSIBLE` with data; with confirm ⇒ kept client gains orders/conversations/notes, merged soft-deleted; delete client with orders ⇒ `CUSTOMER_HAS_ORDERS` ⇒ archive; bulk tags add/remove on 5 clients | 03 §37 CLI | I/E |
| AT-LST-01 | Every list page renders the 6 states (skeleton, empty, filtered-empty, error, offline, loading more) and every form the 5 states (saving, validation, leave-guard, 409, saved toast) — storybook snapshots over 12 §16 | 12 §16 | E |
| AT-LST-02 | `Actions ⌄` on a `new` order: primary "Appeler pour confirmer" highlighted, Enter triggers it, "Envoyer au transporteur" greyed with `DELIVERY_ORDER_NOT_CONFIRMED` in the footer; shortcuts C/R/M/E/A/P/Suppr act on the selected row; `?` opens the help | LST-01, D42 | E |
| AT-LST-03 | Saved view "À envoyer Sétif" saved with filters + sort + columns + density; duplicate name ⇒ `SAVED_VIEW_NAME_TAKEN`; shared by Admin ⇒ visible read-only to others (`SAVED_VIEW_SHARED_READONLY` on edit); set default ⇒ list opens with it; density persists across sessions | LST-02/03, D47 | I/E |
| AT-LST-04 | 1024 px: icon sidebar with tooltips, wilaya/risk columns hidden; 390 px: rows as cards, Actions ⌄ in a bottom sheet, no multi-select, filters full screen; simple mode hides the advanced sidebar items and shows "Rapports (9 / 23)"; switching mode shows "Passer en avancé ?" | LST-05, D12 | E |
| AT-DLK-01 | Table-driven over 03 §35: every `NotificationType` deep link opens the right web URL and `djaber://` path with filters applied; object deleted ⇒ "Introuvable" page; object in another workspace where the user is member ⇒ switch; not member ⇒ 403 | DLK, D48 | E |
| AT-NTF-06 | New types (`order.callback_due`, `conversation.assigned`, `channel.approved`, `product.*`, `moderation.appeal_result`, `report.resolved`, `customer.auto_blocked`, `support.reply`, `account.deletion_confirmed` (e-mail only), `legal.reacceptance_required`, `invoice.unpaid`, `credits.negative`, `credits.pack_purchased`, `workspace.suspended` / `workspace.reactivated` (admin action only), `app.update_required` / `app.update_recommended` (push only)) fire exactly the channels of the 03 §15 table (one row per `NotificationType` value) and appear under their family tab with the right filter | 03 §15 | I |
| AT-ANA-02 | Analytics custom range 733 d ⇒ `REPORT_RANGE_TOO_LONG`; "Personnalisé" without dates ⇒ `REPORT_CUSTOM_RANGE_REQUIRED`; comparison "aucune" hides deltas; empty period shows the CTA; table row click opens the filtered list; credits tab projection date matches the burn rate | 12 §24, D62 | E |
| AT-RPT-01 | Export 4 999 rows CSV ⇒ immediate; 5 001 ⇒ job, banner, "Exports récents" row (`GET /jobs?kind=export`), file expires at 7 d; `POST /jobs/:id/cancel` on a running export ⇒ cancelled, on a finished one ⇒ `JOB_NOT_CANCELLABLE`; `POST /jobs/:id/retry` re-runs a failed one; XLSX always a job; PDF = current page + totals with logo; job timeout ⇒ `REPORT_EXPORT_FAILED` + Réessayer; `POST /reports/:key/schedule { email, dayOfMonth }` ⇒ `ReportSchedule` row and monthly e-mail, without plan feature `scheduled_reports` ⇒ `PLAN_FEATURE_REQUIRED` and "Planifier" opens the upgrade state of its dialog (12 §24); favourites via `PATCH /me/prefs { reportFavorites }`; simple mode lists 9 reports; every report endpoint for an Operator ⇒ 403 (reports = Admin+, `reports.read`) | D62, D69 | I/E |

### Dialog catalogue — one test per dialog (validation + effect) `[08 §7.14]`

| ID | Dialog (frame) | Given / When / Then | Lvl |
|---|---|---|---|
| AT-DLG-01 | Annuler la commande (DLG Orders) | no reason ⇒ button disabled; "faux numéro" ⇒ client risk; shipped order ⇒ `DELIVERY_ORDER_ALREADY_SENT`; customer message checkbox sends per MSG-06 | E/I |
| AT-DLG-02 | Changer le statut | targets limited to the transition matrix; Livrée applies COD; Retournée restocks per checkbox; effective date > 7 d ⇒ validation error | E/I |
| AT-DLG-03 | Assigner (orders / inbox) | member list with counts; "Personne" unassigns; notify sends `conversation.assigned` / in-app | E/I |
| AT-DLG-04 | Programmer un rappel | presets fill the time; past ⇒ `ORDER_CALLBACK_IN_PAST`; note stored; customer message now respects the 24 h window | E/I |
| AT-DLG-05 | Marquer livrée manuellement | default amount = total; different amount needs a reason; effects list matches 04 §21 | E/I |
| AT-DLG-06 | Marquer retournée | reason required; restock unchecked ⇒ loss adjustment; return fee line shown | E/I |
| AT-DLG-07 | Imprimer les bordereaux | 3 formats produce PDFs; unsent orders listed as ignored `SHIPMENT_NOT_CREATED`; "marquer imprimé" sets the flag | I/E |
| AT-DLG-08 | Exporter les commandes | scope radio counts match; > 5 000 ⇒ job; ZR format columns per adapter | I/E |
| AT-DLG-09 | Modifier l'adresse de livraison | stop-desk requires an agency; home requires ≥ 10 chars; fee recomputed line; locked after send | E/I |
| AT-DLG-10 | Résultat de l'appel | each outcome writes an `OrderCall`; 3/3 no answer shows cancel/reminder options; faux numéro cancels + risk | E/I |
| AT-DLG-11 | Fusionner les clients | kept/merged cards; confirm flag; irreversible | E/I |
| AT-DLG-12 | Enregistrer un paiement (DLG Orders II) | partial ⇒ partial status; closed order ⇒ `ORDER_PAYMENT_LOCKED` disabled + tooltip | E/I |
| AT-DLG-13 | Supprimer la commande | typed number exact match enables; delivered ⇒ blocked toast | E |
| AT-DLG-14 | Lien de paiement (P2) | states créer / créé (copy, send) / payé / expiré / échec / montant différent | E |
| AT-DLG-15 | Rembourser (P2) | amount ≤ paid; reason required; cash refund row; order → refunded | I |
| AT-DLG-16 | Modifié par quelqu'un d'autre (409) | Recharger merges untouched fields and highlights mine; Écraser sends my version with the new `version` | E |
| AT-DLG-17 | Ajouter un transporteur | provider fields switch; Livraison propre has none; test states; save allowed on unreachable | E/I |
| AT-DLG-18 | Supprimer le transporteur | with 27 active parcels ⇒ `COURIER_HAS_ACTIVE_SHIPMENTS` ⇒ Désactiver | E/I |
| AT-DLG-19 | Grille des frais — actions | reset all needs confirmation and overwrites; fill missing keeps custom; reset row on default ⇒ `FEE_RULE_NOT_FOUND`; free-delivery modes save | E/I |
| AT-DLG-20 | Bordereau indisponible | retry calls `getLabel`; Djaber A6 renders tracking n°, COD, barcode | E |
| AT-DLG-21 | Annuler le colis | before pickup ⇒ cancelled with order option; after ⇒ `COURIER_CANCEL_NOT_ALLOWED` | I |
| AT-DLG-22 | Nouveau client | phone conflict shows "Utiliser ce client"; default address saved; tags | E/I |
| AT-DLG-23 | Supprimer le client / Tags | soft delete; with orders ⇒ archive proposal; bulk tags apply to 5 | E/I |
| AT-DLG-24 | Nouvelle catégorie / Nouvelle unité (DLG GDS) | duplicate name ⇒ `CATEGORY_ALREADY_EXISTS`; parent depth > 2 ⇒ `CATEGORY_DEPTH_EXCEEDED`; unit "contains n ×" saved | I/E |
| AT-DLG-25 | Supprimer / archiver le produit | hard delete disabled with orders; archive with stock-out checkbox creates the adjustment | E/I |
| AT-DLG-26 | Modifier les prix en masse | +10 % rounded up preview matches; below-cost rows warned `SELLING_BELOW_COST`; variants included when ticked; per-row result | I/E |
| AT-DLG-27 | Changer la catégorie (bulk) | moves 12 products; create-category inline works | E |
| AT-DLG-28 | Générer des variantes | 4 × 2 creates 8 with auto SKUs, existing kept; > 100 ⇒ `VARIANT_LIMIT` | I |
| AT-DLG-29 | Dupliquer le produit | copy options respected; variants stock 0; copy enters moderation | I |
| AT-DLG-30 | Nouveau fournisseur / Paiement fournisseur | terms saved; payment > due ⇒ validation; allocation to purchase or oldest; locked cash row | I/E |
| AT-DLG-31 | Annuler la vente / Encaisser le reste | reason required; restock + refund rows; > 7 d blocked; collect rest ⇒ paid | I/E |
| AT-DLG-32 | Mouvement de caisse manuel | in/out types; closed day ⇒ `CASH_DAY_CLOSED`; receipt photo optional | I/E |
| AT-DLG-33 | Lancer / Valider l'inventaire | scope counts; blocking flag; variance note rule; movements created | I/E |
| AT-DLG-34 | Correspondance des colonnes | auto mapping, ignore column, invalid URLs warning, "update existing by name", mapping saved for next import | I/E |
| AT-DLG-35 | Limite du plan atteinte (DLG GDS II / GLOBAL) | shows resource n / N, Comparer les plans opens billing; 90 % ⇒ `PLAN_NEAR_LIMIT` toast only | E |
| AT-DLG-36 | Créer depuis une photo | 1–5 photos; analysing ≤ 15 s cancellable; filled fields highlighted; failure ⇒ no credits; unavailable ⇒ button hidden | I/E |
| AT-DLG-37 | Images — erreurs inline | 6 MB ⇒ `IMAGE_TOO_LARGE`, gif/bmp per rule, 11th ⇒ `IMAGES_LIMIT`, 500 px ⇒ `IMAGE_SMALL` warning; form still saves without the faulty image | E/I |
| AT-DLG-38 | Ajuster le stock — cas | variant required; insufficient with admin force; qty 0 disabled; service hidden | E/I |
| AT-DLG-39 | Supprimer la catégorie / unité (réaffecter) | reassign select mandatory; sub-categories to root; system unit ⇒ `UNIT_SYSTEM_READONLY` | E/I |
| AT-DLG-40 | Dépense produit | per-unit vs fixed; margin preview equals the formula | U/E |
| AT-DLG-41 | Règle de recommandation | manual rule has priority over automatic; score 0–100; delete simple confirm | I |
| AT-DLG-42 | Restaurer (conflit SKU) | reused SKU ⇒ new SKU field required; content > 90 d ⇒ moderation item | I |
| AT-DLG-43 | Supprimer l'agent (DLG Agents) | typed name; `AGENT_HAS_CHANNELS` blocks; insights dismissed | E/I |
| AT-DLG-44 | Mettre en pause l'agent | shows open-thread count; confirm moves them; checkbox sends the workspace `out_of_hours` system message once per open thread | E/I |
| AT-DLG-45 | Résoudre l'insight | instruction appends and versions the agent; FAQ created; ignore 30 d; already handled ⇒ `INSIGHT_ALREADY_RESOLVED` | I/E |
| AT-DLG-46 | Déconnecter la page | 3 consequences executed (unsubscribe, token cleared, agent detached); history readable | I |
| AT-DLG-47 | Réactiver (swap at limit) | lists active pages with counts; swap atomic; Comparer les plans link | I/E |
| AT-DLG-48 | Reconnexion Meta — issues | popup blocked fallback "Ouvrir dans cet onglet"; pop-up that looks closed keeps the waiting dialog (no cancellation); at the page limit the explainer warns (`PLAN_LIMIT`) and still allows reconnecting; cancelled ⇒ `OAUTH_CANCELLED` toast; invalid state; unverified e-mail dialog | E |
| AT-DLG-49 | Rapport de connexion | one row per page with the right code/state; agent selector attaches; "Plus tard" leaves pages without AI | I/E |
| AT-DLG-50 | Connecter une page — explications / Synchroniser l'historique | permission list; sync 90 d only on Pro (`PLAN_FEATURE_REQUIRED` otherwise); expired token ⇒ `PAGE_SYNC_TOKEN_EXPIRED` | E/I |
| AT-DLG-51 | Modèle IA indisponible | shows fallback note; wizard continues | E |
| AT-DLG-52 | Générer un agent depuis ma page | 4 steps; cancel mid-analysis; failure keeps credits (free); rate-limited; apply to new vs update existing (version created) | I/E |
| AT-DLG-53 | Réponses rapides popover / Assigner / Notes (DLG Inbox) | `/` opens and filters; insert replaces text; note not sent to Meta; assign updates avatar + WS | E/I |
| AT-DLG-54 | Supprimer la conversation | Admin only; soft; restorable 30 d by admin; new customer message creates a new conversation | I |
| AT-DLG-55 | Sélecteur de canal / Actions groupées (inbox) | counts and states; bulk on an inactive channel returns per-row error | E/I |
| AT-DLG-56 | Activer la 2FA (DLG Settings) | QR + key; wrong code ⇒ `AUTH_2FA_INVALID`; 10 codes downloadable; checkbox required to finish | E/I |
| AT-DLG-57 | Désactiver la 2FA / Régénérer | wrong password ⇒ `AUTH_CURRENT_PASSWORD_INCORRECT`; regenerate invalidates old codes; super admin disable ⇒ `TWO_FA_REQUIRED_FOR_ROLE` | I |
| AT-DLG-58 | Changer le mot de passe / Changer l'e-mail | weak ⇒ `AUTH_PASSWORD_WEAK`; mismatch inline; other sessions revoked; e-mail taken ⇒ `AUTH_EMAIL_TAKEN`; old address notified; link 24 h | I/E |
| AT-DLG-59 | Supprimer mon compte | Owner ⇒ `ACCOUNT_OWNS_WORKSPACE` with "Aller à la zone de danger"; non-owner ⇒ grace flow | E/I |
| AT-DLG-60 | Logo & avatar | upload progress, crop, 3 MB ⇒ `IMAGE_TOO_LARGE`, bmp ⇒ `IMAGE_TYPE_INVALID` | E |
| AT-DLG-61 | Réponse rapide / Message système — réinitialiser | duplicate title ⇒ `QUICK_REPLY_TITLE_TAKEN`; variables rendered; shortcut unique; reset restores the 3 default locales | I/E |
| AT-DLG-62 | Supprimer l'espace | typed name; unpaid invoice ⇒ `WORKSPACE_HAS_DEBT`; already scheduled ⇒ `WORKSPACE_DELETION_SCHEDULED`; no refund note | I/E |
| AT-DLG-63 | Google Sheets — choisir la feuille | Picker / URL (`SHEETS_SPREADSHEET_NOT_FOUND`) / create; backfill job; disconnect keeps the sheet | I/E |
| AT-DLG-64 | Webhook sortant | http URL ⇒ `WEBHOOK_URL_INVALID`; secret shown once; ping test 200; reactivate resets the failure counter | I/E |
| AT-DLG-65 | Changer de plan | prorata line equals the formula; downgrade lists resources to pause and applies at period end; `PLAN_IS_FREE` / `PLAN_NOT_FOUND` toasts; promo errors inline | I/E |
| AT-DLG-66 | Calculateur de crédits / Retour de paiement | estimate equals AT-PCK-04; return page states per FL-28 | E |
| AT-DLG-67 | Inviter un membre / Transférer la propriété / Langue & région | `MEMBER_ALREADY_EXISTS`, `INVITATION_PENDING`; limit ⇒ read-only note; transfer needs the password and, when 2FA is enabled, the `totpCode` field (AT-OWN-transfer); language applies to web + mobile | I/E |
| AT-DLG-68 | Créer un plan (DLG Platform admin) | per AT-BIL-09; card preview reflects inputs | E |
| AT-DLG-69 | Supprimer le plan / Abonnement — créer / modifier | `PLAN_IN_USE` with migrate; `SUBSCRIPTION_ALREADY_ACTIVE` ⇒ edit existing; reason audited | I/E |
| AT-DLG-70 | Suspendre / Programmer la suppression | reason list; e-mail toggle; effects of 04 §16; typed name | I/E |
| AT-DLG-71 | Ajouter des crédits / Libérer la page | role limits; Owner e-mail; release forces disconnect in the other workspace with notification and proof flag | I |
| AT-DLG-72 | Clé fournisseur IA / Modèle IA | test states incl. `AI_PROVIDER_KEY_REJECTED`, `AI_PROVIDER_UNREACHABLE` (save anyway), `AI_PROVIDER_NO_KEY`; model costs update the calculator | I/E |
| AT-DLG-73 | Nouveau préréglage / Nouvelle entrée CMS | draft v1 created; slug rules `CMS_SLUG_INVALID` / `CMS_SLUG_TAKEN`; 3 languages created with fallback option | I |
| AT-DLG-74 | Exporter le journal d'audit / Changer le rôle plateforme / Inviter un membre plateforme / Créer un espace pour un client | signed export job; role change 2FA + `ADMIN_CANNOT_DEMOTE_SELF`; domain check; client workspace created with trial months + credits + invitation, existing e-mail becomes owner | I/E |
| AT-DLG-75 | Contester le refus (MOD) · Signaler à Djaber / Bloquer un numéro (SAFE) · Se connecter en tant que (ADM-02, read-only: no mode selector rendered) · Force update (ADM-13) · Clôturer le jour · Réceptionner #ACH · Déplacer la page · Passer en avancé ? | each: required fields block the primary button; effect per the owning AT (MOD-05, SAFE-01/03, IMP-01, PFS-02, CSH-01, GDS-11, AGT-04, ONB-02) | E |
| AT-DLG-76 | GLOBAL system dialogs | Quitter sans enregistrer (Rester keeps the draft), Limite du plan, Vérifiez votre e-mail (resend cooldown), Tâche en cours (cancel ⇒ `JOB_NOT_CANCELLABLE` when finished), Nouvelle version disponible (reload keeps drafts), Raccourcis clavier | E |

### Error codes — one assertion per code with its UI treatment `[11 §12]`

| ID | Codes | Then (status + UI per 11) | Lvl |
|---|---|---|---|
| AT-ERR-00 | **Every** code of 11 §1–12 | table-driven: the API returns the documented HTTP status and `code`; the web client renders the documented UI kind (inline / toast / dialog / banner / state / silent) and the fr/ar/en message exists in i18n (CI check: no code without the 3 messages and a UI mapping) | I/E |
| AT-ERR-01 | `AUTH_USER_BLOCKED`, `TWO_FA_CONFIRMATION_REQUIRED`, `INVITATION_PENDING`, `INVITATION_EMAIL_MISMATCH`, `LEGAL_REACCEPT_REQUIRED`, `APP_UPDATE_REQUIRED`, `MAINTENANCE_MODE`, `FEATURE_DISABLED`, `PLAN_FEATURE_REQUIRED` | 403 login state · inline code field · inline + Renvoyer · invitation state · interstitial · 426 blocking mobile screen · 503 banner + disabled actions · hidden control · dialog Comparer les plans | I/E |
| AT-ERR-02 | `ACCOUNT_DELETION_TOKEN_EXPIRED`, `ACCOUNT_DELETION_PENDING`, `OWNERSHIP_TRANSFER_TARGET_INVALID`, `ADMIN_REASON_REQUIRED`, `ADMIN_IMPERSONATION_FORBIDDEN_ACTION`, `ADMIN_IMPERSONATION_EXPIRED`, `ADMIN_EMAIL_DOMAIN_INVALID`, `ADMIN_CREDIT_GRANT_LIMIT` | 410 public state · 409 dialog · 422 inline · 422 inline · 403 toast under the red banner · 401 state back to admin · 422 inline · 403 inline | I/E |
| AT-ERR-03 | `WORKSPACE_DELETION_SCHEDULED`, `WORKSPACE_HAS_DEBT`, `PLAN_LIMIT_GRANDFATHERED`, `PLAN_SLUG_TAKEN`, `INVOICE_PARTIAL_PAYMENT`, `CREDITS_NEGATIVE_BALANCE` | 409 banner + toast · 409 dialog Payer · 403 dialog · 409 inline · 200 warning in dialog · 402 red banner + thread state | I/E |
| AT-ERR-04 | `IAP_RECEIPT_INVALID`, `IAP_RECEIPT_ALREADY_USED`, `IAP_PRODUCT_UNKNOWN`, `IAP_STORE_UNAVAILABLE` | 422 mobile dialog Réessayer · 409 silent success · 404 toast · 503 pending state | I |
| AT-ERR-05 | `PROMO_INVALID`, `PROMO_EXPIRED`, `PROMO_ALREADY_USED`, `PROMO_PLAN_MISMATCH`, `PROMO_NOT_STACKABLE`, `PROMO_LIMIT_REACHED`, `PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN` | all inline under the promo field, form content kept | E |
| AT-ERR-06 | `AGENT_NO_CHANNEL`, `AGENT_HAS_CHANNELS`, `AGENT_PAUSED_WITH_OPEN_THREADS`, `AGENT_DRAFT_INCOMPLETE`, `AGENT_FAQ_LIMIT`, `AGENT_TEST_LINK_EXPIRED`, `AGENT_VERSION_NOT_FOUND`, `CHANNEL_SYNC_RATE_LIMITED`, `PRESET_ARCHIVED`, `PRESET_LOCALE_INCOMPLETE`, `PRESET_PUBLISHED_IMMUTABLE`, `AGENT_CHANNEL_SWITCH_NEXT_THREAD` | 422 step-5 inline + card badge · 409 dialog · 409 confirm dialog · 422 checklist · 422 inline · 410 state · 404 toast · 429 tooltip · 409 inline · 422 inline · 409 toast · info note | I/E |
| AT-ERR-07 | `VARIANT_LIMIT`, `PRODUCT_HAS_ORDERS`, `CATEGORY_DEPTH_EXCEEDED`, `GDS_MOVEMENT_IMMUTABLE`, `INVENTORY_IN_PROGRESS`, `INVENTORY_VARIANCE_NOTE_REQUIRED`, `INVENTORY_NOT_FOUND`, `SALE_BLOCKED_BY_INVENTORY`, `RECO_RATE_LIMITED`, `PURCHASE_ALREADY_RECEIVED`, `SUPPLIER_HAS_PURCHASES`, `SALE_PARTIAL_REQUIRES_CUSTOMER`, `SALE_CANNOT_CANCEL_AFTER_7D`, `SALE_IMMUTABLE`, `CASH_DAY_CLOSED`, `CASH_ENTRY_EDIT_WINDOW_EXPIRED`, `PURCHASE_OVER_RECEIVE` (warning) | 422 inline · 409 dialog · 422 inline · 403 greyed + tooltip · 409 dialog · 422 inline · 404 state · 409 dialog state · 429 tooltip · 409 greyed + tooltip · 409 dialog · 422 inline · 422 greyed + tooltip · 422 toast · 409 dialog Rouvrir · 422 tooltip · 200 inline warning | I/E |
| AT-ERR-08 | `ORDER_CALLBACK_IN_PAST`, `SHIPMENT_NOT_CREATED`, `COURIER_CANCEL_NOT_ALLOWED`, `COURIER_ADDRESS_LOCKED`, `TRACKING_SYNC_RATE_LIMITED`, `CUSTOMER_MERGE_IRREVERSIBLE`, `CUSTOMER_HAS_ORDERS`, `CUSTOMER_BLOCKED`, `CUSTOMER_BLOCKED_BY_PLATFORM` | 422 inline · 422 ignored row · 409 dialog · 409 dialog Annuler le colis · 429 disabled button · 409 confirm · 409 dialog Archiver · 422 warning+confirm (manual) / silent (AI) · 403 tooltip | I/E |
| AT-ERR-09 | `MODERATION_APPEAL_ALREADY_USED`, `MODERATION_APPEAL_WINDOW_EXPIRED`, `MODERATION_ITEM_ALREADY_DECIDED`, `MODERATION_REASON_REQUIRED`, `MODERATION_REJECTED`, `ABUSE_REPORT_ALREADY_OPEN`, `ABUSE_REPORT_RATE_LIMITED`, `ABUSE_REPORT_SELF`, `TICKET_CLOSED` | 409 hidden button / toast · 410 state · 409 admin toast + refresh · 422 admin inline · 422 product banner · 409 dialog state · 429 toast · 422 toast · 409 ticket state | I/E |
| AT-ERR-10 | `WEBHOOK_URL_INVALID`, `QUICK_REPLY_TITLE_TAKEN`, `CMS_LOCALE_MISSING`, `CMS_SLUG_TAKEN`, `REPORT_EXPORT_FAILED`, `JOB_NOT_CANCELLABLE`, `SAVED_VIEW_NAME_TAKEN`, `SAVED_VIEW_SHARED_READONLY` | 422 inline · 409 inline · 422 admin inline (fallback checkbox) · 409 inline · 500 row ÉCHEC + Réessayer · 409 toast · 409 inline · 403 tooltip | I/E |
| AT-ERR-11 | Every left-column code of 11 §13 | table-driven from 11 §13: each alias resolves to its canonical code through `packages/shared/src/errors/aliases.ts`; no alias string appears in any API response, in the i18n files, or anywhere in the code base outside `aliases.ts` (lint) | U |
| AT-ERR-12 | Greyed `Actions ⌄` items | the footer shows the localized message of the blocking code and the code in a tooltip; clicking a greyed item does nothing | E |
| AT-ERR-13 | Confirmation-flag codes | first call returns 409 with `data`; the dialog renders from it; second call with `confirm=true` succeeds; no side effect on the first call | I |

### State catalogues — one test per catalogue `[12 §16–28]`

| ID | Scenario | Covers | Lvl |
|---|---|---|---|
| AT-ST-01 | GLOBAL: banner priority — with suspended + reconnect + credits 100 % + plan expired + unverified all true, only "suspendu" shows; clearing each shows the next in the documented order; toasts stack max 3 and auto-dismiss at 5 s | 12 §16, D44 | E |
| AT-ST-02 | GLOBAL: system pages 403 (role named), suspended (reason, Contacter le support), session expired (return URL honoured), new web version dialog (drafts kept), mobile update required, maintenance banner, legal interstitial | 12 §16 | E |
| AT-ST-03 | AUTH catalogue: every row of 12 §17 reachable with a fixture (rate-limit countdown, 2FA n essais restants, 2FA asked at every login (no trusted-device option rendered), recovery code single use, forgot cooldown 0:58, reset done auto-login, invitation 6 states, "Créer mon espace" for an invited-only user, switcher ≥ 2 memberships, onboarding transverse states) | 12 §17 | E |
| AT-ST-04 | Home & notifications: 7 card types render; handled card greyed 24 h with actor; max 8 + Tout voir; family tabs counts equal server counts; empty "Vous êtes à jour ✓" | 12 §18 | E |
| AT-ST-05 | Inbox: 8 conversation banners render one at a time in priority; 7 composer states; every message type incl. audio transcription states and skipped-window label; client panel 4 states; "Bloqués" tab collapsed; WS reconnecting pill | 12 §23 | E |
| AT-ST-06 | Orders/delivery/clients: every row of 12 §20 (order page delivery block 5 variants, tracking panel states incl. rate-limit, bulk send results, labels viewer job states, send dialog courier error) | 12 §20 | E |
| AT-ST-07 | GDS: every row of 12 §21 (product page archived / moderation 4 states, cash register row variants, inventory dialogs, recommendations card states incl. APPLIQUÉE and simple-mode subset) | 12 §21 | E |
| AT-ST-08 | Agents & channels: wizard 5 steps with autosave label, agent page tabs and versions, configuration dirty/saving/conflict/validation, insights empty/grouped/already-handled, playground inspector and rate-limit, channel page 4 tabs with analysis states, connection report rows | 12 §22 | E |
| AT-ST-09 | Analytics/reports/billing: period picker errors, empty period CTA, comparison none, export job states, checkout return 5 states, plan change dialog with promo states, credits page negative balance banner | 12 §24 | E |
| AT-ST-10 | Settings/help/safety: 2FA 3 steps, sessions, integrations 5 Sheets states, API key shown once, webhook disabled banner, help contact suggestion + ticket pills, blocked list row kinds incl. PLATEFORME 🔒 | 12 §25 | E |
| AT-ST-11 | Platform admin: every page state of 12 §26 with fixtures (urgent moderation rows, dunning pills `dunning` d0 / d_plus_3 and `expired`, workspace pill EXPIRÉ (limites du plan gratuit), impersonation dialog read-only, provider fallback active, CMS locale missing, audit diff, queues INCIDENT, deletion request states, viewer masking) | 12 §26 | E |
| AT-ST-12 | Public pages: legal fallback banner, 404 + signed preview, pricing toggle, deletion page states, Meta deletion status 3 states, status page incident banner and history, tracking page | 12 §27 | E |
| AT-ST-13 | RTL: AR frames of Home, Inbox, Orders list v2, New order, Product form match snapshots; numbers, phones, SKUs stay LTR; Changa applied to Body AR | 12 §0, 08 §7.10 | E |
| AT-ST-14 | Responsive: Orders list at 1024 (icon sidebar, hidden columns) and 390 (cards, bottom-sheet actions, no multi-select); Home / Inbox / Order page checked at 1024 | 08 §7.10, LST-05 | E |

---

All questions are closed: `../audit/decisions-log-2026-10-11.md`.
