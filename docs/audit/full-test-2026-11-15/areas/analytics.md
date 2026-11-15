# Area analytics — tested 15/11/2026 from 18:46 (Africa/Algiers)

Owner account, shop « Boutique Test Équipe », live https://djaber.vercel.app. Finished 15/11/2026 (phone 390 px pass, English reports and closing sections added by a second run).

### ANALYTICS-01 — « Traitées par l'IA » and agent « Autonomie » are negative (−166,7 %, −300 %, −125 %): more « escaladées » than conversations
- Page: /fr/analytics (Vue d'ensemble), /fr/analytics/conversations, /fr/analytics/agents, /fr/analytics/channels (owner, fr / ar / en, 1440 px), periods 30 j, Mois dernier, Trimestre, Année
- Severity: Major
- Type: Bug
- Steps: 1. Open Statistiques, period 30 j. 2. Look at the CONVERSATIONS tile, then the Conversations, Agents and Canaux tabs.
- Expected: a share between 0 % and 100 % (ANA-02 « AI gauges → Responses / Agents »); « escaladées » counts the conversations of the period that were handed to a human, so it is never larger than CONVERSATIONS.
- Actual: CONVERSATIONS **3** · « **8 escaladées** » · « **-166,7 %** traitées par l'IA ». Conversations tab: « -166,7 % TRAITÉES PAR L'IA », « 8 transferts », table « Test dsqezadsq (FB) 3 · -166,7 % · 8 ». Agents tab: « **-125 %** AUTONOMIE MOYENNE », row « Pro Seller 1 conv. · **-300 %** ». Canaux tab: « -166,7 % IA » under CONV. FB. The handoff count is the number of distinct conversations with a handoff AI run **per day**, summed over the days, and it includes conversations created before the period, while CONVERSATIONS counts only conversations created in the period; the % is `(created − handoffs) ÷ created`.
- Likely cause: apps/api/src/modules/analytics/day-metrics.ts:215-219 (handoffs = `count(DISTINCT conversationId)` per day, not limited to the period's conversations) and analytics.service.ts:250 / 284 / 303 / 377 (`pct(created − handoffs, created)` with no clamp).
- Evidence: .local/qa/campaign/analytics/fr-01-overview.png · API: GET /analytics/overview?period=30d → `conversations.value 3, hint.aiHandledPct -166.7, handoffs 8`; GET /analytics/agents → `autonomy.value -125, "Pro Seller": -300`

### ANALYTICS-02 — « Paiements » report counts the money of cancelled sales and purchases: « ENCAISSÉ 326 522 DA » vs « 19 722 DA ENCAISSÉS » in Statistiques
- Page: /fr/reports/payments, /fr/analytics, /fr/reports/profit_loss (owner, fr, 1440 px, period 30 j)
- Severity: Major
- Type: Bug
- Steps: 1. Rapports › Paiements, period 30 j. 2. Compare with Statistiques › Vue d'ensemble « DA ENCAISSÉS » and Rapports › Journal de caisse.
- Expected: 04 §4 « Cash collected = Σ Order.amountPaid + Σ Sale.amountPaid (completed counter sales) — the same money as Caisse and the « Paiements » report (UX-052) ». A cancelled and refunded sale is not money collected.
- Actual: Paiements shows « 326 522 DA ENCAISSÉ » (Espèces 343 002 DA · 95 %). It lists « 19 oct., 11:49 · Vente · VNT-1003 · Client de passage · Espèces · Encaissement · 300 000 » and « VNT-1007 · 6 500 » — both sales are **cancelled** (`status: cancelled`, VNT-1003 refunded 300 000 DA in the cash journal « Vente #VNT-1003 annulée (remboursement) »), and the refunds are not listed. It also lists ACH-1010 (cancelled purchase) « 1 000 » in « PAYÉ 33 860 », and Marges & rentabilité shows « Achats payés (info) 33 860 » while Achats par fournisseur / par période show « PAYÉ 32 860 ». Statistiques says « 19 722 DA ENCAISSÉS », the Journal de caisse « 378 874 DA ENTRÉES ». Three different « encaissé » amounts for the same 30 days.
- Evidence: .local/qa/campaign/analytics/fr-10-reports-hub.png · API: GET /reports/payments?period=30d → `kpis.received 326522`, row `VNT-1003 amount 300000`; GET /sales/01a15390-… → `status: cancelled, amountPaid: 300000`; GET /purchases/01a1e064-… (ACH-1010) → `status: cancelled, amountPaid: 1000`

### ANALYTICS-03 — « DA REVENUS » differs between reports for the same period (19 722 vs 23 692): product / category reports ignore discounts and delivery fees
- Page: /fr/reports/sales_by_period vs /fr/reports/sales_by_product, sales_by_category, top_products (owner, fr, period 30 j)
- Severity: Minor
- Type: Bug
- Steps: 1. Rapports › Ventes par période: « 19 722 DA REVENUS ». 2. Ventes par produit / Ventes par catégorie / Produits les plus vendus: « 23 692 DA REVENUS ».
- Expected: 04 §4 « Named figures (used verbatim in every KPI label): Revenue = Σ Sale.total + Σ Order.total (delivered) ». A sum of line amounts before discounts is another figure and needs another label (for example « Ventes brutes (avant remises) »), or the discounts are shown as a separate line.
- Actual: the product reports sum line amounts before document discounts (23 692 − 5 020 remises + 1 050 frais = 19 722). VNT-1002 (100 % discount, total 0 DA) still gives « Pantalon … 4 500 DA · marge 100 % ». Statistiques › Produits uses the same gross amounts (« 4 500 DA · TOP PRODUIT »).
- Evidence: API: GET /reports/sales_by_period → revenue 19722; GET /reports/sales_by_product → revenue 23692; GET /reports/discounts → 5 020 (VNT-1002 100 %)

### ANALYTICS-04 — Period chip and « Personnalisé » button drop the start year: a 2-year range reads « 14 NOV. → 15 NOV. 2026 »
- Page: /fr/analytics/orders?period=custom&from=2024-11-14&to=2026-11-15 (owner, fr, 1440 px); same on every tab
- Severity: Minor
- Type: Bug
- Steps: 1. Statistiques › Personnalisé. 2. DU 14/11/2024, AU 15/11/2026 (732 days, accepted). 3. Appliquer.
- Expected: the start year is shown when it differs from the end year (« 14 nov. 2024 → 15 nov. 2026 »).
- Actual: the chip says « 14 NOV. → 15 NOV. 2026 · COMPARÉ À LA PÉRIODE PRÉCÉDENTE » and the custom button « 14 nov. → 15 nov. » (no year at all), which reads like a 2-day period. Same with the URL `?from=2020-01-01&to=2026-11-15`: « 01 janv. → 15 nov. ».
- Likely cause: apps/web/src/features/analytics/shell.tsx:100 (`dayLabel(range.from, locale)` without year; the custom button label has none on either side).
- Evidence: .local/qa/campaign/analytics/fr-05b-732.png · API: GET /analytics/orders?from=2024-11-14&to=2026-11-15 → 200

### ANALYTICS-05 — Raw English codes on French / Arabic screens: languages, AI intents, expense categories
- Page: /fr/analytics/conversations, /fr/analytics/responses, /fr/reports/expenses (owner, fr — see ar / en in Coverage)
- Severity: Minor
- Type: Text
- Steps: 1. Statistiques › Conversations: line « langues : … ». 2. Réponses IA › « Par intention ». 3. Rapports › Dépenses › column CATÉGORIE.
- Expected: every value in words of the screen language (rule 7 « every string an i18n key »; 12 GLOBAL « No technical text on merchant screens », UX-059).
- Actual: « langues : **en** 60,5 % · **arabizi** 22,4 % · **fr** 16,3 % · **mixed** 0,7 % »; intents « **sale** 73 · **info** 37 · **greeting** 13 · **other** 11 · **complaint** 8 · **tracking** 5 »; expense categories « **shipping** », « **rent** », « **packaging** », « **marketing** » (the cash journal translates the same categories: « Frais », « Achat »…). The kit's leak rules do not catch single lower-case words, so they were checked by eye.
- Evidence: .local/qa/campaign/analytics/ (text dumps in scripts/out-11-fr.txt) · API: GET /analytics/responses → `byIntent[].intent: "sale"…`; GET /reports/expenses → `category: "shipping"`

### ANALYTICS-06 — « Top wilayas (commandes livrées) » is sorted by orders, so a wilaya with 0 delivered comes first
- Page: /fr/analytics (Vue d'ensemble) (owner, fr, 30 j)
- Severity: Minor
- Type: Bug
- Steps: 1. Statistiques › Vue d'ensemble, card « Top wilayas (commandes livrées) ».
- Expected: the order follows the figure in the title (delivered orders), or the title says « commandes » and the row shows the orders count.
- Actual: rows « 19 Sétif **0 · 0 %** », « 16 Alger 1 · 33,3 % », « 09 Blida 0 · 0 % », « 31 Oran 0 · 0 % », « 03 Laghouat 0 · 0 % ». Sétif has 8 orders and 0 delivered; the API sorts by `orders` and the card shows `delivered`. M'Sila (1 delivered, 100 %) is not in the top 5 at all.
- Evidence: .local/qa/campaign/analytics/fr-01-overview.png · API: GET /analytics/overview → `topWilayas[0] = {name:"Sétif", orders:8, delivered:0}`

### ANALYTICS-07 — Order and return counts that do not match between cards (manual + import, returned %)
- Page: /fr/analytics (Par canal · agent), /fr/analytics/orders, /fr/analytics/delivery (owner, fr, 30 j)
- Severity: Minor
- Type: Bug
- Steps: 1. Vue d'ensemble › « Par canal · agent ». 2. Commandes tab. 3. Livraison tab.
- Expected: one definition per figure, and links that open the counted rows (ANA-02 « tables clickable to filtered lists »).
- Actual: « Manuel (opérateurs) **14** cmd » links to `/orders?source=manual&…`, but the Commandes tab splits it into « Manuel 13 · 2 400 DA » + « Import 1 · 0 DA »; the imported order is counted as manual on the overview. « **50 %** RETOURNÉES · 2 retours » on the Commandes tab (2 ÷ (2 delivered + 2 returned)) while the overview says « 15,4 % taux de livraison sur 13 expédiées · 2 retours » (÷ shipped) and Livraison says « Livraison propre … 66,7 % » retours; none of the tiles says what the % is of. The funnel « Conversations 3 → Avec intention d'achat 1 → Commandes créées 23 » mixes AI and manual orders, so the « funnel » grows from step 2 to step 3.
- Evidence: .local/qa/campaign/analytics/fr-01-overview.png · API: GET /analytics/orders → `bySource: ai 9, manual 13, import 1`, `returnedPct 50`; GET /analytics/overview → `byChannel[1] = {channelId:null, orders:14}`

### ANALYTICS-08 — Rounded or capped values shown as real values: « médiane 100 messages / conversation · p95 100 », « p95 2 880 min »
- Page: /fr/analytics/conversations (owner, fr, 30 j)
- Severity: Cosmetic
- Type: Bug
- Steps: 1. Statistiques › Conversations.
- Expected: real median / p95 (502 messages for 3 conversations), or « > 50 » when only a histogram bucket is known; long durations in hours (« 48 h »).
- Actual: « médiane **100** MESSAGES / CONVERSATION · p95 100 »: 100 is the `over` value of the last histogram bucket (> 50), not a measured value. Human reply time « 5 min · p95 **2 880 min** ».
- Likely cause: apps/api/src/modules/analytics/day-metrics.ts:57 (`msgPerConv … over: 100`) used by `median()` / `percentile()` in analytics.service.ts:290.
- Evidence: API: GET /analytics/conversations?period=30d → `messagesPerConversation {value:100, hint:{p95:100}}`, `humanResponseTime.hint.p95 2880`

### ANALYTICS-09 — Plurals, decimal separators and per-row status words
- Page: /fr/analytics, /fr/recommendations (all views) (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Statistiques › Aujourd'hui / 7 j. 2. Recommandations (cards, KPIs, Historique, Ventes croisées).
- Expected: French plural rules (1 commande, 0 crédit) and the decimal comma (rule 11 « Latin digits, `12 500 DA` », Intl number format of the locale).
- Actual: « 3 ventes + **1 commandes livrées** », « **0 crédits** / jour », « **1 réceptions** en retard sur 2 », « 5 APPLIQUÉES · **1 IGNORÉES** · 4 EXPIRÉES », « **1 IMPRESSIONS** »; decimals with a point: « Marge **33.8 %** < objectif 35 % », « **45.5 %** TAUX D'APPLICATION · 30 J », « **$3.77** COÛT IA (USD) », « $0.02 ». Historique: a single row's status reads « APPLIQUÉES » / « IGNORÉES » / « EXPIRÉES » (plural filter labels reused as row pills).
- Likely cause: apps/api/src/modules/recommendations/stock-reco.engine.ts:153 (body text built on the server with the raw number `${margin}`).
- Evidence: .local/qa/campaign/analytics/fr-33-reco-menu.png · fr-39-reco-ignored.png

### ANALYTICS-10 — « Journal de caisse » report shows older cash rows in French on English / Arabic screens
- Page: /en/reports/cash_register (owner, en, 1440 px); same rows in /ar
- Severity: Minor
- Type: Text
- Steps: 1. Switch to English. 2. Reports › Cash journal, period 30 d.
- Expected: every row label in the reader's language (07-architecture §4 « Language source »: stored texts are rendered in the reader's language; UX-056). The Cash page shows the recent rows in English (« Purchase #ACH-1010 (supplier payment) »).
- Actual: the October rows read « Correction: Achat #ACH-1005 (paiement) », « Achat #ACH-1002 (paiement fournisseur) », « Vente #VNT-1003 », « Commande #CMD-1003 livrée (COD) », « Correction: Vente #VNT-1004 », and the expense row category « fuel ». Rows written after UX-056 are translated (« Order #CMD-1026 returned (return fee) »), so the old rows were never converted to the stored-text format.
- Likely cause: rows written before UX-056 hold a plain French sentence; `renderStoredText` (packages/shared/src/i18n/stored-text.ts:43) returns text without the `§` mark as typed text, and apps/api/src/modules/gds/reports/definitions.ts:503 has no fallback for them (no data migration).
- Evidence: .local/qa/campaign/analytics/en-en-cash-register-report.png · scripts/out-11-en.txt · API: GET /reports/cash_register?period=30d → 200

### ANALYTICS-11 — Restock card « Stock -6 · ventes 7 / 30 j → rupture dans ~0 jours » for a product already out of stock
- Page: /fr/recommendations (owner, fr, 390 px and 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Stock › Recommandations. 2. Card « RÉAPPROVISIONNER · HAUTE · casquette ».
- Expected: a product with stock ≤ 0 is already out of stock: the card says so (for example « En rupture — 6 unités vendues sans stock ») instead of announcing a future stock-out « dans ~0 jours ».
- Actual: « Stock -6 · ventes 7 / 30 j → rupture dans ~0 jours. »
- Likely cause: apps/api/src/modules/recommendations/stock-reco.engine.ts:89-104 (`daysLeft = max(0, stock) / perDay`, one sentence for every case).
- Evidence: .local/qa/campaign/analytics/fr-phone-reco-menu.png

### ANALYTICS-12 — Phone 390 px: KPI hints and labels cut with « … », no way to read them (one also on desktop)
- Page: /fr/analytics, /analytics/agents, /orders, /delivery, /consumption, /products, /responses; /fr/reports, /fr/reports/cash_flow (owner, fr / ar / en, 390 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open Statistiques on a 390 px phone. 2. Read the small line above / below each KPI value and the long labels.
- Expected: text wraps on the phone, or the full text is reachable (tap / title) — these hint lines carry real figures.
- Actual (visible / full width in px): Agents tile « pedro 2 50 % · Pro Seller… » 147/728 (also cut on desktop, 249/728: 2 of 5 agents readable); Livraison « Mahdi Amrani 7 · Livraison propre 4 · zr… » 147/280; Commandes « 15,4 % des expédiées · COD 1… » 147/179 and reasons « Faux numéro / commande bl… » 117/185; Consommation « entrée 2 831 094 · sortie 1… » 147/185; Vue d'ensemble « 10 ventes + 2 commandes l… »; Réponses IA « texte 147 · image 0 · voc… »; product names in Top produits; reports hub recent export « Top clients · 17 Oct → 15 Nov · XLSX » 63/225; report title « Encaissements vs déca… ». Only two of these carry a `title` (and a phone has no hover). Same in ar and en. No horizontal page scroll anywhere (page width = 390 px on every screen).
- Evidence: .local/qa/campaign/analytics/fr-phone-clip_analytics_agents.png · fr-phone-clip_reports_cash_flow.png · fr-phone-_analytics.png

### ANALYTICS-13 — Cross-sell rule « SCORE (0–100) »: -1 and 101 are saved as 1 and 100 without a message
- Page: /fr/recommendations?view=cross › « + Règle manuelle » (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Ventes croisées › + Règle manuelle (QA analytics marge faible → QA analytics accessoire). 2. Score « -1 » (then « 101 »). 3. Enregistrer.
- Expected: an inline field error « entre 0 et 100 » with the form kept (rule 8 « shown inline inside dialogs; form content preserved »).
- Actual: the dialog closes and the rule is saved with score **1** (typed « -1 ») and **100** (typed « 101 »); nothing tells the merchant the value changed.
- Evidence: .local/qa/campaign/analytics/scripts/out-27.txt, out-27b.txt (QA rules deleted afterwards: DELETE /recommendations/{id} → 204)

## Coverage
Owner, shop « Boutique Test Équipe », live site.
- **Statistiques** (/analytics): all 9 tabs (Vue d'ensemble, Conversations, Réponses IA, Consommation, Agents, Canaux, Produits, Commandes, Livraison); every period preset (Aujourd'hui, 7 j, 30 j, Ce mois, Mois dernier, Trimestre, Année); Personnalisé (valid, end before start, > 732 days, exactly 732 days, empty, bad URL values); « Page : » filter; « Comparer » (période précédente / aucune); chart toggle and hover; links to filtered lists (Manuel → /orders). fr + ar (RTL) + en at 1440 px; fr + ar + en at 390 px (all 9 tabs and the period picker).
- **Rapports**: hub (search fr / upper case / Arabic / spaces / no result, recent exports, job banner, expired job link, unknown report URL); all **23 reports** in fr and en at 1440 px (ar at 1440 px: sales_by_period, profit_loss, expenses, payments, inventory_variances) and all 23 at 390 px in fr and ar; report UI: filters, table search, sort, pagination, favourite on / off, export CSV / XLSX (background job + download) / PDF, copy link, monthly e-mail schedule (bad e-mail, empty, valid, re-open, unschedule), period errors (end < start, > 732 days, custom without dates), snapshot report with no data; at 390 px the export menu, schedule dialog and period popover; tables scroll inside their own box on the phone (991 px table in a 356 px scroller).
- **Recommandations**: Recommandations view (KPIs, type chips, Priorité / Catégorie / Statut filters, card Actions menu, « Modifier le prix » dialog with -5 and a valid price on the QA product, Ignorer, Rappeler dans 7 j, title link), Régénérer maintenant (+ 10-minute limit), Historique, Ventes croisées (sort headers, active switch, + Règle manuelle: empty, same product twice, duplicate rule, score limits, edit, delete, Esc / Annuler / X), « Générer ». fr at 1440 px, ar / en at 1440 px (read), fr + ar + en at 390 px (layout, card menu, Priorité menu, rule dialog).
- Data created: products « QA analytics marge faible », « QA analytics accessoire »; manual cross-sell rules (deleted); one monthly schedule on top_customers (removed).

## Blocked by safety
- None: the kit stopped no call in this area (`blocked` empty in every run). Report schedules used `qa-analytics@test.djaber.local` only.

## Not tested
- The scheduled monthly e-mail itself (sent by the worker on the chosen day; not waited for).
- Exports > 5 000 rows (the shop has far fewer rows); the background-job path was seen only through XLSX.
- Recommendation states that need the nightly run (expiry), and applying a price on pre-existing products (only on the QA product).
- Arabic at 1440 px for the 18 other reports (ar at 390 px covered all 23; same components).
- Admin / operator views of these screens: area `roles`.
- The product name « Sac test mod�ration » (broken character) in the cross-sell table is another tester's data; left to area `products`.

