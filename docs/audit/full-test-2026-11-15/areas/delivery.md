# Area delivery — tested 15/11/2026 18:05–18:40 (Africa/Algiers)

Test shop « Boutique Test Équipe », owner account, live https://djaber.vercel.app. QA data created: product « QA delivery colis », orders #CMD-1022 (QA delivery Samir Un → livraison propre → échec → livrée), #CMD-1023 (QA delivery Lina Deux → livraison propre → retournée), #CMD-1024 (QA delivery Nadir Trois, left confirmed). Fee row 50 and the free-delivery threshold were edited and restored (row 50 back to default, threshold off).

### DELIVERY-01 — Fee grid and « Livraison offerte » amounts drop the decimal separator and the minus sign: « 2500,00 » is saved as 250 000 DA, « -5 » as a 5 DA free-delivery threshold
- Page: /fr/delivery/fees (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Grille des frais, row 50 Bordj Badji Mokhtar, DOMICILE cell: type `2500,00`, Tab. 2. Try `1.5`, `-100`, `1e3`. 3. Turn on « Livraison offerte à partir de » and type `-5`, then `12500,50`, then `1.5` in the amount, Tab each time.
- Expected: amounts are integer DZD (04 §2 price rule `validation.price`); a decimal or negative value is refused with an inline message, never silently turned into another number.
- Actual: every non-digit is stripped and the result is saved at once: `2500,00` → PUT `/delivery/fees/50 {"homePrice":250000}` (250 000 DA shown to customers by the AI and the order form), `1.5` → 15 DA, `-100` → 100 DA, `1e3` → 13 DA. The workspace threshold: `-5` → PATCH `/workspace {"freeDeliveryThreshold":5}` (delivery free on almost every order, no warning), `12500,50` → 1 250 050 DA, `1.5` → 15 DA. Only `99999999` gets an error, and only the generic « Vérifiez les champs. ». Same root as ORDERS-01 (money inputs keep digits only). Row 50 and the threshold were restored afterwards.
- Evidence: .local/qa/campaign/delivery/fr-08-row50-after.png · .local/qa/campaign/delivery/fr-10-free-on.png · API: PUT /delivery/fees/50 → 200 (homePrice 250000) · PATCH /workspace → 200 (freeDeliveryThreshold 5)

### DELIVERY-02 — Raw i18n key « validation.url » under the courier instance URL field
- Page: /fr/delivery/couriers › + Ajouter un transporteur › EcoTrack (owner, fr)
- Severity: Major
- Type: Text
- Steps: 1. Transporteurs › « + Ajouter un transporteur » (EcoTrack tab). 2. URL DE L'INSTANCE = `abc` (or `http://qa-delivery.example.invalid`). 3. Enregistrer (or Tester).
- Expected: a French sentence (« Adresse invalide : elle doit commencer par https:// »); 12 GLOBAL « No technical text on merchant screens » (UX-059).
- Actual: red text `validation.url` under the field. The key does not exist in the message catalogue (`deck.*.json` has `validation.required`, `validation.price`… but no `validation.url`).
- Likely cause: apps/web/src/features/delivery/logic.ts:122 returns `'validation.url'`, missing from packages/shared/src/i18n/messages/deck.{fr,ar,en}.json.
- Evidence: .local/qa/campaign/delivery/fr-13-add-invalid.png

### DELIVERY-03 — Tracking panel says « À jour » for parcels the courier does not know (« Suivi introuvable » is never shown)
- Page: /fr/delivery?tab=all › #CMD-1014 › tracking panel (owner, fr)
- Severity: Major
- Type: Bug / Spec gap
- Steps: 1. Toutes › click #CMD-1014 (ZR-000005, Mahdi Amrani, « CRÉÉE · SANS MOUVEMENT » since 25 oct.). 2. Click « Actualiser ». 3. Wait ~10 s.
- Expected: 12 §6 Tracking state « not found » (« Suivi introuvable chez le transporteur »), as the tracking panel code plans (`TRACKING_NOT_FOUND`); the overview filter « Erreur transporteur › Suivi introuvable » already lists these 6 parcels.
- Actual: « Actualisation… » then « DERNIÈRE SYNCHRO MAINTENANT · À jour · prochaine actualisation dans 5 min », while `GET /shipments/01a1737a…` right after returns `lastError: TRACKING_NOT_FOUND`. The sync is queued (202) and the panel only shows « introuvable » when the POST itself answers that code, so the stored error is never displayed — same for the 3 « zr express » parcels whose `lastError` is `COURIER_CREDENTIALS_INVALID`. The row and the panel give no hint either; the merchant sees 9 healthy « Créée » parcels for 21 days.
- Likely cause: apps/web/src/features/delivery/tracking-panel.tsx:46 (not_found only from the sync response, `shipment.lastError` ignored).
- Evidence: .local/qa/campaign/delivery/fr-23-sync.png · API: POST /shipments/01a1737a…/sync → 202, GET /shipments/01a1737a… → lastError TRACKING_NOT_FOUND

### DELIVERY-04 — Courier send says « Aucun transporteur configuré » when two couriers are configured (only deactivated), and the bulk-send button reads « Envoyer 0 vers »
- Page: /fr/delivery (owner, fr)
- Severity: Minor
- Type: Text / Spec gap
- Steps: 1. The shop has two ZR Express accounts, both « INACTIF ». 2. Open Livraison & suivi. 3. Click « Envoyer les confirmées (1) »; also open the row menu of #CMD-1018 (À envoyer).
- Expected: wording that matches the state (« Aucun transporteur actif — activez-en un ou utilisez la livraison propre »); for an owner (`delivery.manage`) the send dialog offers « Configurer un transporteur » on top of the send flow (12 §20 « Send dialog without courier », DLV-05).
- Actual: banner « Aucun transporteur configuré », bulk dialog « Aucun transporteur configuré. · 0 commande prête à l'envoi » with the primary button « Envoyer 0 vers » (dangling « vers », no courier name), no « Configurer un transporteur » action; row menu « Envoyer au transporteur : Aucun transporteur configuré. »; on the order page of #CMD-1024 the LIVRAISON block's « Envoyer au transporteur » is simply disabled (title « Aucun transporteur configuré. »), again without the courier dialog the spec gives the owner.
- Evidence: .local/qa/campaign/delivery/fr-06-bulk-header.png · .local/qa/campaign/delivery/fr-03-menu-CMD-1018.png · .local/qa/campaign/delivery/fr-23-order-1024.png

### DELIVERY-05 — Courier card shows the raw error code « COURIER_CREDENTIALS_INVALID » (and a hint for the wrong credential names)
- Page: /fr/delivery/couriers (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Open Transporteurs. 2. Look at the « zr express » card (last test refused).
- Expected: « Identifiants refusés par ZR Express · vérifiez la clé API / l'ID tenant » (UX-059; the overview filter already has the wording « Identifiants transporteur refusés »).
- Actual: pill « REFUSÉ » + line « COURIER_CREDENTIALS_INVALID · vérifiez le token / la clé »; this account uses « clé API + ID tenant », not token / clé.
- Evidence: .local/qa/campaign/delivery/fr-11-couriers.png

### DELIVERY-06 — Self-delivery (« Livraison propre ») failed parcel: the menu blames a courier pickup and a « courier space » that do not exist
- Page: /fr/delivery?tab=failed (owner, fr)
- Severity: Minor
- Type: Text / UX
- Steps: 1. QA order #CMD-1022 (confirmed) › row menu › « Marquer expédiée (livraison propre) » (tracking QA-DLV-0001). 2. Row menu › « Échec de livraison » › Client absent › Enregistrer. 3. Échecs › row #CMD-1022 › Actions.
- Expected: reasons that fit a parcel the merchant delivers himself; 04 §22 « Change courier … Allowed on a failed send, a parcel queued at Djaber or a manual parcel ».
- Actual: « Relancer la livraison : Relance impossible depuis Djaber chez ce transporteur : demandez une nouvelle tentative dans votre espace transporteur ou appelez-le. » · « Changer de transporteur : Colis déjà ramassé : annulation impossible, utilisez « Retournée ». » · same for « Annuler l'expédition ». No courier ever picked this parcel up and there is no courier space; before the failure « Changer de transporteur » was offered.
- Evidence: .local/qa/campaign/delivery/fr-18-failed-menu.png

### DELIVERY-07 — Row « Dernier événement » always says « TRANSPORTEUR », even for events made in Djaber (the tracking panel says « DJABER » for the same event)
- Page: /fr/delivery?tab=all (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Toutes. 2. Row #CMD-1014: « Expédition créée · 25 OCT. · 21 J · TRANSPORTEUR ». 3. Open its tracking panel: « Expédition créée · 25 OCT. 15:32 · DJABER ». 4. Row #CMD-1018: « Expédition annulée · 16:35 · TRANSPORTEUR » (the parcel was cancelled by a member in Djaber).
- Expected: the event source (12 §6 Tracking « events with source »), the same in the row and the panel.
- Actual: the row prints « transporteur » whenever the parcel has a courier account.
- Likely cause: apps/web/src/features/delivery/overview.tsx:128 (`sh.courierAccount ? byCourier : djaber`).
- Evidence: .local/qa/campaign/delivery/fr-03-panel-1014.png

### DELIVERY-08 — Filter panel promises « LES KPI SUIVENT LES FILTRES » but the KPI tiles never change
- Page: /fr/delivery?tab=all (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Filtres › Transporteur « Mahdi Amrani » + Erreur transporteur « Suivi introuvable » › « Afficher 6 commandes ». 2. Read the tiles.
- Expected: the tiles follow the filters, as the panel header says.
- Actual: list = 6 rows, tiles unchanged (« EN ATTENTE DE RAMASSAGE 9 », « 2 LIVRÉES », « 2 RETOURNÉES »…); `GET /delivery/overview` is called without the filter params.
- Evidence: .local/qa/campaign/delivery/fr-24-filters-applied.png · .local/qa/campaign/delivery/fr-04-filters.png

### DELIVERY-09 — « Coût transporteur » column shows the test-driver rates (400 + wilaya % 10 × 50) of a deactivated courier
- Page: /fr/delivery/fees (owner, fr)
- Severity: Minor
- Type: Bug (data)
- Steps: 1. Grille des frais. 2. Read COÛT TRANSPORTEUR: Adrar 450, Chlef 500 … Blida 850, Bouira 400, Tamanrasset 450 …
- Expected: the default courier's real cached rates, or « — » when the default courier is inactive / has no real rates (DLV-07).
- Actual: the values follow exactly the fake courier formula (apps/api/src/modules/delivery/adapters/fake-courier.ts:140 `400 + (wilayaId % 10) * 50`): the rate cache of « Mahdi Amrani » (Procolis, INACTIF) was filled by the fake driver (its 6 parcels ZR-000001…5 also carry fake tracking numbers, « Suivi introuvable » since 25 oct.). The merchant reads them as real costs / margins.
- Evidence: .local/qa/campaign/delivery/fr-07-fees.png

### DELIVERY-10 — Turning on « Livraison offerte » immediately saves a 5 000 DA threshold the merchant never typed
- Page: /fr/delivery/fees (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Grille des frais. 2. Click the « Livraison offerte à partir de » switch.
- Expected: the switch enables the amount field; the rule applies once an amount is entered (the AI and the order form apply it at once, 04 §2 deliveryFee).
- Actual: PATCH `/workspace {"freeDeliveryThreshold":5000}` is sent on the click; for the time the merchant types his amount, every order ≥ 5 000 DA is quoted with free delivery. (Restored to off after the test.)
- Evidence: .local/qa/campaign/delivery/fr-10-free-on.png · API: PATCH /workspace → 200

### DELIVERY-11 — Default sort « dernière mise à jour transporteur ↓ » puts today's parcels at the bottom of « Toutes »
- Page: /fr/delivery?tab=all (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Toutes (default sort). 2. Compare the « DERNIER ÉVÉNEMENT » column.
- Expected: newest activity first (the column header is « Dernier événement »).
- Actual: rows from 25–26 Oct first; #CMD-1018 (16:35 today) and #CMD-1017 (16:28 today), then the new QA parcels, last — the sort key is `lastSyncedAt` (null for manual / never-synced parcels), not the last event.
- Evidence: .local/qa/campaign/delivery/fr-06-selection.png · API: GET /shipments?sort=-lastSyncedAt

### DELIVERY-12 — Unknown `?job=` opens two error surfaces at once; bad `?sheet=` shows « Chargement… Chargement… » next to the error
- Page: /fr/delivery?job=00000000-0000-0000-0000-000000000000 and /fr/delivery?tab=all&sheet=not-a-uuid (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Open the first URL. 2. Open the second URL.
- Expected: 12 §20 « Delivery deep links »: a bulk-send job ⇒ results dialog, other jobs ⇒ one job banner (« gone » state); a parcel that does not exist ⇒ one « introuvable » state.
- Actual: 1) banner « Cette tâche n'est plus disponible (expirée ou supprimée). » AND the dialog « Envoi groupé — résultats par commande … Introuvable ou accès refusé. » on top. 2) panel « Chargement… Chargement… Impossible de charger · Requête invalide. · Réessayer » (API GET /shipments/not-a-uuid → 400 BAD_REQUEST; « Réessayer » can never succeed).
- Evidence: .local/qa/campaign/delivery/fr-20-deeplink-job.png · .local/qa/campaign/delivery/fr-20-deeplink-sheet.png

### DELIVERY-13 — Search with no result: « Aucun(e) expédition ne correspond à « les filtres actuels ». »
- Page: /fr/delivery?tab=all&q=zzzz (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Livraison › Toutes. 2. Search `zzzz`.
- Expected: « Aucune expédition ne correspond à « zzzz ». » (the fee grid does it right: « Aucune wilaya ne correspond à « zzz ». »).
- Actual: « Aucun(e) expédition ne correspond à « les filtres actuels ». » — generic « Aucun(e) » and the placeholder phrase quoted as if it were the search.
- Evidence: .local/qa/campaign/delivery/fr-05-search-empty.png

### DELIVERY-14 — Parcels CSV export writes « Point relais » as 0 / 1
- Page: /fr/delivery?tab=all › selection › « Exporter CSV » (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Select #CMD-1022 and #CMD-1014. 2. Exporter CSV › Télécharger.
- Expected: « Oui » / « Non » like the other human-readable columns (statut « LIVRÉE », motif « INJOIGNABLE »).
- Actual: `CMD-1022,…,Centre,0,Livraison propre…` / `CMD-1014,…,Setif,1,Mahdi Amrani…`.
- Evidence: livraisons-2026-11-15.csv (GET /delivery/export?ids=…&format=csv → 200)

### DELIVERY-15 — English word « stale » in the French UI (page subtitle and filter chip « Stale (30 j) »)
- Page: /fr/delivery and its Filtres panel (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Open Livraison & suivi; read the subtitle. 2. Filtres › ÉTAT D'EXPÉDITION.
- Expected: French wording (« sans nouvelles », « inactif 30 j »).
- Actual: « sans mouvement 30 j ⇒ « stale » (ou « Actualiser », 1 / 5 min) » and the chip « Stale (30 j) ».
- Evidence: .local/qa/campaign/delivery/fr-01-overview.png · .local/qa/campaign/delivery/fr-04-filters.png

### DELIVERY-16 — « Supprimer le transporteur » blocked dialog tells the merchant to deactivate a courier that is already inactive; the edit dialog says « Pas encore testé » for a courier tested 2 h ago
- Page: /fr/delivery/couriers (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Card « Mahdi Amrani » (INACTIF) › Supprimer. 2. Card « zr express » (« TESTÉ IL Y A 2 H · REFUSÉ ») › Modifier.
- Expected: « Impossible : 6 expéditions en cours ; il sera supprimable quand les colis seront livrés ou retournés. » (no « Désactivez-le » when it is inactive); the edit dialog shows the last test result.
- Actual: « Impossible : 6 expéditions en cours. Désactivez-le pour empêcher de nouveaux envois … »; edit dialog « TEST DE CONNEXION · Pas encore testé ».
- Evidence: .local/qa/campaign/delivery/fr-14-delete.png · .local/qa/campaign/delivery/fr-14-edit-zrapp.png

### DELIVERY-17 — Phone (390 px): the fee-grid search box is squeezed to an icon-sized field
- Page: /fr/delivery/fees (owner, fr, 390 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open Grille des frais at 390 px wide.
- Expected: full-width search field (« Rechercher une wilaya… »), the buttons on the next line.
- Actual: the search field is ~70 px wide next to « Compléter les manquants », its placeholder is invisible; the rest of the page fits (no horizontal page scroll).
- Evidence: .local/qa/campaign/delivery/fr-21-fees-390.png

### DELIVERY-18 — Arabic: row last-event line cut to « 21 ي · شركة », status pill « تم الإنشاء » wraps on two lines
- Page: /ar/delivery?tab=all (owner, ar, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Open the delivery list in Arabic.
- Expected: « منذ 21 يومًا · شركة التوصيل » on one line, pills on one line.
- Actual: « 25 أكتوبر · 21 ي · شركة » (« ي » is not an Arabic abbreviation of يوم, « التوصيل » is cut), the « CRÉÉE » pill breaks into « تم / الإنشاء ». The panel also says « DJABER » in Latin capitals where the menus say « جابر ».
- Evidence: .local/qa/campaign/delivery/ar-21-overview-1440.png

## Coverage
- **Livraison & suivi (/delivery)** — fr 1440: KPI tiles, « Aucun transporteur » card and its two links, all 6 tabs (Échecs, Sans mouvement, À envoyer, En transit, Retours, Toutes) + unknown `tab=`, search (n°, tracking, name, phone with / without spaces, Arabic, emoji, SQL-like, no result), filter panel (status, courier account, mode, wilaya list, order status, last event, failure reason, courier error, period; « Afficher n », F5 keeps the filters, URL filters on full load), sort N° ↑↓ / dernier événement, page size, selection bar (send / bordereaux / actualiser / export CSV / livraison propre / tout sélectionner), « Envoyer les confirmées » bulk dialog, row `Actions ⌄` of every parcel state (créée Procolis, créée ZR app, livrée, annulée/à envoyer, retournée, échec manuel) with greyed reasons, tracking panel (timeline, Actualiser → actualisation / à jour / 1 per 5 min countdown in the menu, Copier, Ouvrir public link, Précédent / Suivant, ESC, back), dialogs Échec de livraison (required reason), Marquer livrée (amount ≠ total without reason, future date), Marquer retournée, Bordereau (Djaber A6 PDF), Bordereaux groupés, Marquer expédiée (livraison propre, Arabic / emoji / 120-char tracking), deep links `?order=`, `?ids=&sheet=`, bad `sheet=`, unknown `job=`; public tracking page `/s/<code>` of a QA parcel.
- **Full QA parcel flow** (own data): confirmed → livraison propre → échec (Échecs tab + KPI « à traiter aujourd'hui » + attempt 1/3) → livrée manuellement (leaves Échecs) ; confirmed → livraison propre → retournée (Retours tab, KPI 30 j).
- **Grille des frais (/delivery/fees)** — inline edit (valid, empty, 0, negative, decimals with , and ., spaces, 99 999 999, letters, Arabic digits, `1e3`), Enter / Tab / Escape, active toggle off/on (« Non desservie »), row reset ↺ (and its disabled tooltip on a default row), wilaya search (fr, ar, code, accents, no result), « Compléter les manquants » (toast « grille complète »), « Tout réinitialiser » dialog (cancel), « Copier depuis un transporteur » (disabled, reason in title), free-delivery switch + amount (invalid values, F5, off).
- **Transporteurs (/delivery/couriers)** — cards, add dialog (EcoTrack / Yalidine / ZR Express new + Procolis / Livraison propre tabs, required fields, https rule, phone normalisation, long name, Arabic + emoji address, Tester, Enregistrer → blocked), leave guard (« Quitter sans enregistrer ? »), edit dialogs of both ZR accounts (masked credentials, Tester / Enregistrer → blocked, Annuler), Supprimer (blocked dialog, not confirmed), card « Tester » (blocked), auto-send switch (blocked, inline error shown).
- **Locales / sizes** — ar (RTL) 1440 and 390, en 1440, fr 390 for the three screens + row menu; no horizontal page scroll found at 390 px (tables scroll inside their card, the list becomes cards).

## Blocked by safety
- POST /shipments/bulk/ship-manual (bulk « Marquer expédiées (livraison propre) ») — done one by one instead.
- POST /delivery/couriers (add EcoTrack « QA delivery EcoTrack », https://qa-delivery.example.invalid).
- POST /delivery/couriers/:id/test (card « Tester » and dialog « Tester », both ZR accounts).
- PATCH /delivery/couriers/:id (edit « zr express » display name).
- PATCH /workspace `{"autoSendToCourier":true}` (auto-send switch).

## Not tested
- « Activer » on the two ZR Express cards, « Définir par défaut », confirming « Supprimer » (README rule 2b: the real accounts stay deactivated).
- Real courier send / change courier / cancel parcel / « Relancer la livraison » on the ZR parcels (would reach ZR Express; the kit does not block POST /shipments/:id/cancel, so it was deliberately not clicked).
- « Tout réinitialiser » confirm and « Copier depuis un transporteur » diff preview: the reset would wipe the custom rows 19 / 31 / 33 set by other testers; copy needs an active courier with rates.
- Send dialog with an active courier (stop-desk select, rates, weight, per-order results, `?job=` of a real bulk send): no active courier allowed.
- Admin / operator read-only views of the three screens (area « roles »).
