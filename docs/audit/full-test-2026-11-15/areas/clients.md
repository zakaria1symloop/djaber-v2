# Area clients — tested 15/11/2026 18:07–18:37 (Africa/Algiers)

Owner account, shop « Boutique Test Équipe », live https://djaber.vercel.app. Own test data: « QA clients Amina Benali »
(renamed « QA clients أمينة بن علي », merged with « QA clients Fusion Doublon », then archived), « QA clients Supprimer »
(deleted), « QA clients Retour » (still active), order #CMD-1025 (created for the client, then cancelled « QA clients »),
tags `qa-clients`, `qa-clients-عربي😀`, `QA clients tag xxxxxxxxxxxxxxxxxxxxxxxxx` (they now show in every tag picker of the shop).

### CLIENTS-01 — A client's order count differs between the list, the row menu, the delete dialog and the client sheet
- Page: /fr/clients and /fr/clients?sheet=… (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. In the clients list, « Badreddine bendief » shows CMD. **6**, « Houssem H » **5**, « QA orders Karim Deux » **1**. 2. Row Actions shows « Commandes · 6 »; « Supprimer (soft) » dialog shows « 6 commandes ». 3. Open the sheet: tile COMMANDES **5** (Houssem: 4), with 5 orders listed. « Commandes · 6 » opens /orders?clientId=… with 5 orders.
- Expected: one definition of « commandes » on every client screen (CLI-03 « detail with metrics (orders, …) », CLI-04 aggregates recomputed from data). If counter sales are included, the screens should say so (for example « 3 commandes + 3 ventes »).
- Actual: the list, the menu and the delete dialog use `Client.orderCount`, which counts orders that are not cancelled plus completed counter sales (Badreddine: 3 + 3 = 6). The sheet uses `/clients/:id/metrics.orders`, which counts all orders including cancelled ones (5). So the same word « Commandes » shows 6 and 5 for the same client. « mohamed » shows « 1 cmd. » in the list but has no order at all, only one counter sale. Karim Deux has 2 orders (1 cancelled) and the list shows 1.
- Likely cause: apps/api/src/modules/clients/client-aggregates.service.ts:19/37 (`orderCount = live.length + sales.length`) vs the metrics endpoint.
- Evidence: .local/qa/campaign/clients/fr-04-sheet-bad.png · API: GET /clients → `orderCount: 6`; GET /clients/:id/metrics → `orders: 5, sales: 3, cancels: 2`

### CLIENTS-02 — Delete dialog of a client with orders offers « Supprimer », shows a design note, then fails into « 1 commandes : archivez plutôt le client. »
- Page: /fr/clients › Actions › Supprimer (soft) (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Pick a client with orders (« QA clients أمينة بن علي », 1 order; dialog also opened on « Badreddine bendief », 6 orders, cancelled there). 2. Actions › « Supprimer (soft) ». 3. The dialog already says « 1 commande ». Click « Supprimer ».
- Expected: 12 §20 « Supprimer le client | … with orders ⇒ propose Archiver (`CUSTOMER_HAS_ORDERS`) ». The API already returns `actions: archive` for a client with orders, so the dialog can offer « Archiver » from the start, with a correct plural (« 1 commande »).
- Actual: the first step offers only « Supprimer ». Its body ends with the spec note « Avec des commandes : proposer « Archiver ». ». The click gives `409 CUSTOMER_HAS_ORDERS` and the dialog then shows « 1 commandes : archivez plutôt le client. » + « Archiver ». The error text has no plural form for count 1 (fr / ar / en catalogue entries, packages/shared/src/errors/messages.fr.json:76).
- Evidence: .local/qa/campaign/clients/fr-21-delete-has-orders.png · fr-17-delete-with-orders.png · API: DELETE /clients/01a1e02e-… → 409 CUSTOMER_HAS_ORDERS {count:1}

### CLIENTS-03 — An archived client cannot be restored, and re-creating its phone makes a second card without its history
- Page: /fr/clients/01a1e02e-911f-7014-b139-e8c9b397c0e7 (archived) · /fr/clients › + Nouveau client (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Archive « QA clients أمينة بن علي » (1 order) through the delete → Archiver flow. 2. Open its URL directly: banner « Client archivé : retiré des listes, ses commandes restent visibles. », and the Actions menu has no « Restaurer » (it still offers « Supprimer (soft) », « Nouvelle commande », « Fusionner »…). 3. + Nouveau client, « QA clients Retour », phone 0699 10 20 30 (the archived client's phone).
- Expected: archiving can be undone (products have archive / restore), or the dialog says that it is final. 04 §2 « Client phone unique per workspace (normalised) »: a returning customer is matched to the archived card (« Utiliser ce client » / restore), so the orders and the risk history stay with them.
- Actual: no restore anywhere, and the archive dialog does not say that it is final. `POST /clients` → 201, a second client with phone 0699102030 is created with 0 orders, and the earlier order and the merge history stay on the hidden card. The order form now finds only the new card.
- Evidence: .local/qa/campaign/clients/fr-27-archived-page.png · fr-27-archived-menu.png · API: POST /clients {phone:"0699102030"} → 201 (id 01a1e046-403b-…)

### CLIENTS-04 — Technical / design notes shown to the merchant in the client menus and dialogs
- Page: /fr/clients (row menu, sheet « … » menu, full page Actions, + Nouveau client, bulk bar) (owner, fr / ar / en)
- Severity: Minor
- Type: Text
- Steps: 1. Open + Nouveau client. 2. Open a row « Actions ». 3. Tick 2 rows.
- Expected: 12 GLOBAL « No technical text on merchant screens » (UX-059). Hints say where the action leads (DIALOGUE, PAGE COMMANDE).
- Actual:
  - The dialog subtitle « Clients › + Nouveau · aussi depuis Nouvelle commande » is a Figma annotation (ar « العملاء › + جديد · أيضاً من طلب جديد », en « Clients › + New · also from New order »). Source: app.fr.json:2443 `clients.dialog.new.context`.
  - The menu item « Supprimer (soft) » (en « Delete (soft) », ar « حذف (مؤقت) », which means « temporary delete »). The delete dialog also has « Suppression douce » and the line « Avec des commandes : proposer « Archiver ». ».
  - The hint « MULTI-SÉLECTION » under « Étiquettes » appears on a single client's menu.
  - The bulk bar line « Les actions groupées renvoient un résultat par client (ok / erreur) — jamais tout ou rien. »
  - The dialog footer « SI LE NUMÉRO EXISTE DÉJÀ, UN LIEN « UTILISER CE CLIENT » S'AFFICHE. ».
- Evidence: .local/qa/campaign/clients/fr-02-new-empty-submit.png · fr-04-rowmenu-mine.png · ar-23-menu.png · fr-22-bulk.png

### CLIENTS-05 — Every client is « CLIENTE » (feminine) in the sheet header, the merge notice and the order form
- Page: /fr/clients?sheet=… , /fr/clients/[id], /fr/orders/new?clientId=… (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Open the sheet of « Badreddine bendief » or « Houssem H ». 2. Open a merged client's sheet. 3. Actions › Nouvelle commande.
- Expected: neutral wording (« Client depuis oct. »), the same as the rest of the screen (« Client bloqué… », « Client archivé… »).
- Actual: « CLIENTE DEPUIS OCT. » for every client (app.fr.json:2540 `clients.sheet.since`). The merge notice says « Fusionnée le 15 nov. 2026 : la fiche… » (:2528). The order form opened from the sheet says « 1 · CLIENTE » and « Préremplie depuis l'adresse par défaut de la cliente ». The full page also writes « CLIENTE DEPUIS nov. » in lower case while the sheet writes « NOV. ».
- Evidence: .local/qa/campaign/clients/fr-04-sheet-bad.png · fr-04-fullpage.png · fr-15-neworder-blocked.png

### CLIENTS-06 — Notes that are too long show « Trop long ( max) », with no number and no counter
- Page: /fr/clients?sheet=… › Modifier (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Modifier on « QA clients … ». 2. Paste about 6 000 characters in NOTES. 3. Enregistrer.
- Expected: the limit is known before saving (counter or maxlength), and the error names it (« Trop long (2 000 caractères max). »).
- Actual: the field has no maxlength and no counter. After the save the error is « Trop long ( max) », with the number missing. The name field has no maxlength either (101 characters are accepted until submit, then « 3 à 80 caractères… »).
- Evidence: .local/qa/campaign/clients/fr-25-long-notes.png

### CLIENTS-07 — The « no result » message is wrong for a search: « Aucun(e) client ne correspond à « filtres actuels ». »
- Page: /fr/clients?q=zzzz (owner, fr; same in ar « لا يوجد عميل يطابق « المرشحات الحالية ». »)
- Severity: Minor
- Type: Text
- Steps: 1. Search « zzzz » (or apply any filter that gives no result).
- Expected: 12 GLOBAL [FE]: « Aucun client ne correspond à « zzzz ». » for a search, and « … aux filtres actuels » for filters, with no « (e) ».
- Actual: « Aucun(e) client ne correspond à « filtres actuels ». ». The words « filtres actuels » are quoted as if they were the search text, even when the only filter is the search. Products use « les filtres actuels » (app.fr.json:2513 vs :4917).
- Evidence: .local/qa/campaign/clients/fr-08-search-empty.png

### CLIENTS-08 — Filters panel: counts do not follow the draft, and impossible ranges are accepted silently
- Page: /fr/clients › Filtres, › Période › Personnalisé (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Filtres › COMMANDES min `2`, max `1`. 2. Read the header and the button. 3. Afficher. 4. Période › Personnalisé › Du 20/11/2026, Au 01/11/2026.
- Expected: the panel shows the number of clients that the current draft would give, and refuses min > max or Du > Au with an inline message (like the CMS rule « La fin doit être après le début. », 12 §CMS UX-037).
- Actual: the panel keeps « 0 ACTIFS · 12 RÉSULTATS » and « Afficher 12 clients » while the draft gives 0. The range 2 – 1 is applied (`?minOrders=2&maxOrders=1`, chip « COMMANDES 2 – 1 ») and the list is empty. Du > Au is applied the same way (`createdFrom=2026-11-20&createdTo=2026-11-01`) with no warning.
- Evidence: .local/qa/campaign/clients/fr-08-panel-minmax.png · fr-10-period-2026-11-20-2026-11-01.png

### CLIENTS-09 — Sorting by name is case-sensitive (all capitalised names first, « achref » after « QA … »)
- Page: /fr/clients?sort=name (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Click the CLIENT column header.
- Expected: alphabetical order that ignores case and accents: achref, achref khatimi, Amrani Mahdi, Badreddine…
- Actual: « Amrani Mahdi ; Badreddine bendief ; Houssem H ; Midou Yahya ; QA … ; achref ; achref khatimi ; mohamed ». Clients typed in lower case (common for Messenger names) end up at the bottom.
- Evidence: script 09 output · API: GET /clients?sort=name

### CLIENTS-10 — Esc or ✕ on « Nouveau client » / « Modifier » drops everything typed, with no confirmation
- Page: /fr/clients › + Nouveau client, sheet › Modifier (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Modifier, change the name. 2. Press Esc. 3. Reopen.
- Expected: « Quitter sans enregistrer ? » (12 GLOBAL close guard `useCloseGuard`, the same as the other dialogs with typed content).
- Actual: the dialog closes at once and the change is lost. The same happens in « Nouveau client » after typing a name.
- Evidence: script 11 / 25 output (« ESC with typed name → dialogs: 0 »)

### CLIENTS-11 — A malformed client URL shows « Impossible de charger · Requête invalide. » + Réessayer instead of « Introuvable »
- Page: /fr/clients/not-a-uuid (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /fr/clients/not-a-uuid (for example a truncated link).
- Expected: the 404 state « Introuvable — Cet élément n'existe pas ou appartient à un autre espace. » + Retour, which is what /fr/clients/00000000-0000-7000-8000-000000000000 shows.
- Actual: the error state « Impossible de charger — Requête invalide. » with « Réessayer », which can never work.
- Evidence: .local/qa/campaign/clients/fr-04-badid.png · API: GET /clients/not-a-uuid → 400 BAD_REQUEST

### CLIENTS-12 — The second phone added by a merge is shown but cannot be edited or removed
- Page: /fr/clients?sheet=01a1e02e-… › Modifier (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Merge « QA clients Fusion Doublon » (0698 11 22 33) into « QA clients أمينة بن علي ». 2. The sheet shows a second phone « 0698 11 22 33 » under TÉLÉPHONE. 3. Modifier.
- Expected: the second phone can be corrected or removed in the edit dialog (04 §2 « Optional client strings … phone 2 »; the form state already has `phone2`, apps/web/src/features/clients/dialogs.tsx:29).
- Actual: the dialog has no « Téléphone 2 » field. The PATCH silently re-sends `phone2: "0698112233"`, and a wrong phone 2 can never be removed. The list search does not find the client by this phone either.
- Evidence: .local/qa/campaign/clients/fr-25-long-notes.png (dialog without phone 2) · fr-24-phone-sheet.png

### CLIENTS-13 — Tags dialog: it does not show which tags the client already has, and it is called « Tags » while the menu says « Étiquettes »
- Page: /fr/clients › Actions › Étiquettes (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. On a client tagged `qa-clients`, Actions › Étiquettes.
- Expected: for one client, its current tags are shown as selected (« retirer » possible at a glance). One name everywhere: « Étiquettes » (the filter button, the column, the menu).
- Actual: every tag is « inchangé » (aria-label « qa-clients · inchangé »). The merchant cannot tell which tags the client has, and clicking `qa-clients` once marks it « add » again. The dialog title and the field are « Tags », and the text is « les tags sont des filtres dans Clients et Commandes ». The tag field silently cuts at 40 characters.
- Evidence: .local/qa/campaign/clients/fr-12-tags.png · fr-13-tags-state.png

### CLIENTS-14 — Row menu has no « Ouvrir la conversation » for a client who has one (the sheet menu has it)
- Page: /fr/clients › row Actions on « Badreddine bendief » (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Row Actions on Badreddine (1 conversation). 2. Compare with the sheet « … » menu.
- Expected: 12 §20 Clients list row menu « Compléter la fiche · Fusionner · Ouvrir la conversation · Nouvelle commande · Commandes · Étiquettes · Exporter · Supprimer ».
- Actual: the row menu lists Fiche client, Modifier, Fusionner, Nouvelle commande, Commandes, Étiquettes, Exporter la fiche, Marquer « risque », Bloquer, Supprimer. « Ouvrir la conversation » (BOÎTE › FIL) is only in the sheet menu, even though the API row has `open_conversation: enabled`.
- Evidence: .local/qa/campaign/clients/fr-04-rowmenu-bad.png · fr-04-sheet-menu.png

### CLIENTS-15 — « Marquer « fiable » » does not make the client « FIABLE »
- Page: /fr/clients/[id] › Actions (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Mark a client « risque » (one click, pill RISQUE). 2. The menu now offers « Marquer « fiable » ». Click it.
- Expected: the label says what happens (« Retirer « risque » »), or the client then shows FIABLE.
- Actual: `POST /clients/:id/risk {riskLevel:"normal"}`. The pill disappears, or becomes INCONNU for a client without orders, and never shows FIABLE, which needs delivered orders.
- Evidence: .local/qa/campaign/clients/fr-12-menu-after-risk.png · fr-25-after-fiable.png

### CLIENTS-16 — Risk pills differ between desktop and phone: FIABLE / INCONNU only on the phone cards
- Page: /fr/clients (owner, fr, 1440 px vs 390 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Desktop list: « Houssem H » and « QA delivery Samir Un » have no pill, and only RISQUE / BLOQUÉ appear (in the ÉTIQUETTES column). 2. Same list at 390 px: FIABLE on Houssem and Samir, INCONNU on clients without orders. The sheet shows FIABLE too.
- Expected: the same pills on both layouts (CLI risk pills `FIABLE · INCONNU · RISQUE · BLOQUÉ · PLACEHOLDER`, 03 §CLI).
- Actual: the desktop table hides FIABLE and INCONNU.
- Evidence: .local/qa/campaign/clients/fr-01-list.png · fr-24-phone-list.png

### CLIENTS-17 — Small format / wording inconsistencies on the client screens
- Page: /fr/clients, merge dialog, /en/clients (owner)
- Severity: Cosmetic
- Type: Text
- Steps / Actual:
  - The DÉPENSÉ column shows « 0 » for most clients but « 7 700 DA » for others (CLAUDE rule 11 `12 500 DA`). The sheet tile reads « DA DÉPENSÉS 0 ».
  - The merge dialog and its search show raw phones « 0699102030 », « 0698112233 » and a lower-case « risque », instead of « 0699 10 20 30 » and the pill.
  - A wrong phone shows two errors at once: the helper « NUMÉRO INVALIDE · FORMAT ATTENDU 0555 12 34 56 » and « Numéro invalide (ex. 0555123456) ».
  - The page eyebrow is « VENTES » (ar « المبيعات », en « SALES ») above « Clients », although Clients is not under a Ventes group in the sidebar.
  - In en, the title is « Customers » but the count and the button say « 15 clients » and « + New client », the dialog says « New customer », and the menu has « Client record » next to « Block the customer ».
  - In ar, the source pill « ذكاء اصطناعي » wraps on two lines and makes the row taller. A long tag pill is cut with no ellipsis.
- Evidence: .local/qa/campaign/clients/fr-01-list.png · fr-17-merge-picked.png · fr-03-validation.png · en-23-list.png · ar-23-list.png

## Coverage
- Clients list (fr 1440 px): load, KPI count, every column, sort on each sortable column (both directions, and refresh F5 keeps it), « Affichage » (density, hide a column, which is kept in the URL), page size select, row click → sheet, Précédent / Suivant in the sheet, Esc closes the sheet and cleans the URL.
- Search: name, partial phone, phone with spaces, without 0, case, Arabic, `<script>`, `'`, `%`, no result. URL `?q=` survives F5.
- Filters: Source popover, Étiquettes popover, Période (7 j, 30 j, Personnalisé valid and inverted), « À relancer » (checked against the data: 2–3 expected clients, correct, and my client appeared once it had a « new » order), filters panel (every section listed, min / max orders, Réinitialiser), chips, « Effacer tout », [FE] state.
- Nouveau client: empty submit, short / numeric / 101-character name, phone with 9 digits, letters, +213 (normalised), bad e-mail, e-mail trimmed and lower-cased on blur, existing phone → 409 + « Utiliser ce client » (opens the existing sheet), tags (suggested + typed), wilaya / commune pickers (70 wilayas incl. 59–69), address with Arabic + emoji, default address, notes in Arabic → created.
- Client sheet and full page /fr/clients/[id]: metrics tiles, contact, address, channels, tags, notes, orders, counter sales, conversations, merged notice, blocked notice, archived notice, « Nouvelle commande pour … » (prefilled form checked, nothing saved there), order row link + Back, 404 id, malformed id.
- Modifier: values prefilled, phone conflict 409, Arabic name, e-mail cleared → null, notes too long, Esc without guard.
- Row / sheet / full-page Actions menus (own client and pre-existing clients, opened only), Étiquettes (one client, then bulk dialog opened), Marquer « risque » / « fiable », Bloquer (dialog, cancel, then block with an Arabic + emoji note) → BLOQUÉ pill, `?blocked=true`, sheet notice, new-order prefill with the BLOQUÉ pill, Débloquer (confirm dialog), Exporter la fiche (xlsx job → download), Exporter list with filters (xlsx content checked: 3 « À relancer » rows, Arabic and emoji tags intact), Fusionner (search, self excluded, picked cards, 409 CUSTOMER_MERGE_IRREVERSIBLE → « Confirmer la fusion » → merged, phone 2 copied), Supprimer (0 orders → done; with orders → 409 → Archiver → archived), bulk bar (select 2, select all 15, deselect, bulk delete and bulk tags dialogs opened and cancelled).
- Arabic (RTL): list, row menu, sheet, new-client dialog + validation, filters panel, empty state. English: same screens. Phone 390 px (fr): list cards, sheet, row menu, filters panel, new-client dialog, full page. No horizontal overflow (scrollWidth 390).
- Kit log on every run: no console error other than the expected 409 / 404 / 400 of the tested cases, and no text leak detected by the kit.

## Blocked by safety
- None. No call of the clients area was stopped by the kit.

## Not tested
- « Signaler à Djaber » (report) is not offered on any client screen (only in the Inbox conversation menu, `ReportCustomerDialog`), so I could not test it from Clients. It belongs to the channels-inbox area.
- Placeholder clients (« FB User … », « Compléter la fiche », placeholder notice, « Fiche incomplète » filter with results), platform blocks (`CUSTOMER_BLOCKED_BY_PLATFORM`) and auto-rule blocks: the test shop has none, and they cannot be created from the merchant UI.
- « Ouvrir » on a conversation in the sheet, and conversation links: Inbox area.
- Pagination beyond one page: 15 clients, fewer than 25 per page.
- Admin / operator views of Clients: roles area.
- Offline and WebSocket live-update states.
- Submitting merge / delete / block / tags on pre-existing clients: not allowed by the rules (dialogs only opened).
