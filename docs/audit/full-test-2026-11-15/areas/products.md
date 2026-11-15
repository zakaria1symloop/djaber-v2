# Area products — tested 15/11/2026 16:45–17:25 (Africa/Algiers)

Owner account, test shop « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`).
Scripts and raw outputs: `.local/qa/campaign/products/scripts/` and `.local/qa/campaign/products/*.txt`.
Test data created (all named « QA products … »): products « QA products robe été » (PRD-M784NBHC), « QA products t-shirt
variantes » (PRD-ZPJA3574, 6 variants), « QA products import chemise » / « QA products import pantalon » (import), categories
« QA products catégorie مرحبا 😀 » and its child « QA products sous-catégorie 2 ». A duplicate « QA products robe été copie » was
created, archived, restored and hard-deleted; temporary units (« QA products carton », « Kilogramme · kgx », « box of 6 · zz »)
were deleted. Nothing of another area was modified.

### PRODUCTS-01 — Price / stock / weight fields drop the decimal separator and the minus sign: « 2500,00 » is saved as 250 000 DA
- Page: /fr/products/new and /fr/products/[id]/edit (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Products › « + Ajouter un produit ». 2. In « Prix de vente » type `2500,00` then Tab; also try `1999.5`, `-100`. 3. In « Stock initial » type `2.5` and `-5`; in « Poids (g) » `1.5` and `-300`; in « Seuil d'alerte » `-1`.
- Expected: a decimal is refused or rounded with an inline message (amounts are integer DZD, 04 §2; quantities are integers), a negative value is refused with a message — never silently multiplied.
- Actual: the field keeps only the digits — price `2500,00` → « 250 000 », `1999.5` → « 19 995 », `-100` → « 100 »; stock `2.5` → « 25 », `-5` → « 5 »; weight `1.5` → « 15 »; threshold `-1` → « 1 ». No warning; the form saves the wrong value (a price 100× too high goes straight to the AI agent, which quotes it to customers). Same component as ORDERS-01 (MoneyInput / NumberInput of `@djaber/ui`); the quick-edit sheet uses the same inputs.
- Evidence: .local/qa/campaign/products/fr-05-price.png · 05.txt (« PRICE typed "2500,00" -> "250 000" »)

### PRODUCTS-02 — At 1440 px the products table hides the STOCK column under the sticky « Actions » column
- Page: /fr/products (owner, fr and ar, 1440 × 900 — the reference desktop width)
- Severity: Major
- Type: UX
- Steps: 1. Open Produits (the shop has products pending / refused by Djaber, so the IA and VALIDATION DJABER columns are shown). 2. Look for the stock of a product.
- Expected: the main columns readable without scrolling at 1440 px (12 §8 products list: « qty with low pill »; page.tsx comment « 1440 px keeps every other column readable »).
- Actual: the table is 1 478 px wide inside a 1 134 px box; header positions: STOCK 1310–1422, IA 1422–1511, VALIDATION 1511–1633, while the sticky « Actions » column sits at 1289–1407 — so the stock quantity and the RUPTURE / FAIBLE pills are covered, and IA / VALIDATION are off-screen. Only a horizontal scroll inside the table reveals them (and then the product name disappears). Same in Arabic. At 1920 px everything fits.
- Evidence: .local/qa/campaign/products/fr-01-list.png · fr-20-cols-1440-scrolled.png · ar-19-1440--products.png · 20-columns output

### PRODUCTS-03 — Grid view and phone cards show the base price, not the variants' price (« Gourde » 2 200 DA in the grid, sold at 1 800 DA)
- Page: /fr/products?layout=grid (owner, fr, 1440 px) and /fr/products at 390 px (card list)
- Severity: Major
- Type: Bug
- Steps: 1. Products list, table view: « Gourde isotherme en inox » shows 1 800 DA, « ceinture » 1 300 DA – 1 400 DA. 2. Click « Grille » (or open the list on a phone).
- Expected: the same price as the table — a product with variants is sold at its variants' prices (12 §8 products list « price »; comment in page.tsx « tester report 2026-10-20 »).
- Actual: grid cards and phone cards print `product.price` (the base price, not used for sale): « Gourde isotherme en inox 2 200 DA » (its only variant sells 1 800), « ceinture 1 200 DA » (variants 1 300 / 1 400), « QA ai-chat Robe kabyle 4 900 DA » (range 4 900 – 5 200). A merchant on the phone sees prices that are not the ones the AI quotes.
- Evidence: .local/qa/campaign/products/fr-03b-grid.png · fr-19-390--products.png · Likely cause: apps/web/src/app/[locale]/(app)/products/page.tsx:319 and :360 (`<Money value={r.price} />` instead of the `priceRange` used at :131)

### PRODUCTS-04 — « Seuil de stock min » in bulk says OK on a product with variants but changes nothing
- Page: /fr/products (owner, fr, 1440 px), selection bar
- Severity: Minor
- Type: Bug
- Steps: 1. Select « QA products robe été » and « QA products t-shirt variantes » (6 variants, 3 u each, threshold 0). 2. Selection bar › « Seuil de stock min » › 3 › « Appliquer (2) ».
- Expected: the variants of the selected product get the threshold (the product page says « SEUIL D'ALERTE par variante »), or the row is reported « IGNORÉE » with a reason in the bulk result dialog (12 §19).
- Actual: `POST /products/bulk/min-stock` → 200 `{ ok: 2, failed: 0 }`, success toast, but every variant keeps « SEUIL 0 » and none turns « FAIBLE » although they sit at 3 u. The merchant believes the alert is set.
- Evidence: 13b.txt / 14b.txt (« VARIANTS after bulk min 3: … 3 0 Ajuster »)

### PRODUCTS-05 — A custom unit can reuse a system unit's abbreviation / name: two « kg » in the unit list
- Page: /fr/categories › « + Unité » (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. « + Unité », name « QA products carton », abbreviation `kg` › Créer. 2. Again name `Kilogramme`, abbreviation `kgx`. 3. Open a product form › Unité.
- Expected: abbreviation (and name) unique in the workspace including system units — the import and the labels match a unit by its abbreviation — with a clear inline message « Abréviation déjà utilisée ».
- Actual: both are created; the product form unit list shows « Kilogramme (kg) … Kilogramme (kgx) · QA products carton (kg) ». Only the exact pair « Kilogramme / kg » is refused, and then with the generic « Valeur invalide » under NOM (not under the abbreviation). A second « box of 6 » (abbr. `zz`) is accepted too. (Test units deleted afterwards.)
- Evidence: .local/qa/campaign/products/fr-17c-unit-select.png · 17d.txt

### PRODUCTS-06 — Browser « Back » leaves the product form with unsaved changes without the leave guard
- Page: /fr/products/[id]/edit (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Open a product › Modifier. 2. Change the name (« ● Modifications non enregistrées (nom) »). 3. Click a sidebar link → « Quitter sans enregistrer ? » appears (correct), click « Rester »; « Annuler » also asks (correct). 4. Press the browser Back button.
- Expected: the same « Quitter sans enregistrer ? » (12 §16 Form states) or at least the browser's « leave page » prompt.
- Actual: the browser goes straight back (here to /fr/home) and the edit is lost silently.
- Evidence: 11.txt (« LEAVE GUARD (back): NO DIALOG | url …/fr/home ») · fr-11-leave-guard.png

### PRODUCTS-07 — Quick-edit sheet « Agents · 0 / Rien pour l'instant » while the product page lists 4 agents proposing it
- Page: /fr/products?sheet=<id> vs /fr/products/<id> (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Products list › row « Actions » › « Modification rapide » on « QA products robe été ». 2. Tab « Agents ». 3. Click « Fiche complète ».
- Expected: the same agents in both places (CAT-01 quick edit sheet + relations, 12 §19 « related tabs … Agents »).
- Actual: sheet tab « Agents · 0 », « Rien pour l'instant. »; product page block « Agents & canaux » › « PROPOSÉ PAR pedro 2 · Pro Seller · test pro · kjbglkjgvhlyjigv ». Same for every product tried. The margin also differs: sheet « 56 % » / « 57 % », page and list « 55,6 % ».
- Evidence: .local/qa/campaign/products/fr-12-quick-edit.png · 12b.txt

### PRODUCTS-08 — An unknown product id in the URL shows « Impossible de charger — Requête invalide · Réessayer » instead of « Introuvable »
- Page: /fr/products/not-a-uuid and /fr/products/not-a-uuid/edit (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /fr/products/not-a-uuid (a truncated or mistyped link).
- Expected: the 404 state « Introuvable … Retour » (12 §16 Detail states), as for a well-formed unknown id (/fr/products/00000000-0000-7000-8000-000000000000 shows it correctly).
- Actual: error state « Impossible de charger · Requête invalide. · Réessayer » — `GET /products/not-a-uuid` → 400 `BAD_REQUEST`; « Réessayer » can never succeed.
- Evidence: 21.txt

### PRODUCTS-09 — « Ancien prix (promo) » lower than the selling price is accepted
- Page: /fr/products?sheet=<id> quick edit and /fr/products/new (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Quick edit « QA products robe été » (price 4 600). 2. « Ancien prix » 3000 › Tab.
- Expected: old price > selling price (it is the struck-through « before » price on the Messenger card « 4 500 DA (5 500 DA) »), or at least a warning like the « selling < cost » one. 03 CAT-01 does not state the rule — spec gap.
- Actual: saved silently (« ● Ancien prix modifié · enregistré », `PATCH … {"oldPrice":3000}` → 200); the card would advertise a « promo » cheaper than the real price. (Restored to 5 500 afterwards.)
- Evidence: .local/qa/campaign/products/fr-12b-old-lt-price.png

### PRODUCTS-10 — Keyword count error says « Trop long (50 max) » while the limit broken is « 30 max »
- Page: /fr/products/new (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. « Mots-clés (IA) »: type 35 short words separated by commas (`mot0,mot1,…,mot34`). 2. Enregistrer.
- Expected: « 30 mots-clés max » (the hint under the field says « Séparés par des virgules · 30 max »).
- Actual: « Trop long (50 max) » — 50 is the per-keyword character limit; the merchant cannot tell what to fix. Likely cause: apps/web/src/features/catalog/product-form/model.ts:178 (one `validation.length` issue for both rules).
- Evidence: 05.txt

### PRODUCTS-11 — Import preview: a decimal price is reported as « Prix de vente requis (> 0) »
- Page: /fr/products/import (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Import a CSV with a row `QA products import décimal,1999.5,1` (file .local/qa/campaign/products/files/import-mix.csv).
- Expected: « Prix invalide : nombre entier en DA » (or the price rounded with a warning).
- Actual: preview row 6 « 1999.5 » · « Prix de vente requis (> 0) · Prix de vente »; the downloaded error file says the same. The price is present and > 0, so the message is wrong.
- Evidence: .local/qa/campaign/products/fr-15-mix-1.png · files/errors-import-mix-erreurs.csv

### PRODUCTS-12 — A file that is not an image is accepted in the form, then fails on save with « réessayez avec Enregistrer »
- Page: /fr/products/[id]/edit › Images (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Edit « QA products robe été ». 2. Images › Ajouter a text file renamed `fake.jpg`. 3. Enregistrer.
- Expected: `IMAGE_TYPE_INVALID` shown at once on the tile (12 §21 « Images inline errors »), no retry advice for a file that can never be sent.
- Actual: the tile shows « À ENREGISTRER » (counted 1 / 10) with no error; on save `POST …/images` → 415 and the form says « Format non supporté (jpg, png, webp, gif). » plus « 1 photo n'a pas été envoyée : réessayez avec « Enregistrer ». » — retrying fails again. (The format list also names GIF while the hint says JPG, PNG, WEBP.)
- Evidence: .local/qa/campaign/products/fr-18-img-fake-jpg.png · fr-18b-fake-saved.png · 18b.txt

### PRODUCTS-13 — Filtered-empty text « Aucun(e) produit ne correspond à « les filtres actuels » »
- Page: /fr/products?q=zzzqqq (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Search `zzzqqq` (or any filter with no result).
- Expected: « Aucun produit ne correspond aux filtres actuels. » and the active filters named (12 §16 « Vide filtré … names the active filters »).
- Actual: « Aucun(e) produit ne correspond à « les filtres actuels ». » — generic (e), the placeholder phrase in quotes, filters not named.
- Evidence: .local/qa/campaign/products/fr-03-search-none.png

### PRODUCTS-14 — Small wording slips on the product screens
- Page: /fr/products/new, /fr/products (filter panel), /fr/categories, /fr/products/new › Générer des variantes, /fr/products/import (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps / Actual: (a) form validation summary « Validation : 1 erreurs — nom » (plural with 1); (b) filter panel header « 1 ACTIF · 8 RÉSULTATS · ÉTAT DANS L'URL » — « état dans l'URL » is a developer note shown to the merchant (UX-059); (c) system unit menu greyed reason « Supprimer : Unité système non modifiable. » (should say « non supprimable »); (d) « Générer des variantes » with 11 × 11 values shows « Générer 101 variantes » (there are 121 combinations; the button is correctly disabled « 100 variantes max par produit. »); (e) import too-large message « Max 5 Mo et 2000 lignes. » (« 2 000 » elsewhere); (f) the « Ajuster le stock » dialog keeps « Enregistrer l'ajustement » enabled with no motif chosen (title empty) while the motif is marked required.
- Expected: correct plural, no technical note, the right verb, the real count, the same number format, a disabled reason on the missing motif.
- Evidence: 06.txt / 03.txt / 17.txt / 09b.txt / 08.txt · .local/qa/campaign/products/fr-09b-121.png

### PRODUCTS-15 — Arabic: brand written two ways and « 2,000 » with a comma
- Page: /ar/products, /ar/products/[id], /ar/products/import (owner, ar, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Switch to Arabic. 2. Compare the list banner, the product page header and the import page.
- Expected: one spelling of the brand; numbers « 2 000 » (rule 11, Latin digits with a space).
- Actual: list banner « مراجعة جابر » but product page « في انتظار مراجعة Djaber »; import « 2,000 سطر كحد أقصى » (same « 2,000 rows » in English, « 2 000 lignes » in French).
- Evidence: .local/qa/campaign/products/ar-19-1440--products.png · ar-19-1440--products-import.png · 19-ar.txt

### PRODUCTS-16 — Phone: long product names are cut in the product page title
- Page: /fr/products/[id] at 390 px (owner, fr and ar)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open « QA products t-shirt variantes » on a 390 px screen.
- Expected: the full name readable (wrapped) on its own page.
- Actual: the H1 is a single truncated line « QA products t-shirt vari… »; the full name appears nowhere else on the screen.
- Evidence: .local/qa/campaign/products/fr-19-390--products-01a1dff3-8e04-70fd-ae12-f874af.png

## Coverage
- **Products list** (fr 1440 full; ar 1440, en 1440, fr 390, ar 390 screenshots + leak / overflow checks): tabs Tous / Actifs / En attente / Refusés / Masqués, banners « Voir les refusés » / « Voir », search (Latin, Arabic, SKU, emoji, `%_`, no result, F5 keeps `q`), Catégorie dropdown, « Stock faible » chip + `?lowStock=1` deep link + chip ×, filter panel (categories search + pick, status Actifs / Inactifs / Archivés, type, stock state, quantity / price / cost / margin ranges incl. min > max, negative, letters, agent « Aucun agent », moderation, dates presets + custom, sort, Réinitialiser, Esc, « Afficher n »), active-filter chips, column sort (name, SKU, price ↑↓, cost, stock), pagination + 25 / 50 / 100 + F5, grid / list, density & columns menu, Back after filters, row « Actions » menu (state-aware items, greyed reasons « Supprimer : Référencé par commandes/ventes : archivez-le. », service « Ajuster le stock : Ce produit n'a pas de stock (service). »), 1280 / 1440 / 1920 column layout.
- **Quick-edit sheet**: price / old price / empty price (inline « Prix de vente requis (> 0) »), saved-on-blur indicator, stock stepper (+1 → movement), related tabs, Précédent / Suivant, Esc.
- **Bulk bar**: select rows, « Changer de catégorie », « Seuil de stock min » (applied 3 on QA products), « Prix (+ / − %) » preview (+10 %, +150 %, −150 % → error notice, −99 % → below-cost notice), « Ajouter à un agent » (opened, not applied — agents are shared), « Étiquettes » (0 → disabled « Entre 1 et 50 », PDF job done), « Exporter », « Archiver » (dialog only).
- **Product form** (create + edit): empty submit, whitespace name, 300-char name (cut at 255), duplicate SKU (« SKU déjà utilisé » inline, 409), price / old / cost / stock / threshold / weight with decimals, negatives, Arabic digits, letters, huge numbers, selling < cost warning, keywords > 30, description > 5 000 with counter, category combobox, unit combobox, service mode (`?type=service`), variants (add row, empty row error, generate 6, generate 121 refused, duplicate variant name « Nom déjà utilisé par une autre variante », row menu, delete variant dialog), images (wrong type, > 5 Mo « Image trop lourde », 1 px warning, save with invalid file), « Remplir depuis la photo » dialog (opened only — 5 credits), leave guard (sidebar link, Annuler, Back), save → product page, edit of another tab adopted (no 409 reproducible: the edit page adopts the newer version on focus).
- **Product page**: header pills, card preview dialog, « Ajuster le stock » (insufficient → « Forcer (stock négatif) » preview, zero disabled, +3 correction saved), expense dialog (close guard on typed content, 150 DA per unit added, margin preview), menu: Dupliquer (empty name error, copy created → edit page), Ajouter à un agent (dialog), Étiquettes, Exporter (job + download), Désactiver / Réactiver, Archiver → archived page (banner, Restaurer dialog, restored), Supprimer définitivement (204, then 404 page « Introuvable »), refused product page (motif, rules, « Modifier et resoumettre »), variants table, 404 / bad id.
- **Import**: start page, sample CSV download, wrong type (« Format non supporté. »), > 5 Mo (« Max 5 Mo et 2000 lignes. »), mixed CSV (valid, missing price, negative, decimal, duplicate SKU, missing name, Arabic + bad stock), column mapping dialog, tabs Toutes / Erreurs, error report download, commit → done screen (2 created, 6 ignored, 1 category created, pending-review link).
- **Export**: header « Exporter » with search filter → XLSX job → download; content checked (one line per variant, labels in French).
- **Categories & units**: list (2-level tree), new category (empty, duplicate name case-insensitive « Catégorie existante. », parent list limited to root categories, close guard), create parent + child (Arabic + emoji name), edit (name cut at 80), delete parent with sub-category (move-to-root option), delete category in use (reassign select, button disabled until chosen, reassigned), units (system unit menu greyed, new unit empty / duplicates / conversion requires base unit, delete custom unit).
- **Services**: list, « + Nouveau service » → form with stock tracking off.
- **States**: 404 product, filtered-empty, empty search, archived, refused, pending review; fr / ar (RTL, `dir=rtl`, no horizontal page overflow) / en for list, grid, new, product page, edit, import, categories, services; 390 px fr + ar for the same pages (no page overflow).

## Blocked by safety
- None — no call of this area was stopped by the kit.

## Not tested
- « Remplir depuis la photo » analysis and the photo-based creation (each run costs 5 AI credits; only the dialog was opened).
- « Ajouter à un agent » submit (single and bulk): the agents are shared with the ai-chat / agents areas; not changed.
- Bulk « Changer de catégorie », bulk price apply and bulk archive submit (dialogs and previews only, to keep other areas' products untouched; the only selection was the QA products).
- Moderation appeal (« Contester ») and « Resoumettre »: the refused products belong to the shop's history (appeal window over); the QA products are only pending.
- Plan-limit dialog (the shop's plan is unlimited: « 32 + 2 ≤ ∞ »), offline state, 409 conflict dialog (not reproducible in one session: the edit page adopts the newer version on focus), XLSX / XLS import files (CSV only), unit « in use » delete (the only used unit belongs to the shop).
- Roles (admin / operator) — covered by the `roles` area.
