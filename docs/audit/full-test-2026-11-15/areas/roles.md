# Area roles — tested 15/11/2026 19:53–20:40 (Africa/Algiers)

Admin (`admin@test.djaber.local`) and operator (`operateur@test.djaber.local`) accounts of « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`), compared with the owner and with the permission matrix (`docs/specs/02-actors-roles.md` §3, `packages/shared/src/permissions.ts`). Scripts and raw outputs: `.local/qa/campaign/roles/scripts/`, `.local/qa/campaign/roles/*.txt`.

Test data (all « QA roles … »): product « QA roles produit » (PRD-6L96XRDF, created by the admin, 2 500 DA, stock 20); order CMD-1026 for client « QA roles client operator » (0661 23 45 98) created by the operator, then delivered (operator) and returned (admin). Note: C: had 0 MB free during the run; scripts were run with TEMP on G: (no impact on the findings).

### ROLES-01 — Operator can sell at any price: the line unit price is editable and accepted, although discounts and fee changes are Admin+
- Page: /fr/orders/new and /fr/orders/[id] › Articles « Modifier » (operator, fr, 1440 px); API PATCH /orders/:id
- Severity: Major
- Type: Security
- Steps: 1. Sign in as operator. 2. Nouvelle commande › add « QA roles produit » (catalogue price 2 500 DA). 3. Type 1 000 in the line price field › Enregistrer la commande. 4. On the order, change the line again to 1 DA (UI « Modifier » articles, or `PATCH /orders/:id { items:[{productId, quantity:1, unitPrice:1}], version }`).
- Expected: an operator cannot lower what the customer pays: discount, line discount and delivery fee are Admin+ (02 §3 « orders: edit delivery fee/discount … Owner/Admin only », `UpdateOrderSchema` « deliveryFee / discount override = orders.money »); a unit-price override is a discount by another name, so it needs `orders.money` too (or the price field is read-only for the operator, like the discount field which is already hidden for them).
- Actual: `POST /orders` body `"items":[{…,"quantity":1,"unitPrice":1000}]` → 201 (CMD-1026 created at 1 000 DA instead of 2 500 DA); `PATCH /orders/:id {items:[{unitPrice:1}]}` → 200, subtotal 1 DA, total 401 DA. In the same session `PATCH {discount:300}` → 403 FORBIDDEN, `PATCH {deliveryFee:0}` → 403, `PATCH {items:[{…,discount:900}]}` → 403. So the rule is enforced for the discount fields only and is bypassed through the price.
- Evidence: .local/qa/campaign/roles/fr-operator-neworder-filled.png · .local/qa/campaign/roles/op-order.out · op-order-api.out · API: PATCH /orders/01a1e09e-… {items unitPrice 1} → 200 · Likely cause: apps/api orders service checks `orders.money` only for `discount` / `deliveryFee` / line `discount`, not for `unitPrice` ≠ catalogue price.

### ROLES-02 — Lowering an order total silently lowers « Montant payé » below a payment already recorded (1 400 DA cash row, paid shown 401 DA, no history line, no refund)
- Page: /fr/orders/[id] (operator, fr, 1440 px) — found while testing ROLES-01, belongs to the orders money rules
- Severity: Major
- Type: Bug
- Steps: 1. Order CMD-1026, total 1 400 DA, record « payé 1 400 DA » (operator, `PATCH {amountPaid:1400, paymentStatus:"paid"}` → 200). 2. Change the line price so that the total becomes 401 DA (`PATCH {items:[…unitPrice:1]}` → 200). 3. Open the order.
- Expected: money already received is never rewritten silently: either the edit is refused (`ORDER_PAYMENT_LOCKED`-like) or an overpayment / refund due is shown and logged (04 §1.4 payments, history of every money change).
- Actual: « MONTANT PAYÉ 401 DA · RESTE 0 DA » while the payment list still shows « Espèces · 15 NOV. 2026 · YACINE T. · 1 400 DA »; the history has « Montant payé : 0 → 1400 » but no line for 1 400 → 401. 999 DA vanished from the order.
- Evidence: .local/qa/campaign/roles/op-order-api.out (« amountPaid 1400 paid → 200 … paid 1400 » then « items unitPrice 1 → 200 … total 401 paid 401 ») · pm1.out (order page text) · API: PATCH /orders/01a1e09e-… → 200

### ROLES-03 — 403 page on the Owner-only « Zone de danger » tells an Admin « réservée aux admins de l'espace. Votre rôle : Admin. »
- Page: /fr/settings/danger (admin, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Sign in as admin. 2. Open /fr/settings/danger (direct link; the tab is correctly hidden).
- Expected: the 403 text names the role that is required (« réservée au propriétaire de l'espace ») — 12 GLOBAL « 403 page with role explanation ».
- Actual: « 403 · Accès refusé · Cette page est réservée aux admins de l'espace. Votre rôle : Admin. » — contradictory. Same generic text is used for every 403 page whatever the permission (owner-only pages too).
- Evidence: .local/qa/campaign/roles/fr-ad-_settings_danger.png · sweep-admin-fr.json

### ROLES-04 — Export notifications send the operator to « Rapports », a page they are refused (403)
- Page: /fr/notifications › « Tâche terminée : Export » › « Ouvrir › » (operator, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. As operator, /fr/movements › « Exporter CSV » (allowed for the operator, toast « Export terminé · mouvements.csv · Télécharger »). 2. Open Notifications: « Tâche terminée : Export · TÂCHE TERMINÉE ». 3. Click « Ouvrir › ».
- Expected: the notification opens something the member can use (the file download, or the page the export came from); 12 GLOBAL « deep links » never lead a member to a page their role refuses. Reports / export jobs are `reports.read` (Admin+), so a job started by an operator must not link to /reports.
- Actual: link `/fr/reports?job=01a1e0a9-…` → « 403 · Accès refusé · Cette page est réservée aux admins de l'espace. Votre rôle : Opérateur. » (`GET /reports` → 403). Once the toast is gone the operator has no way to get their file (`GET /jobs?kind=export` → 403 for them too).
- Evidence: .local/qa/campaign/roles/fr-operator-movements-export.png · fr-operator-export-notif-target.png · notif-open.out · API: GET /reports → 403

### ROLES-05 — Operator can read and export the whole stock movements journal although the matrix gives movements to Owner / Admin only
- Page: /fr/movements (operator, fr, 1440 px); sidebar « Mouvements »
- Severity: Minor
- Type: Spec gap
- Steps: 1. Sign in as operator. 2. Sidebar › Stock › « Mouvements » (visible). 3. Read the journal (product, qty, before → after, who, references, « 842 988 DA AU COÛT » tile) › « Exporter CSV ».
- Expected: 02-actors-roles §3 « stock: adjust, movements read — Owner ● Admin ● Operator — » (no movements for the operator); route map /movements = `stock.read`. Either the operator loses the page and the export, or the matrix in 02 §3 is updated to say the operator reads movements (and exports them) — today the two documents and the app disagree.
- Actual: the item is in the operator's sidebar, `GET /stock/movements` → 200 and `GET /stock/movements/export` → 202 (CSV produced); only « + Ajuster le stock » / « Contre-passer » are refused. (`stock.read` = every role in packages/shared/src/permissions.ts.)
- Evidence: .local/qa/campaign/roles/fr-operator-movements-export.png · probe-operator.txt (« 200 GET /stock/movements », « 202 GET /stock/movements/export ») · sweep-operator-fr.json (sidebar)

### ROLES-06 — Operator gets the courier accounts (sender phone, credential hints, test results) from the API while the Transporteurs page refuses them
- Page: /fr/delivery/couriers (operator, fr) and `GET /delivery/couriers`
- Severity: Minor
- Type: Security
- Steps: 1. Sign in as operator. 2. Open /fr/delivery/couriers: « 403 · Accès refusé ». 3. Call `GET /delivery/couriers` with the same session (the app itself calls it for the send dialog).
- Expected: the operator only needs the courier names / capabilities to send a parcel; credential hints, sender phone and last test errors are courier settings (02 §3 « delivery: couriers … Owner / Admin »).
- Actual: 200 with every account: `sender {name, phone "0554…", address}`, `credentialHints {"key":"••••XcQh"}` / `{"tenantId":"••••ea2f"}`, `lastTest.error "COURIER_CREDENTIALS_INVALID"`, stats, all `actions` FORBIDDEN.
- Evidence: .local/qa/campaign/roles/probe-operator.txt (« 200 GET /delivery/couriers ») · API: GET /delivery/couriers → 200

### ROLES-07 — Admin can buy credit packs (Chargily checkout) although the matrix gives the Admin read-only billing
- Page: /fr/settings/credits › « Acheter un pack » (admin, fr, 1440 px)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Sign in as admin. 2. Paramètres › Crédits › « Acheter un pack ». 3. Choose « 5 crédits · 450 DA » › « Payer 450 DA (CIB / Edahabia) ».
- Expected: 02-actors-roles §3 « billing: plans, checkout, invoices, credits ledger — Owner ● · Admin R · Operator — »: the Admin reads billing but does not pay. The route map (/settings/credits « buy pack `billing.write` ») and permissions.ts (`billing.write`: owner + admin) say the opposite; one of the documents must be corrected (the plan buttons are already Owner-only: « Réservé au propriétaire de l'espace. »).
- Actual: the button is enabled for the admin, the dialog opens and « Payer 450 DA » sends `POST /credits/packs/checkout` (aborted by the QA kit, so the payment page was not reached). The admin can also edit « Infos de facturation » (`billing.write`).
- Evidence: .local/qa/campaign/roles/fr-admin-buy-pack.png · pack.out · API: POST /credits/packs/checkout → blocked (safety)

### ROLES-08 — Home for the operator: quick actions are greyed « Vous n'avez pas la permission », but « Vos pages › Connecter Facebook » and the « Démarrer » checklist stay active and lead to pages where nothing can be done
- Page: /fr/home (operator, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Sign in as operator. 2. Home: « ACTIONS RAPIDES » cards are greyed with « VOUS N'AVEZ PAS LA PERMISSION. » (good). 3. Click « Connecter Facebook » in « VOS PAGES », or « Connecter une page » / « Configurer votre agent IA » in « DÉMARRER ».
- Expected: same treatment everywhere on the screen (12 rule 7: every control the member cannot use is greyed with its reason, or hidden); the onboarding checklist is the Owner's / Admin's job.
- Actual: « Connecter Facebook » is an active link → /fr/channels where the operator has no connect button; checklist rows link to /channels, /products, /agents with no possible action for an operator.
- Evidence: .local/qa/campaign/roles/fr-operator-home-quick-actions.png · home-op.out · links.out

### ROLES-09 — Merchant members opening /admin read « Votre rôle plateforme (—) ne permet pas cette action (403). »
- Page: /fr/admin, /ar/admin, /en/admin (admin and operator, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Sign in as a shop admin or operator. 2. Open /fr/admin (old bookmark, shared link).
- Expected: a plain sentence without HTTP status or placeholder dash (12 §157 UX-059: no HTTP status « (404) » on merchant screens), e.g. « Cet espace est réservé à l'équipe Djaber. » + « Retour à l'accueil ».
- Actual: fr « 403 · Accès refusé · Votre rôle plateforme (—) ne permet pas cette action (403). »; ar « دورك في المنصة (—) لا يسمح بهذا الإجراء (403). »; en « Your platform role (—) does not allow this action (403). » (also « action » for a page).
- Evidence: sweep-operator-fr.json, l-ar2.out, l-en.out (route /admin)

### ROLES-10 — Admin's conversation menu shows the hint « ADMIN · SOFT » next to « Supprimer la conversation »
- Page: /fr/inbox/[id] › conversation « Actions » (admin, fr, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Sign in as admin. 2. Inbox › open a conversation › « Actions ».
- Expected: a merchant wording (e.g. « restaurable 30 jours ») — no developer word « SOFT » (12 §157 no technical text).
- Actual: last item « Supprimer la conversation ADMIN · SOFT ». (Operator: item correctly absent.)
- Evidence: .local/qa/campaign/roles/inbox-op.out (« MENU … Supprimer la conversation ADMIN · SOFT »)

## Coverage
- **Sidebar and route sweep, admin and operator (fr, 1440 px)**: 48 routes each (every merchant page, settings tab, /admin). Admin: full shop sidebar incl. Fournisseurs / Achats / Ventes / Caisse / Rapports; settings without « Zone de danger »; /settings/danger → 403 (ROLES-03). Operator: no Fournisseurs / Achats / Ventes / Caisse / Rapports in the sidebar; settings tabs Profil · Membres · Notifications · Sécurité · Crédits; 403 page (« Cette page est réservée aux admins de l'espace. Votre rôle : Opérateur. ») on /orders/import, /products/new, /products/import, /products/[id]/edit, /delivery/couriers, /suppliers, /purchases, /purchases/new, /sales, /cash, /agents/new, /agents/new/identity, /agents/generate, /reports, /reports/[key], /settings/workspace, stock-mode, quick-replies, system-messages, integrations (all tabs), billing, billing/return, danger — all consistent with the matrix.
- **Hidden / greyed controls (operator)**: orders list (Exporter / Importer hidden; row menu: Supprimer, Lien de paiement, Rembourser, Marquer retournée greyed « Vous n'avez pas la permission. »; new-order form without discount field; delivered order banner « « Marquer retournée » reste possible (admin) »); products / services row menus (Modifier, Ajuster, Dupliquer, Désactiver, Archiver, Supprimer greyed with reason footer); clients (Exporter hidden, no Supprimer); categories (Modifier / Supprimer greyed); stock (Ajuster / Réapprovisionner greyed « Action non autorisée pour votre rôle »); movements (Contre-passer absent); inventory (Lancer / Valider / Annuler / Feuille greyed, counting allowed); recommendations (all actions greyed); delivery fee grid (all inputs, switch and buttons disabled with reason); agents list / agent page (only Tester / Voir …; configuration read-only with note « Opérateur : lecture seule »; no Restaurer); channels (Reconnecter / Synchroniser / Déconnecter greyed; IA tab note « Seuls les admins… »; Analyse tab « réservée aux admins »); inbox (no « Supprimer la conversation »); members (section matrix disabled, no invite); credits (ledger « réservé aux admins », Acheter un pack greyed); notifications prefs; security (sessions, + Bloquer un numéro).
- **Admin vs owner**: billing plan buttons (Plan gratuit / Renouveler / Résilier) greyed « Réservé au propriétaire de l'espace. »; members: no invite / no role change / no transfer, section matrix disabled; credit pack checkout reachable (ROLES-07); inbox delete present (ROLES-10); agents / channels full menus.
- **API guard probes** (harmless bodies, random ids; 403 = refused by the guard, 422 / 404 = guard passed): 66 endpoints for operator and admin (`probe-operator.txt`, `probe-admin.txt`). Every UI refusal is also enforced by the API, except the price override (ROLES-01) and the read gaps ROLES-05 / ROLES-06. Admin gets 403 only on owner keys (`/workspace/invitations`, `/billing/preview`) and `/admin/*`.
- **Order flow as operator on own data**: create (CMD-1026), edit notes / payment / items, status new → delivered allowed, delivered → returned refused (403) and done by admin (02 §3 footnote OK); fee / discount / line discount refused (403).
- **Deep links**: every link of Home, Queue, Stock, Recommendations, Analytics, Delivery, Products followed as operator (`links.out`): none lands on a 403 / 404; notification « Tâche terminée : Export » does (ROLES-04).
- **Locales**: operator Home, Orders, Products, 403 pages, fee grid, credits, /admin in ar (RTL, dir=rtl, no horizontal overflow) and en; admin 403 / settings in fr. Role names translated (« مشغّل », « Operator »).
- **Phone 390 px (operator, fr)**: Home, Orders, order page, Products, Members, Workspace 403, fee grid — no page overflow (wide tables / tab bars scroll inside their box); drawer lists the same items as the desktop sidebar.
- Text leaks seen with both roles but owned by other areas: « malformed_output:no_json » on /queue insights, « COURIER_CREDENTIALS_INVALID » on /delivery/couriers (admin), « Idempotency-Key » in the new-order footer, « cas_001 » (a SKU, false positive).

## Blocked by safety
- `PATCH /workspace/members/:id` (probe with a random id) — QA_BLOCKED, so the « hide a section from a member » feature could not be exercised.
- `POST /orders/:id/payment-link` (probe with a random id) — QA_BLOCKED.
- `POST /credits/packs/checkout` as admin (« Payer 450 DA ») — QA_BLOCKED (ROLES-07).

## Not tested
- **Read-only member** (`READ_ONLY_MEMBER`, plan over `maxMembers`) and **sections hidden by the owner**: need a plan downgrade or a member change, both forbidden on the shared accounts.
- Operator unblocking a blocked customer (`safety.manage`) and the « CLIENT BLOQUÉ » banner: would require blocking a real customer conversation.
- Operator replying in a conversation / sending to a courier: real Messenger customers and real courier — blocked by the ground rules.
- Platform roles other than super admin (support / moderator / finance / read): no such account in accounts.json.
- 2FA and password screens for admin / operator beyond display (shared accounts).
