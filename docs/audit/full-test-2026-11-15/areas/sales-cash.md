# Area sales-cash — tested 15/11/2026 18:47–19:25 (Africa/Algiers)

Owner account, test shop « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`).
Scripts and raw outputs: `.local/qa/campaign/sales-cash/scripts/` and `.local/qa/campaign/sales-cash/*.json`.

Summary: 3 Major · 15 Minor · 5 Cosmetic (23 bugs).

### SALES-CASH-01 — « Valider la vente » from the row menu of a draft validates it with 0 DA collected
- Page: /fr/sales (owner, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. Nouvelle vente › « QA sales-cash savon » ×1 (450 DA), Espèces, montant reçu = total, no client › Brouillon (#VNT-1011). 2. Same with client « QA sales-cash عميل كريم » (#VNT-1012). 3. Row `Actions ⌄` › « Valider la vente » › confirm « Valider la vente ».
- Expected: the sale is validated with the amount received (dialog text: « Le stock sort et le montant reçu entre en caisse »); a fully paid walk-in sale needs no client (04 §20 Sales, GDS-07).
- Actual: walk-in draft → toast « Paiement partiel : identifiez le client. » (the confirm dialog stays open, error not inline); draft with a client → validated « NON PAYÉE », PAYÉ 0 DA, no cash row. The menu sends `PATCH /sales/:id { status: 'completed' }` without `amountPaid`, and the server completes with `amountPaid ?? 0`.
- Evidence: .local/qa/campaign/sales-cash/fr-s05-menu-validate-VNT-1011.png, fr-s05-menu-validate-VNT-1012.png · API: PATCH /sales/01a1e059-1443-7c14-b458-d9bf996ccb42 → 422 SALE_PARTIAL_REQUIRES_CUSTOMER
- Likely cause: apps/web/src/features/gds/sale-dialogs.tsx:46 (`updateSale(s.id, { status: 'completed' })`) + apps/api/src/modules/gds/sale.service.ts:311 (`input.amountPaid ?? 0`).

### SALES-CASH-02 — A draft does not keep the amount received: a partial payment typed before « Brouillon » becomes a full payment
- Page: /fr/sales/new → /fr/sales/new?draft=… (owner, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. Nouvelle vente › t-shirt M, price 2 000, montant reçu 500 (reste dû 1 500 → PARTIELLE), new client « QA sales-cash عميل كريم » 0555 98 76 01, CCP › Brouillon (#VNT-1010). 2. List shows PAYÉ 0 DA. 3. Reopen the draft: MONTANT REÇU shows 2 000 (follows the total). 4. Valider.
- Expected: the draft keeps the amount received (12 §252 « finishing a draft sends the typed client »; the sheet state is the draft); validating gives PARTIELLE · RESTE 1 500 DA.
- Actual: the 500 typed is lost; the sale is validated PAYÉE 2 000 DA and 2 000 DA enter the cash register while the customer paid 500. `POST /sales` (status draft) never stores `amountPaid` (sale.service.ts:258 `deriveGdsPaymentStatus(0, …)`, no amountPaid field) and the sheet then defaults « montant reçu » to the total.
- Evidence: .local/qa/campaign/sales-cash/fr-s03-partial-client.png, fr-s04-draft-open.png, fr-s04-detail.png
- Likely cause: apps/api/src/modules/gds/sale.service.ts:246-262 (draft row created without amountPaid) and apps/web/src/features/gds/sales.tsx (`setReceived(d.amountPaid ? … : null)`).

### SALES-CASH-03 — Phone (390 px): the lines of the « Nouvelle vente » sheet show no product name
- Page: /fr/sales/new (owner, fr, 390 × 844); also /ar/sales/new at 1440
- Severity: Major
- Type: UX
- Steps: 1. Phone width, Nouvelle vente. 2. Add « QA sales-cash t-shirt » (or several products).
- Expected: each line shows its product name (12 §248 « lines with stock + price edited note »), as at 1440 in French.
- Actual: the line shows only − 1 + · price 2 500 · ✕ and the variant select; the name column is squeezed to 0 width, so with several lines the seller cannot tell them apart. In Arabic at 1440 the name is cut to « …h t-shirt ».
- Evidence: .local/qa/campaign/sales-cash/fr-s18-phone-sheet.png, ar-s18-desk-sheet.png
- Likely cause: apps/web/src/features/gds/sales.tsx line markup (`min-w-0 flex-1 truncate` name next to the fixed stepper + `w-28` price in a 460 px sheet).

### SALES-CASH-04 — Cancelling a sale paid with two methods refunds everything in cash (« Espèces »)
- Page: /fr/sales/:id → /fr/cash (owner, fr, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. Sale #VNT-1013 (450 DA, client): 200 DA Espèces at validation, then « Encaisser le reste » 100 DA Virement. 2. Annuler la vente › motif, « Réintégrer le stock », « Rembourser les 300 DA encaissés » › confirm. 3. Open Caisse.
- Expected: the refund reverses the cash rows as they were taken (04 §20 « reverses cash rows »): −200 Espèces and −100 Virement.
- Actual: one row « Vente #VNT-1013 annulée (remboursement) » −300 **Espèces**: the drawer's theoretical cash (closing uses method = cash only) is now 100 DA too low.
- Evidence: .local/qa/campaign/sales-cash/fr-s09-cash.png

### SALES-CASH-05 — A cancelled and refunded sale keeps « Partielle » / Payé 300 DA
- Page: /fr/sales?paymentStatus=partial, Exporter XLSX (owner, fr, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. Cancel partial sale #VNT-1013 with « Rembourser les 300 DA ». 2. Filter Paiement = Partielle. 3. Export.
- Expected: a refunded cancelled sale is not « partielle » and has nothing paid (or the filter excludes cancelled sales, as the KPIs do: « 0 VENTE PARTIELLE »).
- Actual: the filter lists #VNT-1013 (ANNULÉE) while the KPI says 0 partial; the export row reads « Annulée … Payé 300 · Reste dû 0 · Paiement Partielle ». `cancel()` leaves paymentStatus / amountPaid unchanged when `refund` is true (sale.service.ts:355 `input.refund ? {} : …`).
- Evidence: .local/qa/campaign/sales-cash/fr-s16-partial-filter.png, ventes-2026-11-15.xlsx

### SALES-CASH-06 — Validating a draft from the sheet has no confirmation
- Page: /fr/sales/new?draft=… (owner, fr, 1440)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Open draft #VNT-1010 from the list. 2. Click « Valider la vente (2 000 DA) ».
- Expected: « Valider la vente » (draft sale) is confirmed (12 §158 confirmation list, 12 §252 « "Valider la vente" confirmed ») — the row menu does show « Valider la vente #VNT-… ? ».
- Actual: the sale is validated at once (stock out + cash row), no dialog.
- Evidence: .local/qa/campaign/sales-cash/fr-s04-sheet-validate.png

### SALES-CASH-07 — Quantity field: « 2.5 » becomes 25, « -3 » becomes 3, silently
- Page: /fr/sales/new (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Add a product line. 2. Type 2.5 (or paste « 2,5 ») in QUANTITÉ, leave the field.
- Expected: decimals / negatives refused with a message, or rounded (2), never multiplied by 10.
- Actual: 2.5 → 25, -3 → 3, 9999999 → 100000 with no message; the line total jumps ×10.
- Evidence: script output .local/qa/campaign/sales-cash/s03-fr.json

### SALES-CASH-08 — Stale errors stay in the sheet after the cause is fixed
- Page: /fr/sales/new (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Add t-shirt without variant › Valider → « Choisissez une variante. ». 2. Pick variant M → message stays. 3. Qty 5 on M (stock 3) › Valider → « Quantité invalide » under the line + « Stock insuffisant pour QA sales-cash t-shirt · M (3). ». 4. Set qty 1 → both messages stay (also visible in the leave-guard / close flow).
- Expected: an error is cleared when its field changes.
- Actual: the errors stay until the next submit.
- Evidence: .local/qa/campaign/sales-cash/fr-s03-close-guard.png (qty 1, still « Quantité invalide » and « Stock insuffisant »)

### SALES-CASH-09 — Discount in % accepts 150 % silently (total 0 DA, field still shows 150)
- Page: /fr/sales/new (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Lines for 14 400 DA. 2. Remise 150, mode %.
- Expected: « remise ≤ sous-total » message (server rule `discount: validation.range`), or the field capped at 100 %.
- Actual: Remise −14 400 DA, Total 0 DA, no message; the field keeps 150 %.
- Evidence: .local/qa/campaign/sales-cash/fr-s02-discount-150pct.png

### SALES-CASH-10 — « Journée du 2026-11-01 clôturée. » — ISO date in the error of the manual-row dialog
- Page: /fr/cash?day=2026-11-01 (owner, fr, 1440), day closed
- Severity: Minor
- Type: Text
- Steps: 1. Close a day. 2. « + Mouvement manuel » dated that day › Enregistrer.
- Expected: « Journée du 01 nov. clôturée. » (the « Clôturer la journée » tooltip already formats it so); no raw data on shop screens (12 §157).
- Actual: inline error « Journée du 2026-11-01 clôturée. » (server message with `params.date` in ISO). API: POST /cash → 409 CASH_DAY_CLOSED.
- Evidence: .local/qa/campaign/sales-cash/fr-s14-closed-manual.png

### SALES-CASH-11 — Manual cash dialog always shows « Journée clôturée : plus de modification » in its footer
- Page: /fr/cash › « + Mouvement manuel » / Modifier / Dupliquer / Corriger (owner, fr, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Open « + Mouvement manuel » on today (day open).
- Expected: the closed-day note only on a closed day (or worded as a rule: « Une journée clôturée n'accepte plus de modification »).
- Actual: the footer reads « Journée clôturée : plus de modification » on every open day, as if today were closed.
- Evidence: .local/qa/campaign/sales-cash/fr-s10-manual-empty.png
- Likely cause: apps/web/src/features/gds/cash-dialogs.tsx:113 (`note={t('cash.manual.closedNote')}` unconditional).

### SALES-CASH-12 — « SOLDE ACTUEL » KPI shows the end-of-period balance when a past day / period is selected
- Page: /fr/cash?day=2026-10-19 (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Caisse › Jour › Un jour = 19 oct.
- Expected: « Solde actuel » = the till now (−14 652 DA), or the tile renamed « Solde fin de journée » for a past day (CSH-01 KPIs: opening, current…).
- Actual: « 305 806 DA SOLDE ACTUEL » (balance at the end of 19 oct) while the till is at −14 652 DA. Same with « Hier » (−10 602 « solde actuel »).
- Evidence: .local/qa/campaign/sales-cash/fr-s12-day-19oct.png

### SALES-CASH-13 — Negative theoretical cash: the counted field drops « - », so the day can only be closed with a big gap
- Page: /fr/cash › Clôturer la journée (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Today « Solde théorique (espèces) −9 222 DA ». 2. Type « -9222 » in COMPTÉ EN CAISSE.
- Expected: a hint explaining the negative theoretical balance (missing apport / opening float) before a CORRECTION is created, or the gap computed on what the user can type.
- Actual: « - » is removed (9 222 → écart +18 444 DA). On 01 nov (théorique −7 272) the closing created a CORRECTION +14 544 DA (test day, reopened at once: the reversal row −14 544 was created, balances are back).
- Evidence: .local/qa/campaign/sales-cash/fr-s13-close-01nov.png, fr-s14-reopened.png

### SALES-CASH-14 — Cancel reason stored in the canceller's language: « Erreur de saisie » shown in Arabic and English
- Page: /ar/sales/:id, /en/sales/:id, /ar/cash (owner, ar / en, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Cancel a sale in French with motif « Erreur de saisie ». 2. Open the sale page and the Caisse in ar / en.
- Expected: the reason shown in the viewer's language (stored texts per viewer, as done for other stored texts).
- Actual: ar « أُلغي البيع في 15 نوفمبر · السبب «Erreur de saisie» »; en « reason “Erreur de saisie” »; cash row ar « البيع #VNT-1013 مُلغى (استرداد) — Erreur de saisie ».
- Evidence: .local/qa/campaign/sales-cash/ar-s18-desk-detail-cancelled.png, ar-s18-desk-cash.png, en-s18-desk-detail-cancelled.png
- Likely cause: apps/web/src/features/gds/sale-dialogs.tsx CancelSaleDialog sends the translated label as `reason`.

### SALES-CASH-15 — A future day can be opened from the URL and offers « + Mouvement manuel »
- Page: /fr/cash?day=2027-01-01 (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Open /fr/cash?day=2027-01-01 (the date picker has max = today, the URL does not).
- Expected: future day refused (back to today) as the picker does.
- Actual: « OUVERTURE 01 JANV. : −14 652 DA », empty state « Aucun mouvement · 01 janv. » with « + Mouvement manuel », « Clôturer la journée » enabled (server refuses with validation.date).
- Evidence: .local/qa/campaign/sales-cash/fr-s12-future-day.png

### SALES-CASH-16 — /sales/new?draft=<id> opens a validated sale as « (brouillon) » and an unknown id as a blank sale, silently
- Page: /fr/sales/new?draft=01a1e05f-… (#VNT-1014, validated) and ?draft=00000000-… (owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Open /fr/sales/new?draft=<id of a validated sale>. 2. Click Brouillon. 3. Open ?draft=<unknown id>.
- Expected: a validated sale redirects to its page; an unknown draft shows « Introuvable » (GLOBAL 404) instead of an empty sheet.
- Actual: « Vente #VNT-1014 (brouillon) » with editable lines; Brouillon → « Vente validée : annulez et refaites-la. » (server guard OK). Unknown id → blank « Nouvelle vente » sheet, the 404 is ignored (GET /sales/00000000-… → 404).
- Evidence: .local/qa/campaign/sales-cash/fr-s17-completed-as-draft.png, fr-s15-bad-draft.png

### SALES-CASH-17 — Cancelled sale page still says « Annulation possible jusqu'au 22 nov. » and keeps « 1 SORTIE » only
- Page: /fr/sales/:id of a cancelled sale (owner, fr, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Cancel #VNT-1013 with « Réintégrer le stock » and refund. 2. Open the sale page.
- Expected: no « annulation possible » note on a cancelled sale; MOUVEMENTS shows the return movement; PAIEMENTS shows the refund.
- Actual: « Annulation possible jusqu'au 22 nov. (7 jours). Pas de modification après validation : annuler + refaire. » is still shown; MOUVEMENTS « 1 SORTIE »; PAIEMENTS lists 200 + 100 without the −300 refund.
- Evidence: .local/qa/campaign/sales-cash/fr-s09-1013.png

### SALES-CASH-18 — Sale sheet offers only 3 payment methods (Espèces, CCP / BaridiMob, Carte)
- Page: /fr/sales/new (owner, fr, 1440)
- Severity: Minor
- Type: Spec gap
- Expected: `CashMethod ∈ cash|ccp|card|transfer|other` (03 GDS-07, 05 Sale.paymentMethod) — Virement and Autre are missing.
- Actual: 3 segments only (`SALE_METHODS = ['cash','ccp','card']`, sales.tsx:69).

### SALES-CASH-19 — Sale page « PAIEMENTS » prints the method in lower case: « 2 000 DA ccp »
- Page: /fr/sales/:id (owner, fr, 1440)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Validate a sale paid with « CCP / BaridiMob ». 2. Open the sale page.
- Expected: the method label as on screen elsewhere (« CCP »).
- Actual: « 2 000 DA ccp (15 nov. 18:52) » — the label is `.toLowerCase()`d, so acronyms (CCP) look like a raw enum value.
- Evidence: .local/qa/campaign/sales-cash/fr-s04-detail.png
- Likely cause: apps/web/src/features/gds/sale-page.tsx:106 (`.toLowerCase()`).

### SALES-CASH-20 — Ticket PDF prints « ? » instead of ✓ and emoji in the note
- Page: /fr/sales/:id › Actions › Ticket PDF (owner, fr)
- Severity: Cosmetic
- Type: Bug
- Steps: 1. Sale note « QA sales-cash note ✓ ملاحظة 😀 » (Modifier le paiement). 2. Ticket PDF.
- Expected: the note as typed (or the unsupported glyphs dropped).
- Actual: « QA sales-cash note ? ملاحظة ? ». Arabic is rendered correctly.
- Evidence: .local/qa/campaign/sales-cash/ticket-partial.pdf

### SALES-CASH-21 — Cash KPI captions do not match their amounts (apport, remboursement, correction not named)
- Page: /fr/cash (owner, fr, 1440)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Today: 5 sales, 1 COD, 1 apport 5 000; out: 4 achats, 2 frais de retour, 1 loyer, 1 remboursement, 1 correction.
- Expected: the caption lists what the amount sums (CSH-01 « cashed today (sales · COD) »), or the apport / refund / correction are left out of these tiles.
- Actual: « 5 VENTES · 1 COD +10 900 DA ENCAISSÉ AUJOURD'HUI » (includes the 5 000 apport) and « 4 ACHATS · 3 FRAIS −14 950 DA » (includes the 300 refund and the 50 correction).
- Evidence: .local/qa/campaign/sales-cash/fr-s11-cash-after.png

### SALES-CASH-22 — Small texts: « 0 » amount says « Champ requis »; reason « ab » says « Champ requis »; client chip « عميل كريم· 0555 »
- Page: /fr/sales/:id › Encaisser le reste; /fr/cash › Mouvement manuel; /fr/cash › Rouvrir la journée; /fr/sales/new (owner, fr)
- Severity: Cosmetic
- Type: Text
- Actual: amount 0 → « Champ requis » (expected « Montant supérieur à 0 »); reopen reason « ab » → « Champ requis » (3 characters needed, not said); selected client in the sale sheet / link dialog « QA sales-cash عميل كريم· 0555 98 76 01 » (no space before « · »).
- Evidence: script outputs s06-fr.json, s10-fr.json, s14-fr.json

### SALES-CASH-23 — RTL / locale typography: « (DA 2 500) تأكيد البيع », « .Karim P », opening « DA 10 602- », « Delete : »
- Page: /ar/sales/new, /ar/cash, /en/sales (owner, ar / en, 1440)
- Severity: Cosmetic
- Type: Text
- Actual: ar validate button « (DA 2 500) تأكيد البيع » (amount not isolated with `<Ltr>`); ar cash « .Karim P » (period jumps to the left); ar opening KPI « الافتتاح 15 نوفمبر: DA 10 602- »; en / ar disabled-reason lines « Delete : Paid sale can't be deleted. » / « حذف : … » (French space before the colon).
- Evidence: .local/qa/campaign/sales-cash/ar-s18-desk-sheet.png, ar-s18-desk-cash.png

## Coverage
Owner account, test shop « Boutique Test Équipe ». Desktop 1440 × 900 unless stated.

| Screen / flow | fr | ar | en | 390 px |
|---|---|---|---|---|
| /sales list: KPIs, filters Paiement / Vendeur / Client / Période (chips, « Effacer tout », URL, F5 keeps them), search (n°, number only, Arabic name, product, phone, SQL-like text), sort Total asc / desc, page size, filtered-empty state, error state (simulated 500), offline banner + disabled actions with reasons, export XLSX (+ CSV offered) | ✓ | ✓ | ✓ | ✓ |
| Row `Actions ⌄` per status: draft (Valider, Modifier, Supprimer), unpaid / partial / paid, cancelled, > 7 days (disabled reasons « Vente de plus de 7 jours », « Vente encaissée : non supprimable ») | ✓ | ✓ | ✓ | — |
| Nouvelle vente sheet: picker (no result, product, same product twice → qty, variant product, service), variant required, insufficient stock (server 422), quantity 0 / -3 / 2.5 / 9 999 999, price edited note, price 0, discount DA / % (10 %, 150 %, negative), amount received below / above total (rendu), partial without client blocked (disabled reason), new client inline (Arabic name, bad / good phone), existing client picker, methods, Brouillon, close guard (✕ and Esc → « Quitter sans enregistrer ? » Rester / Quitter), F5 on a draft, unknown / validated draft id in URL | ✓ | ✓ | ✓ | ✓ |
| Drafts: reopen, validate from the sheet, validate from the row menu (confirm dialog), delete (confirm) | ✓ | — | — | — |
| Sale page: header actions, Encaisser le reste (empty, 0, > remaining, « 450abc », partial 100 Virement, full), Modifier le paiement (method + note with ✓ / Arabic / emoji), Ticket PDF (downloaded, read), Lier à un client (no result, pick, link), Annuler la vente (default reason, « Autre motif », restock + refund), cancelled state, 404 page | ✓ | ✓ | ✓ | ✓ |
| /cash: KPIs, rows (AUTO lock tooltips, MANUEL), filters Sens / Type / Mode / Par, search, period pills (Aujourd'hui, Hier, 7 j, 30 j, Ce mois) + one day + future / garbage `?day=`, F5 keeps filters, export XLSX (opened: real date cells, labels as on screen), error state (simulated 500) | ✓ | ✓ | ✓ | ✓ |
| Manual row dialog: empty / 0 / huge amount, blank label, Esc close guard, income (Apport) / expense (Loyer, CCP), edit (direction change), duplicate, delete (confirm), proof upload (.txt refused `IMAGE_TYPE_INVALID`, .png accepted, « Voir le justificatif »), correction of an automatic row (« Corriger (ligne liée) ») | ✓ | ✓ (open) | ✓ (open) | — |
| AUTO row click → reference (order page, sale page with `?back=/cash`) | ✓ | — | — | — |
| Clôturer la journée: today (dialog only: empty counted, gap, note required, Esc), past day 01 nov closed (gap +14 544 because the theoretical cash is negative), locked day (manual row → 409 CASH_DAY_CLOSED, close button disabled with reason, banner), Rouvrir la journée (empty / 2-char reason refused, reopened, correction reversed) | ✓ | ✓ (open) | ✓ (open) | ✓ (open) |

Data created (all named « QA sales-cash … »): products « QA sales-cash savon », « QA sales-cash t-shirt » (S / M / L), « QA sales-cash parfum luxe », « QA sales-cash emballage cadeau » (service); client « QA sales-cash عميل كريم » 0555 98 76 01; sales #VNT-1010 (paid), #VNT-1012 (paid), #VNT-1013 (cancelled, refunded), #VNT-1014 (paid, linked), #VNT-1011 (draft, deleted); cash rows today « QA sales-cash apport فلوس 💰 » +5 000, « QA sales-cash loyer » −1 200 (with proof), « QA sales-cash correction VNT-1014 » −50; a closing of 01 nov « QA sales-cash clôture test » (+14 544 correction) reopened at once (reversal row « Réouverture : QA sales-cash réouverture (test clôture) » −14 544, balance back to the original; 01 nov now appears in « jours non clôturés »).

## Blocked by safety
None — no call of this area matches the kit's blocked list (no courier, payment, Meta or account call).

## Not tested
- `SALE_BLOCKED_BY_INVENTORY` (needs an inventory with « Bloquer les ventes comptoir », owned by the stock area), `SALE_CANNOT_CANCEL_AFTER_7D` server path (only the disabled menu reason on October sales), manual row edit window > 24 h (`CASH_ENTRY_EDIT_WINDOW_EXPIRED`) — need older own data.
- Closing today with a gap (would lock today's cash for every other agent and add a shop-wide correction); only the dialog was exercised.
- Closing / reopen as admin or operator, read-only views of sales / cash (roles area).
- Product barcode scan (needs a device); « Mois dernier », « 90 j », « Cette année » pills only listed, not opened.
