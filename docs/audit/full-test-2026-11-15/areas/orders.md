# Area orders — tested 15/11/2026 16:10–17:00 (Africa/Algiers)

### ORDERS-01 — Money / quantity fields drop the decimal separator: « 2500,00 » becomes 250 000 DA, « 1999.5 » becomes 19 995
- Page: /fr/orders/new (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. New order, add « QA orders robe ». 2. In the line unit price type `2500,00` then Tab. 3. Also try `1999.5` in the price, `1.5` in a quantity, `1000.5` in « Montant déjà payé ».
- Expected: a decimal is refused or rounded (amounts are integer DZD, 04 §2 « Selling price integer > 0 »), never multiplied; at least an inline error.
- Actual: the field keeps only the digits: `2500,00` → « 250 000 », `1999.5` → « 19 995 », quantity `1.5` → « 15 » (line 187 500 DA + « STOCK INSUFFISANT »), paid `1000.5` → « 10 005 ». No warning; the recap total follows the wrong value, so the order can be saved 10× / 100× too expensive. A pasted price « 2 500,00 DA » (common copy from a spreadsheet) is the typical trigger. `-2` and `-100` silently become `2` / `100` too — in « Enregistrer un paiement » an amount typed `-100` was saved as a **+100 DA** cash payment (#CMD-1017 now has two 100 DA rows from two tries).
- Evidence: .local/qa/campaign/orders/fr-07-qty.png · script output 08/09 (« PRICE "2500,00" → "250 000" »)

### ORDERS-02 — The « Notes internes » typed in the new-order form are saved but never shown on the order page
- Page: /fr/orders/new → /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 (#CMD-1017) (owner, fr)
- Severity: Major
- Type: Bug
- Steps: 1. New order, fill « NOTES INTERNES » with « QA orders note interne — test سلام 😀 ». 2. Save. 3. Look at the order page.
- Expected: the note is visible on the order page (12 §5 Order page « notes »); the form promises it is an internal note.
- Actual: the API stores it (`GET /orders/:id` → `notes: "QA orders note interne — test سلام 😀"`) but the page's « NOTES INTERNES » block reads « Aucune note » (it only lists `orderNotes`), and no other block shows `notes`. The merchant loses the instruction (« Livrer le matin de préférence » is the placeholder).
- Evidence: .local/qa/campaign/orders/fr-11-order-page.png

### ORDERS-03 — Order history shows raw data: member UUID for « Assignation » and a UTC ISO date for « Rappel »
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 (#CMD-1017) › HISTORIQUE (owner, fr)
- Severity: Major
- Type: Text
- Steps: 1. Order page › Actions › « Assigner à… » › Karim Proprio (Moi) › Assigner. 2. Actions › « Programmer un rappel » › « Dans 1 h » › Programmer. 3. Read the HISTORIQUE column.
- Expected: « Assignation : Karim P. », « Rappel : 15/11 17:26 » (Africa/Algiers) — 12 GLOBAL « No technical text on merchant screens » (UX-059), CLAUDE rule 11 (local time).
- Actual: « Assignation : 01a14f0d-68c6-71a5-9ed5-507261a83918 » and « Rappel : 2026-11-15T16:26:00.000Z » (UTC, one hour off from the header « rappel à 17:26 »).
- Evidence: .local/qa/campaign/orders/fr-16-after.png

### ORDERS-04 — A delivered order's address / phone 2 can still be edited (page says « lecture seule »)
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 (#CMD-1017, LIVRÉE) (owner, fr)
- Severity: Major
- Type: Bug
- Steps: 1. Order shipped (manual, tracking QA-TRK-0001) then « Marquer livrée ». 2. Banner « Commande livrée le 15 nov. 2026 — lecture seule. ». 3. Actions › « Modifier le contact / adresse » (enabled; the LIVRAISON « Modifier » link is also active) › phone 2 `0661 22 33 44` › Enregistrer.
- Expected: 12 §5 Order page « [RO] fields (delivered/cancelled/returned; actions limited to Mark returned (Admin+, from delivered) and notes) »; 04 §21 address edit only before a courier shipment. The menu of a cancelled order already greys it « Commande clôturée. ». Same row menu on the tester's delivered order #CMD-1003 offers it enabled too.
- Actual: saved without error; history adds « Adresse : Oran · Ain Biya · point relais → Oran · Ain Biya · point relais » (identical before / after — the phone 2 change is not described). The dialog itself says « après l'envoi, l'adresse est verrouillée ».
- Evidence: .local/qa/campaign/orders/fr-18-addr-delivered.png · .local/qa/campaign/orders/fr-02-rowmenu-LIVRÉE.png

### ORDERS-05 — « Marquer livrée manuellement » ignores the deposit already paid: default = total, the cashed amount is taken as the new total paid
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 (#CMD-1017) › Marquer livrée (owner, fr)
- Severity: Major
- Type: Bug
- Steps: 1. Order total 5 400 DA with 1 200 DA already recorded (deposit, « Reste 4 200 DA »; the send dialog also says « Reste à payer : 4 200 DA »). 2. Actions › « Marquer livrée (auto-livraison) ». 3. The field « MONTANT ENCAISSÉ » is prefilled 5 400 (= total) and the effects line says « paiement = encaissé (5 400 DA) ». 4. Type what the courier actually hands back, e.g. 5 000, reason, Confirmer.
- Expected: the amount cashed at delivery defaults to the remaining 4 200 DA and is added to what was already paid (deposit + COD = total), one cash row for the cashed amount (04 §1.4 / §21 COD rule: the order becomes `paid` when deposit + cashed = total).
- Actual: the server treats the entered amount as the new `amountPaid`: « MONTANT PAYÉ 5 000 DA · RESTE 400 DA · PARTIELLE » and a cash row of 3 800 DA (5 000 − 1 200). A merchant who types the real cash received (4 200) would end with « payé 4 200 / reste 1 200 » and a 3 000 DA cash row — the cash register no longer matches the money in hand.
- Evidence: .local/qa/campaign/orders/fr-17-delivered.png · script 17 output (PAIEMENT block)

### ORDERS-06 — Confirming an order silently queues it to the courier (auto-send), while the result step still proposes « Envoyer au transporteur »
- Page: /fr/orders/01a1dfd5-aa84-7981-accc-d8ec691afd44 (#CMD-1018) › Appeler & confirmer (owner, fr)
- Severity: Major
- Type: UX
- Steps: 1. New order with address (Blida). 2. « Appeler & confirmer » › Continuer › « Confirmée » › « Confirmer la commande ». 3. Read step 3, then the LIVRAISON block / history.
- Expected: when the workspace has `autoSendToCourier` on (05 Workspace, default false; README D9 « optional auto-send »), the confirm dialog says so (« Envoi automatique à Mahdi Amrani en cours ») and does not offer a second manual send; the merchant must know a parcel request is leaving.
- Actual: step 3 says « Étape suivante : préparer la commande ou l'envoyer au transporteur. » with buttons « Préparer » / « Envoyer au transporteur », but the server had already created a `pending` shipment with the default ZR Express account (history « Système · Livraison : NON ENVOYÉE → À ENVOYER · Mahdi Amrani »; block « ENVOI EN COURS … Mahdi Amrani indisponible : envoi mis en attente, nouvel essai automatique »). Nothing in the dialog mentions it. (Safety: I cancelled the queued shipment at once — « Annuler l'expédition » › « Remettre la commande en Confirmée » — no parcel was created, `lastError COURIER_UNAVAILABLE`.)
- Evidence: .local/qa/campaign/orders/fr-21-confirm-result.png · .local/qa/campaign/orders/fr-23-peek.png · API: POST /shipments/01a1dfd8-…/cancel {"then":"confirmed"} → 200

### ORDERS-07 — Technical text in the new-order footer: « IDEMPOTENCY-KEY GÉNÉRÉE PAR SOUMISSION »
- Page: /fr/orders/new (owner, fr) — after a first failed submit
- Severity: Minor
- Type: Text
- Steps: 1. New order, submit once with an error (e.g. stock insufficient). 2. Look at the sticky footer, left.
- Expected: no technical text on shop screens (12 GLOBAL « No technical text on merchant screens », UX-059).
- Actual: « BROUILLON ENREGISTRÉ · IDEMPOTENCY-KEY GÉNÉRÉE PAR SOUMISSION ».
- Evidence: script 09 output (footer text) · .local/qa/campaign/orders/fr-09-insufficient.png

### ORDERS-08 — New-order « À l'enregistrement » box says the stock is decremented even for a « Nouvelle » order
- Page: /fr/orders/new (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Open New order, status « Nouvelle » selected (default). 2. Read the right column box « À L'ENREGISTREMENT ».
- Expected: 04 §3 « Order created status `new`: qty reserved … no movement »; only « Confirmée » removes the stock. Also « ligne Google Sheets ajoutée » only when Sheets is connected.
- Actual: « Stock décrémenté (mouvements « sortie »), compteurs client mis à jour, ligne Google Sheets ajoutée, notification « nouvelle commande ». » whatever the status / integrations.
- Evidence: .local/qa/campaign/orders/fr-03-new-full.png

### ORDERS-09 — Orders list « Articles » cell says « + 1 ARTICLE(S) » for an order that has a single line with quantity 2
- Page: /fr/orders (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Create an order with one line « QA orders robe » ×2 (#CMD-1017). 2. Open /fr/orders.
- Expected: « QA orders robe ×2 » only (one line); « + n article(s) » only when there are more lines.
- Actual: « QA orders robe ×2 + 1 ARTICLE(S) » although the order page lists one line only (robe, qté 2). Probably also the tester orders showing « gant ×2 + 1 ARTICLE(S) » (#CMD-1015, #CMD-1007). The cell seems to subtract 1 from the unit count (`itemCount` = 2) instead of the line count. « ARTICLE(S) » is also a lazy plural (« 1 article », « 2 articles »).
- Evidence: .local/qa/campaign/orders/fr-01-list.png (rows 1015, 1007) · script 01 output for #CMD-1017

### ORDERS-10 — Payment dialog shows a product message: « Prix de vente requis (> 0) » for an amount of 0
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 › Enregistrer un paiement (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Order page › « Enregistrer un paiement ». 2. Amount `0` › Enregistrer.
- Expected: a payment message, e.g. « Montant requis (> 0) ».
- Actual: « Prix de vente requis (> 0) » (the product selling-price message, `validation.price`).
- Evidence: script 14 output (dialog text « MONTANT (DA) * … Prix de vente requis (> 0) »)

### ORDERS-11 — Returning an order wipes every payment, also the deposit, and shows « RESTE 5 400 DA » in orange on the closed order
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 (#CMD-1017, RETOURNÉE) (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Delivered order with 1 200 DA deposit + 3 800 DA COD row. 2. Actions › Marquer retournée › « Client absent / injoignable » › Marquer retournée.
- Expected: 04 §20 « COD rule … reversed on `returned` » — the COD row is reversed; the deposit refund should be explicit (it was money received before delivery), and a closed order should not show a remaining amount to collect.
- Actual: payment block « REMBOURSÉE · MONTANT PAYÉ 0 DA · RESTE 5 400 DA » (orange), the payment rows list is empty (the 1 000 / 100 / 100 / 3 800 rows disappear), history « Paiement : PARTIELLE → REMBOURSÉE ». Also the return dialog ticks « Le transporteur facture le retour (prix de la grille) » by default for a « LIVRAISON PROPRE » order (no courier).
- Evidence: .local/qa/campaign/orders/fr-18-returned.png · .local/qa/campaign/orders/fr-18-return-dialog.png

### ORDERS-12 — Delete dialog refuses the number exactly as displayed (« #CMD-1020 »); only « CMD-1020 » works, with no hint
- Page: /fr/orders/01a1dfd5-f6eb-7e45-ace8-debc198ea96e (#CMD-1020) › Actions › Supprimer (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Open « Supprimer la commande #CMD-1020 ». 2. Type `#CMD-1020` (as in the title and page header).
- Expected: the number as shown is accepted, or the field shows the expected text as placeholder (12 §20 « typed number (exact) »).
- Actual: « Supprimer » stays disabled for `#CMD-1020`; it enables only for `CMD-1020`. The field has no placeholder; helper « doit correspondre exactement ». The footer also puts « Annuler » and « Supprimer » on two misaligned rows.
- Evidence: .local/qa/campaign/orders/fr-21-err-delete_C.png

### ORDERS-13 — « Utiliser ce client » promises « adresse par défaut préremplie » but the delivery block stays empty
- Page: /fr/orders/new (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Create an order for « QA orders Karim Deux » 0770 11 22 33 with Blida · Beni Mered · « QA orders rue des roses n 5 » (#CMD-1018). 2. New order, type a name + the same phone. 3. Banner « Ce numéro appartient déjà à QA orders Karim Deux — la commande sera rattachée à sa fiche (adresse par défaut préremplie). » › « Utiliser ce client ».
- Expected: wilaya / commune / address prefilled from the client (as the banner says); same when the client is picked from the search results (tester client « achref khatimi », orders in Laghouat, gives an empty delivery block too).
- Actual: « 3 · LIVRAISON » stays « Wilaya / Choisissez d'abord la wilaya », address empty.
- Evidence: script 20 output (« B delivery prefilled? … Wilaya … ») · .local/qa/campaign/orders/fr-06-client-picked.png

### ORDERS-14 — Confirm dialog of an order without address says « LIVRAISON OFFERTE »
- Page: /fr/orders/01a1dfd5-f6eb-7e45-ace8-debc198ea96e (#CMD-1020, no wilaya) › Appeler & confirmer (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Save a « Nouvelle » order with no wilaya / address. 2. « Appeler & confirmer ».
- Expected: « Livraison à calculer » / « frais non calculés » next to « Adresse de livraison manquante ».
- Actual: « 1 ARTICLE · LIVRAISON OFFERTE · COD » (free delivery), while the block above says « Adresse de livraison manquante ». The order page shows « FRAIS CLIENT 0 DA » too.
- Evidence: .local/qa/campaign/orders/fr-21-confirm-no-address.png

### ORDERS-15 — Bulk bar offers actions that no selected order allows (Confirmer / Préparer / Marquer expédiées / Annuler on shipped or closed orders)
- Page: /fr/orders (owner, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Select two EXPÉDIÉE rows (tester #CMD-1001, #CMD-1006) — or my closed #CMD-1017 (RETOURNÉE) + #CMD-1019 (ANNULÉE). 2. Read the selection bar. 3. (closed pair only) click « Confirmer ».
- Expected: 12 §5 Orders list « selection + bulk bar (only valid actions; per-item results dialog) » — invalid actions greyed with the reason, as « Envoyer au transporteur » already is (« Aucune commande sélectionnée ne peut être envoyée »).
- Actual: « Confirmer », « Préparer », « Marquer expédiées », « Annuler » are enabled; « Confirmer » on the closed pair sends `POST /orders/bulk/status {to:"confirmed"}` and the results dialog lists « ERREUR · Commande clôturée. » ×2 with a button « Réessayer les 2 erreurs » that can never succeed.
- Evidence: .local/qa/campaign/orders/fr-02-bulk.png · .local/qa/campaign/orders/fr-25-bulk-closed.png · .local/qa/campaign/orders/fr-25-bulk-confirm-results.png

### ORDERS-16 — A scheduled callback stays on the order after it is delivered / returned (pill « RAPPEL » on a closed order)
- Page: /fr/orders (owner, fr) — #CMD-1017
- Severity: Minor
- Type: Bug
- Steps: 1. On #CMD-1017 « Programmer un rappel » › « Dans 1 h » (17:26). 2. Ship manually, mark delivered, mark returned. 3. Open /fr/orders and the export.
- Expected: closing the order (delivered / cancelled / returned) clears `callbackAt` (04 §21: the callback raises `order.callback_due` to call the customer; nothing to call about on a closed order).
- Actual: the list row shows « RETOURNÉE · RAPPEL » (ar « معاودة الاتصال »), the XLSX export « Confirmation = RAPPEL »; the due callback can still raise a reminder / Home « RAPPEL » card for a returned order.
- Evidence: .local/qa/campaign/orders/ar-28-list-1440.png (row #CMD-1017) · .local/qa/campaign/orders/export-commandes-2026-11-15.xlsx

### ORDERS-17 — Orders table at 1440 px: LIVRAISON column clipped under « Actions », RISQUE column off-screen; in Arabic the SOURCE cell overlaps ARTICLES
- Page: /fr/orders, /ar/orders (owner, 1440 × 900) — also /fr/orders/[id] at 390 px
- Severity: Minor
- Type: UX
- Steps: 1. Open /fr/orders at 1440 px. 2. Same in /ar. 3. Open an order page at 390 px.
- Expected: every column readable (or a horizontal scroll inside the table with the Actions column sticky); no overlapping text.
- Actual: fr: delivery pills cut to « SANS MOI », « NON ENVI », wilaya « 03 Laghoua' », RISQUE never visible; ar: the delivery column is almost completely hidden behind the « إجراءات » buttons and the import source « qa-orders-import.csv · 15 نوفمبر 2026 » overlaps « QA orders robe ». At 390 px the order page items table cuts the TOTAL column (« TOTA », « 2 500 DA » cut).
- Evidence: .local/qa/campaign/orders/fr-01-list.png · .local/qa/campaign/orders/ar-28-list-1440.png · .local/qa/campaign/orders/fr-28-order-390.png

### ORDERS-18 — Filtered-empty text « Aucun(e) commande ne correspond à « filtres actuels ». »
- Page: /fr/orders?tab=returned (before any return) and /fr/orders?q=zzzzqa (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Click tab « Retournées » (0) or search `zzzzqa`.
- Expected: a finished French sentence (12 GLOBAL [FE]), e.g. « Aucune commande ne correspond à ces filtres. » / « Aucune commande retournée. ».
- Actual: « Aucun(e) commande ne correspond à « filtres actuels ». » — generic gender placeholder and the words « filtres actuels » quoted as if they were the search term.
- Evidence: .local/qa/campaign/orders/fr-02-search-empty.png · .local/qa/campaign/orders/fr-02-tab-retournees.png

### ORDERS-19 — Items « Modifier » greyed on a confirmed order with the reason « Adresse verrouillée : annulez le colis d'abord. » although its parcel was cancelled
- Page: /fr/orders/01a1dfd5-aa84-7981-accc-d8ec691afd44 (#CMD-1018, CONFIRMÉE, LIVRAISON « NON ENVOYÉE ») (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Confirm #CMD-1018 (auto-send queued a parcel, see ORDERS-06). 2. Cancel the parcel (« Remettre la commande en Confirmée »). 3. Reload the order page, hover « Modifier » of ARTICLES.
- Expected: no active parcel ⇒ the reason should not ask to cancel a parcel (12 GLOBAL disabled reasons « names what blocks the item in this state »); items of a confirmed, not-sent order are editable (12 §5 « editable (new/confirmed/preparing/shipped) »).
- Actual: button disabled, tooltip « Adresse verrouillée : annulez le colis d'abord. » (an address reason on the items button), while « MODIFIER » of the address on the same page is enabled.
- Evidence: script 30 output · .local/qa/campaign/orders/fr-28-order-390.png (greyed « Modifier » of ARTICLES)

### ORDERS-20 — A malformed order URL shows « Impossible de charger · Requête invalide · Réessayer » instead of the 404 state
- Page: /fr/orders/abc (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Open /fr/orders/abc.
- Expected: the GLOBAL 404 state (« Introuvable … Retour »), as for an unknown UUID.
- Actual: error state « Impossible de charger / Requête invalide. / Réessayer » (GET /orders/abc → 400 BAD_REQUEST); « Réessayer » can never work. An unknown UUID correctly shows « Introuvable · Cet élément n'existe pas ou appartient à un autre espace. ».
- Evidence: .local/qa/campaign/orders/fr-29-404-abc.png · API: GET /orders/abc → 400

### ORDERS-21 — Import « terminé » screen has no error report for the skipped lines
- Page: /fr/orders/import (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Import `qa-orders-import.csv` (1 valid row; 2 rows in error: invalid phone / wilaya 99 / SKU unknown, and stock insufficient). 2. « Importer 1 commande ».
- Expected: 02 route map /orders/import « done (created / skipped, error report download) »; 12 GLOBAL keeps the « Code (support) » column of import error files.
- Actual: « Import terminé · 1 COMMANDES CRÉÉES · 2 LIGNES IGNORÉES · 0 REFUSÉES À L'IMPORT » with only « Voir les commandes importées » / « Importer un autre fichier »; the per-row errors of the preview cannot be downloaded. (The preview itself works: phone / wilaya / address / SKU / stock errors per row; wrong file type « Format non supporté. »; created #CMD-1021 « QA orders Import Un », source IMPORT.)
- Evidence: .local/qa/campaign/orders/fr-26-import-csv.png · .local/qa/campaign/orders/fr-27-import-done.png

### ORDERS-22 — No saved views on the orders list
- Page: /fr/orders (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Apply a filter (Source = IA → `?source=ai`, 9 rows; kept after F5). 2. Look for a saved-view control.
- Expected: 02 route map /orders « saved views » (`GET|POST|PATCH|DELETE /me/saved-views`, `POST /me/saved-views/:id/share`, permission `views.share`).
- Actual: no saved-view control anywhere (tabs, filter bar, « Filtres » panel, density menu).
- Evidence: .local/qa/campaign/orders/fr-30-filter-ia.png · .local/qa/campaign/orders/fr-02-filters-panel.png

### ORDERS-23 — Self-delivery parcel shows « CRÉÉE » and « JAMAIS SYNCHRONISÉ »; courier name printed lowercase « zr express »
- Page: /fr/orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3 › LIVRAISON block and « Envoyer au transporteur » dialog (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. « Marquer expédiée (manuel) » with tracking QA-TRK-0001. 2. Read the LIVRAISON block. 3. On a preparing order open « Envoyer au transporteur ».
- Expected: 04 §1.2 manual ship creates a Shipment `provider=manual`, status `sent` (pill ENVOYÉE); no courier sync line for self-delivery. Provider names as brands (« ZR Express »).
- Actual: pill « CRÉÉE », line « JAMAIS SYNCHRONISÉ » under « Livraison propre · QA-TRK-0001 »; the send dialog shows « zr express » under the account « Mahdi Amrani · PAR DÉFAUT ».
- Evidence: .local/qa/campaign/orders/fr-17-shipped.png · .local/qa/campaign/orders/fr-17-send-dialog.png

### ORDERS-24 — Small texts: « CLIENTE », « commande(s) », decimal point in French KPIs, untranslated shortcut hints, static « RAPPEL 16:00 », cancelled parcel link on the slip
- Page: /fr|ar|en/orders, /orders/new, /orders/[id], /orders/import, /orders/[id]/print (owner)
- Severity: Cosmetic
- Type: Text
- Steps: read the screens.
- Expected: neutral « CLIENT » heading and real plurals; French decimal comma (« 6,7 % »); translated shortcut hints; examples matching the chosen time; no dead tracking link on the slip.
- Actual: section « 1 · CLIENTE » and « Cliente connue · 1 commande(s) précédente(s) » (ar « العميلة » / « الزبونة »); KPI « 6.7 % LIVRÉES · 30 J » (fr) / « 5.3 % » (ar); import tile « 1 ARTICLES »; row-menu hints « ENTER », « DELETE » in fr and ar (and « Annuler la commande » carries the hint « DELETE » next to a separate « Supprimer »); en « Send to courier : Confirm… » (French space before the colon); callback dialog footer always « ligne « RAPPEL 16:00 » » whatever the chosen time; the A5 slip of #CMD-1018 prints « Suivi : djaber.vercel.app/s/193pMGwzd3UZE9_w », the public link of the parcel that was cancelled.
- Evidence: .local/qa/campaign/orders/fr-01-list.png · .local/qa/campaign/orders/fr-12-dlg-Programmer_un_rappel.png · .local/qa/campaign/orders/fr-27-print.png · .local/qa/campaign/orders/ar-28-list-menu-1440.png

## Coverage

Owner account, live https://djaber.vercel.app, shop « Boutique Test Équipe ». Scripts: `.local/qa/campaign/orders/scripts/` (01–30), screenshots `.local/qa/campaign/orders/`.

- **Orders list /orders** (fr 1440 · ar 1440 RTL · en 1440 · fr 390): KPI strip, 8 tabs with counts (URL `?tab=`), search (number, name, phone, no result, Arabic, `<script>`), sort on N°/date, client, total, status (URL `?sort=`), dropdowns Source / Confirmation / Wilaya (69) / Période, « Filtres » panel (all groups, amount min/max, apply), density & columns menu, Export dialog (scope, XLSX download checked: 23 columns, filter respected), row `Actions ⌄` for NOUVELLE / EXPÉDIÉE / ANNULÉE / LIVRÉE (items + disabled reasons), selection + bulk bar, bulk « Confirmer » results dialog, F5 keeps tab / search / `?source=ai`, back button, filtered-empty, 390 px cards. No text leak recorded by the kit on the list.
- **New order /orders/new**: empty submit (inline + summary « Validation : 3 erreurs »), client search & pick, « Changer de client », phone conflict « Utiliser ce client », name 1 char / blanks / 120 chars (cut at 80) / Arabic / emoji, phones invalid / +213 / 00213 / landline (normalised on blur), product search, 2 lines, quantity 0 / -2 / 1.5 / 5 > stock / 99 999 / abc, unit price 0 / -100 / decimals / comma, wilaya + commune (Alger, 57 communes), fee quote home 400 / stop-desk 250, « Modifier (Admin) » visible, address short / Arabic / blanks, paid -500 / > total (blocked « Le montant payé dépasse le total ») / decimals, discount negative / > subtotal, status Confirmée without address (inline errors), server `ORDER_INSUFFICIENT_STOCK` mapped on the line, « Enregistrer et confirmer plus tard », draft restored after reload, leave guard (sidebar link), duplicate prefill + « Annuler » back to the source order. fr / ar / en / 390 px.
- **Order page /orders/[id]** on my orders #CMD-1017…1021: all header buttons, Actions menu per state (new, preparing, shipped, delivered, returned, cancelled), dialogs opened / ESC / cancel: Appeler & confirmer (3 steps, address-missing block, outcome, result), Annuler (reason required, « Faux numéro » ⇒ RISQUE badge), Modifier le contact (inline, invalid phone, leave guard « Quitter sans enregistrer ? »), Modifier l'adresse (wilaya change Oran, fee 600 → stop-desk 400, save, history), Articles « Modifier », Enregistrer un paiement (0 / negative / overpay « dépasse le reste » / valid), Rembourser (form only), Marquer expédiée (manuel, tracking), Changer le statut (targets per state, back-date > 7 d refused), Marquer livrée (amount ≠ total needs reason, date > 7 d refused), Marquer retournée (reason required, restock), Journaliser un appel (Sans réponse), Programmer un rappel (past date « Choisissez une heure à venir. », « Dans 1 h »), Assigner (me), Notes internes (add with Arabic + emoji), Supprimer (typed number, deleted #CMD-1020), Préparer (one click), Imprimer → /orders/[id]/print (A5 preview, options), parcel menu + « Annuler l'expédition ». 404 (unknown UUID) and malformed id. Closed orders: header buttons greyed with « Commande clôturée. ». fr / ar / en at 1440, fr at 390.
- **Import /orders/import**: drop zone, wrong file type, CSV preview (valid / error rows, error tabs), commit, done screen, link to `?source=import`. fr / ar / en / 390 px.

Test data created (all named « QA orders … »): products « QA orders robe » (PRD-5V35NSVB, stock 20) and « QA orders sac » (PRD-MMP6Q3XD, stock 3); clients « QA orders Amel Test » 0550998877, « QA orders Karim Deux » 0770112233 (now RISQUE from the fake-number cancel), « QA orders Client Trois » 0661000003, « QA orders Import Un » 0550111222; orders #CMD-1017 (returned), #CMD-1018 (confirmed, parcel cancelled), #CMD-1019 (cancelled), #CMD-1020 (deleted), #CMD-1021 (import, new). No tester order was modified (only their menus were opened).

## Blocked by safety

- `POST /orders/01a1dfca-4a73-7a51-ab92-84a02cb3bcc3/shipments` (« Créer le colis » in « Envoyer au transporteur ») → 418 QA_BLOCKED; the dialog showed « blocked by the QA kit (safety) » inline (expected).
- **Not blocked, server side:** confirming #CMD-1018 made the worker queue a shipment to the real default ZR Express account « Mahdi Amrani » (workspace auto-send to courier is ON). The courier was unavailable (`COURIER_UNAVAILABLE`, retry scheduled) and I cancelled the shipment within two minutes (`POST /shipments/01a1dfd8-035d-7a3d-ad28-839c9d32e9ce/cancel {"then":"confirmed"}`), so no parcel was created. **Every agent that confirms an order in this shop (confirm dialog / call outcome « Confirmée », and probably « Marquer confirmée » and bulk « Confirmer »; an order created directly « Confirmée », #CMD-1019, did not) can trigger a real courier request** — the kit cannot stop it. Coordinator: switch « envoi automatique » off in the test shop or add a note to the README.

## Not tested

- « Lien de paiement » (greyed « Fonction indisponible pour le moment. ») and the « Rembourser » submit (would write a refund cash row; form only checked).
- Real courier flows (send / sync / label / change courier / retry): blocked by safety; the « Échec de livraison » target of « Changer le statut » (needs a courier parcel).
- Permissions per role (admin / operator) and 403 states: area « roles ».
- Offline state, 409 conflict dialog (needs two sessions editing the same order at once), WebSocket live refresh, keyboard shortcuts (ENTER / C / R / E / A) — not exercised.
- Orders with a conversation (« Prévenir le client » checkbox, « Ouvrir la conversation »): none of my orders has one; only checked that the box is greyed « Commande sans conversation ».
- Import of an Excel (.xlsx) file and a file > 1 000 rows.
