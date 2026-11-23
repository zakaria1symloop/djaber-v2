# 08 — Web screens (brief for the Figma web design)

The web app is designed in Figma **before** coding, from these specs, reusing the design system of the Figma pages Mobile V2 (base FR) + Screens (AR/EN) adapted to desktop. The web frames live on the page "Web V2" (id 898:24126, formerly "Web") of the same file; the complete frame index is §7.16. Every screen is traced to spec IDs; every state listed in [12-screen-states.md](12-screen-states.md) is drawn. The mobile app is specified in [14-mobile-app.md](14-mobile-app.md).

## 1. Design system (from the Figma variables — existing, reused as-is)

**Color collection** (mode Dark): `ink/base #000`, `ink/surface #0A0A0A`, `ink/raised #141414`, `ink/raised-high #1C1C1C`, `text/primary #FFF`, `text/secondary #A3A3A3`, `text/muted #666`, `line/hairline #FFF 8 %`, `line/edge #FFF 12 %`, `line/lit #FFF 18 %`, `signal/live #34D399`, `accent/money #34D399`, `accent/alert #F87171`, `accent/inbound #60A5FA`, `accent/starred #FBBF24`, `accent/orders #FB923C`, `accent/clients #A78BFA`.
**Space & Form**: `space/2…28`, `gutter/content 16`, `gutter/label 20`, `radius/card 8`, `extrusion/quiet 3 · action 4 · urgent 5 · pressed 0`, `stroke/hairline 1`.
**Text styles**: Display/L (Syne Bold 30), Display/M (27), Display/S (16), Title (Geist Medium 14), Body (Geist 13), **Body AR (Changa 13)**, Numeral/L (Geist SemiBold 21), Numeral/M (14), Label/Section (JetBrains Mono 10.5 upper), Label/Meta (9), Label/Micro (8).
**Effect styles**: Extrusion/Quiet, Action, Urgent, Inset, Primary.
Dark-only in v2. Desktop may scale type +1–2 px. Arabic uses Changa (already in the file).

**Existing components (26)**: Section Label · Agent Status · Menu Button · Shortcut Tile · KPI Tile · List Row · Nav Item · Escalation Card · Text Field · Primary Button · Checkbox · Logo · Menu Row · Option Card · Action Card · Checklist Row · Menu Subrow · Credits Pill · Tab · Page Card · Agent Card · Preset Card · Plan Card · Conversation Row · Status Tag (2).

**Web-only components to add**: Sidebar (groups, collapse) · Top bar (workspace switcher when > 1, credits pill, bell, user menu) · Data table (sticky header, sort, row select, bulk bar, pagination 25/50/100, density) · Filter bar (chips + sheet + date range with presets) · Side sheet · Dialog (confirm / destructive with typed confirmation) · Toast · Banner (global states) · Empty / error / offline states · Skeletons · Stepper · Split view (inbox) · Charts (line, bar, donut, wilaya map) · Status pills for every enum in 04 · Timeline · Upload dropzone · Secondary/ghost/danger buttons · Select / combobox (wilaya, commune, client, product) · Toggle · Segmented control · Tooltip.

**UX rules (V1 defects closed)**: one primary action per view; destructive = red + confirm; errors inline inside dialogs; every list has loading / empty / filtered-empty / error states; filters live in the URL and KPIs follow them; status tabs are the status filter (no duplicate control); sidebar scrolls, each module once; detail in side sheet, full page for order / agent / conversation; RTL mirrored, numbers LTR; all strings from i18n (no hardcoded labels); no dead buttons — a control is either enabled with a working action, or hidden/disabled with a tooltip reason.

## 2. Layout

≥ 1280: sidebar 240 + content (max 1440); inbox 3 panes. 1024–1279: icon sidebar. < 1024: usable at 390 (tablet/phone fallback; the app is the phone experience).

## 3. Navigation

```
[Logo]                          [Workspace ▾ (if >1)]  [⚡ credits] [🔔] [user]
Accueil                                       (Home)
File d'attente              (badge)           (needs-human conversations + pending insights)
Boîte de réception          (badge)           (Inbox)
Commandes                                     (Orders)
Livraison & suivi                             (Delivery: overview, send, tracking, couriers, fees)
Clients
STOCK (GDS)
  Tableau de bord stock
  Produits · Services
  Catégories
  Mouvements                          (advanced)
  Fournisseurs                        (advanced, P2)
  Achats                              (advanced, P2)
  Ventes                              (advanced, P2)
  Caisse                              (advanced, P2)
  Recommandations                     (advanced, P2)
IA & CANAUX
  Agents IA
  Pages connectées
ANALYSE
  Statistiques                        (P2)
  Rapports                            (advanced, P2)
──
Notifications · Paramètres · Aide
```
Simple mode hides the "(advanced)" items (D12). Users with a `PlatformRole` have a separate admin shell (§7.11), entered from the user menu item "Plateforme".

## 4. Screen list (states in 12; `M→W` = adapt mobile screen; `NEW` = web-only)

### 4.1 Public & auth [P0]
Login (+2FA step, rate-limited) · Sign up · Forgot password · Reset password (NEW; valid / expired / done) · Verify email (NEW) · Accept invitation (NEW) · Pricing · Legal & CMS pages (fr/ar/en, locale fallback) · Landing, features, help (ported, restyled; "Aide" in the app opens the in-app help center of §7.8 (D46), which embeds the same CMS help entries in the user's locale) · App Review pending notice (within connect). Sign-up from `/pricing` shows the chosen plan note; auth links keep `returnTo` and the typed e-mail. Every e-mail / phone / URL / code field uses the typed inputs of 04 §2 (EmailInput, PhoneInput, UrlInput, CodeInput: LTR, right keyboard, formatted on blur).

### 4.2 Onboarding [P1]
Welcome → Stock mode → First product → Agent preset → Connect page (+ permissions explainer, OAuth refused, pending approval) → Ready. `M→W T1a–T6`. As built (2026-10-15): step 3 = name, price, stock, photo + "✦ Remplir avec l'IA" (the frame's "Importer un fichier CSV/XLSX", "Extraire depuis ma page Facebook" and CATÉGORIE select are not built: nothing usable before the setup ends); step 4 "Partir de zéro" opens the agent wizard (steps 1–3) inside the tunnel; reopened steps show the product / agent / pages created earlier; step 6 next actions disabled with their reason. Flow 10 FL-04, states 12 §2.

### 4.3 Home [P1]
Greeting · À traiter queue (escalation cards: needs human, failed parcel, low stock, reconnect) · KPI tiles · quick actions · my pages · Get Started · banners (credits, plan, reconnect, approval). `M→W 09`.

### 4.4 Queue & inbox [P1]
Queue (needs-human + insights) · Inbox 3-pane (list tabs, search, channel switcher; thread with all message types, AI/human/system authorship, failed/skipped sends, handoff banner, AI paused banner, composer with image + quick replies, disabled states; client panel with orders + create order) · notes · assign · delete. `M→W 10, 10a, 10b, 14a`.

### 4.5 Orders [P1]
List (KPIs, tabs, filters incl. confirmation/payment/delivery/has-remaining, bulk bar with per-item results, export, print) · Order page (contact edit, items, delivery block with shipment timeline, payment, history, calls, notes, linked conversation, read-only mode, conflict state) · New order (client picker/create, items with variants, wilaya/commune, stop-desk, fee quote editable, amount paid, status new/confirmed) · Confirm dialog (review → outcome → result with Prepare / Send to courier) · Cancel / Return / Delete dialogs · Payment link dialog (P2). `M→W Orders*`.

### 4.6 Delivery [P1 fees / P2 couriers]
Overview (by status, failures with actions, returns) · Fees per wilaya (69 rows, inline edit, fill missing, reset all, free-delivery rule, copy from courier P2) · Couriers (empty, list, add/edit per provider incl. EcoTrack URL, test ok/fail, default, active) · Send dialog (single/bulk, prefilled from order, courier validation errors, queued state) · Tracking (timeline, sync now, failed reasons + actions, stale) · Labels (single/merged, Djaber fallback). `M→W Delivery*`.

### 4.7 Clients [P1]
List (paginated, filters) · Detail (metrics, addresses, orders, conversations, merge notice) · Add/edit · Delete · Export. `M→W Clients*`.

### 4.8 GDS — catalogue [P1]
Stock dashboard (simple/advanced) · Products list (table/grid, all filters, low-stock deep link) · Product page (images, variants, stock, expenses & margins adv. P2, agents using it, movements) · Add/edit (simple, with variants, from photo, warnings) · Adjust stock · Custom unit · Archive · Import wizard (upload → preview with row errors + plan limit → done) · Export · Categories (list, add/edit, delete with reassign) · Services list. `M→W 16–18, Categories*`.

### 4.9 AI agents [P1]
List (empty, active, paused, draft, limit reached — drafts never count toward `maxAgents`, "New agent" always) · Choose preset / scratch · Wizard 5 steps (Identité → Connaissances → Comportement → Canaux → Test & activation; model badge read-only, assigned by platform routing) · Agent page (metrics, channels, insights, config, versions) · Edit tabs (dirty guard) · Test playground (real cards, tool calls, read-only model badge) · Insights queue (types incl. error) · Delete dialog · Generate from page (job progress, review, apply to new/existing). `M→W 14*, 15*`.

### 4.10 Channels [P1]
List with platform tabs and statuses (active / paused manual / paused by plan / needs reconnect / disconnected) · Connect (Facebook, Instagram, permissions explainer, approval pending, OAuth refused, per-page report) · Page overview (insights / unavailable) · Messages · AI settings (linked agent / none) · History · Analysis (job states, reconnect, review, import). `M→W 12, 13, Page *`.

### 4.11 Analytics [P2] & reports [P2]
8 tabs with period presets + custom (empty dates, start chosen, applied) · Reports hub + 23 reports on one template (period, KPIs, chart, table, export XLSX/PDF, > 5 000 rows job). `M→W Analytics*, Reports*`.

### 4.12 GDS — operations [P2]
Suppliers (list, detail, add/edit, delete) · Purchases (list, filters, detail, new, receive, cancel, delete) · Sales (list, detail, new, partial payment, edit payment, delete) · Cash register (period pills, KPIs, add/edit manual, immutable auto rows) · Movements · Recommendations (list, generate job, stats, toggle, delete). `M→W` all exist.

### 4.13 Notifications & settings [P1]
Notifications (filter by every type, unread, deep links) · Settings: Profile · Workspace · Members & invitations (incl. ownership transfer) · Language · Stock mode (advanced mode adds `Workspace.targetMarginPct`, default 35) · Quick replies · Customer system messages (4 keys × 3 locales: `handoff`, `out_of_hours`, `out_of_stock`, `welcome`; preview, reset to default) · Auto-pause toggle · Free-delivery rule · Online payment (P2) · Notification preferences · Security (password, 2FA, sessions) · Integrations (couriers, Google Sheets, API keys, webhooks — P2) · Plan & billing (plan cards, checkout result, invoices, cancel) · Credits (ledger + calculator) · Danger zone. `M→W 11, 11a`.

### 4.14 Platform admin [P2] (NEW)
Shell · Analytics · Workspaces / users (detail with plan, subscription, credits, suspend, release channel, read-only impersonation) · Plans · Subscriptions · AI providers & models & fallbacks + pricing calculator · Agent presets · Conversations & products viewers · CMS per locale · Audit log · plus the §7.11 pages (moderation, abuse reports, support, platform settings, jobs & health, packs & promos, roles & deletion requests).

### 4.15 Global states (every screen)
Loading skeleton · empty with CTA · filtered-empty · error with retry · offline banner · 403 (no permission) · 404 · plan-expired banner (free limits applied, paused badges, upgrade — no read-only) · credits exhausted banner · channel needs reconnect banner · approval pending banner · read-only member banner · job progress toasts · unsaved-changes dialog · session expired redirect.

## 5. Figma deliverable checklist
- [x] "Web V2" page in the same file, shared variables/styles.
- [ ] Frames 1440 × auto; 1024 and 390 checks for home, inbox, orders list, order page.
- [ ] FR first; AR (RTL) for shell, inbox, orders list, order form, product form; EN spot checks.
- [ ] Every state in 12 drawn or marked "same as mobile".
- [ ] Web components added with variants; status pills for every enum.
- [ ] Prototype links: onboarding, inbox takeover, AI order → confirm → send → tracking.
- [ ] Each frame named `<spec id> — <screen> — <state>`.

## 6. List mechanics (filters · actions · quick edit · relations) — mirrored in Figma « 00 Reference » and « 10 Mechanics »

Common rules: filters live in the URL (shareable, back button) · page KPIs follow the active filters · status tabs **are** the status filter (never duplicated) · active chips with × and "clear all" · server search with 300 ms debounce · bulk actions return a per-row result dialog (ok / error code) · the row `⋯` menu lists **every** action; forbidden ones are shown disabled with the reason · a side sheet opens detail/quick edit without leaving the list, with ‹ › to move to the next row · Esc closes · saved views per user.

| Page | Filters (field · type · model source) | Row actions | Bulk | Quick edit / panel |
|---|---|---|---|---|
| Orders | status (tabs) · confirmationStatus + callAttempts ≥ n · paymentStatus / method / remaining > 0 · deliveryStatus + Shipment.provider · source · channelId · agentId · assigneeId · wilayaId + isStopdesk · total range · orderedAt presets/custom · OrderItem.productId · riskLevel · sort | contextual CTA by status; menu: open, prepare, send to courier, mark shipped (manual), mark delivered (COD rule), edit contact, log call, record payment, payment link (P2), print, conversation, client, products ?ids=, duplicate, cancel, delete (disabled if delivered / active parcel) | confirm, prepare, shipped, delivered, send (group dialog), print, export, cancel | contact inline (validated), notes; panel = summary + timeline |
| Products | categoryId[] · isActive/deletedAt · trackStock/hasVariants · stock state · stock range · price · costPrice (adv.) · margin · agent scope · created/updated · sort · table/grid | adjust; menu: open, quick edit, adjust stock, variants, orders ?product=, movements ?product=, agents, recommendations, duplicate, Messenger card preview, archive | category, add to agent, min stock, price ± %, export, labels, archive | panel: price/old/cost, status, per-variant stock steppers (= movement with reason), images, tabs orders/movements/agents/recommendations |
| Clients | source · record quality (placeholder, no phone, no address, duplicates) · tags · riskLevel · channel · orderCount · totalSpent · lastOrderAt buckets · wilaya · createdAt · sort | open, complete record, merge, conversation, new order, orders ?client=, tags, export, delete (soft) | tags, export, merge (2), delete | panel: metrics, merge notice, contact, addresses, last orders, conversations |
| Inbox | channel · status (tabs) · aiPaused / agentId · unread · assigneeId · order (with / cart / abandoned / none) · AiRun.intent · client flags · lastLanguage · lastMessageAt (24 h window) · sort | resume/pause AI, assign me, resolved, archive, unread, client, new order, orders ?client=, insights, delete (admin) | resolved, archive, assign, resume AI | client panel in thread; notes; quick replies |
| Agents | status (active / paused / by plan) · channel · model · pending insights | insights, test, details, edit, pause, delete; page chips → channel | pause/resume, delete | tabs edit; "add to instructions" from an insight |
| Channels | platform (tabs) · status · linked agent | Inbox, Stock, Configure, Regenerate, Reconnect, Pause/Resume, Disconnect (consequences dialog) | resume/pause (swap at limit), disconnect | page: overview, messages, AI settings, history, analysis → import |
| Delivery | shipment status (tabs) · courier · wilaya · failure reason · sentAt · stop-desk | track (sync now), label, fix & resend, mark returned, order | send (group dialog, per-row results), merged labels, sync | send dialog prefilled from the order; courier errors mapped to fields |
| Movements | product/variant · type · refType · actor · date | open reference, product | export | read-only audit trail |
| Notifications | type (all NotificationType) · unread · date | deep link by type, mark read | mark all read | preferences per type |
| Members | role · read-only (plan) · pending invitations | role ⌄ (owner locked), remove; resend (60 s) / revoke | — | invite form with role explainer + plan-limit note |

Filter components: chips (single) · checkboxes with counts (multi) · range (min — max + unit) · entity search (category, product, client, wilaya) · date presets + custom range (end of day inclusive, Africa/Algiers) · toggle (saved view) · sort chips. Each group shows its model source in Label/Micro for implementation.

Cross-navigation (from → to): Home queue → thread / delivery `?tab=all&ids=<order>&sheet=<shipment>` (failed parcel) / products ?lowStock=1 · Thread → client panel, new order prefilled, product quick edit, insight · Orders list/page → client, thread, products ?ids=, delivery dialog · Products → orders ?product=, movements ?product=, agents, recommendations · Clients → orders ?client=, thread, new order, merge · Agents → channels, insights → thread, playground · Channels → inbox ?channel=, agent, agent products, analysis · Delivery failure → order delivery block · Notifications → target by type · Plan → resources paused by plan.


---

## 7. Screens, tabs and dialogs drawn in Figma that were missing above (2026-10-06)

The Figma "Web V2" page (124 frames, sections 00 → 14) is **ahead** of §4; this section lists every frame that §4 did not describe, using the exact frame names, and §7.16 indexes every frame of the page with its route. States for each are in 12 §16+. Decisions D36–D78 (README, all final) govern the behaviour; where a Figma text differs from a spec value the spec wins (D65, `../audit/figma-text-fixes.md`).

### 7.1 Reference sheets (section 00) — read first by the coder
| Frame | What it fixes |
|---|---|
| `REF — Component sheet (status pills per enum, patterns)` | One colour per enum, everywhere (lists, sheets, mobile): money = positive/done · inbound = in progress · starred = attention · alert = blocking/negative · secondary/muted = neutral · signal/live = AI. Pills per enum: `Order.status` (NOUVELLE · CONFIRMÉE · EN PRÉPARATION · EXPÉDIÉE · LIVRÉE · RETOURNÉE · ANNULÉE), `Order.confirmationStatus` (À APPELER `pending` · SANS RÉPONSE n/3 `no_answer` · CONFIRMÉE `confirmed` · RAPPEL hh:mm `callback` · REFUS `rejected` · FAUX NUMÉRO `wrong_number`), call outcomes = `CallResult` (`picked_up` Confirmée · `no_answer` Sans réponse · `busy` Occupé · `voicemail` Messagerie · `rejected` Refus · `wrong_number` Faux numéro · `callback` Rappeler plus tard), payment (NON PAYÉE · PARTIELLE · PAYÉE · LIEN EN ATTENTE · REMBOURSÉE · COD · CIB), source (✦ IA · ✎ MANUEL · ▣ MOBILE · { } API · ⤒ IMPORT), customer risk (FIABLE · INCONNU · RISQUE · BLOQUÉ · PLACEHOLDER), shipment = `ShipmentStatus` (NON ENVOYÉE = no shipment · À ENVOYER `pending` · ENVOYÉE `sent` (the Figma text CRÉÉE is a text fix) · RAMASSÉE `picked_up` · EN TRANSIT `in_transit` · EN LIVRAISON `out_for_delivery` · LIVRÉE ✓ `delivered` · ÉCHEC `failed` · RETOURNÉE `returned` · ANNULÉE `cancelled` · SANS MOUVEMENT = derived flag, no event > 5 d while status ∈ {sent, picked_up, in_transit}; `stale` (no event for 30 d) shows SANS MOUVEMENT with "30 j"), courier (ZR EXPRESS · ECOTRACK · YALIDINE · LIVRAISON PROPRE · TEST OK · IDENTIFIANTS INVALIDES), product (ACTIF · MASQUÉ · ARCHIVÉ · SERVICE · STOCK FAIBLE · RUPTURE · VALIDÉ · EN ATTENTE · REFUSÉ · CONTESTATION · PROPOSÉ PAR L'IA · EXCLU DE L'IA), movement (ENTRÉE · SORTIE · AJUST. + · AJUST. − · INVENTAIRE · RETOUR), conversation (IA · À TRAITER · ASSIGNÉE · IA EN PAUSE · RÉSOLUE · ARCHIVÉE · HORS FENÊTRE 24 H), agent (ACTIF · EN PAUSE · BROUILLON · PAUSE (PLAN) · V3 · ACTUELLE · MAJ PRÉRÉGLAGE DISPO), channel (FACEBOOK · INSTAGRAM · EN ATTENTE META · RECONNEXION REQUISE · EN PAUSE (PLAN) · DÉSACTIVÉ · DÉCONNECTÉ), insight (INCOMPRÉHENSION · SUJET INCONNU · TRANSFERT · ERREUR IA), subscription = `SubscriptionStatus` (ESSAI `trial` · ACTIF `active` · RELANCE J0 / J+3 `dunning` per `dunningStage` · EXPIRÉ `expired` · RÉSILIÉ `cancelled`; "suspendu" is only `Workspace.status=suspended`, admin action), invoice = `InvoiceStatus` (À VENIR `upcoming` · IMPAYÉE `unpaid` · PAYÉE `paid` · ANNULÉE `void` · REMBOURSÉE `refunded`), credits (n / N · 80 % · ÉPUISÉS · PACK), job (EN COURS · n % · PRÊT · PARTIEL · ÉCHEC), admin (SUPPRESSION J+30 · NON VÉRIFIÉ · URGENT · AUTO-APPROUVÉ · APPEL · SLA DÉPASSÉ · EN ATTENTE CLIENT · TRUST · SURVEILLANCE). UI patterns: toast (bottom-right, 5 s, max 3, dot + text + action + ✕), banner (top of content, 3 px left edge, one at a time), skeleton (ink/raised-high 60 %, same grid, 300 ms), stepper (✓ done · active · upcoming; back-navigation allowed), timeline (newest first), dropzone, tooltip (also for disabled reasons), segmented control, toggle 34 × 18, comboboxes (wilaya 69 search · commune by wilaya · client phone/name + create · product name/SKU with nested variants), side sheet 420–460 px (✕ · ‹ › · Esc · scroll body, fixed actions), dialog 380–680 px (destructive = red button, no default focus), `Actions ⌄` chip, charts (daily bars · comparison line dotted previous period · donut · wilaya choropleth · funnel). |
| `REF — Entity & navigation map (for implementation)` | Per entity (Channel, Conversation, Message, Client, Order, OrderItem, Shipment, Product, ProductVariant, Category/Unit, Agent, AgentInsight/AiRun, Member/Invitation, Subscription/CreditLedger/Plan, Notification): key fields, "from this entity → go to" jumps with URL params, UI rules. Cross-navigation table (from → to · action/param). |
| `REF — Filters, actions & quick-edit matrix per page` | = §6 table (source of truth kept in sync). |
| `REF — Deep-link map (notification → target) + remaining list mechanics` | = 03 §35; saved views (D47); remaining filters for Members / Channels / Notifications; inbox bulk actions; clients quick-edit panel. |

### 7.2 Shell, Home, Notifications (section 01)
- `ANA-01b — Home & Notifications — states catalogue`: skeleton; "À faire" card variants (COLIS, STOCK, PAGE, INSIGHT, CONVERSATION, RAPPEL, TÂCHE; Waiting / Handled); Home banners (credits exhausted, plan expires in n d, plan expired, reconnect, pending Meta, resume onboarding step n/6); page-card badges (ACTIF, EN ATTENTE META, RECONNEXION REQUISE, EN PAUSE (PLAN), 0 page card); notification type filter (multi-select by `NotificationType`, "Non lues" toggle, "Tout marquer lu"); empty "Vous êtes à jour ✓".
- `NTF-01 — Notifications — list`: family tabs (Toutes · Non lues n · Commandes (journey J05r-7: the family holds every order notification, not only AI orders) · À traiter · Problèmes IA · Stock · Colis · Paiements · Pages · Crédits & plan · Membres · Intégrations · Tâches), rows with family label, title, body, slug, age, "Ouvrir ›", "Charger les 20 suivantes", "Préférences".
- Top bar adds the "?" help panel (D46); user menu: Profil · Langue · Créer un espace (invited-only user, D30) · Plateforme (users with a `PlatformRole`) · Déconnexion · Déconnecter tous les appareils; workspace switcher when ≥ 2 memberships (`AUTH — States catalogue`).

### 7.3 Inbox & queue (section 02 + DLG Inbox)
- `QUEUE — File d'attente — items`: header "n conversations attendent un humain · n problèmes signalés · rappel propriétaire après 30 min" + "Régler le rappel"; cards by reason (TRANSFERT · rule, DEMANDE HUMAIN, CRÉDITS ÉPUISÉS) with assignee and actions (Me l'assigner · Reprendre l'IA · Répondre); "Problèmes signalés" cards (INCOMPRIS · HORS SUJET · ERREUR IA) with Ouvrir · Ajouter aux instructions · Ignorer.
- `DLG — Inbox & queue`: quick replies popover (`/` shortcut, search), assign popover (members with open counts, Personne), notes panel (Ctrl+Enter), delete conversation dialog (soft, restorable 30 d), channel switcher with counts and states, bulk bar (résolues · archiver · assigner · reprendre l'IA · bloquer), message types rendering (image full-screen, audio player + transcript states, video, file, location, sticker, postback, product cards, human with name, system events, failed send with Réessayer, skipped-window), conversation banners (priority list in 04 §23 / 12 §17), composer states, client-panel states, queue empty state.

### 7.4 Orders, delivery & clients (section 03 + DLG Orders ×2 + MECH)
- `ORD-05 v2 — Orders — list (dense rows, source column, actions dropdown)` **replaces** `ORD-05 — list v1 (superseded)`: KPI strip (à confirmer + sans appel > 2 h, à expédier, en transit + sans mouvement, livrées 30 j + retours, DA 30 j + IA/manuel split), tabs with counts, search, filter chips (Source · Confirmation · Wilaya · Période · Filtres (n)), DENSITÉ / COLONNES, selection bar (Confirmer · Envoyer au transporteur · Bordereaux · Assigner · Annuler), columns N°·DATE / CLIENT (+ n cmd, nouveau, n retour) / SOURCE / ARTICLES / TOTAL / CONFIRMATION / LIVRAISON / WILAYA / RISQUE / ACTIONS; open `Actions ⌄` menu with shortcuts and greyed items + reason; legend panel = the row-action rule (D42). Also `ORD-05 v2 — AR (RTL)`.
- `ORD-06 — Order page — new`: header (number, status, source, channel, created by, calls), actions Imprimer · Annuler · Appeler & confirmer; cards Cliente (edit contact), Livraison, Conversation, Articles (edit), totals, delivery block (NON ENVOYÉE · courier · customer fee · courier cost + margin · "Envoyer au transporteur" disabled until confirmed), payment block (Enregistrer un paiement · Lien de paiement · COD note), history timeline, calls (Journaliser), internal notes.
- `ORD-07 — Confirm order dialog — outcome step` (3 steps Vérifier · Appel · Résultat; outcomes = the `CallResult` enum values `picked_up` Confirmée · `no_answer` Sans réponse · `busy` Occupé · `voicemail` Messagerie · `rejected` Refus · `wrong_number` Faux numéro · `callback` Rappeler plus tard; note; readiness line; each outcome writes one `OrderCall` row).
- `DLV-08 — Delivery — overview + tracking panel`: tiles, tabs, failures table (N° · client · courier · reason pill · last event · Actions), stale table, failure/stale menus, tracking side panel (timeline with source, Actualiser states, actions Relancer · Appeler · Portail ↗ · Bordereau · Marquer retournée; alternative states Annulée · Livrée ✓ · Retournée), empty "no courier" card.
- `DLV-06 / ORD-09 — Labels viewer + order print preview A5`: embedded PDF viewer with print; courier label A6; Djaber fallback label (QR = public tracking); A5 order slip (options with/without prices, 2 per A4, FR/AR); merge job states.
- `DLV-01/03 — fee grid + couriers settings`: tabs Grille par wilaya · Transporteurs · Règles; grid columns N° · WILAYA (FR/AR) · DOMICILE · STOP-DESK · RETOUR · COÛT ZR · SOURCE (PERSONNALISÉ / DÉFAUT) · ACTIVE ("Non desservie — l'IA le dit au client"); inline edit on blur; courier cards with capabilities and stats; add/edit form with provider-dependent fields and test states.
- `DLV-05 — send to courier dialog (validation error)`: courier radio with cost + delay, wilaya/commune, home / stop-desk + stop-desk point combobox, COD, weight, content line, courier error banner mapped to the field.
- `CLI-03 — Clients — list with detail sheet`: KPI line, filters (Source · Étiquettes · Période · Filtres), columns, detail sheet (metrics, merged notice, contact, default address, channels, orders, conversations, "Nouvelle commande pour …").
- `MECH — Delivery filters + row menu + bulk send results` and `ORD-05 — row actions menu + bulk results dialog`, `ORD-05 — filter panel open`, `CLI-03 — filter panel + row menu`: see §6 and 12 §19.
- `DLG — Orders & delivery — dialogs catalogue`: Annuler la commande (reason list, note, customer message checkbox), Changer le statut (Livrée / Retournée / Échec / Confirmée (retour arrière), effective date), Assigner, Programmer un rappel, Marquer livrée manuellement, Marquer retournée, Imprimer les bordereaux, Exporter les commandes, Modifier l'adresse de livraison, Résultat de l'appel (same `CallResult` values as ORD-07: `picked_up` · `no_answer` 3/3 · `busy` · `voicemail` · `callback` · `wrong_number` · `rejected`), Fusionner les clients.
- `DLG — Orders, delivery & clients II`: Enregistrer un paiement, Supprimer la commande (typed number), Lien de paiement (P2 states), Rembourser (P2), Modifié par quelqu'un d'autre (409), Ajouter un transporteur (provider tabs incl. Livraison propre, test states), Supprimer le transporteur (blocked), Grille des frais — actions (reset all, fill missing, copy from courier P2, free delivery modes, reset a row), Bordereau indisponible, Annuler le colis, Nouveau client (phone conflict link), Supprimer le client, Tags (bulk).

### 7.5 GDS (section 04 + DLG GDS ×2)
- `CAT-09 — Product page — full`: breadcrumb, pills (ACTIF · VALIDÉ DJABER · PROPOSÉ PAR L'IA), actions (Aperçu carte Messenger · Ajuster le stock · Modifier · Actions ⌄), archived banner + Restaurer, gallery (reorder, ★ primary, caption, delete), variants table with inline edit (price, cost, threshold — stock only via Ajuster), recent movements (before → after, reference link), "Prix & marge" (price, weighted average cost + purchase ref, expenses/unit + Ajouter, margin, sales 30 d; simple mode = price + stock only), Stock block (tracked, total, reserved = confirmed not shipped, available for AI, last inventory), "Agents IA (client list L67 23/11: the block lists agents only; « Voir les agents IA qui le vendent »)" (offered by, mentions 30 d, top questions → FAQ), "Validation Djaber" block, Actions menu (Dupliquer · Archiver · Ajouter à un agent · Étiquette · Exporter · Voir les commandes · Voir les conversations · Supprimer si aucune commande).
- `CAT-11 / GDS-06b — Services list · New purchase form · Purchase & sale detail`: services list (IA column PROPOSÉ / EXCLU, empty text), new purchase form (supplier, expected date, invoice n°, lines with `PURCHASE_UNTRACKED_PRODUCT`, tax, shipping, paid, method, Brouillon / Commander), purchase detail (status pill, blocks, actions Payer le solde · Imprimer · Dupliquer · Annuler blocked), sale detail (PARTIELLE · RESTE, actions Encaisser le reste · Ticket PDF · Lier à un client · Annuler).
- `GDS-05 — Movements — list + filter panel`: KPIs (entries, exits, adjustments incl. inventories, alerts "écarts inventaire > 10 %"), columns incl. AVANT → APRÈS, MOTIF, RÉFÉRENCE, PAR; row menu (Ouvrir le produit · Ouvrir la référence · Contre-passer · Voir le stock à cette date = `GET /stock/snapshot?date` · Modifier/Supprimer impossible `GDS_MOVEMENT_IMMUTABLE`); filter panel with model sources; "Enregistrer la vue".
- `GDS-06 — Suppliers`, `GDS-07 — Purchases + receive dialog`, `GDS-08 — Sales + new sale with partial payment`, `GDS-09 — Cash register — ledger with locked automatic rows` (+ "Clôturer la journée" dialog, KPIs incl. unclosed days), `GDS-10 — Recommendations` (rule cards by type RÉAPPROVISIONNER · RUPTURE IMMINENTE · PROMOUVOIR · PRIX · FOURNISSEUR · AGENT IA with rule label and actions; job banner; stats; simple-mode subset; applied state; menu; `RECO_RATE_LIMITED`).
- `MOD — Merchant side — product moderation states` and `MOD — Product — rejected view + appeal dialog (merchant)` (03 §23).
- `DLG — GDS (stock) — dialogs catalogue`: Nouvelle catégorie (parent, image), Nouvelle unité (contains n × unit), Supprimer le produit (blocked → Archiver, "sortir le stock restant"), Modifier les prix en masse (preview, below-cost warning), Changer la catégorie, Générer des variantes (attributes, defaults, max 100), Dupliquer le produit (copy options, re-moderation note), Nouveau fournisseur, Enregistrer un paiement fournisseur, Annuler la vente (reason, restock, refund), Encaisser le reste, Mouvement de caisse manuel, Lancer un inventaire, Valider l'inventaire, Correspondance des colonnes (import mapping, update existing by name, save mapping).
- `DLG — GDS (stock) II — dialogs & inline states catalogue`: Limite du plan atteinte (generic), Créer depuis une photo (states), Images — erreurs inline, Ajuster le stock — cas (variant required, insufficient + force admin, qty 0, service), Supprimer la catégorie (reassign + sub-categories), Dépense produit, Achats — verrous, Ventes — verrous, Caisse — ligne manuelle & verrous (`CASH_DAY_CLOSED`), Règle de recommandation (manual rule), Restaurer avec conflit de SKU.
- `CAT-01 — Product — quick edit sheet + relations`, `CAT-08 — bulk bar + row actions menu`, `CAT-08 — filter panel open`: §6.

### 7.6 Agents & channels (section 05 + DLG Agents)
- `AGT-02 — Agent wizard — step 1 identity · step 2 knowledge · step 3 behaviour · step 4 channels (move dialog) · step 5 test & activate` (03 §30 AGV-02; note: the step-4 frame still carries the old step labels — Figma fix D65).
- `AGT-03 — Agent page — overview (tabs, versions, rollback)`, `AGT-04 — Configuration tab (edit as tabs, dirty, saving, conflict)`, `AGT-08 — Insights queue tab` (tabs En attente / Résolus / Ignorés, filters type / channel / period, "Regrouper par sujet", grouped cards n ×, resolve dialog), `AGT-07 — Agent playground — dry run with tool calls` (simulation banner with turns used, tool call bubbles, real cards, scenario chips, 📷 🎤 inputs, last-turn inspector: status, intent + confidence, model, tokens, latency, tools, credits, cards, language, system prompt preview; "Ajouter une instruction depuis ce tour", "Signaler une mauvaise réponse (eval)", "Exporter la conversation (eval)").
- `CHN-07b — Channel page — Messages · AI settings · History tabs`, `CHN-08 — analysis review (import)` (states PERMISSION REQUISE · EN COURS · AUCUN PRODUIT; grid with NOUVEAU / EXISTE DÉJÀ / PRIX MANQUANT; "Désélectionner les doublons"; import note).
- `MECH — Agents filters + row menu · Channels row actions` (§6).
- `DLG — Agents & channels — dialogs, connect flow & generate-from-page`: Supprimer l'agent (typed name; `AGENT_HAS_CHANNELS`), Mettre en pause (open threads, out-of-hours checkbox), Résoudre l'insight (instruction / FAQ / ignore 30 d), Déconnecter la page (consequences), Réactiver … at plan limit (choose the page to pause / compare plans), Reconnexion Meta — issues (popup blocked, waiting, refused, invalid state, e-mail unverified, success), Rapport de connexion (rows CONNECTÉE / EN ATTENTE META / IGNORÉE codes / LIMITE / AVERTISSEMENT + agent selector), Connecter une page — explications (permissions list, "jamais"), Synchroniser l'historique (7 / 30 / 90 d Pro), Modèle IA indisponible, Générer un agent depuis ma page (4 steps + failure states).

### 7.7 Analytics & reports (section 06)
- `ANA-02 — overview tab + period picker` (presets incl. Ce mois · Mois dernier · Trimestre; comparison selector; KPI tiles with deltas; revenue by day; funnel; top products; top wilayas; by channel · agent; empty / loading / range-too-large / comparison / timezone notes).
- `ANA-02b — tabs Conversations · IA · Agents · Canaux · Produits · Commandes · Livraison` (each = KPIs · 1 chart · 1 table; rows link to filtered lists; period picker errors).
- `ANA-03 — Reports hub (23 reports) + export jobs` (5 groups, favourites ★ = `PATCH /me/prefs { reportFavorites }`, "Exports récents" = `GET /jobs?kind=export` with job states and `POST /jobs/:id/cancel` / `POST /jobs/:id/retry`, simple-mode 9 reports; reports = Admin+ only, permission `reports.read`) and `ANA-04 — Report template + large export banner` (filters as query string, Planifier (e-mail mensuel) = `POST|DELETE /reports/:key/schedule { email, dayOfMonth }` behind plan feature `scheduled_reports`, Exporter ⌄ CSV / XLSX / PDF / Copier le lien).

### 7.8 Settings, billing, help & safety (section 07 + DLG Settings)
- `BIL-04 / BIL-03 — Credits page (ledger) · Invoices · Checkout return`, `BIL-01 — Plan & billing` (expiry banner, plan cards, usage bars, ledger excerpt, invoices, cancel at period end).
- `HELP — Help & support (merchant)`, `SAFE — Trust & safety (merchant)` (03 §24–25).
- `SET — Integrations`, `SET — Members & invitations` (LECTURE SEULE · PLAN pill, invite form with limit note — at the limit the invite buttons are greyed with `PLAN_LIMIT` + "Changer de plan"; read-only only for a member joining while over the limit), `SET — Profile · Workspace · Security` (sessions list with device/location, "Déconnecter tous les autres appareils"), `SET — Quick replies · System messages · Notifications · Stock mode · Danger zone`.
- `DLG — Settings & billing — dialogs catalogue`: Activer la 2FA (3 steps), Désactiver / Régénérer (password), Changer le mot de passe, Changer l'e-mail, Supprimer mon compte (blocked / grace), Logo & avatar (upload states, crop), Réponse rapide (title, text with variables, shortcut), Message système — réinitialiser, Supprimer l'espace (typed name; `WORKSPACE_HAS_DEBT`), Google Sheets — choisir la feuille (Picker / URL / create, filters, backfill, states), Webhook sortant (URL https, events, secret once, test, reactivate, delete), Changer de plan (cycle, prorata, downgrade warning, cancel, errors, promo code; checkout = Chargily), Calculateur de crédits, Retour de paiement (states), Inviter un membre (roles explainer, limit note), Transférer la propriété (`POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }`: password always, `totpCode` when the Owner has 2FA enabled, target must be an Admin), Langue & région.

### 7.9 Auth, onboarding, global (sections 08–09)
- `AUTH — States catalogue`: login states (submitting, credentials, rate-limited countdown, unverified, session expired), 2FA states (invalid n left, recovery code, expired, blocked; the "trusted device 30 d" checkbox drawn in Figma is not built — text fix), forgot (sent always, cooldown, mail unavailable), reset (validating, invalid, weak, done auto-login), verify & invitation states, **Créer mon espace** (invited-only user: shop name, wilaya, stock mode ⇒ owner + trial), workspace switcher + user menu, onboarding transverse states.
- `AUTH — Verify e-mail — done + reminder`, `AUTH — Accept invitation — logged out` (other states listed), `ONB-01` steps 1–6 (step 6 "Tout est prêt" with next actions Tester mon agent · Importer · Inviter · Accueil).
- `GLOBAL — States, toasts, banners & system dialogs catalogue` (12 §16), `GLOBAL — 404`, `GLOBAL — Credits exhausted — thread state (Inbox)`, `GLOBAL — Offline — stale data (Orders)`, `GLOBAL — Plan expired — free limits applied (Channels)` (paused card with "Reprendre" swap note).

### 7.10 RTL & responsive (section 10)
`ANA-01 — Home — AR`, `INB — Inbox — AR`, `ORD-05 v2 — Orders — list — AR`, `ORD-02 — New order — AR`, `CAT-01 — Product form — AR` (mirrored shell, Changa, LTR numbers/phones/SKUs); `RESP — Responsive — 1024 icon sidebar · 390 mobile web · simple-mode sidebar` (03 §34 LST-05).

### 7.11 Platform admin (section 12 + DLG Platform admin)
15-item admin sidebar on every ADM frame: Vue d'ensemble · Espaces de travail · Utilisateurs · Modération (badge) · Signalements · Support · Plans · Abonnements & factures · Crédits & promos · Fournisseurs IA · Préréglages d'agents · Contenu (CMS) · Journal d'audit · Tâches & santé · Paramètres plateforme · "← Retour à mon espace".
- `ADM-01 — overview` (KPIs, signups/activations/churn chart, alerts, top workspaces, AI cost per model, trials expiring).
- `ADM-02 — workspaces list + detail sheet` (filters plan / status / credits / created / wilaya; row menu incl. impersonation, change plan, add credits, extend trial, suspend, schedule deletion; sheet tabs Résumé · Membres · Abonnement · Crédits · Canaux · Audit; impersonation dialog rules).
- `ADM-03 — users` (platform role, status, verified, 2FA, last login; row menu).
- `ADM-04 — plans editor` (cards with version, subscribers, archive; edit form with impact warning `PLAN_LIMIT_GRANDFATHERED`, 30-day price notice).
- `ADM-05 — subscriptions & invoices` (KPIs, tabs Abonnements · Factures · Paiements manuels · Packs de crédits, dunning states, manual payment dialog, row menu).
- `ADM-06 — AI providers, routing & pricing calculator` (provider cards with health and fallback, routing table per capability, calculator).
- `ADM-07 — agent presets editor` (version pills, locales completeness, prompt with variables, publish checks, menu).
- `ADM-08 — CMS per locale` (entry types tabs, FR/AR/EN statuses, scheduling window, channels, target, AI translation, `CMS_LOCALE_MISSING`).
- `ADM-09 — audit log + diff` (filters incl. impersonation, before/after diff, signed export).
- `ADM-10 — moderation queue + review panel`, `ADM-11 — abuse reports & blocked words`, `ADM-12 — support tickets`, `ADM-13 — platform settings`, `ADM-14 — jobs & health`, `ADM-15 — credit packs & promo codes`, `ADM-16 — admin roles & account deletion requests`, `ADM-17 — read-only viewers + user detail` (03 §23–29).
- `DLG — Platform admin — dialogs catalogue`: Créer un plan (slug, names FR/AR/EN, prices, trial, order, limits −1, features, visibility, validation, card preview), Supprimer le plan (blocked → migrate / archive), Abonnement — créer / modifier (reason; `SUBSCRIPTION_ALREADY_ACTIVE`), Suspendre (reason list, e-mail), Ajouter des crédits, Libérer la page (proof of ownership), Clé fournisseur IA (test states), Modèle IA (costs, context, timeout, fallback threshold), Nouveau préréglage, Nouvelle entrée CMS, Exporter le journal d'audit, Changer le rôle plateforme (2FA; errors), Inviter un membre plateforme, Créer un espace pour un client, Programmer la suppression.

### 7.12 Public pages (section 13)
`PUB — Legal (CMS) · Landing & help · Meta data-deletion status`, `PUB — Pricing page (plans · FAQ · CTA)`, `PUB — Public account deletion page (djaber.ai/compte/suppression)`, `PUB — Public status page (status.djaber.ai)` (03 §36). Visitors' "Contact" links are `mailto:` the support mailbox (`NEXT_PUBLIC_SUPPORT_EMAIL`); landing CTA "Voir les fonctionnalités", help "Bien démarrer" (figma-text-fixes).

### 7.13 Navigation additions
- Sidebar: unchanged items; "Aide" opens the in-app help center (D46); Settings sub-nav (left rail): Profil · Espace de travail · Membres · Mode stock · Réponses rapides · Messages système · Sécurité · Intégrations · Plan & facturation · Crédits · Zone de danger; "Sécurité & clients bloqués" (SAFE) is reached from Settings › Sécurité (`/settings/security`).
- Orders list header gains "Importer" (D69, P2; opens `/orders/import` = the CAT-06 wizard with columns `clientName, phone, wilaya, commune?, address, items "SKU×qty;…", note?, orderedAt?`; `POST /orders/import` → 202, `POST /orders/import/:jobId/commit`) next to Exporter / + Nouvelle commande.
- Delivery header: Grille des frais · Transporteurs · "Envoyer les confirmées (n)".
- Public shell: Fonctionnalités · Tarifs · Aide · Statut · FR/AR/EN · Se connecter · Essai gratuit 14 j.

### 7.14 Dialog catalogues (Figma section 14) — index
| Frame | Dialogs (one `Dialog/<title>` each; footer note = rule or error code) |
|---|---|
| DLG — Orders & delivery | Annuler la commande · Changer le statut · Assigner · Programmer un rappel · Marquer livrée manuellement · Marquer retournée · Imprimer les bordereaux · Exporter les commandes · Modifier l'adresse de livraison · Résultat de l'appel · Fusionner les clients |
| DLG — Orders, delivery & clients II | Enregistrer un paiement · Supprimer la commande · Lien de paiement (P2) · Rembourser (P2) · Modifié par quelqu'un d'autre (409) · Ajouter un transporteur · Supprimer le transporteur · Grille des frais — actions · Bordereau indisponible · Annuler le colis · Nouveau client · Supprimer le client · Tags |
| DLG — GDS (stock) | Nouvelle catégorie · Nouvelle unité · Supprimer / archiver le produit · Modifier les prix en masse · Changer la catégorie · Générer des variantes · Dupliquer le produit · Nouveau fournisseur · Enregistrer un paiement fournisseur · Annuler la vente · Encaisser le reste · Mouvement de caisse manuel · Lancer un inventaire · Valider l'inventaire · Correspondance des colonnes |
| DLG — GDS (stock) II | Limite du plan atteinte · Créer depuis une photo · Images — erreurs inline · Ajuster le stock — cas · Supprimer la catégorie / unité (réaffecter) · Dépense produit · Achats — verrous · Ventes — verrous · Caisse — ligne manuelle & verrous · Règle de recommandation · Restaurer (conflit SKU) |
| DLG — Agents & channels | Supprimer l'agent · Mettre en pause · Résoudre l'insight · Déconnecter la page · Réactiver (swap at limit) · Reconnexion Meta — issues · Rapport de connexion · Connecter une page — explications · Synchroniser l'historique · Modèle IA indisponible · Générer un agent depuis ma page |
| DLG — Inbox & queue | Réponses rapides · Assigner · Notes internes · Supprimer la conversation · Sélecteur de canal · Actions groupées · Types de messages (×2) · Bandeaux de conversation · Composer — états · Panneau client — états · File d'attente — vide |
| DLG — Settings & billing | Activer la 2FA · Désactiver la 2FA / Régénérer · Changer le mot de passe · Changer l'e-mail · Supprimer mon compte · Logo & avatar · Réponse rapide · Message système — réinitialiser · Supprimer l'espace · Google Sheets — choisir la feuille · Webhook sortant · Changer de plan · Calculateur de crédits · Retour de paiement · Inviter un membre · Transférer la propriété · Langue & région |
| DLG — Platform admin | Créer un plan · Supprimer le plan · Abonnement — créer / modifier · Suspendre · Ajouter des crédits · Libérer la page · Clé fournisseur IA · Modèle IA · Nouveau préréglage · Nouvelle entrée CMS · Exporter le journal d'audit · Changer le rôle plateforme · Inviter un membre plateforme · Créer un espace pour un client · Programmer la suppression |
| MOD (04 GDS) | Contester le refus (appeal) |
| SAFE (07) | Signaler à Djaber · Bloquer un numéro |
| GLOBAL (09) | Quitter sans enregistrer ? · Modifié par quelqu'un d'autre · Limite du plan atteinte · Vérifiez votre e-mail · Tâche en cours · Nouvelle version disponible · Raccourcis clavier |
| ADM-02 / ADM-13 | Se connecter en tant que (impersonation, read-only only: reason ≥ 10 chars, ticket optional, 30 min) · Force update (2FA, sets `AppVersion.minVersion`) |
| GDS-09 / GDS-07 / GDS-01 | Clôturer le jour · Réceptionner #ACH · Ajuster le stock |
| AGT-02 step 4 / RESP | Déplacer la page vers ce nouvel agent · Passer en avancé ? |

### 7.15 Figma deliverable checklist (update)
- [x] "Web V2" page with 124 frames in 16 sections; cover lists every frame; §7.16 is the index.
- [x] Every state of 12 drawn or catalogued (GLOBAL, AUTH, ANA-01b, DLG ×8).
- [x] RTL frames for shell, inbox, orders list, order form, product form.
- [x] Responsive checks drawn at 1024 and 390 (RESP) for orders; home / inbox / order page have no dedicated 1024 frame: they follow the RESP rules (icon sidebar, secondary columns hidden) and are verified by AT-ST-14.
- [ ] Prototype links (onboarding, inbox takeover, AI order → confirm → send → tracking) — Figma deliverable of P1, not needed by the coder (flows are in 10).
- [ ] Figma text fixes of `../audit/figma-text-fixes.md` applied in Figma; until they are, the spec value wins (D65).
- [ ] Web components promoted to Figma components (currently inline, REF Component sheet); the coder builds them from `packages/ui` props in `02-next-route-map.md` §5.

### 7.16 Frame index (complete — every frame of the "Web V2" page, with its route)

Routes are those of `docs/implementation/02-next-route-map.md` §3; "—" = reference frame without a route. Dialog frames hold one `Dialog/<title>` each (§7.14).

| Section | Frame (exact name) | Route(s) | Spec |
|---|---|---|---|
| 00 Reference | `REF — Component sheet (status pills per enum, patterns)` | — | §7.1, 12 §16 |
| 00 Reference | `REF — Entity & navigation map (for implementation)` | — | §7.1, §6 |
| 00 Reference | `REF — Filters, actions & quick-edit matrix per page` | — | §6 |
| 00 Reference | `REF — Deep-link map (notification → target) + remaining list mechanics` | — | 03 §15, 03 §35, D47 |
| 01 Shell & home | `ANA-01 — Home — default` | `/home` | §4.3, 12 §3 |
| 01 Shell & home | `ANA-01 — Home — new workspace + banners` | `/home` | 12 §3, 12 §16 |
| 01 Shell & home | `ANA-01b — Home & Notifications — states catalogue` | `/home`, `/notifications` | §7.2, 12 §18 |
| 01 Shell & home | `NTF-01 — Notifications — list` | `/notifications` | §7.2, 12 §18 |
| 02 Inbox & queue | `QUEUE — File d'attente — items` | `/queue` | §7.3, 12 §4 |
| 02 Inbox & queue | `INB — Inbox — thread with handoff` | `/inbox`, `/inbox/[conversationId]` | §4.4, 12 §4, 12 §23 |
| 02 Inbox & queue | `INB — Inbox — filter sheet + conversation menu` | `/inbox` | §6, 12 §23 |
| 03 Orders, delivery & clients | `ORD-05 v2 — Orders — list (dense rows, source column, actions dropdown)` | `/orders` | §7.4, 12 §20 |
| 03 Orders, delivery & clients | `ORD-05 — Orders — list v1 (superseded)` | — (do not implement) | §7.4 |
| 03 Orders, delivery & clients | `ORD-05 — Orders — filter panel open` | `/orders` | §6, 12 §19 |
| 03 Orders, delivery & clients | `ORD-05 — Orders — row actions menu + bulk results dialog` | `/orders` | §6, 12 §19 |
| 03 Orders, delivery & clients | `ORD-02 — New order — form (client conflict, variant, fee quote)` | `/orders/new` | §4.5, 12 §5 |
| 03 Orders, delivery & clients | `ORD-06 — Order page — new` | `/orders/[id]` | §7.4, 12 §5, 12 §20 |
| 03 Orders, delivery & clients | `ORD-07 — Confirm order dialog — outcome step` | `/orders/[id]` | §7.4, 12 §5 |
| 03 Orders, delivery & clients | `DLV-08 — Delivery — overview + tracking panel` | `/delivery` | §7.4, 12 §6, 12 §20 |
| 03 Orders, delivery & clients | `DLV-05 — Delivery — send to courier dialog (validation error)` | `/delivery`, `/orders/[id]` | §7.4, 12 §6 |
| 03 Orders, delivery & clients | `DLV-01/03 — Delivery — fee grid + couriers settings` | `/delivery/fees`, `/delivery/couriers` | §7.4, 12 §6 |
| 03 Orders, delivery & clients | `DLV-06 / ORD-09 — Labels viewer + order print preview A5` | `/orders/[id]`, `/delivery` | §7.4, 12 §20 |
| 03 Orders, delivery & clients | `MECH — Delivery filters + row menu + bulk send results` | `/delivery` | §6, 12 §19–20 |
| 03 Orders, delivery & clients | `CLI-03 — Clients — list with detail sheet` | `/clients`, `/clients/[id]` | §7.4, 12 §7, 12 §20 |
| 03 Orders, delivery & clients | `CLI-03 — Clients — filter panel + row menu` | `/clients` | §6, 12 §19 |
| 04 GDS | `GDS-01 — Stock dashboard (advanced) + adjust dialog` | `/stock` | 12 §8, 12 §21 |
| 04 GDS | `CAT-08 — Products — list (advanced)` | `/products` | §4.8, 12 §8 |
| 04 GDS | `CAT-08 — Products — bulk bar + row actions menu` | `/products` | §6, 12 §19 |
| 04 GDS | `CAT-08 — Products — filter panel open` | `/products` | §6, 12 §19 |
| 04 GDS | `CAT-01 — Product — quick edit sheet + relations` | `/products` | §6, 12 §19 |
| 04 GDS | `CAT-01 — Product form — edit with variants` | `/products/new`, `/products/[id]/edit` | §4.8, 12 §8 |
| 04 GDS | `CAT-09 — Product page — full` | `/products/[id]` | §7.5, 12 §21 |
| 04 GDS | `CAT-06 — Import wizard — preview with row errors` | `/products/import`, `/orders/import` (same wizard, D69) | §4.8, 12 §8 |
| 04 GDS | `CAT-04 — Categories & units — list + edit sheet + reassign dialog` | `/categories` | §4.8, 12 §8 |
| 04 GDS | `CAT-11 / GDS-06b — Services list · New purchase form · Purchase & sale detail` | `/services`, `/purchases/new`, `/purchases/[id]`, `/sales/[id]` | §7.5, 12 §21 |
| 04 GDS | `GDS-05 — Movements — list + filter panel` | `/movements` | §7.5, 12 §21 |
| 04 GDS | `GDS-06 — Suppliers — list + detail sheet` | `/suppliers`, `/suppliers/[id]` | §7.5, 12 §12 |
| 04 GDS | `GDS-07 — Purchases — list + receive dialog` | `/purchases` | §7.5, 12 §12, 12 §21 |
| 04 GDS | `GDS-08 — Sales (counter) — list + new sale with partial payment` | `/sales`, `/sales/new` | §7.5, 12 §21 |
| 04 GDS | `GDS-09 — Cash register — ledger with locked automatic rows` | `/cash` | §7.5, 12 §21 |
| 04 GDS | `GDS-10 — Recommendations — list + generate job + stats` | `/recommendations` | §7.5, 12 §21 |
| 04 GDS | `MOD — Merchant side — product moderation states` | `/products` | §7.5, 12 §21 |
| 04 GDS | `MOD — Product — rejected view + appeal dialog (merchant)` | `/products/[id]` | §7.5, 12 §21 |
| 05 Agents & channels | `AGT-01 — Agents — list (active, paused, insights)` | `/agents` | §4.9, 12 §9 |
| 05 Agents & channels | `AGT-02 — Agent wizard — step 1 identity` | `/agents/new/identity` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-02 — Agent wizard — step 2 knowledge` | `/agents/new/knowledge` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-02 — Agent wizard — step 3 behaviour` | `/agents/new/behaviour` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-02 — Agent wizard — step 4 channels (move dialog)` | `/agents/new/channels` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-02 — Agent wizard — step 5 test & activate` | `/agents/new/activate` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-03 — Agent page — overview (tabs, versions, rollback)` | `/agents/[id]` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-04 — Agent page — Configuration tab (edit as tabs, dirty, saving, conflict)` | `/agents/[id]/configuration` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-08 — Agent page — Insights queue tab` | `/agents/[id]/insights` | §7.6, 12 §22 |
| 05 Agents & channels | `AGT-07 — Agent playground — dry run with tool calls` | `/agents/[id]/playground`, `/agent-test/[token]` (shared read-only playground, `GET /agent-test/:token`) | §7.6, 12 §22 |
| 05 Agents & channels | `MECH — Agents filters + row menu · Channels row actions` | `/agents`, `/channels` | §6, 12 §19 |
| 05 Agents & channels | `CHN-06 — Channels — list with statuses` | `/channels` | §4.10, 12 §10, 12 §22 |
| 05 Agents & channels | `CHN-07 — Channel page — overview` | `/channels/[id]` | §4.10, 12 §10 |
| 05 Agents & channels | `CHN-07b — Channel page — Messages · AI settings · History tabs` | `/channels/[id]/messages`, `/channels/[id]/ai`, `/channels/[id]/history` | §7.6, 12 §22 |
| 05 Agents & channels | `CHN-08 — Channel page — analysis review (import)` | `/channels/[id]/analysis` | §7.6, 12 §22 |
| 06 Analytics & reports | `ANA-02 — Analytics — overview tab + period picker` | `/analytics/overview` | §7.7, 12 §24 |
| 06 Analytics & reports | `ANA-02b — Analytics — tabs Conversations · IA · Agents · Canaux · Produits · Commandes · Livraison` | `/analytics/[tab]` | §7.7, 12 §24 |
| 06 Analytics & reports | `ANA-03 — Reports — hub (23 reports) + export jobs` | `/reports` | §7.7, 12 §24 |
| 06 Analytics & reports | `ANA-04 — Report — template (Ventes par produit) + large export banner` | `/reports/[key]` | §7.7, 12 §24 |
| 07 Settings, billing, help & safety | `BIL-01 — Settings — Plan & billing` | `/settings/billing` | §7.8, 12 §24 |
| 07 Settings, billing, help & safety | `BIL-04 / BIL-03 — Credits page (ledger) · Invoices · Checkout return` | `/settings/credits`, `/settings/billing/return` | §7.8, 12 §24 |
| 07 Settings, billing, help & safety | `HELP — Help & support (merchant) — center, status, contact form, my tickets` | `/help`, `/help/contact`, `/help/tickets`, `/help/tickets/[id]`; "?" contextual panel (`GET /help/articles?context=`) on every page | §7.8, 12 §25 |
| 07 Settings, billing, help & safety | `SAFE — Trust & safety (merchant)` | `/settings/security` (blocked customers, auto-rules, blocked words) | §7.8, 12 §25 |
| 07 Settings, billing, help & safety | `SET — Settings — Profile · Workspace · Security` | `/settings/profile`, `/settings/workspace`, `/settings/security` | §7.8, 12 §25 |
| 07 Settings, billing, help & safety | `SET — Settings — Members & invitations` | `/settings/members` | §7.8, 12 §25 |
| 07 Settings, billing, help & safety | `SET — Settings — Integrations (Sheets · API keys · webhooks)` | `/settings/integrations` | §7.8, 12 §25 |
| 07 Settings, billing, help & safety | `SET — Settings — Quick replies · System messages · Notifications · Stock mode · Danger zone` | `/settings/quick-replies`, `/settings/system-messages`, `/settings/notifications`, `/settings/stock-mode`, `/settings/danger` | §7.8, 12 §13, 12 §25 |
| 08 Auth & onboarding | `AUTH — Login — default` | `/login` | 12 §1, 12 §17 |
| 08 Auth & onboarding | `AUTH — Login — 2FA step` | `/login` | 12 §17 |
| 08 Auth & onboarding | `AUTH — Sign up — field errors` | `/signup` | 12 §1 |
| 08 Auth & onboarding | `AUTH — Reset password — expired` | `/reset-password` | 12 §1, 12 §17 |
| 08 Auth & onboarding | `AUTH — Verify e-mail — done + reminder` | `/verify-email` | 12 §17 |
| 08 Auth & onboarding | `AUTH — Accept invitation — logged out` | `/invitations/[token]` | 12 §17 |
| 08 Auth & onboarding | `AUTH — States catalogue` | `/login`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invitations/[token]`, `/workspaces/new`, user menu + workspace switcher, onboarding transverse states | §7.9, 12 §17 |
| 08 Auth & onboarding | `ONB-01 — Onboarding — step 1…6` (6 frames) | `/onboarding/welcome`, `/onboarding/stock-mode`, `/onboarding/first-product`, `/onboarding/agent`, `/onboarding/connect`, `/onboarding/ready` | §4.2, 12 §2 |
| 09 Global | `GLOBAL — States, toasts, banners & system dialogs catalogue` | every route (layout hooks: legal re-acceptance interstitial, maintenance, announcements, new web version) | 12 §16 |
| 09 Global | `GLOBAL — 404` | every unknown route; "Introuvable" for deleted objects | 12 §0, 12 §16 |
| 09 Global | `GLOBAL — Credits exhausted — thread state (Inbox)` | `/inbox/[conversationId]` | 12 §23 |
| 09 Global | `GLOBAL — Offline — stale data (Orders)` | `/orders` (pattern for every list) | 12 §16 |
| 09 Global | `GLOBAL — Plan expired — free limits applied (Channels)` | `/channels`, `/settings/billing` | 12 §0, 12 §22, FL-31 |
| 10 RTL & responsive | `ANA-01 — Home — AR (RTL)` | `/home` | §7.10 |
| 10 RTL & responsive | `INB — Inbox — AR (RTL)` | `/inbox` | §7.10 |
| 10 RTL & responsive | `ORD-05 v2 — Orders — list — AR (RTL)` | `/orders` | §7.10 |
| 10 RTL & responsive | `ORD-02 — New order — AR (RTL)` | `/orders/new` | §7.10 |
| 10 RTL & responsive | `CAT-01 — Product form — AR (RTL)` | `/products/new`, `/products/[id]/edit` | §7.10 |
| 10 RTL & responsive | `RESP — Responsive — 1024 icon sidebar · 390 mobile web · simple-mode sidebar` | every `(app)` route | §2, §7.10, 12 §19 |
| 12 Platform admin | `ADM-01 — Platform admin — overview` | `/admin` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-02 — Platform admin — workspaces list + detail sheet` | `/admin/workspaces`, `/admin/workspaces/[id]` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-03 — Platform admin — users` | `/admin/users` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-04 — Platform admin — plans editor` | `/admin/plans` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-05 — Platform admin — subscriptions & invoices` | `/admin/subscriptions` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-06 — Platform admin — AI providers, routing & pricing calculator` | `/admin/ai` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-07 — Platform admin — agent presets editor` | `/admin/presets` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-08 — Platform admin — CMS per locale` | `/admin/cms` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-09 — Platform admin — audit log + diff` | `/admin/audit` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-10 — Platform admin — moderation queue (products) + review panel` | `/admin/moderation` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-11 — Platform admin — abuse reports & blocked words` | `/admin/reports` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-12 — Platform admin — support tickets` | `/admin/support`, `/admin/support/[id]` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-13 — Platform admin — platform settings` | `/admin/settings` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-14 — Platform admin — jobs & health` | `/admin/health` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-15 — Platform admin — credit packs & promo codes` | `/admin/credits` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-16 — Platform admin — admin roles & account deletion requests` | `/admin/team` | §7.11, 12 §26 |
| 12 Platform admin | `ADM-17 — Platform admin — read-only viewers + user detail` | `/admin/viewers/conversations/[id]`, `/admin/viewers/products`, `/admin/users` (detail) | §7.11, 12 §26 |
| 13 Public | `PUB — Legal (CMS) · Landing & help · Meta data-deletion status` | `/`, `/features`, `/help`, `/help/[slug]`, `/legal/[slug]`, `/meta/data-deletion/[code]` | §7.12, 12 §27 |
| 13 Public | `PUB — Pricing page (plans · FAQ · CTA)` | `/pricing` | §7.12, 12 §27 |
| 13 Public | `PUB — Public account deletion page (djaber.ai/compte/suppression)` | `/account/deletion` | §7.12, 12 §27, FL-22 |
| 13 Public | `PUB — Public status page (status.djaber.ai)` | `/status` | §7.12, 12 §27 |
| 14 Dialog catalogues | `DLG — Orders & delivery — dialogs catalogue` | `/orders`, `/orders/[id]`, `/delivery` | §7.14, 12 §20 |
| 14 Dialog catalogues | `DLG — Orders, delivery & clients II — dialogs catalogue` | `/orders/[id]`, `/delivery/*`, `/clients` | §7.14, 12 §20 |
| 14 Dialog catalogues | `DLG — GDS (stock) — dialogs catalogue` | `/products*`, `/categories`, `/suppliers`, `/sales`, `/cash`, `/inventories` | §7.14, 12 §21 |
| 14 Dialog catalogues | `DLG — GDS (stock) II — dialogs & inline states catalogue` | `/products*`, `/stock`, `/purchases`, `/sales`, `/cash`, `/recommendations` | §7.14, 12 §21 |
| 14 Dialog catalogues | `DLG — Agents & channels — dialogs, connect flow & generate-from-page` | `/agents*`, `/channels*`, `/onboarding/connect` | §7.14, 12 §22 |
| 14 Dialog catalogues | `DLG — Inbox & queue — popovers, message types, banners, composer states` | `/inbox*`, `/queue` | §7.14, 12 §23 |
| 14 Dialog catalogues | `DLG — Settings & billing — dialogs catalogue` | `/settings/*` | §7.14, 12 §24–25 |
| 14 Dialog catalogues | `DLG — Platform admin — dialogs catalogue` | `/admin/*` | §7.14, 12 §26 |

Routes without a dedicated frame (built from the frames above, per 02 §3.6): public tracking `/s/[code]` (`GET /track/:publicToken`) = the timeline of `DLV-08` tracking panel without phone + "Signaler ce vendeur" (SAFE dialog) + GLOBAL 404; orders import `/orders/import` = `CAT-06` wizard; shared playground `/agent-test/[token]` = `AGT-07` without inspector; dialog "Langue & région", legal re-acceptance interstitial, maintenance and announcement banners, "?" help panel and saved views = the DLG / GLOBAL / REF frames cited in their rows.
