# Area admin — tested 15/11/2026 20:40–21:50 (Africa/Algiers)

Super admin account (`superadmin@test.djaber.local`, `open({ role: 'superadmin' })`), live https://djaber.vercel.app, Playwright through the kit `tools/qa/pw-kit.mjs`. Scripts and raw outputs: `.local/qa/campaign/admin/scripts/`, `.local/qa/campaign/admin/*.json`. Admin screens keep error codes on purpose (12 §16 UX-059 exception), so codes shown in admin legends are not reported.

Test data created (all « QA admin … », on « Boutique Test Équipe » only): products « QA admin modération A (approuver) » (approved), « B (refuser) » (rejected, motif Autre), « C (modifier) » (changes requested) — created through the owner account; promo code « QAADMIN-BTE » (5 %, targeted at Boutique Test Équipe only, 15→16/11, then **deactivated**); support ticket #T-2026-00011 « QA admin ticket — test support » (internal note, canned reply, resolved); 2 read-only impersonation sessions of Boutique Test Équipe; viewer.open on one Boutique Test Équipe conversation. Nothing was created elsewhere (the « QA admin espace client » workspace was refused by the server, see ADMIN-06).

### ADMIN-01 — « Fournisseurs IA »: the voice route shows « OK » although both of its providers are switched off (Groq and OpenAI « DÉSACTIVÉ »), and the text fallback is a disabled provider too
- Page: /fr/admin/ai › « Routage par capacité » (superadmin, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Admin › Fournisseurs IA. 2. Look at the provider cards and the routing table.
- Expected: a route whose primary model's provider is disabled is « BASCULE ACTIVE » (fallback usable) or an alert « aucun modèle actif » when the fallback is unusable too (12 §26 AI providers: « routing table rows with ÉTAT OK / BASCULE ACTIVE »; overview alert « AI error rate with fallback active »). The runtime already skips a disabled provider (`routing.service.ts:84` ⇒ `AGENT_MODEL_UNAVAILABLE` when nothing is left).
- Actual: cards: OpenAI DÉSACTIVÉ (aucune clé), Groq DÉSACTIVÉ, Google DÉSACTIVÉ, Anthropic ACTIF. Table: « Vocal (transcription) — Groq · Whisper large v3 turbo / secours OpenAI · Whisper — 0 $ — 3 / note — ÉTAT OK »; « Texte (réponse) — Anthropic · Claude Haiku 5.5 / secours Groq · GPT-OSS 120B — OK ». With this configuration the runtime router (routing.service.ts:82-85) has no active provider for transcription, so voice notes should fail with `AGENT_MODEL_UNAVAILABLE` (not verified with a real voice note) and text replies have no working fallback, but the page and the overview show no alert. Also the routing dialog of « Texte (réponse) » offers « Groq · Whisper large v3 turbo » (a speech model, listed with capability « texte » on the Groq card) as a text model.
- Evidence: .local/qa/campaign/admin/sweep-fr.json (/admin/ai), content.json (ai:routeDlg) · Likely cause: apps/api/src/modules/admin-core/ai-admin.service.ts:275 (`state` looks at `primaryModel.isActive` only, not `primaryModel.provider.isActive` / fallback provider).

### ADMIN-02 — Audit log detail claims « session web (2FA ✓) » for every admin action, including sessions without 2FA
- Page: /fr/admin/audit › any row (`?sheet=<id>`) — superadmin, fr
- Severity: Major
- Type: Security
- Steps: 1. Sign in as superadmin@test.djaber.local (2FA « Non » in Utilisateurs, « NON ⚠ » in Équipe plateforme). 2. Do any admin action (e.g. deactivate promo code QAADMIN-BTE). 3. Journal d'audit › open the row.
- Expected: the context states the real second factor of the session (03 ADM-09 « context ip/device »; an audit trail that is « immuable, export signé » must not assert a 2FA that did not happen).
- Actual: « Détail — PROMO_CODE.UPDATE · PromoCode 01a1e0df · 15 nov. 21:22 · Super Super Admin Admin · 154.247.x.x · session web (2FA ✓) »; API `GET /admin/audit-logs` returns `context.twoFactor: true` for every `actorType = admin` row (also on `platform_member.force_2fa` done by this account without 2FA).
- Evidence: .local/qa/campaign/admin/ops.json (audit:row) · Likely cause: apps/api/src/modules/admin-core/audit-query.service.ts:64 (`twoFactor: r.actorType === 'admin'`).

### ADMIN-03 — « Forcer la 2FA » runs in one click: no confirmation, no reason, no toast
- Page: /fr/admin/team › Membres plateforme › « Actions ⌄ » › « Forcer la 2FA » (superadmin, fr)
- Severity: Major
- Type: Bug
- Steps: 1. Open « Actions ⌄ » on a platform member. 2. Click « Forcer la 2FA ».
- Expected: a confirmation with a reason (« Raison obligatoire · journalisée », like every other sensitive admin action — CLAUDE rule 9 « audit for every sensitive action », 12 §16 « Confirmation before destructive / one-way actions »), then a toast (« 2FA réinitialisée : accès bloqué jusqu'à sa réactivation. » exists in the messages).
- Actual: the request is sent immediately (`POST /admin/platform-members/:userId/force-2fa` → 200), no dialog, no reason (audit row `platform_member.force_2fa`, reason `null`), no visible toast. **Note:** this click was made by this test run on `lecture@djaber.local` (read role) while mapping the menu, believing it opened a dialog; that account had no 2FA (`totpEnabled` false before and after), so nothing changed for it, but the action is in the audit log at 15/11 21:29. The kit does not block this path (see « Blocked by safety »).
- Evidence: .local/qa/campaign/admin/ops2.json (team:dlg:Forcer la 2FA = none) · API: POST /admin/platform-members/01a1c0d5-…/force-2fa → 200 · audit 01a1e0e6-6d14-…

### ADMIN-04 — « Niveau de confiance » cannot be changed anywhere: the dialog exists but no menu ever offers it
- Page: /fr/admin/workspaces (row « Actions ⌄ » and detail sheet), superadmin, fr, 1440 px
- Severity: Major
- Type: Bug
- Steps: 1. Admin › Espaces de travail. 2. Open « Actions ⌄ » on « Boutique Test Équipe » (trust level SURVEILLANCE). 3. Open the sheet (« Ouvrir la fiche ») and its « Actions ».
- Expected: « Niveau de confiance » action → DLG « Niveau de confiance » (`POST /admin/workspaces/:id/trust-level`, `admin.moderation.write`) — 02-next-route-map §3.5 row `/admin/workspaces`; trust levels drive moderation (auto-approval « marchand de confiance », « Suspension proposée » for `watch`).
- Actual: menu = Ouvrir la fiche · Se connecter en tant que · Changer de plan · Ajouter / Retirer des crédits · Prolonger · Suspendre · Programmer la suppression. No trust-level item; the sheet only shows the pill « SURVEILLANCE ». The web has `TrustLevelDialog` and a `trust_level` menu entry, but the server never sends a `trust_level` action descriptor, and `toMenuActions` only shows server descriptors.
- Evidence: .local/qa/campaign/admin/workspaces.json (rowMenuItems) · Likely cause: apps/api/src/modules/admin-core/workspaces.service.ts:202-212 (`actions()` has no `a('trust_level', 'admin.moderation.write')`).

### ADMIN-05 — Admin row menus: disabled reasons are wrong (« Modifié entre-temps, rechargez. ») and address the admin as the user (« Supprimez votre espace d'abord. »)
- Page: /fr/admin/users › « Actions ⌄ » on Karim Proprio (proprietaire@test.djaber.local) and on the super admin's own row (superadmin, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Admin › Utilisateurs › search « test.djaber.local ». 2. Open « Actions ⌄ » on a verified user without 2FA who owns a shop.
- Expected: finished sentences that give the real reason (12 §16 « Disabled reasons », UX-060): « E-mail déjà vérifié. », « La 2FA n'est pas activée pour ce compte. », « Cet utilisateur possède « Boutique Test Équipe » : transférez la propriété ou supprimez l'espace d'abord (ACCOUNT_OWNS_WORKSPACE). »
- Actual: footer of the menu: « Renvoyer l'e-mail de vérification : Modifié entre-temps, rechargez. · Désactiver la 2FA : Modifié entre-temps, rechargez. · Programmer la suppression (RGPD) : Supprimez votre espace d'abord. » (generic `CONFLICT` used as reason code). The same « Modifié entre-temps, rechargez. » reason is shown on other admin menus for « not in this state »: Abonnements › Boutique Test Équipe › « Renvoyer la relance » (subscription active, nothing to remind); CMS › « holla » (already published) › « Publier », « Programmer »; Équipe plateforme › demandes de suppression › « Résoudre », « Traiter maintenant » (request awaiting confirmation).
- Evidence: .local/qa/campaign/admin/users.json (menuFull, selfMenuFull), billing.json (subRowMenu), content.json (cms:menu), ops2.json (team:delMenu) · Likely cause: apps/api/src/modules/admin-core/users.service.ts:125 (`'CONFLICT'` as reasonCode; same pattern in the other admin services)

### ADMIN-06 — « Créer un espace pour un client » with an e-mail that already owns a shop: raw « validation.taken » under the field, and the note promises the opposite
- Page: /fr/admin/workspaces › « + Créer un espace (pour un client) » (superadmin, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Open the dialog. 2. Nom « QA admin espace client », e-mail `proprietaire@test.djaber.local` (owner of Boutique Test Équipe). 3. « Créer l'espace ».
- Expected: a sentence such as « Cet utilisateur possède déjà un espace (un compte ne peut posséder qu'un espace). » — the dialog note says « Si l'e-mail existe : l'utilisateur devient propriétaire sans nouveau compte », which must name the one-workspace limit; error codes only from 11-error-catalogue (not a generic `CONFLICT`).
- Actual: under « E-mail du propriétaire »: « validation.taken » (raw i18n key). API `POST /admin/workspaces` → 409 `CONFLICT` « Modifié entre-temps, rechargez. » `fields.ownerEmail = validation.taken`. Same `validation.taken` field value is returned for a duplicate promo code, pack slug, Google product id and AI model id (billing-admin.service.ts:500/599/606, ai-admin.service.ts:209).
- Evidence: .local/qa/campaign/admin/fr-ws-create-errors.png · ws2.json · API: POST /admin/workspaces → 409 · Likely cause: apps/api/src/modules/admin-core/workspaces.service.ts:319 + no `validation.taken` key in the web messages (only `validation.email` exists).

### ADMIN-07 — During « Se connecter en tant que », read-only forms say « Accès en lecture seule (limite du plan). »
- Page: /fr/products/new, /fr/settings/quick-replies under an impersonation of « Boutique Test Équipe » (superadmin, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Admin › Espaces › Boutique Test Équipe › Actions › « Se connecter en tant que (impersonation) », reason ≥ 10 chars › « Se connecter (lecture seule) ». 2. Open Produits › Nouveau produit, or Paramètres › Réponses rapides.
- Expected: the reason of the read-only state is the impersonation (« Mode « connecté en tant que » : lecture seule »); the shop is not at a plan limit (Pro, 3 / 10 members). assumptions-log 26/10 (UX-024) already removed the member-limit banner during an impersonation.
- Actual: fields greyed with « Accès en lecture seule (limite du plan). » on both pages. A write that is still offered (Notifications › « Tout marquer comme lu », enabled) is refused by the API `POST /notifications/read-all` → 403 `ADMIN_IMPERSONATION_FORBIDDEN_ACTION` (correct server side, but the button should be disabled with that reason).
- Evidence: .local/qa/campaign/admin/imperso.json (newProduct), imperso2.json (qr, markDisabled false) · API: POST /notifications/read-all → 403

### ADMIN-08 — Promo code dialog: out-of-range value and an end date before the start both show « Valeur hors limites (–) »; a duplicate code shows « Modifié entre-temps, rechargez. »
- Page: /fr/admin/credits › « + Code promo » (superadmin, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Code « CODEPROMO » (exists), % remise, valeur 150 › « Créer le code ». 2. Valeur 5, validité 20/11 → 10/11, code « QAADMIN-DATES » › Créer. 3. Validité 15/11 → 16/11, code « CODEPROMO » › Créer.
- Expected: messages that say what to fix: « Entre 1 et 100 % » under Valeur, « La fin doit être après le début. » under Validité (same rule as the CMS « Fin » field, 12 §26 CMS / UX-037), « Ce code existe déjà. » under Code.
- Actual: 1. « Valeur hors limites (–) » (the bounds slot is empty « (–) »), API 422 `fields.value = validation.range`. 2. « Valeur hors limites (–) » under Validité, API 422 `fields.validTo = validation.range`. 3. « Modifié entre-temps, rechargez. » under Code, API 409 `CONFLICT` `fields.code = validation.taken` (see ADMIN-06). The server rules are right (nothing was created); only the texts are wrong.
- Evidence: .local/qa/campaign/admin/billing3.json (promoErrors1, promoErrorsDup), promo.json (reversed) · API: POST /admin/promo-codes → 422 / 409

### ADMIN-09 — Moderation rows and panel say « IA : 1 seule image (0) » for products that have no image at all
- Page: /fr/admin/moderation (all tabs), superadmin, fr
- Severity: Minor
- Type: Text
- Steps: 1. Admin › Modération › À vérifier. 2. Look at the AI reason of « QA admin modération A » (created without image) or « Retest UX-044 produit 1 ».
- Expected: the flag tells the real problem: « Aucune image » when there is none, « 1 seule image » when there is one (12 §26 Moderation « rows with … AI reason »).
- Actual: « IA : 1 seule image (0) » (0 images) and « IA : 1 seule image (1) » (1 image): the `single_image` flag is raised for 0 images and its count is printed in brackets.
- Evidence: .local/qa/campaign/admin/mod2.json (search) · API item `aiFlags: [{ code: "single_image", field: "images", message: "0" }]`

### ADMIN-10 — Product viewer shows « EN ATTENTE » for a product whose moderation is « modification demandée »
- Page: /fr/admin/viewers/products?workspaceId=<Boutique Test Équipe> (superadmin, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Modération › « QA admin modération C (modifier) » › motif « Infos manquantes (demander modification) », message › « Demander une modification » (API item status `changes_requested`). 2. Espaces › Boutique Test Équipe › « Visionneuses (lecture seule) ».
- Expected: the validation pill of the viewer matches the moderation status (« MODIFICATION DEMANDÉE »), 12 §26 Viewers « products list with validation + IA pills ».
- Actual: « QA admin modération C (modifier) · 1 500 DA · EN ATTENTE · PROPOSÉ » (A shows VALIDÉ and B REFUSÉ correctly).
- Evidence: .local/qa/campaign/admin/viewers.json (products), viewers2.json (C status `changes_requested`)

### ADMIN-11 — Plan editor cannot change what the create form sets: names AR / EN, description, conversations / webhooks / sync-history limits, visibility and « Populaire »
- Page: /fr/admin/plans › « Modifier » on « Pro » (`?edit=`), superadmin, fr (cancelled, nothing saved)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Admin › Plans › « + Nouveau plan »: fields slug, Nom FR / AR / EN, description, prix, essai, ordre, 9 limits (pages, agents, produits, conversations, membres, crédits, clés API, webhooks, historique sync), features, Actif / Populaire / Visible. 2. Close, then « Modifier » on Pro.
- Expected: the editor of ADM-04 edits the plan (version n → n+1) including its public texts and visibility (a typo in the Arabic name or switching « Populaire » to another plan must not need a new plan) — 03 ADM / 12 §26 « Plans: edit form (version n → n+1, impact warning) ».
- Actual: edit form has only Nom (one language), prix mensuel / annuel, essai, crédits / mois, pages, agents, membres, produits, clés API max and the features; no AR / EN name, description, conversations / webhooks / sync limits, order, Actif / Populaire / Visible (only « Archiver »). « Dupliquer » pre-fills all of them, so the data exists.
- Evidence: .local/qa/campaign/admin/billing2.json (dupValues vs editValues)

### ADMIN-12 — « Équipe plateforme » shows « NON ⚠ (accès bloqué) » for platform members who do have access
- Page: /fr/admin/team › Membres plateforme (superadmin, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Sign in as superadmin@test.djaber.local (no 2FA). 2. Open Équipe plateforme.
- Expected: the 2FA column tells the truth: while the owner's dated pause `PLATFORM_2FA_OFF_UNTIL` (or the test exemption) is active, « NON ⚠ (2FA exigée à partir du …) »; « accès bloqué » only when `TWO_FA_REQUIRED_FOR_ROLE` is actually enforced (PRL-02).
- Actual: 8 of 9 members, including « Super Super Admin Admin (vous) », show « NON ⚠ (accès bloqué) » although that account is using every admin page right now (last action « il y a 4 h · moderation.approve »).
- Evidence: .local/qa/campaign/admin/sweep-fr.json (/admin/team) · Likely cause: apps/web team page renders `admin.team.noTwoFa` without looking at `twoFaPaused()` / exemption (apps/api/src/core/tenancy/tenant.resolver.ts:25-37).

### ADMIN-13 — Empty CMS tab « E-mails » shows the filtered-empty state (« Aucun(e) entrée ne correspond à « les filtres actuels ». · Effacer les filtres ») with no filter set
- Page: /fr/admin/cms?tab=email (superadmin, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Admin › Contenu (CMS) › tab « E-mails » (no filter).
- Expected: GLOBAL « Vide » state (icon, one-line reason, primary CTA « + Nouvelle entrée »), 12 §16 List — 6 states; « Vide filtré » only when a filter is active.
- Actual: « Aucun résultat · Aucun(e) entrée ne correspond à « les filtres actuels ». · Effacer les filtres ». Same component on the other admin lists (see ADMIN-16).
- Evidence: .local/qa/campaign/admin/content.json (cms:tab:email)

### ADMIN-14 — Journal d'audit: the « Action » filter offers 15 fixed actions; most logged actions cannot be filtered
- Page: /fr/admin/audit › filter « Action » (superadmin, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Open the « Action » filter.
- Expected: every action slug that exists in the log can be filtered (moderation decisions, promo codes, CMS, platform members, products …), 12 §26 Audit log « filters ».
- Actual: only workspace.suspend, workspace.reactivate, credits.grant, plan.change, plan.update, impersonation.start / stop, user.block, preset.publish, pricing.version, invoice.mark_paid, member.role_change, viewer.open, viewer.unmask, audit.export. The 7-day log is full of `moderation.reject`, `moderation.request_changes`, `promo_code.update`, `platform_member.force_2fa`, `impersonation.action`, `recommendation.*`, `product.create` … that can only be found by free text.
- Evidence: .local/qa/campaign/admin/ops.json (audit:f:Action) · Likely cause: apps/web/src/app/[locale]/(admin)/admin/audit/page.tsx:21 (hard-coded `ACTIONS`)

### ADMIN-15 — After F5 during « Se connecter en tant que », the admin lands silently in their own shop on the same URL
- Page: /fr/notifications during an impersonation of « Boutique Test Équipe » (superadmin, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Start an impersonation of Boutique Test Équipe. 2. Open Notifications. 3. Press F5.
- Expected: when the reload ends the session (assumptions-log 13/10 D21-bis: token in memory), say so: « Session « connecté en tant que » terminée » + « Retour à l'admin » (12 §26 Workspaces « expired session state … back to admin »).
- Actual: the red banner disappears and the same page now shows the super admin's own shop « Espace Super Admin » (different menu: « Livraison & suivi », « Inventaires » appear), with no message; an admin can easily think they are still looking at the merchant's data.
- Evidence: .local/qa/campaign/admin/imperso2.json (afterF5)

### ADMIN-16 — Filtered-empty text of the admin lists: « Aucun(e) espace ne correspond à « les filtres actuels ». »
- Page: /fr/admin/workspaces?q=zzzz-aucun, ?status=suspended (superadmin, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Search « zzzz-aucun » (or Statut = Suspendu).
- Expected: GLOBAL « Vide filtré » names the active filters (« Aucun résultat pour « zzzz-aucun » · Statut : Suspendu — Effacer les filtres »), 12 §16.
- Actual: « Aucun résultat · Aucun(e) espace ne correspond à « les filtres actuels ». » — « Aucun(e) » and the filler « les filtres actuels » inside quotes as if it were the search term.
- Evidence: .local/qa/campaign/admin/workspaces.json (noMatch, suspended)

### ADMIN-17 — Viewers page title starts with a literal « … »: « … — visionneuses (lecture seule) »
- Page: /fr/admin/viewers/products (superadmin, fr / ar / en)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Open /fr/admin/viewers/products without `?workspaceId`.
- Expected: a page title (« Visionneuses (lecture seule) ») — the Figma frame name « ADM-17 — … read-only viewers » is not a title.
- Actual: « … — visionneuses (lecture seule) », then « Ouvrez les visionneuses depuis la fiche d'un espace. »
- Evidence: .local/qa/campaign/admin/sweep-fr.json (/admin/viewers/products)

### ADMIN-18 — Admin forms accept negative or empty quantities that the server will refuse (pack credits −5, workspace initial credits −50)
- Page: /fr/admin/credits › « + Pack »; /fr/admin/workspaces › « Créer un espace » (superadmin, fr)
- Severity: Cosmetic
- Type: UX
- Steps: 1. « + Pack », Crédits « -5 ». 2. « Créer un espace », Crédits initiaux « -50 ».
- Expected: inline « doit être > 0 » before submit (12 §16 Form « Validation » state), the primary button greyed like for the empty name.
- Actual: « Enregistrer » / « Créer l'espace » stay enabled with −5 / −50 (`disabled={!Number(credits)}` treats −5 as valid); the error only comes from the server (not submitted here for the pack).
- Evidence: .local/qa/campaign/admin/billing3.json (packDisabledNeg false) · Likely cause: apps/web/src/features/admin/credits/parts.tsx:62

### ADMIN-19 — Small text / format issues on the admin screens
- Page: several (superadmin, fr)
- Severity: Cosmetic
- Type: Text
- Steps / Actual (each seen on the live pages):
  1. Plurals: Plans « 1 pages · 1 agents · 1 membres », « 1 abonnés »; overview alert « 1 espaces à 100 % de crédits ».
  2. Decimal point in French: Fournisseurs IA « COÛT RÉEL / 1 K 0.00288 $ », Crédits › Historique des grilles « crédit 0.9 DA » (rule 11 « 12 500 DA », French decimal comma as elsewhere on the same page « 0,39 DA »).
  3. Workspace sheet (Boutique Test Équipe › Résumé): « ABONNEMENT Pro mensuel · 4 900 DA · renouvelé le 26 nov. · chargily » (future date with « renouvelé », raw provider key); « INTÉGRATIONS Sheets ✗ · zrexpress ✗ · zrexpress ✗ » (raw courier key, twice); Crédits tab « RENOUVELLEMENT · renewal », « PACK · pack:pack-500 ».
  4. User sheet (Karim Proprio): « SESSIONS & APPAREILS » lists ~100 identical lines « Windows · 154.247.x.x · il y a n min » with no grouping or « n de plus ».
  5. Reports › treatment panel prints raw rule data « MERCHANT_REPORTS_30D:1 », « BLOCK_REQUESTED » and an empty « system : « » (15:21) » line.
  6. « + Fournisseur » on Fournisseurs IA opens « Clé fournisseur IA — OpenAI · remplacer la clé » (OpenAI has no key; nothing to replace, and no new provider can be added).
- Expected: French plural agreement, decimal comma, labels instead of keys (admin screens may keep error codes, 12 §16 UX-059 exception, but not raw data values).
- Evidence: .local/qa/campaign/admin/sweep-fr.json, ws2.json, users.json, ops2.json, content.json

## Note for other areas (seen from the admin viewer, not re-tested)
- channels-inbox: the read-only viewer of a Boutique Test Équipe conversation (#01a153, Badreddine b., ~20 days ago) shows merchant replies sent with unreplaced quick-reply variables: « asd;lkfjweiohndfnfjdsdffddd2 Badreddine {total} {boutique} » — `{prénom}` was filled, `{total}` and `{boutique}` reached the customer as raw text. Worth a retest of quick replies in the inbox composer (evidence: .local/qa/campaign/admin/viewers2.json, kit leak `{total}` / `{boutique}`).

## Coverage
All pages of the AdminShell sidebar, superadmin, 1440 px fr unless noted. « open » = opened, read and cancelled / Esc; « submit » = sent to the API.

| Screen | What was tested | fr | ar | en | 390 px |
|---|---|---|---|---|---|
| Vue d'ensemble `/admin` | KPI tiles, chart, period menu + `?period=7d` reload, every alert / top-workspace / AI-cost / trials link (all land on the right filtered page or sheet) | ✓ | ✓ | ✓ | ✓ fr / ar |
| Espaces `/admin/workspaces` | search (text, e-mail, Arabic, no match), filters Plan / Statut / Crédits / Créé / Wilaya / Filtres (panel), URL filters + F5, row menu (all 8 items, every dialog open + Esc), detail sheet + 7 tabs via `?stab=`, sheet 404, prev / next; « Créer un espace » validation (empty, bad e-mail, existing owner, −50 credits) — submit refused by server; impersonation of Boutique Test Équipe: reason ≥ 10 chars, banner, 6 merchant pages, write refused (403 `ADMIN_IMPERSONATION_FORBIDDEN_ACTION`), F5 | ✓ | ✓ | ✓ | ✓ fr / ar |
| Utilisateurs `/admin/users` | 5 filters, `?status=unverified`, search, row menu (8 items incl. own row), dialogs reset password / revoke sessions / promote / block (open + Esc), user sheet, sheet 404 / bad id, « Inviter un admin plateforme » | ✓ | ✓ | ✓ | ✓ fr / ar |
| Modération `/admin/moderation` | 6 tabs (`todo`, `urgent`, `appeals`, `sample`, `rejected`, `prompts`), 6 filters, search, review panel, **approve / reject (empty, no reason, valid) / request changes on my 3 QA admin products**, bulk selection + « Rejeter (motif commun) » dialog (Esc), « Mots & catégories interdits » panel, « Règles de modération » link | ✓ | ✓ | ✓ | ✓ fr / ar |
| Signalements `/admin/reports` | KPIs, 5 tabs, row menu, treatment panel (read only — reports belong to another shop, not decided), Mots bloqués (open, not saved), Règles automatiques, liste noire (not added) | ✓ | ✓ | ✓ | — |
| Support `/admin/support` + réponses types | tabs, filters, SLA column, ticket thread of Boutique Test Équipe, « / » canned-reply picker, **new ticket on Boutique Test Équipe → internal note → canned reply sent → Résoudre** (#T-2026-00011), context actions (open), « Nouvelle réponse type » (close guard) | ✓ | ✓ | ✓ | ✓ fr / ar |
| Plans `/admin/plans` | cards, « Nouveau plan » (empty → disabled), « Dupliquer » (pre-filled), « Modifier » Pro (fields, leave guard « Quitter sans enregistrer ? »), « Aperçu page tarifs » (new tab); nothing saved | ✓ | ✓ | ✓ | — |
| Abonnements & factures | KPIs, 4 tabs, filters, row menu, « Créer un abonnement » **submitted on Boutique Test Équipe → 409 `SUBSCRIPTION_ALREADY_ACTIVE` shown inline (correct)**, « + Paiement manuel » (step 1), « Exporter comptabilité » (open) | ✓ | ✓ | ✓ | ✓ fr / ar |
| Crédits & promos | packs table + row menu (delete greyed with reason), « + Pack » validation (not saved), « Historique des grilles », promo validation (value 150, reversed dates, duplicate code), **QAADMIN-BTE created → edited (max 1 → 2) → redemptions → deactivated (confirm dialog)** | ✓ | ✓ | ✓ | — |
| Fournisseurs IA | provider cards, key dialog (open, not tested — would call the provider), model dialog, route menu + routing dialog (open), calculator (−10, text) | ✓ | ✓ | ✓ | ✓ fr / ar |
| Préréglages | cards, card menu (delete greyed with reason), « Vendeur Pro » editor, versions, « Nouveau préréglage » (open), onboarding preview | ✓ | ✓ | ✓ | — |
| Contenu (CMS) | 6 type tabs, row menu, announcement editor (open + close), « Nouvelle entrée » (invalid slug, not created), « Aperçu site » | ✓ | ✓ | ✓ | — |
| Journal d'audit | 6 filters, search « QA admin » (my actions all logged with reasons), detail with before / after, export dialog (open) | ✓ | ✓ | ✓ | ✓ fr / ar |
| Tâches & santé | tiles, queues table + row menu (not used), DLQ list, « Déclarer un incident » (close guard), Grafana link | ✓ | ✓ | ✓ | — |
| Paramètres plateforme | all sections read, « + Nouveau flag », « Historique », app-version row menu, maintenance dialog (open), `#meta` anchor scrolls into view | ✓ | ✓ | ✓ | ✓ fr / ar |
| Équipe plateforme | role matrix, members, member menu (« Modifier le rôle » open), invite (wrong domain → `ADMIN_EMAIL_DOMAIN_INVALID` inline, nothing sent), deletion requests list + menu | ✓ | ✓ | ✓ | ✓ fr / ar |
| Visionneuses | products viewer of Boutique Test Équipe (statuses, product history), conversation viewer (reason < 10 chars disabled, then opened), « Afficher » unmask dialog (open, not submitted) | ✓ | ✓ (title) | ✓ (title) | — |

ar / en: every page above was loaded and its text checked for untranslated French (none found apart from data names) and RTL direction (`dir="rtl"`, no horizontal overflow at 390 px). Technical-text recorder: only admin-legend codes (allowed) and the `{total}` / `{boutique}` leak noted above.

## Blocked by safety
- No call was stopped by the kit in this run (`blocked: []` in every log): the destructive dialogs (suspend, schedule deletion, credits add / remove, block, reset password, revoke sessions, platform role) were opened and cancelled, never submitted.
- **Kit gaps found** (not in `BLOCKED`, worth adding): `POST /admin/platform-members/:userId/force-2fa` (one click, see ADMIN-03 — triggered once by this run on `lecture@djaber.local`, no state change), `POST /admin/workspaces/:id/plan` (the real plan-change path; the kit pattern is `change-plan`), `POST /admin/workspaces/:id/trust-level`, `POST /admin/impersonation/sessions` (read-only, used on Boutique Test Équipe only), `POST /admin/ai-providers/:key/test`, `PATCH /admin/ai-providers/:key`, `PUT /admin/ai-routes/:capability`, `PUT /admin/maintenance`, `PUT /admin/incident-banner`, `POST /admin/queues/:name/*`, `PUT /admin/blocked-words`, `POST /admin/blacklist`, `POST /admin/reports/:id/decide`, `POST /admin/moderation/items/*` on other shops, `PUT /admin/settings/:key`.

## Not tested
- Submits on live platform objects (by rule): plan / pack / preset / CMS / canned-reply creation or edits, AI key test and routing changes, feature flags, app versions, maintenance, incident declaration, queue actions (pause / replay / drain), blocked words, blacklist, report decisions (the only open reports belong to « Boutique de Test »), deletion-request processing, platform invitations (only `@djaber.ai` allowed).
- Shop actions on Boutique Test Équipe that change other areas' test conditions: change plan, extend, suspend / reactivate, credits, schedule deletion (also blocked by the kit), trust level (no UI, ADMIN-04).
- Platform roles other than super admin (read / support / moderator / finance accounts have no password in `accounts.json`): role-based hiding of write controls not checked.
- Impersonation expiry after the configured 10 min (not waited for); « Quitter » button of the banner (the session had already ended on F5 in the second run).
- Audit / accounting / safety exports (would start background jobs; dialogs opened only).
