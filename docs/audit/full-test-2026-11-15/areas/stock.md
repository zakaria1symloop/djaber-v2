# Area stock — tested 15/11/2026 18:35–19:20 (Africa/Algiers)

Owner account, test shop « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`).
Scripts and raw outputs: `.local/qa/campaign/stock/scripts/` and `.local/qa/campaign/stock/*.txt`; screenshots `.local/qa/campaign/stock/*.png`.
Test data created (all named « QA stock … »): products « QA stock tapis » (PRD-B83U5KJT, simple, cost 1 000 → 971 after receipt) and
« QA stock pull variantes » (PRD-8VCQNJ2L, variants S / M); supplier « QA stock fournisseur مورد الجملة 😀 » (a second one, « QA stock
fournisseur à supprimer », was created, deactivated and deleted); purchases #ACH-1008 (received, over-received, paid in 3 payments),
#ACH-1010 and #ACH-1011 (partially received then cancelled), #ACH-1009 and #ACH-1012 (deleted); manual adjustments and one
reversal on « QA stock tapis ». Nothing of another area was submitted (INV-7, other suppliers / purchases: menus and dialogs only).

### STOCK-01 — Purchase quantity: erasing the field puts « 1 » back at once, so « erase then type 5 » orders 15
- Page: /fr/purchases/new and /fr/purchases/[id]/edit, line « QTÉ » (owner, fr, 1440 px) — same `QtyStepper` in the counter-sale form
- Severity: Major
- Type: Bug
- Steps: 1. Achats › « + Nouvel achat » › add « QA stock tapis » (qty 1). 2. Click the quantity, Ctrl+A, Backspace — the field shows « 1 » again. 3. Type `5`.
- Expected: the quantity becomes 5 (the field may be empty while typing and be validated on blur).
- Actual: the field reads « 15 »; End + Backspace ×2 + `8` gives « 18 »; typing `-3` gives « 13 », `2.5` gives « 125 ». The total updates silently (« Total 5 250 DA · 7 u »), so the purchase is ordered — and later received into stock and into the weighted-average cost — with the wrong quantity. Only double-click + type replaces the value.
- Evidence: .local/qa/campaign/stock/23.txt (« after clear: "1" · after typing 5: "15" ») · fr-23-qty.png · Likely cause: packages/ui/src/inputs.tsx:225-227 (`Math.max(min, n)` with `min=1` on every keystroke: empty → 0 → 1)

### STOCK-02 — Stock quantities, supplier delays and payment amounts drop the decimal separator and the minus sign
- Page: /fr/stock › « Ajuster un stock » (QUANTITÉ), /fr/suppliers › « Nouveau fournisseur » (DÉLAI DE PAIEMENT / DE LIVRAISON), purchase « Payer le solde » (MONTANT) (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. « Ajuster un stock » › « QA stock tapis » › QUANTITÉ: type `2.5`, `2,5`, `-5`, `1e3`, `99999999999`. 2. « Nouveau fournisseur »: délai de paiement `-5`, délai de livraison `2.5`. 3. « Payer le solde »: montant `-50`, `1,5`.
- Expected: a decimal or negative value is refused with an inline message (quantities and DZD amounts are integers, 04 §2) — never silently changed.
- Actual: `2.5` → « 25 », `2,5` → « 25 », `-5` → « 5 », `1e3` → « 13 », `99999999999` → « 9 999 999 » (cut without a word); supplier `-5` → « 5 », `2.5` → « 25 »; payment `-50` → « 50 », `1,5` → « 15 ». A merchant typing « 2,5 » in the adjustment dialog adds 25 units. Same input family as PRODUCTS-01 / ORDERS-01 (one fix covers all).
- Evidence: .local/qa/campaign/stock/07.txt (« QTY typed "2.5" -> "25" »), 17.txt, 28.txt

### STOCK-03 — « Same name » warning of the supplier dialog never appears: its lookup is refused 422 (pageSize=5)
- Page: /fr/suppliers › « + Nouveau fournisseur » / « Modifier » (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. « + Nouveau fournisseur ». 2. Type the exact name of an existing supplier (« QA stock fournisseur مورد الجملة 😀 »), no phone. 3. Créer.
- Expected: the dialog points out that a supplier with the same name exists before creating (tester report 2026-10-20 UX-003, comment at suppliers.tsx:459).
- Actual: no warning; a second supplier with the same name is created. Every name typed fires `GET /suppliers?q=…&pageSize=5` → 422 `VALIDATION_ERROR {pageSize: validation.range}` (the API accepts 25 / 50 / 100, api-contract §1.6), 4–5 console errors per dialog. (The shop already holds two « zakaria amrani ».) The phone / e-mail duplicate check works (409 `SUPPLIER_ALREADY_EXISTS`, shown inline).
- Evidence: .local/qa/campaign/stock/fr-18-twin.png · 17.txt / 18.txt · API: GET /suppliers?q=…&pageSize=5 → 422 · Likely cause: apps/web/src/features/gds/suppliers.tsx:462 (`pageSize: 5`)

### STOCK-04 — Movements search promises « référence (#CMD, #ACH, #VTE) » but never matches a reference number
- Page: /fr/movements (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Mouvements. 2. Type `#CMD-1023` (shown in the RÉFÉRENCE column of 2 rows) in the search field « Produit, variante, référence (#CMD, #ACH, #VTE)… ».
- Expected: the rows of order CMD-1023 (and of #ACH-1008 when searching it).
- Actual: « Aucun résultat — Aucun(e) mouvement ne correspond à « #CMD-1023 ». » The server only searches product name / SKU / variant name / note.
- Evidence: .local/qa/campaign/stock/13.txt · Likely cause: apps/api/src/modules/catalog/stock.service.ts:316-318 (no reference number in the OR)

### STOCK-05 — Stock dashboard « ACHATS EN ATTENTE 1 · 4 730 DA » pairs the pending count with the debt of a received purchase
- Page: /fr/stock, block « ACHATS & FOURNISSEURS » (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Open the stock dashboard. 2. Read « ACHATS EN ATTENTE ». 3. Click it.
- Expected: the number and the value of the purchases waiting for receipt (GDS-01 « purchases & suppliers block »), consistent with the list it opens.
- Actual: « 1 · 4 730 DA »: 1 = #ACH-1006 (10 000 DA, already paid) but 4 730 DA = what is still owed on #ACH-1003, a purchase **received** on 19 oct. The link opens `/purchases?status=pending,partial` with one row of 10 000 DA — the 4 730 DA appears nowhere there.
- Evidence: .local/qa/campaign/stock/01.txt, 32.txt · Likely cause: apps/api/src/modules/catalog/stock.service.ts:528/536 (`dueToSuppliers` sums pending + partial + received) shown by apps/web/src/features/catalog/stock/dashboard.tsx:236 next to `pendingReceipt`

### STOCK-06 — A reversed movement shows a raw ID as its reference on the product page (« 01a1e052 · Correction »)
- Page: /fr/products/[id] › « Mouvements récents » after a « Contre-passer » (owner, fr, 1440 px); /fr/movements shows « Manuel » for the same row
- Severity: Minor
- Type: Bug
- Steps: 1. Mouvements › row « QA stock tapis −20 Perte » › Actions › Contre-passer › Contre-passer (toast « Mouvement contre-passé · QA stock tapis », +20 created — correct). 2. Open the product page of « QA stock tapis ».
- Expected: the reversal points to the movement it cancels in readable words (04 §20 Movements: `reversedByMovementId`), the same on both screens.
- Actual: product page: « AJUST. + +20 -8 → 12 · 01a1e052 · Correction » (first 8 characters of a UUID); movements list: RÉFÉRENCE « Manuel »; the original row gives no hint that it was reversed (its Contre-passer is only greyed with the generic « Journal immuable : corrigez par un nouvel ajustement. », the same reason as on order / purchase movements, which do not say why they cannot be reversed).
- Evidence: .local/qa/campaign/stock/26.txt (« 01a1e052 · Correction ») · fr-13-after-reverse.png · 13.txt · Likely cause: apps/api/src/modules/catalog/stock.service.ts:359 (`labels.get(m.refId) ?? m.refId.slice(0, 8)`) and :363 (one reason code for every non-reversible case)

### STOCK-07 — Arabic (RTL): purchase numbers, amounts and names are scrambled (« ACH-1008# », « DA 2 000 », « .Karim P »)
- Page: /ar/purchases/[id], /ar/stock « آخر الحركات » (owner, ar, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Switch to Arabic. 2. Open purchase #ACH-1008 and the stock dashboard.
- Expected: numbers, references and amounts kept left-to-right inside the Arabic sentence (`<Ltr>`, CLAUDE.md rule 7).
- Actual: title « الشراء ACH-1008# »; history « دفعة DA 2 000 في 15 نوفمبر »; payments « 15 نوفمبر 13:00 2026 · نقدًا · .Karim P »; dashboard lines « شراء مُستلم · #Karim Proprio · ACH-1011 · ACH-1011 » (the « # » jumps to the member name); « مستلم 100 % » rendered « % 100 ».
- Evidence: .local/qa/campaign/stock/ar-34-purchases-01a1e05e-5f14-7e87-b487-76fc6.png · ar-34-stock.png

### STOCK-08 — Draft purchase says « reste 0 » while its form said « reste dû 9 800 DA »
- Page: /fr/purchases/[id] of a draft (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Nouvel achat, 3 lines, total 9 800 DA, payé 0 › « Brouillon ». 2. Read MONTANTS; open « Réceptionner ».
- Expected: the same « reste dû 9 800 DA » as the form (or « — » with an explanation for a draft).
- Actual: « total 9 800 · payé 0 (Espèces) · reste 0 »; the receive dialog says « solde dû après : 0 DA »; after « Commander » the same purchase shows « reste 9 800 ». Same on duplicates (#ACH-1009 / 1010 / 1011).
- Evidence: .local/qa/campaign/stock/22.txt, 24.txt, 29.txt

### STOCK-09 — Supplier « Enregistrer un paiement » is offered with nothing due, and its dialog reads « Achat — »
- Page: /fr/suppliers row menu / sheet (owner, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Fournisseurs › row « pedro » (solde dû 0 DA) › Actions › Enregistrer un paiement (opened, not submitted). 2. On « QA stock fournisseur » (6 800 DA due) type 7 000.
- Expected: the item greyed with a reason (« Aucun solde dû ») like the other disabled items; the over-amount error shown while typing as in « Payer le solde ».
- Actual: the dialog opens: « pedro · solde dû 0 DA (0 achat) · MONTANT · max = solde dû · Crée une ligne de caisse « Achat — » (verrouillée) ». 7 000 for a 6 800 DA debt shows no message before submit. An inactive supplier with nothing due still offers it too.
- Evidence: .local/qa/campaign/stock/fr-17-pay-pedro.png · 17.txt, 28.txt

### STOCK-10 — Movements: custom period with « Du » after « Au » silently drops « Du »
- Page: /fr/movements › Période › DU / AU (owner, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Période › DU 15/11/2026, AU 01/10/2026.
- Expected: inline error « la date de début est après la date de fin » (12 §11 custom period states), dates kept.
- Actual: DU is cleared without a word; URL keeps only `to=2026-10-01`; result « Période : … → 01 oct. ».
- Evidence: .local/qa/campaign/stock/fr-35-period-inverted.png · 35.txt

### STOCK-11 — Inventory counting screen: SKUs printed in capitals, tabs not in the URL, table cut at 390 px
- Page: /fr/inventory/[id] (owner, fr, 1440 px and 390 px)
- Severity: Minor
- Type: UX
- Steps: 1. Inventaires › #INV-7 (open count of the shop, read only). 2. Look at the SKU under each product; click « À compter » / « Écarts »; F5. 3. Same at 390 px.
- Expected: SKUs as stored (case is part of the code merchants type / scan); filters in the URL (CLAUDE.md rule 7); the counting table usable on a phone (INV-01: entry on web and mobile).
- Actual: « cas_001 » shows « CAS_001 », « ezé23 » « EZÉ23 », « azeaezazeaz » « AZEAEZAZEAZ » (CSS uppercase); the tab is lost on F5 (URL unchanged); at 390 px the COMPTÉ / ÉCART / NOTE columns need a horizontal scroll (NOTE off-screen). Same at 390 px for the ARTICLES table of a purchase (TOTAL cut).
- Evidence: .local/qa/campaign/stock/fr-14-inv7.png · fr-34-390-inventory-01a1783b-36da-7737-83fb-9aa88.png · fr-34-390-purchases-01a1e05e-5f14-7e87-b487-76fc6.png · 15.txt

### STOCK-12 — Adjustment dialog announces a « sortie » / « entrée » movement, but writes « AJUST. − » / « AJUST. + »
- Page: /fr/stock › « Ajuster un stock » (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. « QA stock tapis » › Définir 12 (stock 15) or Sortie 20.
- Expected: the preview names the type that is written: manual adjustment = `adjustment_out` / `adjustment_in` (04 §20 Movements), shown « AJUST. − » / « AJUST. + ».
- Actual: « Résultat : QA stock tapis passe de 15 à 12. Un mouvement « sortie » sera enregistré… » → the journal shows « AJUST. − −3 Inventaire ». Same for « entrée » → « AJUST. + ». After a forced save the dialog flashes « Stock insuffisant : QA stock tapis n'a que -8 unités » while closing.
- Evidence: .local/qa/campaign/stock/07.txt, 10.txt · i18n `stock.adjust.preview`

### STOCK-13 — Product stock block says « alerte quand le stock passe en dessous » the threshold, the alert fires at equal
- Page: /fr/products/[id] › Stock › SEUIL D'ALERTE (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. « QA stock pull variantes » variant M: stock 2, seuil 2; « QA stock tapis » seuil 3.
- Expected: wording matching the rule `quantity ≤ minStock` (03 NTF `stock.low`) — « au seuil ou en dessous ».
- Actual: « 3 u (alerte quand le stock passe en dessous) » while variant M at 2 / seuil 2 is listed « FAIBLE » on the dashboard and in `?lowStock=1`.
- Evidence: .local/qa/campaign/stock/04.txt, 32.txt

### STOCK-14 — Small texts: « Aucun(e) », « 1 erreurs », double full stops, « ⚠ ⚠ », « (–) », hyphen minus, repeated references
- Page: /fr/movements, /fr/purchases/new, /fr/purchases/[id], /fr/inventory/[id], supplier dialog, /fr/stock (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps / Actual (each seen and reproduced):
  - Movements empty search: « Aucun(e) mouvement ne correspond à « #CMD-1023 ». » (inclusive placeholder instead of « Aucun mouvement »).
  - Purchase form: « Validation : 1 erreurs — Choisissez une variante. », and the summary stays after the variant is chosen.
  - « Inventaire validé le 19 oct. par Amina T.. » · « En retard : réception prévue le 21 oct.. » (abbreviation dot + sentence dot).
  - Receive dialog over-receipt: « ⚠ ⚠ Quantité reçue > commandée pour « QA stock tapis »… » (icon twice).
  - Supplier dialog, délai 99 999: « Valeur hors limites (–) » (bounds missing).
  - ASCII hyphen instead of « − » for negatives: « -8 000 DA AU COÛT », inventory « -18 357 DA », theoretical « -6 », product page « 12 → -8 »; « −0 » in the empty KPI tiles.
  - Dashboard movement lines repeat the reference: « Commande créée · #CMD-1024 · CMD-1024 », « Achat reçu · #ACH-1008 · ACH-1008 ».
  - Purchase pills « PARTIEL 5/9 » + « PARTIEL · DÛ 7 800 DA » side by side (reception and payment use the same word).
  - Every purchase page ends with the same static line « Actions : Payer le solde · Imprimer le bon · Dupliquer · Annuler (impossible une fois reçu). », also on paid, pending and cancelled purchases.
- Evidence: .local/qa/campaign/stock/13.txt, 22.txt, 14.txt, 19b.txt, 27.txt, 17.txt, 12.txt, 01.txt

### STOCK-15 — Payment taken at reception is dated 13:00 instead of the real time; « commandé » vanishes from a cancelled purchase's history
- Page: /fr/purchases/[id] (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Bug
- Steps: 1. Réceptionner #ACH-1008 at 19:02 with « PAIEMENT À LA RÉCEPTION » 2 000 DA. 2. Read PAIEMENTS. 3. On #ACH-1010 (commandé, payé 1 000, partly received) › Annuler l'achat.
- Expected: the payment time = when it was recorded (19:02, like the later « Payer le solde » rows); the history keeps every step.
- Actual: « 15 nov. 2026 13:00 · Espèces · Karim P. » (noon UTC of the reception date); after cancelling #ACH-1010 the history reads « créé 15 nov. · paiement 1 000 DA le 15 nov. · annulé 15 nov. » (the « commandé 15 nov. » step shown before is gone). MONTANTS also names only the first method: « payé 11 800 (Espèces) » for Espèces + CCP payments.
- Evidence: .local/qa/campaign/stock/26.txt, 28.txt, 30.txt

## Checked and correct (no bug)
Adjust dialog: required fields, « Quantité nulle. » (0 and « Définir » to the same value greyed), variant required (« Ajustez le stock par variante. »), services absent from the picker, insufficient stock with preview « passe de 15 à −85 (bloqué) » and « Forcer (stock négatif) » for the owner; forced to −8 then reversed back to 12. Dashboard tiles follow the movements (value at cost, items, low / out counts; negative stock counted 0). Movement filters (type, motif, product, par = Système, période, panel « Appliquer (n) »), chips, « Effacer », URL + F5, sort ↑ / ↓, page sizes, invalid URL params (« Impossible de charger » + Réessayer), CSV export (job toast « Export terminé · mouvements.csv »), snapshot « Voir le stock à cette date » (checked on casquette for 20 / 25 / 26 oct.: 53 / −5 / −6 = journal), reversal dialog + toast. Purchases: validation (supplier, ≥ 1 line, variant, paid > total), service line refused (« … est un service : non achetable »), leave guard (« Quitter sans enregistrer ? »), draft → commandé, edit of a pending purchase, edit of a received one refused with a clear text, partial receipt, over-receipt accepted with toast « Reçu > commandé (6/5) : le bon est complété » and line raised, added line (variant required), weighted-average cost (tapis 12 × 1 000 + 2 × 800 → 971 DA; pull S 5 × 1 200 + 3 × 1 500 → 1 313 DA, half-up), payments (« Payer le solde », supplier payment « au plus ancien »), over-payment refused inline on submit, delete of draft / unpaid pending, delete greyed once paid, cancel of a partial purchase (« les 1 u reçues restent en stock, le reste n'est plus dû »), cancelled → payment locked, received → cancel greyed « Achat reçu : annulation impossible », duplicate, print PDF (ACH-1008.pdf), late filter / KPI, sort by total kept after F5, status deep link from the dashboard, 404 page. Suppliers: required name, DZ phone format with normalisation, e-mail check, phone / e-mail duplicate 409, Arabic + emoji name, edit, deactivate → « INACTIF » + « Nouvel achat » greyed « Fournisseur désactivé : réactivez-le pour lui passer un achat. », delete of a supplier without purchase, « Supprimer » greyed for one with purchases, detail sheet with prev / next. Inventory list: « Lancer un inventaire » greyed « Inventaire INV-7 en cours : terminez-le d'abord. », « Valider » greyed « Aucune ligne comptée. », cancel dialog (opened, kept), count sheet PDF (INV-7.pdf), 404. Stock alerts: dashboard « STOCK FAIBLE » list + « Réapprovisionner » (opens a purchase pre-filled with the missing quantity), `/products?lowStock=1`, notification « Rupture : QA stock tapis » after the forced exit. Arabic and English: every screen fully translated, `dir=rtl`, no horizontal page scroll; 390 px: no page overflow, movements and suppliers switch to cards.

## Coverage
| Screen / flow | fr | ar | en | 390 px |
|---|---|---|---|---|
| /stock dashboard (tiles, recent movements, low-stock list, purchases block, links) | ✓ | ✓ | ✓ | ✓ |
| Adjust dialog (in / out / set, variant, force, validation, ESC) | ✓ | ✓ (opened) | ✓ (opened) | — |
| /movements (KPIs, quick filters, panel, search, sort, pagination, export, row menu, reverse, snapshot, F5, back, bad params) | ✓ | ✓ | ✓ | ✓ |
| /inventory list + /inventory/[id] (read only: tabs, search, sheet PDF, actions menu, cancel dialog opened, 404) | ✓ | ✓ | ✓ | ✓ |
| /suppliers (chips, row menus, sheet, create / edit / deactivate / delete, payment dialog) | ✓ | ✓ | ✓ | ✓ |
| /purchases list (KPIs, filters, sort, late, export menu, row menus, bad params) | ✓ | ✓ | ✓ | ✓ |
| /purchases/new + /edit (validation, lines, variants, service refused, leave guard, draft / order) | ✓ | ✓ | ✓ | ✓ |
| /purchases/[id] (order, receive partial / full / over / added line, pay, supplier pay, cancel, delete, duplicate, print) | ✓ | ✓ | ✓ | ✓ |
| Stock alerts (low list, `?lowStock=1`, `stock.low` / out notification) | ✓ | — | — | — |

## Blocked by safety
None — no call of this area was stopped by the kit.

## Not tested
- Inventory start / count entry / validate / cancel: the shop already has #INV-7 open (draft, started 26 oct. by Amina T., not « QA » data); only one open count is allowed per workspace and every typed count is saved to the server, so starting, counting or cancelling would have meant submitting on another person's record.
- Simple stock mode screens (the stock-mode switch is blocked by the kit for all agents).
- Admin / operator views of these screens (area « roles »); counter sales and the cash rows created by purchase payments (area « sales-cash »); recommendations page (area « analytics »).
