# 05 — Data model

PostgreSQL 16 + Prisma (D2). Derived from V1 `backend/prisma/schema.prisma`, cleaned.

## Conventions

- PK `id` UUID v7. `createdAt`, `updatedAt` everywhere. `deletedAt` where soft-deleted (`SD`). `version Int` on Order, Product, Agent, Conversation (04 §11).
- **Every business table has `workspaceId` NOT NULL + FK + index** (first column of composite indexes).
- Enums are Postgres enums. Money `Int` (DZD). JSON only for free-form data.
- Secrets `Bytes` AES-256-GCM (page tokens, courier credentials, AI keys, TOTP secrets, Google/webhook secrets). API keys, reset/verification/invite tokens: SHA-256 hashes.
- `prisma migrate` only.

`→` FK · `?` nullable · `U(...)` unique · `[FIG <frame>]` = field/entity added from the Figma web design (2026-10-06 pass; decisions D36–D71 of the README, all DECIDED). Sections 11–20 hold the Figma additions; existing rows were only extended, never renamed. **`docs/implementation/prisma-schema.prisma` is the source of every model, field and enum name; this file describes the same shape in prose — where a wording here and the schema differ, the schema wins.** Tenancy rule for every new table: `workspaceId` NOT NULL + FK + first column of every composite index, **except** platform-level tables (section 19) which have no `workspaceId` or a nullable one when a row may target one workspace.

## 1. Identity & tenancy

| Entity | Fields | Notes |
|---|---|---|
| **User** | email U, passwordHash, firstName, lastName, phone? `[FIG ADM-17]`, locale(fr/ar/en), avatarUrl?, emailVerifiedAt?, totpSecret?(enc), totpEnabled, recoveryCodes?(hashed JSON), **platformRole**(none/read/support/moderator/finance/super_admin — replaces `isSuperAdmin`; `isSuperAdmin` = `platformRole = super_admin`) `[FIG ADM-16]` (D41), **status**(active/blocked/deletion_scheduled) + blockedAt?, blockReason? `[FIG ADM-03]`, ownedWorkspaceId?→ (null for invited-only users, D30), **prefs JSON** `{ listDensity: compact\|comfortable, soundOnMessage, dismissedAnnouncementIds[] }` `[FIG ORD-05 v2, SET notifications]`, lastLoginAt?, lastSeenPlatform?(web/mobile), deletedAt? | `User.locale` drives UI + e-mails; saved views in `SavedView` (§16) |
| **RefreshToken** | userId→, familyId, tokenHash U, expiresAt, revokedAt?, userAgent?, ip? | rotation + reuse detection |
| **EmailToken** | userId→, kind(verify/reset/change_email), tokenHash U, payload?, expiresAt, usedAt? | |
| **Workspace** | name, slug U, logoUrl?, phone?, address?, senderWilayaId?→, locale, timezone('Africa/Algiers') `[FIG DLG Settings › Langue]`, stockMode(simple/advanced), onboardingStep, freeDeliveryThreshold?, autoPauseOnManualReply(true), handoffReminderMin(30), onlinePaymentEnabled(false), autoSendToCourier(false), defaultCourierAccountId?→ `[FIG MECH Delivery]`, targetMarginPct Int (default 35; Settings › Stock, advanced mode; PRIX recommendation rule, D69) `[FIG GDS-10]`, systemMessages JSON `{ handoff, out_of_stock, out_of_hours, welcome } × { fr, ar, en }` (D43, 04 §5; seeded at creation from `CmsEntry(type=system_message_default)`; the fixed platform texts `customer.unavailable`, `customer.unsupportedMedia`, `customer.voiceFailed` live in i18n, 11 §9, not here), **status**(active/suspended/deletion_scheduled) + suspendedAt?, suspendReason?(`SuspendReason` = fraud/unpaid/content/owner_request/other), suspendNote?, deletionScheduledAt? `[FIG ADM-02]`, **trustLevel**(`TrustLevel` = new/standard/trusted/watch, default `new`) + trustSetById?→ (last manual change) `[FIG ADM-10]` (D36, D52), **safetyRules JSON** `{ riskAfterReturns: 2, autoBlockEnabled: false, autoBlockAfterUncollected: 3, handoffOnRisk: true }` (`autoBlockEnabled` = the auto-block rule, OFF by default; `autoBlockAfterUncollected` = its threshold ≥ 1) `[FIG SAFE]` (D37), blockedWords text[] `[FIG SAFE, ADM-11]`, billingInfo JSON? {companyName, nif, address} `[FIG BIL-04]`, assistedOnboarding(false) `[FIG DLG Admin › Créer un espace]`, deletedAt? | `Workspace.locale` drives customer messages, exports, Sheets. Trial/expired come from `Subscription`, not from `status` |
| **Membership** | workspaceId→, userId→, role(owner/admin/operator), readOnly(false) | U(workspaceId,userId); partial U(workspaceId) where role=owner (D30) |
| **Invitation** | workspaceId→, email, role, tokenHash U, invitedById→, expiresAt, acceptedAt? | |
| **DeviceToken** | userId→, token U, platform(android/ios/web), lastSeenAt | FCM |
| **IdempotencyKey** | workspaceId→, key, actorKey (userId or apiKeyId), requestHash, responseCode, responseBody JSON, expiresAt | U(workspaceId,key), 24 h |
| **PlatformInvitation** | email (domain-restricted), platformRole, tokenHash U, invitedById→, expiresAt, acceptedAt? | `[FIG ADM-16 Inviter un membre plateforme]` (D41) |
| **LegalAcceptance** | userId→, legalDocumentId→, version Int, acceptedAt, ip?, client(`DevicePlatform` = android/ios/web) | U(userId, legalDocumentId, version) `[FIG ADM-13 Documents légaux]` (D39); written by `POST /legal/accept { key, version }` |

## 2. Billing

| Entity | Fields | Notes |
|---|---|---|
| **Plan** | slug U (immutable), name JSON, description JSON, priceMonthly, priceYearly, trialDays(14) `[FIG ADM-04]`, maxPages, maxAgents, maxProducts, maxConversationsPerMonth, maxMembers, maxApiKeys, maxWebhooks, syncHistoryDays `[FIG DLG Admin › Créer un plan]`, monthlyCredits, features text[] (`voice_notes, image_recognition, google_sheets, couriers, api_keys, webhooks, advanced_stock, scheduled_reports, instagram, priority_support, multi_workspace`) `[FIG ADM-04]`, providerPriceIds JSON, isActive, isFeatured (one), isVisible (pricing page) `[FIG PUB Pricing]`, sortOrder, **version** Int, archivedAt? | `-1` unlimited; every edit = new `PlanVersion` |
| **PlanVersion** | planId→, version, snapshot JSON, changedById→, impactCount, createdAt | U(planId, version) `[FIG ADM-04 Plan.version]`; subscribers keep their version until renewal (`PLAN_LIMIT_GRANDFATHERED`) |
| **Subscription** | workspaceId→, planId→, planVersion, status(`SubscriptionStatus` = trial/active/dunning/expired/cancelled) `[FIG ADM-05]`, billingCycle(monthly/yearly/none), provider(`BillingProvider` = none/chargily/manual), appliedPrice, discountPct?, promoRedemptionId?→, currentPeriodStart, currentPeriodEnd, trialEndsAt?, cancelAtPeriodEnd(false), cancelledAt?, cancelReason?, dunningStage?(`DunningStage` = d_minus_7/d0/d_plus_3/expired), providerSubscriptionId?, providerCustomerId? | exactly one current per workspace (partial unique where status in trial/active/dunning); plan derived from it. Dunning timeline 04 §14 (R-J): J+7 ⇒ `status=expired`, `dunningStage=expired`, new free subscription; non-payment never suspends (`Workspace.status=suspended` is an admin action) |
| **Invoice** | workspaceId→, number U (`F-<year>-<seq>`), kind(`InvoiceKind` = subscription/credit_pack/manual), subscriptionId?→, creditPackPurchaseId?→ U, amount, status(`InvoiceStatus` = upcoming/unpaid/paid/void/refunded), method?(`PaymentMethodBilling` = cib/edahabia/manual_transfer/manual_ccp/manual_cash/google_play/app_store), dueAt?, paidAt?, pdfUrl?, lines JSON, billingInfo JSON? (snapshot), dunningStage? | `[FIG BIL-04 Factures, ADM-05]`; legally kept 10 y without personal data (ADM-16). No credit-note column or status in v2 (D71) |
| **BillingPayment** | workspaceId→, invoiceId?→, subscriptionId?→, amount, status(pending/paid/failed/expired/refunded), provider(`BillingPaymentProvider` = chargily/manual/google_play/app_store), providerCheckoutId U, reference?, proofUploadId?→, recordedById?→ (manual), paidAt?, raw JSON? | `[FIG ADM-05 Paiement manuel]` (D71): one row per payment; amount = remaining ⇒ invoice `paid`; amount < remaining ⇒ invoice stays `unpaid` (`200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`); amount > remaining ⇒ `422 VALIDATION_ERROR` on `amount` |
| **CreditLedger** | workspaceId→, periodStart?, bucket(`CreditBucket` = plan/pack) `[FIG BIL-04]` (D40), action(text_reply/image_recognition/voice_transcription/reserve/release/renewal/pack_purchase/grant/store_refund/adjustment), kind(reserved/debit/release/credit), credits(signed), balanceAfter, aiRunId?→, conversationId?, agentId?, channelId?, creditPackPurchaseId?→, grantedById?→, reason?, idempotencyKey U | append-only; Figma label "CreditTransaction" = this table. Pack credits never expire and are consumed after plan credits; negative balance (store refund) blocks the AI |

## 3. Channels & conversations

| Entity | Fields | Notes |
|---|---|---|
| **Channel** | workspaceId→, platform(facebook/instagram), externalId, name, avatarUrl?, followersCount? `[FIG CHN-07b]`, accessToken(enc), tokenExpiresAt?, status(`ChannelStatus` = active/paused/pending_review/needs_reconnect/disabled/disconnected) `[FIG CHN-06 "EN ATTENTE META", MECH Channels "Désactiver temporairement"]`, pausedReason?(`PausedReason` = manual/plan/moderation), parentChannelId?→, connectedById→, icebreaker? `[FIG CHN-07b]`, grantedScopes text[], lastSyncAt?, lastInfoSyncAt?, lastSeenAt?, lastTokenCheckAt? | **U(platform, externalId)** global |
| **ChannelEvent** | workspaceId→, channelId→, kind(connected/reconnected/disconnected/disabled/enabled/token_checked/webhook_resubscribed/info_synced/history_synced/approved/agent_attached/agent_detached/released_by_admin), description?, actorType(user/system/admin), actorId?, at | `[FIG CHN-07b Historique de la page]`; idx(channelId, at) |
| **Conversation** | workspaceId→, channelId→, externalSenderId, clientId?→, agentId?→, assigneeId?→, status(active/needs_human/resolved/archived), aiPaused, unreadCount, lastMessageAt, lastCustomerMessageAt (24 h window), lastMessagePreview, lastAiIntent?(sale/info/tracking/complaint/greeting/other) `[FIG INB filter "Intention"]`, firstInboundAt, context JSON (cart, collected fields, lastLanguage), version, deletedAt? | U(channelId, externalSenderId); idx(workspaceId,status,lastMessageAt); "blocked" = join on `CustomerBlock` |
| **Message** | workspaceId→, conversationId→, externalId?, direction(in/out), type(text/image/audio/video/file/location/sticker/postback/product_cards/system) `[FIG DLG Inbox]`, author(customer/ai/human/system), authorUserId?→, text?, attachments JSON[{type,url,mime,size,caption?}], transcript?, transcriptStatus?(pending/done/failed/too_long), payload JSON? (cards, quick replies, postback), customerReaction?(like/dislike) `[FIG AGT-03 satisfaction 👍/👎]`, containsBlockedWord(false) `[FIG ADM-11]`, sentAt, deliveryStatus(pending/sent/failed/skipped_window), error?, aiRunId?→ | U(conversationId, externalId) |
| **ConversationNote** | workspaceId→, conversationId→, authorId→, body | |
| **QuickReply** | workspaceId→, title (≤ 80), body (≤ 1 000), shortcut? (`/[a-z0-9-]{1,29}`, ≤ 30), locale (default fr), sortOrder | seeded 4 V1 defaults; U(workspaceId, locale, title) (`QUICK_REPLY_TITLE_TAKEN`) `[FIG DLG Settings]`; body may use `{prénom} {boutique} {total}` |
| **InboundEvent** | provider(`InboundProvider` = meta/chargily/courier/google/google_play/app_store), externalId U, payload JSON, receivedAt, processedAt?, error? | raw webhooks (Meta, Chargily, couriers, Google, store refund notifications RTDN / App Store Server Notifications), 7 d |

## 4. AI

| Entity | Fields | Notes |
|---|---|---|
| **AiProvider** | key U(openai/anthropic/google/groq), displayName, apiKey(enc), isActive, isPrimary, lastTestedAt?, lastTestOk?, keyAddedAt? | platform `[FIG ADM-06]`; error rate 24 h computed from `AiRun` |
| **AiModel** | providerId→, modelId, displayName, capabilities text[](text/vision/transcription/embeddings) (replaces `supportsVision`), supportsTools, inputPricePerM, outputPricePerM, contextTokens?, timeoutSec(20), failoverThresholdPct(2), isActive, isDefault, isFallbackText, isFallbackVision | U(providerId, modelId) `[FIG DLG Admin › Modèle IA]` |
| **AiRoute** | capability U(text/vision/transcription/embeddings), primaryModelId→, fallbackModelId?→, creditCost (text 1 / vision 5 / voice 3 / embeddings 0 — D17), timeoutSec(20), errorThresholdPct(2), failoverActive(false), failoverSince?, updatedById→ | `[FIG ADM-06 Routage par capacité]`; supersedes `AiModel.isFallback*` as the source of truth for routing; AI HTTP timeout 45 s overall |
| **CreditPricing** | version U, usdToDzd, creditPriceDzd, costs JSON {text, image, voice, order}, avgTokensPerMessage, targetMarginPct, effectiveAt, createdById→, announcementCmsEntryId?→ | `[FIG ADM-06 Calculateur]` (D63): a new version changes the D17 constants only from each workspace's next credit period; requires a published CMS announcement + e-mail |
| **AgentPreset** | key U (slug), name JSON, tagline JSON, description JSON, badge?(recommended/popular/beta), sectors text[], status(draft/published/archived), currentVersion, sortOrder, archivedAt? | 4 V1 presets seeded `[FIG ADM-07]` |
| **AgentPresetVersion** | presetId→, version, status(draft/published/archived), locales JSON {fr/ar/en: {name, tagline, systemPrompt}} (variables `{{shop_name}} {{catalog}} {{delivery_grid}} {{policies}} {{language}}`), config JSON (tone, capabilities, handoffRules, maxReplyChars, model defaults), changelog?, testResults JSON?, publishedAt?, publishedById?→ | U(presetId, version) `[FIG ADM-07]`; publishing never changes existing agents (they get "Mise à jour disponible") |
| **Agent** | workspaceId→, name, description?, personality(professional/friendly/casual/technical), customInstructions, productCardTemplate?, closingInstructions?, humanHandoffRules?, modelId→, temperature, maxTokens, sellAllProducts, imageRecognition, voiceTranscription, responseDelaySec, isActive, pausedReason?(`PausedReason` = manual/plan/moderation), **status**(draft/active/paused) `[FIG AGT-01 "BROUILLON", MECH Agents]`, presetId?→, presetVersion?, currentVersion Int (= latest `AgentVersion.version`), lastActiveAt?, scheduledActivateAt? `[FIG AGT-02 step 5 "Activer à une date"]`, wizardStep?, version, deletedAt?, **+ the structured wizard columns of §15** | V1 prompt fields (D23) + status/version fields + wizard columns (D54), compiled into `customInstructions` / `humanHandoffRules` at every save; no `config` JSON blob. `modelId` is assigned by `AiRoute` routing, never by the merchant (R-H). Drafts never count toward `Plan.maxAgents` (D67) |
| **AgentVersion** | workspaceId→, agentId→, version, snapshot JSON (all Agent fields + FAQ + channels + products), note?, createdById→, source(manual/wizard/insight/preset_update/restore/generation), restoredFromVersion? | U(agentId, version) `[FIG AGT-03 Versions, AGT-04 "chaque enregistrement crée une version"]` |
| **AgentChannel** | agentId→, channelId→ U | |
| **AgentProduct** | agentId→, productId→ | U |
| **AgentInsight** | workspaceId→, agentId→, conversationId→, messageId?→, aiRunId?→, type(unclear/unknown_topic/handoff/error), customerMessage, aiResponse?, detail?, topicKey? (grouping "12 ×") `[FIG AGT-08]`, status(pending/resolved/dismissed), resolution?(instruction/faq/product/ignored_30d), resolvedById?, resolvedAt?, snoozedUntil? | idx(workspaceId, agentId, status, topicKey) |
| **AiRun** | workspaceId→, agentId?→, conversationId?→, kind(reply/test/vision/transcription/page_analysis/agent_generation/caption/faq_extraction/test_scenario), modelId→, providerId→, usedFallback(false), status(running/ok/unclear/unknown/handoff/error), intent?(sale/info/tracking/complaint/greeting/other), inputTokens, outputTokens, latencyMs, confidence?, creditsCharged, toolCallCount, error?, attempt, startedAt, finishedAt? | `[FIG AGT-07 inspecteur, ANA-02 cost]` |
| **AgentTestRun** | workspaceId→, agentId→, agentVersion, scenarioKey(darija_price/arabizi_delivery/photo/voice/off_catalog/anger/qty_limit/refund), status(pass/fail/error), summary?, aiRunId?→, at | `[FIG AGT-02 step 5 "8 scénarios"]` |
| **AgentTestLink** | workspaceId→, agentId→, tokenHash U, createdById→, expiresAt (24 h), usedCount | `[FIG AGT-02 step 5 / AGT-03 "Partager un lien de test"]`; public `GET /agent-test/:token` (web `/agent-test/[token]`), `AGENT_TEST_LINK_EXPIRED` after `expiresAt` |
| **AiToolCall** | aiRunId→, callId, name, args JSON, result JSON?, executedAt? | U(aiRunId, callId) — replay on retry |

## 5. Catalogue

| Entity | Fields | Notes |
|---|---|---|
| **Category** | workspaceId→, name, description?, color, parentId?→ (2 levels max) `[FIG DLG GDS › Nouvelle catégorie]`, imageUploadId?→, deletedAt? | partial U(workspaceId, name) (`CATEGORY_ALREADY_EXISTS`) |
| **Unit** | workspaceId?→, name, abbreviation, isSystem, containsQty?, baseUnitId?→ (e.g. "Boîte de 6 = 6 × Pièce") `[FIG DLG GDS › Nouvelle unité]` | system 7 |
| **Product** | workspaceId→, sku, name, description?, categoryId?→, unitId?→, trackStock, price, oldPrice?, costPrice? (weighted average, updated on purchase receipt `[FIG GDS-07]`), stock?(null when untracked), minStock, weightGrams?, keywords text[], hasVariants, isActive, **moderationStatus**(not_required/pending/approved/rejected/appealed) + moderationItemId?→ + approvedSnapshot JSON? (last approved title/description/images/category/price — the version still sold while a re-review is pending) + contentVersion Int `[FIG MOD, CAT-09 "Validation Djaber"]` (D36), createdById?→, lastInventoryAt?, version, deletedAt? | partial U(workspaceId, sku) live; trigram idx(name, keywords, description); idx(workspaceId, moderationStatus). "Reserved" stock = Σ confirmed-not-shipped order lines (computed) |
| **ProductImage** | productId→, storageKey, url, width, height, sortOrder, isPrimary, aiCaption?, altText?, moderationFlag?(logo/inappropriate) `[FIG MOD rejected view]` | ≤ 10 per product (`IMAGES_LIMIT`), ≤ 5 MB each, min 600 px (warning `IMAGE_SMALL` below); the Figma "8 max / 8 Mo / 500 px" text is a Figma fix (D65, R-E) |
| **ProductVariant** | productId→, name, sku?, attributes JSON, price, costPrice?, stock, minStock, isActive, deletedAt? | U(productId, name); SKU in global partial unique with products; ≤ 100 per product (`VARIANT_LIMIT`) `[FIG DLG GDS › Générer des variantes]` |
| **ProductExpense** | workspaceId→, productId→, category(marketing/shipping/packaging/customs/storage/other), description?, amount, isPerUnit, date, createdById→ | `[FIG DLG GDS II › Dépense produit]` |
| **Recommendation** | workspaceId→, productId→, recommendedId→, type(cross_sell/up_sell), score, reason?, source(manual/rules), impressions, conversions, revenue, isActive | U(productId, recommendedId, type); manual rules take precedence over rule-generated ones |
| **RecommendationEvent** | recommendationId→, conversationId→, kind(impression/conversion), orderId?→, at | attribution 7 d |
| **StockMovement** | workspaceId→, productId→, variantId?→, type(in/out/adjustment_in/adjustment_out/inventory/return) `[FIG GDS-05 filter]`, quantity(signed), quantityBefore, quantityAfter `[FIG GDS-05 "AVANT → APRÈS"]`, reason?(order_delivered/order_created/order_cancelled/order_returned/sale/sale_cancelled/purchase/purchase_cancelled/breakage/loss/initial/inventory/correction/archive/import/other), note?, refType?(order/sale/purchase/inventory/import/manual/variant), refId?, actorId?→, reversedByMovementId?→ | append-only, immutable (`GDS_MOVEMENT_IMMUTABLE`); "contre-passer" = new inverse movement with `reason=correction` |

## 6. Customers

| Entity | Fields | Notes |
|---|---|---|
| **Client** | workspaceId→, name, phone?, phone2?, email?, notes?, tags text[], source(manual/ai/import/api), isPlaceholder, orderCount, totalSpent, lastOrderAt?, returnCount, cancelCount, uncollectedCount `[FIG SAFE auto rules, DLG Marquer retournée "+1 retour"]`, riskLevel(normal/high), riskSetManually(false) `[FIG SAFE "Marquer risque"]`, mergedIntoId?→, deletedAt? | partial U(workspaceId, phone) live. Pills: FIABLE = ≥ 1 delivered & 0 return; INCONNU = 0 order; RISQUE = `riskLevel=high`; BLOQUÉ = active `CustomerBlock`; PLACEHOLDER = `isPlaceholder` `[FIG REF Component sheet]` |
| **ClientAddress** | clientId→, wilayaId→, communeId?→, communeText?, address?, isStopdesk, stopdeskId?, isDefault | |
| **ClientIdentity** | clientId→, channelId→, externalSenderId, displayName?, avatarUrl? | U(channelId, externalSenderId) |

## 7. Orders & delivery

| Entity | Fields | Notes |
|---|---|---|
| **Order** | workspaceId→, number, clientId→, conversationId?→, channelId?→, **source(ai/manual/mobile/api/import)** `[FIG ORD-05 v2 SOURCE column]` **(D42)**, agentId?→ (source ai), createdById?→ (manual/mobile), apiKeyId?→ (api), importJobId?→ (import), assigneeId?→ `[FIG DLG Orders › Assigner]`, status, confirmationStatus(pending/no_answer/confirmed/rejected/wrong_number/callback) `[FIG REF pills "FAUX NUMÉRO", "RAPPEL"]`, callbackAt? `[FIG DLG Programmer un rappel]`, paymentStatus, deliveryStatus, paymentMethod(cash/card/transfer/ccp/other), clientName, clientPhone, clientPhone2? `[FIG DLG Modifier l'adresse]`, wilayaId?→, communeId?→, communeText?, address?, isStopdesk, stopdeskId?, subtotal, discount, tax, deliveryFee, courierCost? (informational, D15), returnFee? (D27), total, amountPaid, callAttempts, riskLevel (snapshot of Client at creation), notes?, labelPrintedAt? `[FIG DLG Imprimer les bordereaux]`, orderedAt, confirmedAt?, shippedAt?, deliveredAt?, cancelledAt?, cancelReason?(unreachable/changed_mind/fake/unavailable/duplicate/other) + cancelNote?, version | U(workspaceId, number); idx(workspaceId, source, agentId), idx(workspaceId, assigneeId, status), idx(workspaceId, callbackAt) |
| **OrderItem** | orderId→, productId→, variantId?→, productName, variantName?, sku?, unitPrice, costPrice?, quantity, discount, total | snapshots |
| **OrderStatusHistory** | orderId→, field, from, to, actorType(user/ai/system/courier/api), actorId?, reason?, effectiveAt? (back-dated ≤ 7 d `[FIG DLG Changer le statut]`), at | |
| **OrderCall** | orderId→, userId→, result(picked_up/no_answer/busy/voicemail/rejected/wrong_number/callback) `[FIG DLG Résultat de l'appel]`, callbackAt?, notes?, calledAt | `callAttempts` = count |
| **OrderNote** | orderId→, authorId→, body | |
| **PaymentEntry** | workspaceId→, sourceType(order/sale/purchase), sourceId, amount(signed; refund negative), method(cash/card/transfer/ccp/other), reference?, note?, paidAt, createdById→, cashTransactionId?→ | `[FIG DLG Enregistrer un paiement, Encaisser le reste, Paiement fournisseur]` — one row per recorded payment; `amountPaid` on the source = Σ rows (recomputed, never incremented); each row creates its locked `CashTransaction(isAutomatic=true, sourceType=payment_entry)` |
| **OrderPayment** | workspaceId→, orderId→, provider, amount, status(pending/paid/failed/expired/refunded/mismatch), checkoutUrl?, providerRef? U, expiresAt?, paidAt?, refundReason?, refundedAt?, raw JSON | P2; one active link per order |
| **Wilaya** | id 1–69, code, nameFr, nameAr | seed — 69 since loi n° 26-06 du 4 avril 2026 (JO n° 25): ids up to 58 are the historical wilayas, 59–69 carved out of a parent (59 Aflou ← 03, 60 Barika ← 05, 61 El Kantara ← 07, 62 Bir El Ater ← 12, 63 El Aricha ← 13, 64 Ksar Chellala ← 14, 65 Aïn Oussera ← 17, 66 Messaad ← 17, 67 Ksar El Boukhari ← 26, 68 Bou Saâda ← 28, 69 El Abiodh Sidi Cheikh ← 32). The parent link is code, not a column (`WILAYA_PARENT`, `courierWilayaId` in `@djaber/shared` geo.ts; couriers receive the parent code, 04 §22). Data migration `20261015120000_wilayas_69` (idempotent) |
| **Commune** | id, wilayaId→, nameFr, nameAr, postalCode? | seed (official list); 108 communes re-attached to the wilayas 59–69 by the 2026-10-15 migration (ids unchanged; commune lists of geoalgeria 1.3.0 citing the JO, matched by name inside the parent) |
| **CourierCommuneMap** | provider, communeId→, externalCode, stopdeskIds JSON | U(provider, communeId) |
| **CourierStopdesk** | provider, communeId→, externalId, name, address? | U(provider, externalId) `[FIG DLG Modifier l'adresse "liste des agences par commune"]` |
| **DeliveryFeeRule** | workspaceId→, wilayaId→, homePrice, stopdeskPrice, returnPrice(0), freeAbove? (free home delivery above this order total in DA; null ⇒ `Workspace.freeDeliveryThreshold`) `[FIG DLV-01 "Gratuit dès"]`, isActive, source(default/custom) `[FIG DLV-01 "SOURCE"]` | U(workspaceId, wilayaId); `DELETE /delivery/fees/:wilayaId` resets the row to `source=default` |
| **CourierRateCache** | courierAccountId→, wilayaId→, homePrice?, stopdeskPrice?, avgDays?, fetchedAt | U(courierAccountId, wilayaId); 1 h TTL (DLV-07) `[FIG DLV-01 "COÛT ZR"]` |
| **CourierAccount** | workspaceId→, provider(zrexpress/ecotrack/yalidine), baseUrl(default ''), displayName, credentials(enc), isActive, isDefault, senderName?, senderPhone?, senderAddress?, senderWilayaId?, webhookSecret?(enc), lastTestedAt?, lastTestOk?, lastTestLatencyMs? `[FIG DLV-01/03 "TESTÉ IL Y A 2 H"]` | U(workspaceId, provider, baseUrl); capabilities come from the adapter, not stored |
| **Shipment** | workspaceId→, orderId→, provider(manual/zrexpress/ecotrack/yalidine), courierAccountId?→ (null when manual), status(pending/sent/picked_up/in_transit/out_for_delivery/delivered/failed/returned/cancelled/stale) `[FIG REF pill "RAMASSÉE"]`, trackingNumber?, externalId?, labelUrl?, publicTrackingToken U `[FIG DLV-06 "QR = lien de suivi public djaber.ai/s/…"]`, codAmount, weightKg?, contentSummary?, stopdeskId?, courierCost?, failureReason?(address/unreachable/refused/damaged/other), deliveryAttempts(0) `[FIG DLV-08 "tentative 2/3"]`, rawStatus?, lastSyncedAt?, nextSyncAt?, attempts, lastError? (a canonical 11 code: `COURIER_VALIDATION` / `COURIER_CREDENTIALS_INVALID` / `COURIER_UNAVAILABLE`), cancelledAt? | partial U(orderId) where status not in (cancelled, failed, returned, stale); idx(workspaceId, status, lastSyncedAt). `picked_up` is a status (RAMASSÉE); `stale` = no event for 30 d (04 §22) |
| **ShipmentEvent** | shipmentId→, rawStatus, mappedStatus, description?, location?, at, source(webhook/poll/manual/system), actorId?→ | `[FIG DLV-08 timeline]` |
| **SheetsConnection** | workspaceId→ U, googleEmail, refreshToken(enc), spreadsheetId, sheetName, filters JSON, status(active/error/disconnected), lastSyncAt?, lastError? | |
| **SheetsRow** | connectionId→, orderId→ U, syncedAt | located by `djaber_id` column |

## 8. GDS — suppliers, purchases, sales, cash (P2)

| Entity | Fields |
|---|---|
| **Supplier** | workspaceId→, name, email?, phone?, address?, notes?, terms?, paymentTermsDays?, avgLeadDays?, isActive, deletedAt? `[FIG GDS-06, DLG GDS › Nouveau fournisseur]` |
| **Purchase** | workspaceId→, number, supplierId?→, status(draft/pending/partial/received/cancelled) (`draft` = "Brouillon" `[FIG GDS-07]`; `pending` = "Commandé"), supplierInvoiceRef?, subtotal, tax, shippingCost, total, amountPaid, paymentMethod, paymentStatus(unpaid/partial/paid), notes?, cancelReason?, createdById→, purchasedAt, expectedAt?, receivedAt?, cancelledAt? |
| **PurchaseItem** | purchaseId→, productId→, variantId?→, productName, variantName?, quantity, receivedQty, unitCost, total |
| **Sale** | workspaceId→, number, clientId?→, customerName?, customerPhone?, status(draft/completed/cancelled) `[FIG GDS-08]`, subtotal, discount, tax, total, amountPaid, paymentMethod(cash/card/transfer/ccp/other), paymentStatus(unpaid/partial/paid), notes?, createdById→ ("vendeur"), soldAt, cancelledAt?, cancelReason?, stockRestored? | partial payment requires `clientId` (`SALE_PARTIAL_REQUIRES_CUSTOMER`); cancel ≤ 7 d (`SALE_CANNOT_CANCEL_AFTER_7D`) `[FIG DLG GDS › Annuler la vente]` |
| **SaleItem** | saleId→, productId→, variantId?→, productName, variantName?, quantity, unitPrice, costPrice?, discount, total |
| **CashTransaction** | workspaceId→, type(income/expense), amount, category(sale/order/purchase/rent/salary/utilities/marketing/shipping/deposit/withdrawal/correction/refund/other) `[FIG GDS-09 types APPORT · RETRAIT · CORRECTION]`, method(cash/ccp/card/transfer/other) `[FIG GDS-09 "MODE"]`, reference?, description?, date, isAutomatic (locked: `403 CAISSE_EDIT_AUTOMATIC` on edit/delete), sourceType?(`CashSourceType` = order/sale/purchase/payment_entry/closing), sourceId?, closingId?→, createdById?→, proofUploadId?→, correctsTransactionId?→ | The Figma frames use an old label for this table, corrected by D65 — the only entity name is `CashTransaction`. Manual rows editable ≤ 24 h (`CASH_ENTRY_EDIT_WINDOW_EXPIRED`) and only while the day is open (`409 CASH_DAY_CLOSED`); a correction of an automatic row = new `category=correction` row with `correctsTransactionId` |
| **CashClosing** | workspaceId→, day (date), theoreticalBalance, countedBalance, difference, note? (required if difference ≠ 0), closedById→, closedAt, reopenedById?→, reopenedAt? | U(workspaceId, day) `[FIG GDS-09 Clôturer la journée]` (D56); `POST /cash/close` creates the row and, when `difference ≠ 0`, one `CashTransaction(category=correction, isAutomatic=true, sourceType=closing, closingId)`; `POST /cash/days/:day/reopen { reason }` (Admin+, audited) sets `reopenedById` / `reopenedAt`. There is no separate "cash day" entity |

## 9. Platform

| Entity | Fields | Notes |
|---|---|---|
| **Notification** | workspaceId?→ (null for account-level), userId?→, type(enum `NotificationType`, 56 values = the dotted slugs of 03 §15 in snake_case, e.g. `order.ai_created` → `order_ai_created`), title JSON, body JSON, data JSON (deep-link params), readAt? | localized at render; idx(userId, readAt, createdAt), idx(workspaceId, type, createdAt). Channels and deep links per type: 03 §15 (single source) |
| **NotificationPreference** | membershipId→, type, email, push, sound(false) `[FIG SET notifications "SON"]` | |
| **Upload** | workspaceId?→, storageKey, url, mime, size, kind(avatar/logo/reply/label/export/report/ticket_attachment/appeal_attachment/payment_proof/cash_proof/category_image/faq_file/inventory_sheet), createdById→ | |
| **ApiKey** | workspaceId→, name, environment(live/test) (prefix `dj_live_` / `dj_test_`) `[FIG SET Intégrations]`, prefix, keyHash U, scopes text[] (enum §18), lastUsedAt?, lastUsedIp?, revokedAt?, createdById→ | `maxApiKeys` per plan |
| **WebhookEndpoint** | workspaceId→, url, events text[] (06 §4 + `order.delivered`, `product.updated`), secret(enc), isActive, failureCount, disabledAt?, disabledReason?, lastDeliveryAt?, secretRotatedAt?, createdById→ | `[FIG SET Intégrations › Webhooks]`; `maxWebhooks` per plan |
| **WebhookDelivery** | endpointId→, event, payload JSON, attempt, status(pending/success/failed/exhausted), responseCode?, durationMs?, error?, nextAttemptAt?, replayOfId?→ | 30 d |
| **Outbox** | workspaceId?, topic, key, payload JSON, processedAt?, attempts | transactional outbox; `@@unique([topic, key])` — `OutboxService.enqueue` inserts with `ON CONFLICT DO NOTHING` (dedup); idx(processedAt, createdAt) |
| **DailyStat** | workspaceId→, day (date), metrics JSON `{ conversations, aiReplies, handoffs, orders, revenue, credits, byChannel, byAgent, byWilaya }`, computedAt | U(workspaceId, day); analytics daily rollup (ANA-02) recomputed by `sched-daily-stats`, never incremented |
| **ReportSchedule** | workspaceId→, reportKey, email, dayOfMonth(1), createdById→ | U(workspaceId, reportKey, email); `POST\|DELETE /reports/:key/schedule { email, dayOfMonth }`, plan feature `scheduled_reports` (D62, P2) |
| **Job** | workspaceId?→ (null for platform jobs), kind(import/analysis/generation/bulk_send/bulk_status/bulk_products/backfill/export/report_export/recommendations/labels/sync_history/tracking_refresh/inventory/agent_test_scenarios/audit_export/data_export/faq_extraction/translate), queue?, status(queued/running/done/partial/failed/cancelled), progress, total?, payload JSON?, result JSON? (per-item results for bulk), error?, resultUploadId?→, expiresAt?, createdById?→ | long jobs `[FIG ANA-03 export jobs, DLV-06 fusion de bordereaux]` |
| **AuditLog** | workspaceId?, actorType(user/admin/system/api_key), actorId?, actorRole?, action (dotted key, e.g. `workspace.suspend`, `credits.grant`, `plan.update`, `impersonation.start`, `viewer.open`), entity, entityId, before JSON?, after JSON?, diff JSON, **reason?** (required for sensitive admin actions), impersonationSessionId?→, ip?, userAgent?, sessionId?, at | 2 y; immutable; signed CSV export `[FIG ADM-09]` |
| **Counter** | workspaceId→, key(order/sale/purchase/inventory/ticket), value | U; platform counters (`invoice`, `ticket`) use `workspaceId = null` |
| **CmsPage** | *superseded by `CmsEntry` (§19) — V1 rows migrate to `CmsEntry(type=legal\|page)` with locale `fr` (D26)* | |

## 10. V1 → v2 migration mapping (D3)

| V1 | v2 | Rule |
|---|---|---|
| User (plan, credits*) | User + owned Workspace + Membership(owner) + Subscription + CreditLedger | plan `individual/teams` or slug → Plan by slug (unknown → free); `creditsUsed` → one debit row |
| Page | Channel | token re-encrypted; `isActive=false` → `disconnected` and the plaintext token **discarded**; IG rows → `parentChannelId` when found |
| PageAISettings, AISettings | dropped | agents only |
| Conversation | Conversation | `resolved && aiPaused` with pending insight → `needs_human`; sender → ClientIdentity |
| Message | Message | `messageId` prefixed `agent_/ai_` → author `ai`; other outgoing → `human`; incoming → `customer` |
| Agent / AgentPage / AgentProduct / AgentInsight | same | `aiModel` string → AiModel by modelId (unknown → default) |
| Product | Product | `trackStock=false` → `stock=null`; `archivedSku` rows → `deletedAt`, sku restored; `Decimal` → Int rounded; `unit` label → Unit by name |
| ProductImage / Variant / Expense / Recommendation | same | variant SKU conflicts → suffixed + report |
| Client | Client + ClientAddress | phone normalised; duplicates merged (oldest survives, report); `address` → `ClientAddress.address` (no wilaya); "FB/IG User" → `isPlaceholder` |
| Order | Order | `pending→new`; `paymentStatus pending→unpaid`; `communeName` → `Commune` by fuzzy match else `communeText`; numbers kept; `orderDate→orderedAt` |
| OrderItem / OrderCall | same | |
| Sale / SaleItem / Purchase / PurchaseItem / Supplier / CaisseTransaction / StockMovement | same (`CaisseTransaction→CashTransaction`, `sourceId`→`sourceType+sourceId`) | SaleItem variant resolved by `productName` suffix when possible; legacy numbers `SL-…`/`PO-…` preserved, counters start after max |
| DeliveryFeeRule | same | |
| DeliveryProvider | not migrated | merchants reconnect couriers (credentials format differs) |
| AIProvider | AiProvider + AiModel | models JSON → rows |
| Plan / Subscription | same | `maxConversations→maxConversationsPerMonth`, `maxTeamMembers→maxMembers`, `currency` dropped (DZD); `trial→trial`; one active per workspace enforced (latest wins, report) |
| CreditUsage | CreditLedger | `estimated` rows kept with flag |
| Notification / DeviceToken (Expo) | Notification / dropped | types: `ai_order→order.ai_created`, `agent_insight→agent.insight` (metadata handoff → `conversation.handoff`), `stock_alert` (credits rows) → `credits.exhausted`, `delivery_sent→shipment.created`, push-only `paused_message→conversation.needs_human_message` |
| CmsPage | CmsEntry (type `legal`/`page`) + CmsEntryLocale `fr` (D26) | |
| User.isAdmin | `User.platformRole = super_admin` (`isAdmin=false` → `none`) | D41 (DECIDED); every migrated platform user must enable 2FA before accessing `/admin` |
| Order.source `manual/ai/api` | `manual/ai/api` kept; `mobile`/`import` only for new rows | — |
| CaisseTransaction | CashTransaction (`method = cash` when unknown) | — |

Dry-run report: per table counts in/out/rejected with reasons; acceptance: counts equal, Σ order totals and Σ stock per workspace equal (13).

---

# Figma additions (2026-10-06 pass)

Everything below exists in the web Figma and was missing from §1–§10. Sources are frame names of the "Web V2" page (id 898:24126). Every entity below is DECIDED (README D36–D71, `../audit/decisions-log-2026-10-11.md`) and exists in `prisma-schema.prisma` with exactly these names.

## 11. Product moderation (store compliance) (D36, D52)

| Entity | Fields | Notes |
|---|---|---|
| **ModerationItem** | workspaceId→, type(product/product_image/agent_prompt/category), productId?→, agentId?→, categoryId?→, contentVersion, snapshot JSON (title, description, price, categoryId, images[]), status(pending/auto_approved/approved/rejected/changes_requested/appealed/appeal_rejected), aiScore(0–1), aiFlags JSON[{code, field?, message}] (`protected_brand`, `misleading_price`, `prohibited_category`, `single_image`, `logo_detected`…), priority(normal/urgent), slaDueAt, assigneeId?→ (platform user), reviewerId?→, decision?(counterfeit/prohibited/inappropriate_image/misleading/missing_info/other), reasonTemplateKey?, merchantMessage? (FR, auto-translated AR), rejectedFields text[], decidedAt?, submittedAt, source(create/update/import/page_extraction/duplicate/restore) | `[FIG ADM-10 "MODÈLE : ModerationItem(...)", MOD]`; idx(status, priority, submittedAt); idx(workspaceId, productId, submittedAt). One item per (product, contentVersion). Auto-approve when `aiScore ≥ 0.9 ∧ Workspace.trustLevel ∈ standard/trusted ∧ category not sensitive`; else human queue, SLA 2 business hours |
| **ModerationAppeal** | workspaceId→, moderationItemId→ U (one appeal per item), message (≤ 500), attachmentUploadId?→, submittedById→, submittedAt, deadlineAt (rejection + 7 d), reviewerId?→ (must differ from `ModerationItem.reviewerId`), decision?(upheld/overturned), decisionNote?, decidedAt? | `[FIG MOD rejected view + appeal dialog]`; `MODERATION_APPEAL_ALREADY_USED`, `MODERATION_APPEAL_WINDOW_EXPIRED` (after `deadlineAt`), `MODERATION_NOT_REJECTED` (appeal on a non-rejected item) |
| **ModerationRule** | key U, kind(blocked_word/protected_brand/prohibited_category/sensitive_category/price_reference), value, locale?, categoryId?→, referencePrice?, isActive, createdById→ | platform table `[FIG ADM-10 "Mots & catégories interdits"]` |

Trust-level transitions (D52, 04 §12): `new → standard` automatically (daily job `sched-trust-levels` and on each approval) when ≥ 10 `approved` items and 0 `rejected` in the last 30 days; `standard → trusted` manual only (moderator, reason, audited); `any → watch` automatically when `count(rejected ∧ decision=counterfeit, 90 d) ≥ 3` (everything then goes to human review); at 5 the workspace is listed in ADM-01 "Suspension proposée" (admin decides); `watch → standard` manual only (moderator). Manual changes write `Workspace.trustSetById` and an `AuditLog` row with `reason`.

## 12. Trust & safety — reports, blocks, blacklist (D37)

| Entity | Fields | Notes |
|---|---|---|
| **Report** | workspaceId?→ (null when filed by an end customer against a merchant), type(conversation/customer/merchant/ai_message/product), reporterKind(merchant_user/end_customer/system), reporterUserId?→, reporterEmail?, conversationId?→, clientId?→, messageId?→, aiRunId?→, productId?→, targetWorkspaceId?→, reason(harassment/fraud/spam/inappropriate_content/ai_incorrect/other), details?, excerpt JSON (10 last messages, partially masked), severity(low/medium/high), status(open/reviewing/actioned/dismissed), assigneeId?→, decision?(block_confirmed/platform_blacklist/reported_to_meta/dismissed/more_info), decisionNote?, resolvedById?→, resolvedAt?, reporterNotifiedAt?, blockRequested(false) | `[FIG ADM-11 "Report(type … status …)", SAFE]`; idx(status, severity, createdAt); decision < 24 h, reporter notified (`report.resolved`) |
| **CustomerBlock** | workspaceId→, clientId?→, phone?, channelId?→, externalSenderId?, reason?(`BlockReason` = harassment/fraud/spam/inappropriate/uncollected/other), note?, source(`BlockSource` = manual/auto_rule/platform), reportId?→, blockedById?→, blockedAt, unblockedById?→, unblockedAt? | `[FIG SAFE "Clients bloqués (CustomerBlock)"]`; partial U(workspaceId, clientId) where unblockedAt null; `source=platform` rows are not unblockable by the merchant (`403 CUSTOMER_BLOCKED_BY_PLATFORM`); `auto_rule` rows come from `Workspace.safetyRules` (04 §13). Effects: no AI reply, conversation moves to the "Bloqués" tab, AI never creates an order, manual order asks confirmation, silent towards the customer |
| **PlatformBlacklist** | phone U (normalised), reason, reportId?→, workspaceCount, createdById→, createdAt, revokedById?→, revokedAt? | platform `[FIG ADM-11 "Liste noire plateforme"]`; auto-proposed when the same phone is blocked by ≥ 3 workspaces in 7 d |
| **BlockedWord** | workspaceId?→ (null = platform list), word, locale?, createdById→ | U(workspaceId, word) `[FIG ADM-11 "Mots bloqués", SAFE]`; an AI reply containing a blocked word is never sent (replaced by handoff); inbound matches set `Message.containsBlockedWord` |

## 13. Support (D38)

| Entity | Fields | Notes |
|---|---|---|
| **SupportTicket** | number U (`T-<seq>`), workspaceId?→, userId→, category(`TicketCategory` = meta_connection/credits/billing/delivery/integrations/agent/stock/mobile/security/other), priority(`TicketPriority` = low/normal/high/urgent), channel(`TicketChannel` = web/mobile/email/chat), status(`TicketStatus` = open/pending_customer/resolved/closed), subject, context JSON (workspace, plan, page, app version, browser, last errors — never customer messages), assigneeId?→ (platform user), firstResponseAt?, slaDueAt, slaHours (Pro 1 / Starter 4 / Free 24, business hours Africa/Algiers), resolvedAt?, closedAt?, satisfaction?(1–5), satisfactionNote?, incidentId?→, escalatedAt?, escalationNote? | `[FIG ADM-12 "Ticket(category, priority, channel …)", HELP]`; idx(status, slaDueAt), idx(workspaceId, createdAt). Operators may open tickets; admins of the workspace see them all |
| **SupportMessage** | ticketId→, authorKind(user/support/system), authorId?→, body, attachments JSON[{uploadId,name,size}], isInternal(false), cannedReplyKey?, at | `[FIG ADM-12 thread]` |
| **CannedReply** | key U (`/sheets-reconnect`), title, body JSON {fr,ar,en}, category?, createdById→, updatedAt | platform `[FIG ADM-12 "Réponses types"]` |

## 14. Account lifecycle & platform team

| Entity | Fields | Notes |
|---|---|---|
| **AccountDeletionRequest** | userId→, source(`DeletionSource` = app/public_page/admin), status(`DeletionStatus` = pending_confirmation/grace/blocked/anonymised/cancelled), tokenHash? U (24 h e-mail link), requestedAt, confirmedAt?, scheduledAt? (confirmedAt + 30 d), blockedReason? ∈ `ACCOUNT_OWNS_WORKSPACE` \| `WORKSPACE_HAS_DEBT` (string column holding the 11 code), exportJobId?→, cancelledAt?, processedAt?, processedById?→, ip? | `[FIG ADM-16 "AccountDeletionRequest", PUB account deletion]` (D39, D50); partial U(userId) where status in (pending_confirmation, grace, blocked). Anonymisation = name, e-mail, phone, avatar replaced; invoices kept 10 y |
| **ImpersonationSession** | adminUserId→, workspaceId→, reason (≥ 10 chars), ticketId?→, startedAt, expiresAt (= startedAt + 30 min), endedAt?, actionsCount | `[FIG ADM-02 "IMPERSONATION (DIALOGUE)", ADM-16 matrix]` (D21-bis, R-F): read-only only — no `mode` column, no owner notification; every non-GET request under `X-Impersonation-Session` ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`; `AuditLog.impersonationSessionId` links every request; endpoints `/admin/impersonation/sessions` (04 §17) |
| **DataDeletionRequest** | provider(meta), confirmationCode U, externalUserId, status(pending/done/not_found), requestedAt, completedAt?, affectedWorkspaces Int | `[FIG PUB "Statut de suppression de données Meta — /data-deletion/:code"]` (MSG-08) |

Platform roles (`User.platformRole` ∈ `PlatformRole` = none/read/support/moderator/finance/super_admin) — capability matrix `[FIG ADM-16]`: 01-nest-module-map §3.2 is the single table (keys `admin.<area>.read` and `admin.<area>.write`); impersonation = `super_admin` + `support` only.

## 15. Agent wizard fields (D23, D54 — final)

These columns exist on **Agent** (schema) and are snapshotted in `AgentVersion.snapshot`. They are **compiled into the prompt fields `customInstructions` (sections) and `humanHandoffRules` (one line per rule) at every save**; the AI pipeline reads only the prompt fields. The merchant edits either the structured form or the raw instructions (advanced mode), never both in one save.

| Group `[FIG AGT-02]` | Fields |
|---|---|
| Identity (step 1) | displayName? (shown to customers; empty = page name), avatarUploadId?→, avatarMode?(page/upload/initials), languages text[] (darija/arabizi/fr/ar/kabyle/en), defaultLanguage?, tone?(`AgentTone` = warm/professional/casual/premium), formality?(`Formality` = follow_customer/tu/vous), emojiLevel?(`EmojiLevel` = none/moderate/many) |
| Knowledge (step 2) | catalogScope(`CatalogScope` = all/categories, default all), scopeCategoryIds text[], outOfStockBehavior(`OutOfStockBehavior` = say_unavailable/suggest_alternative, default suggest_alternative), showMissingVariants(true), policies JSON? {delivery, payment, returns, hours}; FAQ rows in `AgentFaq` |
| Behaviour (step 3) | capabilities JSON? {replyText, imageRecognition, voiceTranscription, takeOrders, quoteDelivery, crossSell} (imageRecognition/voiceTranscription mirror the V1 columns), orderFields JSON? [{key, required, locked}] (product, quantity, name, phone, wilaya locked; commune, address, phone2, note optional), maxQtyPerOrder? (default 5 when null), maxAmountPerOrder? (default 50 000 when null), riskyClientBehavior?(`RiskyClientBehavior` = take_and_flag/handoff), recapMode?(`RecapMode` = always/when_unsure), handoffRules JSON? [{kind: human_request/refund/complaint/anger/3_unclear/off_topic/over_limits/risky_client/keyword, enabled}], handoffKeywords text[], businessHours JSON? `{days: [0-6], from: "HH:mm", to: "HH:mm"}` (Africa/Algiers; outside ⇒ workspace system message `out_of_hours`, D43). The handoff and out-of-hours texts are `Workspace.systemMessages.handoff` / `.out_of_hours`, not agent columns |
| Model (not a step) | `modelId` assigned by `AiRoute` routing at save and on fallback; `temperature` / `maxTokens` from `AgentPresetVersion.config`; the merchant never chooses (R-H) |

| Entity | Fields | Notes |
|---|---|---|
| **AgentFaq** | workspaceId→, agentId→, question, answer, source(manual/page_extraction/ai_suggested/file_import), askedCount?, sortOrder, isActive | ≤ 50 entries / 20 000 chars per agent `[FIG AGT-02 step 2]`; "Résoudre l'insight → Créer une FAQ" creates a row |

## 16. Saved views & user preferences **(D42)**

| Entity | Fields | Notes |
|---|---|---|
| **SavedView** | workspaceId→, userId→, page(orders/products/clients/inbox/delivery/movements/agents/channels/notifications/purchases/sales/cash), name, filters JSON (the list query params of 06 §10), sort?, columns text[]?, density?(compact/comfortable), isDefault(false), isShared(false), sharedById?→ | U(workspaceId, userId, page, name) `[FIG REF Deep-link map "Vues enregistrées", CAT-08 filter panel "Enregistrer cette vue"]`; a shared view is read-only for others; partial U(userId, page) where isDefault |

`User.prefs.listDensity` is the fallback density when the view has none `[FIG ORD-05 v2]`.

## 17. Notification types

All notification types, channels and deep links: **03 §15 (single source)** — one row per value of the enum `NotificationType` (56 values) with event, producer, in-app / e-mail / push / customer channels and the web deep link (English route paths of 02-next-route-map; mobile = `djaber://` + identical path). Dotted slug in prose and i18n (`order.callback_due`), snake_case in the enum (`order_callback_due`). Older labels drawn in the Figma deep-link map are Figma text fixes (D65, `../audit/figma-text-fixes.md`) and appear nowhere in code.

## 18. Integrations — API-key scopes & inventory

`ApiKey.scopes` enum (06 §5): `products:read, products:write, orders:read, orders:write, customers:read, customers:write, conversations:read, conversations:reply, delivery:read, analytics:read, webhooks:manage` `[FIG SET Intégrations › Créer une clé]`.

| Entity | Fields | Notes |
|---|---|---|
| **InventoryCount** | workspaceId→, number (`INV-<seq>`), scope(all/category/alerts_only), categoryId?→, status(draft/counting/validated/cancelled), blockCounterSales(false), startedById→, startedAt, validatedById?→, validatedAt?, lineCount, discrepancyCount, discrepancyValue, note? | U(workspaceId, number) `[FIG DLG GDS › Lancer / Valider l'inventaire, GDS-05 "#INV-004"]` |
| **InventoryCountLine** | inventoryCountId→, productId→, variantId?→, expectedQty, countedQty?, difference (computed), differencePct, note? (required when > 10 %), movementId?→ | U(inventoryCountId, productId, variantId); validation creates one `StockMovement(type=inventory)` per non-zero difference |
| **StockRecommendation** | workspaceId→, type(restock/stockout_imminent/promote/price/supplier/agent), priority(high/medium/low), status(active/applied/dismissed/snoozed/expired), productId?→, variantId?→, supplierId?→, agentId?→, title JSON, body JSON, suggestedAction JSON ({kind: create_purchase/create_promo/update_price/open_supplier/open_insights, params}), ruleKey, estimatedValue?, generatedAt, jobId?→, snoozedUntil?, appliedAt?, appliedRefType?, appliedRefId?, dismissedAt?, dismissedById?→ | `[FIG GDS-10 "FILTRES : Recommendation.type · priority · status"]` — rule engine output (D18, `Job(kind=recommendations)`), distinct from the cross-sell `Recommendation` table (§5), which stays |
| **StockRecommendationMute** | workspaceId→, productId→, type | U `[FIG GDS-10 menu "Désactiver cette règle pour ce produit"]` |

## 19. Platform-level tables (no `workspaceId`)

| Entity | Fields | Notes |
|---|---|---|
| **CreditPack** | slug U, name JSON, credits, priceWebDzd, googleProductId? U, appleProductId? U, storeTier?, storePriceLabel?, isActive, visibleWeb(true), visibleMobile(true), isFeatured, sortOrder | `[FIG ADM-15 "Packs de crédits (CreditPack)"]` (D40); seed `pack-500` 500 = 450 DA, `pack-2000` 2 000 = 1 500 DA, `pack-6000` 6 000 = 3 900 DA (web prices; store tiers set in the consoles) |
| **CreditPackPurchase** | workspaceId→, creditPackId→, channel(web/google_play/app_store), status(pending/validated/credited/refunded/failed/invalid), amount, currency(DZD/USD), providerCheckoutId?, storeTransactionId? U, storeOrderId?, receipt JSON? (raw store receipt, validated server-side), purchasedById→, validatedAt?, creditedAt?, refundedAt?, refundSource?(store/manual), invoiceId?→, ledgerEntryId?→ | `[FIG ADM-15 rules]`; idempotent on `storeTransactionId`; refund ⇒ negative ledger row |
| **PromoCode** | code U (case-insensitive; pattern `PARRAIN-*` for referrals), kind(percent_discount/fixed_discount/credits/trial_extension), value, periods? (billing periods for discounts), planSlugs text[], target(new_workspaces/existing/all/workspace) + targetWorkspaceId?→, maxUses?, perWorkspaceLimit(1), validFrom?, validTo?, isActive, createdById→, notes? | `[FIG ADM-15 "Codes promo (PromoCode)"]`; mobile accepts only `credits` kind (store rule); errors `PROMO_INVALID / PROMO_EXPIRED / PROMO_ALREADY_USED / PROMO_PLAN_MISMATCH / PROMO_NOT_STACKABLE` |
| **PromoRedemption** | promoCodeId→, workspaceId→, userId→, subscriptionId?→, ledgerEntryId?→, redeemedAt | U(promoCodeId, workspaceId) when `perWorkspaceLimit = 1` |
| **AppVersion** | platform U(android/ios), latestVersion, latestBuild?, minVersion, recommendedVersion, storeStatus(published/in_review/rejected/rollout) + rolloutPct?, storeUrl, updateMessage JSON {fr,ar,en}, forceUpdateAt?, updatedById→ | `[FIG ADM-13 Applications mobiles]` (D39); `GET /app/version`; `X-App-Version < minVersion` ⇒ `426 APP_UPDATE_REQUIRED {minVersion, storeUrl, message}`; changing `minVersion` requires a 2FA confirmation (audit `app_version.force_update`) |
| **FeatureFlag** | key U, description?, webPct(0–100), mobilePct(0–100), targeting JSON {planSlugs[], workspaceIds[], abTest?}, isActive, updatedById→ | `[FIG ADM-13 Fonctions (feature flags)]`; evaluation = hash(workspaceId) < pct ∨ listed |
| **LegalDocument** | key(`LegalDocKey` = terms/privacy/account_deletion/content_rules), version Int, isMajor, cmsEntryId→, publishedAt, publishedById→, requiresReacceptance | U(key, version) `[FIG ADM-13 Documents légaux]` (D39); acceptances in `LegalAcceptance` (§1); a major version ⇒ `403 LEGAL_REACCEPT_REQUIRED` until accepted (04 §15) |
| **PlatformSetting** | key U (`maintenance`, `incident_banner`, `limits`, `meta_app`, `contact`, `trial`, `impersonation_window`…), value JSON, version, updatedById→, updatedAt | `[FIG ADM-13 Maintenance, Limites & valeurs par défaut]`; every change ⇒ `PlatformSettingVersion` |
| **PlatformSettingVersion** | settingKey, version, value JSON, changedById→, reason?, at | history "Historique" `[FIG ADM-13]` |
| **MetaPermission** | scope U, status(not_requested/in_review/approved/rejected), feature, submittedAt?, decidedAt?, notes? | `[FIG ADM-13 Application Meta]` (CHN-11) |
| **PlatformProvider** | key U (`chargily` / `email` / `sms` / `push` / `courier_zr` / `courier_ecotrack` / `courier_yalidine` / `google_oauth`), kind, config JSON (non-secret), secret?(enc), status(`ProviderStatus` = ok/warning/error/disabled), lastCheckedAt?, lastError?, quota JSON?, expiresAt? | `[FIG ADM-13 Fournisseurs techniques]` (D58); payment gateway = Chargily Pay (CIB / Edahabia rails, R-N); `POST /admin/providers/:key/test` |
| **Incident** | title JSON, status(open/identified/monitoring/resolved), severity(minor/major/critical), components text[] (`messaging/ai/web/mobile_api/sheets/couriers/payment/notifications`), startedAt, identifiedAt?, resolvedAt?, affectedWorkspaces?, bannerCmsEntryId?→, postMortem?, createdById→ | `[FIG ADM-14 Incidents, PUB status]` |
| **IncidentUpdate** | incidentId→, status, body JSON, authorId→, at | timeline on the status page |
| **StatusSubscriber** | email U, tokenHash, verifiedAt?, unsubscribedAt?, locale | `[FIG PUB status "S'abonner aux incidents"]` |
| **CmsEntry** | key U (slug), type(announcement/legal/help/email/plan_text/system_message_default/page), category?, target JSON {planSlugs[], workspaceIds[]} (announcements), channels text[](banner/in_app/email/push/web — `web` = banner under the public site header, only for announcements targeting « Tous les espaces », UX-005 of 21/10), startsAt?, endsAt?, link? (http(s) address or an existing app / public page, `isAnnouncementLink`, UX-026 of 22/10; picked in ADM-08 from the list of 12 §ADM-08 « Lien », UX-036 of 26/10), sortOrder, status(draft/scheduled/published/archived), currentVersion, createdById→ | `[FIG ADM-08 "CmsEntry.key/title", PUB Legal]`; replaces `CmsPage` (D26) |
| **CmsEntryLocale** | entryId→, locale(fr/ar/en), title, body (sanitised HTML / Markdown), status(missing/draft/published), fallbackToFr(false), updatedById→ | U(entryId, locale); publish blocked if a locale is empty unless `fallbackToFr` (`CMS_LOCALE_MISSING`) |
| **CmsEntryVersion** | entryId→, version, snapshot JSON (all locales + settings), createdById→, at | U(entryId, version) "Historique : 4 versions" |

## 20. Indexes, uniques & tenancy summary for the additions

- Every table in §11–§18 has `workspaceId` NOT NULL (exceptions: `Report.workspaceId` nullable for end-customer reports; `Notification.workspaceId`, `Upload.workspaceId`, `Job.workspaceId` nullable for account/platform rows) and `idx(workspaceId, <status>, createdAt)`.
- Platform tables (§19, `ModerationRule`, `PlatformBlacklist`, `BlockedWord` with null workspace, `CannedReply`, `PlatformInvitation`, `AiRoute`, `CreditPricing`, `AgentPreset*`, `PlanVersion`) are readable by platform roles only (01-nest-module-map §3.2); merchants reach them through derived public endpoints (`/plans`, `/credit-packs`, `/legal/:key`, `/legal/pending`, `/status`, `/app/version`).
- Soft delete (`deletedAt`) added on: nothing new — moderation, reports, tickets, versions are append-only or status-driven. Hard purge follows 04 §9 (workspace purge cascades to every `workspaceId` table; platform tables keep anonymised references).
- Uniques added: `Invoice.number`, `SupportTicket.number`, `InventoryCount(workspaceId, number)`, `SavedView(workspaceId, userId, page, name)`, `CustomerBlock(workspaceId, clientId) active`, `ModerationAppeal.moderationItemId`, `AgentVersion(agentId, version)`, `AgentPresetVersion(presetId, version)`, `PlanVersion(planId, version)`, `CmsEntryLocale(entryId, locale)`, `CreditPackPurchase.storeTransactionId`, `PromoRedemption(promoCodeId, workspaceId)`, `AppVersion.platform`, `FeatureFlag.key`, `LegalAcceptance(userId, legalDocumentId, version)`, `Shipment.publicTrackingToken`, `AiRoute.capability`.
- Counters (04 §10) gain `inventory` (`INV-…`) per workspace and platform-level `invoice` (`F-<year>-…`) and `ticket` (`T-…`).
