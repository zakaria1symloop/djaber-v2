# Area settings — tested 15/11/2026 17:35–18:05 (Africa/Algiers)

Owner account, test shop « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`).
Scripts and raw outputs: `.local/qa/campaign/settings/scripts/` and `.local/qa/campaign/settings/*.txt`; screenshots
`.local/qa/campaign/settings/<locale>-*.png`.

Test data (all named « QA settings … »): quick reply « QA settings merci مرحبا 😀 » (FR, `/qamerci`) kept; quick replies
« QA settings livraison » (AR) and « QA settings offline » deleted; invitation `qa-settings-1@test.djaber.local` sent,
resent, then revoked; API key « QA settings clé lecture 😀 » created then revoked (row stays « RÉVOQUÉE »); webhook
`https://example.invalid/qa-settings-hook` created, edited, secret rotated, deleted; blocked numbers `abc`, `0123`,
`٠٦٩٩٩٩٩٩٠١`, `0699 99 99 01` (note « QA settings test ») created then unblocked; blocked words added then removed.
Values changed for a test and put back right after: owner first name, workspace « Rappel propriétaire » (0 / 31 → 30) and
address, the 4 FR system messages, one e-mail notification preference, safety rules (seuil, « risque » rule), billing NIF.
**Side effect to know:** on /settings/security a « Déconnecter » click revokes a session at once (no confirmation); my
script clicked the 6th row of the owner's session list (expecting a dialog), once or twice — that may have signed out
another agent's owner session (`DELETE /me/sessions/f29d4ae5-…` → 204).
The pre-existing quick reply « asdflkj2 » (EN) and the plan name « Gratuit pro max » belong to other testers / the admin
and were not touched.

### SETTINGS-01 — Profile shows the stored language (« English ») instead of the interface in use; saving the name silently switches the app to English
- Page: /fr/settings/profile (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Open /fr/settings/profile (the owner's stored `locale` is `en`, the interface is French because of the URL). 2. « LANGUE DE L'INTERFACE » shows « English ». 3. Change only the first name (or nothing else), click « Enregistrer ».
- Expected: the select shows the language actually in use (or sign-in applies `User.locale`), and fixing the name never changes the interface language (profile subtitle « Langue de l'interface = profil »; route map /settings/profile « language & region »).
- Actual: `PATCH /me {"firstName":"Karim","lastName":"Proprio","locale":"en"}` is sent with the stale hidden value, then the page jumps to /en/settings/profile (html lang=en). A merchant who fixes a typo in their name ends up in English. Sign-in on /fr does not apply `User.locale=en` either, so the two disagree from the start.
- Evidence: .local/qa/campaign/settings/fr-profile-delete-dialog.png (select « English » behind the dialog in a French UI) · profile2.txt (« url after save https://djaber.vercel.app/en/settings/profile ») · API: PATCH /me → 200 · Likely cause: apps/web/src/app/[locale]/(app)/settings/profile/page.tsx:31-36 (form default `me.locale`, not the URL locale) and :55 (router.replace to `next.locale`)

### SETTINGS-02 — System messages: the hint shows « VARIABLE {PRODUCT} » / « {SHOP} » in capitals, but only `{product}` / `{shop}` work; wrong or unknown variables are saved and would reach customers raw
- Page: /fr/settings/system-messages (owner, fr / ar / en, 1440 px); same idea in /fr/settings/quick-replies
- Severity: Major
- Type: Bug
- Steps: 1. Read the hint under « RUPTURE DE STOCK »: « QUAND : PRODUIT DEMANDÉ EN RUPTURE · VARIABLE {PRODUCT} » (« VARIABLE {SHOP} » for « ACCUEIL », « المتغير {PRODUCT} » in Arabic). 2. Type the variable as shown: « Désolé, {PRODUCT} est épuisé. {product} revient bientôt. {inconnu} ». 3. Look at « APERÇU », then « Enregistrer ».
- Expected: the hint shows the variable exactly as it must be typed (`{product}`, `{shop}`); a wrongly-cased or unknown variable is refused inline (or matched case-insensitively) before saving (12 §13 « validation »; route map: `out_of_stock` with `{product}`, `welcome` with `{shop}`).
- Actual: preview « Désolé, {PRODUCT} est épuisé. La Robe satin revient bientôt. {inconnu} »; « Enregistrer » accepts it (`PUT /workspace/system-messages` → 200, toast « Enregistré »), so customers would receive the literal « {PRODUCT} » / « {inconnu} ». The hint is upper-cased by the section-label style, which teaches the wrong spelling. Quick replies accept `{inconnu}` the same way (« QA settings merci … {inconnu} » saved), and the two features use different variable languages (`{prénom} {boutique} {total}` vs `{product} {shop}`). (FR texts restored right after the test.)
- Evidence: .local/qa/campaign/settings/sysmsg.txt (« preview oos … {PRODUCT} est épuisé … {inconnu} ») · fr-sys-long.png · qr3.txt · API: PUT /workspace/system-messages → 200

### SETTINGS-03 — « Bloquer un numéro » accepts any text and does not normalise Arabic digits: « abc », « 0123 », « ٠٦٩٩٩٩٩٩٠١ » are « bloqués » but block nobody
- Page: /fr/settings/security › Clients bloqués › « + Bloquer un numéro » (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. « + Bloquer un numéro ». 2. TÉLÉPHONE `abc` › Bloquer. 3. Again with `0123`, then with Arabic-Indic digits `٠٦٩٩٩٩٩٩٠١`.
- Expected: the number is validated like everywhere else (« Numéro invalide (ex. 0555123456) », as on the workspace form) and normalised (Arabic digits → Latin, +213 → 0) so the block really matches the customer's phone (12 §25 safety « + Bloquer un numéro »; 04 integer / Latin-digit rule).
- Actual: every value returns `POST /safety/blocks` → 201 and the toast « abc est bloqué »; the list shows rows « abc », « 0123 », « ٠٦٩٩٩٩٩٩٠١ » as MANUEL. The Arabic-digit row is stored as typed, so the customer 0699 99 99 01 is NOT blocked although the merchant was told so (`+213699999901` is normalised correctly to 0699999901, and a duplicate returns the existing row — good). Rows unblocked after the test.
- Evidence: .local/qa/campaign/settings/safety.txt · safety2.txt · fr-safety-list.png · API: POST /safety/blocks {"phone":"abc"} → 201 · Likely cause: packages/shared/src/schemas/inbox.ts:135 (`phone: z.string().trim().min(1).max(20)`, no phone validator / normalisation)

### SETTINGS-04 — Change-plan dialog lets the owner pay the next month 11 days early although « Renouveler » says it is not possible yet
- Page: /fr/settings/billing (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Plan & facturation (Pro monthly, renewal 26 nov.). 2. « Renouveler » is greyed: « Renouvellement possible à partir du 19 nov. 2026 (7 jours avant l'échéance). » 3. Open /fr/settings/billing?change=pro&cycle=monthly (or « Annuel » › « Passer à Pro » › choose « Mensuel · 4 900 DA »).
- Expected: the same rule everywhere: no early renewal before the 7-day window (or the button is enabled too).
- Actual: the dialog « Changer de plan · Pro mensuel → Pro » offers « Aujourd'hui : 4 900 DA · la période suivante est payée, prochaine échéance le 26 déc. 2026 » with an enabled « Payer 4 900 DA (CIB / Edahabia) » (`POST /billing/preview` → 200 `mode:"renewal"`). The checkout itself was blocked by the kit, so the server answer to the checkout is unknown.
- Evidence: .local/qa/campaign/settings/fr-billing-deeplink.png · billing2.txt · API: POST /billing/preview {"cycle":"monthly"} → 200

### SETTINGS-05 — Google Sheets: « Exporter l'historique » is greyed with the wrong reason « Modifié entre-temps, rechargez. »
- Page: /fr/settings/integrations/sheets (owner, fr, 1440 px), state ERREUR · ACCÈS RÉVOQUÉ
- Severity: Minor
- Type: Text
- Steps: 1. Intégrations › Google Sheets (the test shop's token is revoked). 2. Hover « Exporter l'historique (période) ».
- Expected: the real reason, like the button next to it: « Accès Google révoqué, reconnectez-vous. » (rule: disabled reasons are finished, true sentences).
- Actual: tooltip « Modifié entre-temps, rechargez. » (the generic CONFLICT message); « Changer de feuille » correctly says « Accès Google révoqué, reconnectez-vous. ». Also « LIGNES : 1 commandes synchronisées » (plural with 1).
- Evidence: .local/qa/campaign/settings/integ.txt (`title="Modifié entre-temps, rechargez."`) · fr-integ-sheets.png · Likely cause: server `actions.backfill.reason` = CONFLICT, shown as is by apps/web/src/features/integrations/sheets-tab.tsx:226

### SETTINGS-06 — Credits / billing pages show technical and designer texts to the merchant (« pack:pack-500 », « bandeau rouge, IA bloquée… »)
- Page: /fr/settings/credits and /fr/settings/billing (owner, fr / ar, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Crédits › Historique, filter « Action : PACK ». 2. Read the line under the table. 3. Plan & facturation › under the invoices.
- Expected: merchant wording only (no slugs, no design notes).
- Actual: the pack row's DÉTAIL reads `pack:pack-500` (a « Pack de 5 crédits »), and the ACTION cell shows « PACK » twice; under the ledger: « Solde négatif (remboursement store) : bandeau rouge, IA bloquée jusqu'à régularisation. » (a Figma annotation, i18n key `credits.ledger.note`); under the invoices: « Impayée : « Payer maintenant » · relances 7 jours avant l'échéance… PDF : logo, infos de facturation (raison sociale, NIF, adresse). » In the ledger the agent name is glued to the link: « pedro 2CONVERSATION › » (« Pro Sellerالمحادثة › » in Arabic).
- Evidence: .local/qa/campaign/settings/credits.txt (« pack:pack-500 +5 724 ») · fr-credits-filtered.png · tour-fr-1440.txt · packages/shared/src/i18n/messages/app.fr.json:2678

### SETTINGS-07 — Credits ledger « Période » with « du » after « au » silently drops the start date
- Page: /fr/settings/credits (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Crédits › Période. 2. DU 20/11/2026, AU 01/11/2026.
- Expected: inline « La date de début doit précéder la date de fin » (`INVALID_DATE_RANGE`, 12 §24) and nothing applied.
- Actual: the chip becomes « PÉRIODE : … → 01 NOV. 2026 » and the request is `GET /credits/ledger?…&to=2026-11-01` — the « du » date is lost without a word.
- Evidence: .local/qa/campaign/settings/fr-credits-period-invalid.png · credits.txt

### SETTINGS-08 — Sessions list: 177 rows on one page, each « Déconnecter » acts at the first click
- Page: /fr/settings/security (owner, fr, 1440 px and 390 px)
- Severity: Minor
- Type: UX
- Steps: 1. Sécurité › SESSIONS ACTIVES (shared QA owner account, many sign-ins today). 2. Scroll to « Clients bloqués ». 3. Click « Déconnecter » on any row.
- Expected: a readable list (most recent first, « Voir tout » / pagination, old sessions expired), device details that tell sessions apart, and a confirm or undo for a destructive click (12 §25 « sessions with CETTE SESSION, Déconnecter per device »).
- Actual: 177 rows « Chrome · Windows · 154.247.207.26 », several « MAINTENANT », all on one page; « Déconnecter tous les autres appareils » and the whole « Clients bloqués / Règles automatiques / Mots bloqués » section sit below them (thousands of px). One click on « Déconnecter » sends `DELETE /me/sessions/:id` → 204 immediately (no dialog, no undo) — this is how a test session of another agent was probably revoked (see the note at the top).
- Evidence: .local/qa/campaign/settings/security.txt (« sessions rows 177 ») · fr-security-bottom.png · API: DELETE /me/sessions/f29d4ae5-… → 204

### SETTINGS-09 — Number fields of the settings drop « - » and « . » and silently cut long values (same input as PRODUCTS-01)
- Page: /fr/settings/workspace and /fr/settings/security › Règles automatiques (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Espace de travail › « RAPPEL PROPRIÉTAIRE… (MIN) » type `-5`, `2.5`, `99999999`; « LIVRAISON GRATUITE À PARTIR DE (DA) » the same. 2. Sécurité › Règles automatiques › SEUIL type `-2`, `1.5`, `1000` then Tab (auto-saved).
- Expected: a negative or decimal value refused with a message; the range « Entre 1 et 50 » shown for any value outside it (it is shown for `0`).
- Actual: `-5` → « 5 », `2.5` → « 25 », `99999999` → « 9 999 » (minutes) / « 99 999 999 » (DA); on SEUIL `-2` is saved as 2, `1.5` as 15 and `1000` as 10 (`PUT /safety/rules {"autoBlockAfterUncollected":15}` → 200, toast « Enregistré »), no warning. Restored to 3 / 30.
- Evidence: .local/qa/campaign/settings/workspace.txt (« NUM … typed 2.5 -> "25" ») · safety3.txt · Same component as PRODUCTS-01 / ORDERS-01

### SETTINGS-10 — Browser « Back » leaves a settings form with unsaved changes without the leave guard
- Page: /fr/settings/profile (owner, fr, 1440 px); the sidebar links and the system-message / quick-reply / workspace forms do ask
- Severity: Minor
- Type: Bug
- Steps: 1. Membres › Profil. 2. Change the first name. 3. Browser Back.
- Expected: « Quitter sans enregistrer ? » like for a sidebar click (12 §0 leave guard).
- Actual: goes straight back to /fr/settings/members, the change is lost. (Sidebar link → guard shown; F5 → browser « beforeunload » shown.) Same as PRODUCTS-06.
- Evidence: .local/qa/campaign/settings/misc.txt (« after back: url …/settings/members | dialog  ») · fr-back-guard.png

### SETTINGS-11 — Quick replies: two replies can share the same shortcut
- Page: /fr/settings/quick-replies (owner, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Reply A (FR) shortcut `/qamerci`. 2. Reply B (AR) › Modifier › RACCOURCI `/qamerci` › Enregistrer.
- Expected: shortcut unique in the workspace (typing « /qamerci » in the composer must insert one known text), or at least a warning.
- Actual: `PATCH /workspace/quick-replies/:id {"shortcut":"/qamerci"}` → 200; the list shows both rows with « /qamerci ». (Title uniqueness per language works: « Titre déjà utilisé. », also case-insensitive.)
- Evidence: .local/qa/campaign/settings/qr4.txt

### SETTINGS-12 — Misleading error texts: private-IP webhook « HTTPS obligatoire », long promo code « Vérifiez les champs. »
- Page: /fr/settings/integrations/webhooks and /fr/settings/billing › Changer de plan (owner, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Webhook › Modifier › URL `https://127.0.0.1/qa-settings` (also `https://localhost/…`, `https://10.0.0.1/…`, `https://169.254.169.254/…`). 2. Changer de plan › CODE PROMO with 60 characters › Appliquer.
- Expected: « Adresse privée ou locale refusée » (the URL is HTTPS); « Code trop long (50 max) » or a `maxlength` on the field.
- Actual: 1. `WEBHOOK_URL_INVALID` « URL invalide (HTTPS obligatoire). » for an https URL (the block itself is correct: no SSRF). 2. `VALIDATION_ERROR` « Vérifiez les champs. » under the promo field (fields.code = validation.length); the field has no maxlength.
- Evidence: .local/qa/campaign/settings/webhooks2.txt · billing2.txt · API: PATCH /webhooks/:id → 422 · POST /billing/promo/validate → 422

### SETTINGS-13 — Arabic preview of « Rupture de stock » mixes a French sample product (« عذرًا، La Robe satin غير متوفر حاليًا »)
- Page: /fr/settings/system-messages › tab العربية (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Messages système › العربية. 2. Read « APERÇU » of « RUPTURE DE STOCK ».
- Expected: a sample name in the tab's language (or neutral) so the merchant sees a realistic message.
- Actual: « عذرًا، La Robe satin غير متوفر حاليًا. » (same French name in the English tab).
- Evidence: .local/qa/campaign/settings/fr-sys-ar-tab.png · sysmsg2.txt

### SETTINGS-14 — Pending invitation shows « EXPIRE DANS 8 J » right after « Renvoyer » (link valid 7 days)
- Page: /fr/settings/members (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Bug
- Steps: 1. Invite `qa-settings-1@test.djaber.local` (« EXPIRE DANS 7 J »). 2. After 60 s « Renvoyer ».
- Expected: « Lien valable 7 j » → « expire dans 7 j ».
- Actual: « OPÉRATEUR · ENVOYÉE MAINTENANT · EXPIRE DANS 8 J » (`expiresAt` = sentAt + 7 d; `Math.ceil` turns 7 d + a few seconds of clock difference into 8).
- Evidence: .local/qa/campaign/settings/members2.txt (« PENDING2 … EXPIRE DANS 8 J ») · Likely cause: apps/web/src/lib/time.ts:25 (`Math.ceil`)

### SETTINGS-15 — Yearly view: the current plan card says « VOTRE PLAN » and « Passer à Pro »
- Page: /fr/settings/billing?cycle=yearly (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Plan & facturation (Pro monthly) › « Annuel · −2 mois ».
- Expected: « Passer à l'annuel » (or « Payer à l'année ») on the current plan.
- Actual: Pro card « VOTRE PLAN … 4 083 DA / MOIS · ANNUEL … Passer à Pro · facturé 49 000 DA / an ».
- Evidence: .local/qa/campaign/settings/fr-billing-yearly.png · billing.txt

### SETTINGS-16 — Phone width: active settings tab off-screen, credits pill wraps, Arabic e-mails cut at the start
- Page: /fr|ar/settings/* (owner, 390 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. At 390 px open Paramètres › Notifications (or Sécurité, Crédits…). 2. Look at the horizontal sub-nav and the top bar. 3. In Arabic open Membres.
- Expected: the active sub-nav item scrolled into view; the credits pill on one line; e-mails displayed LTR (`<Ltr>`) and cut at the end.
- Actual: the sub-nav shows « Profil · Espace de travail · Membres · Mode stock », the active « Notifications » is hidden to the right; the pill breaks into « 6 / 5 000 · packs 0 / » + « 5 »; in Arabic « taire@test.djaber.local », « in@test.djaber.local » (start of the address cut). The notifications matrix needs an inner horizontal scroll to reach the SON column. No page-level horizontal scroll on any settings page (fr / ar at 390 px).
- Evidence: .local/qa/campaign/settings/fr-tour-390-_settings_notifications.png · ar-tour-390-_settings_members.png

## Coverage
- **Profile** (fr): fields valid / empty (« Champ requis ») / 300 chars (« Trop long (80 max) ») / Arabic + emoji (saved, then restored); leave guard (sidebar ✓, Back ✗ SETTINGS-10, F5 beforeunload ✓); avatar wrong type (« Format non supporté ») and 6 MB (« Image trop lourde (5 Mo max) »); e-mail change dialog (invalid, same e-mail, password required, ESC); delete-account dialog (owner blocked, « Supprimer » greyed with reason, link to danger zone).
- **Workspace**: all fields, name empty / 200 chars, phone formats, numeric fields, leave guard, save + « Enregistré » toast, F5, logo button; concurrent edit from a second signed-in browser (live refresh, no lost update, no 409 seen).
- **Members**: roles explainer, row menus (owner: Transférer; admin: Passer Opérateur / Retirer; operator: Passer Admin / Retirer), invite dialog (empty, invalid, existing member `MEMBER_ALREADY_EXISTS`, valid, duplicate case-insensitive `INVITATION_PENDING`), resend cooldown 60 s, revoke confirm, section-access checkbox (blocked), transfer-ownership dialog (password required, submit blocked), demote / remove dialogs (submit blocked).
- **Notifications prefs**: matrix read (in-app always, push greyed « bientôt disponible », e-mail locked rows with title « toujours envoyé »), one e-mail toggle saved / reloaded / restored, sound switch.
- **Quick replies**: add (empty, duplicate title per language and case, 1 001 chars capped at 1 000, bad shortcut format, Arabic + emoji, unknown variable), edit, Monter / Descendre (first / last greyed), reorder persisted after F5, delete confirm, ESC on a dirty dialog (guard ✓), offline save (« Pas de connexion », sent on reconnect).
- **System messages**: 4 keys × fr / ar / en tabs (RTL textarea in Arabic ✓), preview, empty (« Vide = texte par défaut »), 1 000-char cap, wrong-case / unknown variable (SETTINGS-02), reset dialogs (cancelled), leave guard ✓.
- **Security**: password form (empty, weak, mismatch « Ne correspond pas », valid → blocked), e-mail dialog, 2FA activate dialog (setup blocked → « Impossible de charger » + Réessayer), sessions list (SETTINGS-08); **Safety**: source filter in the URL (`?blockSource=`), block-number dialog (SETTINGS-03), unblock confirm, auto rules (toggle + seuil), blocked words (add list, duplicate, Arabic, 200-char cap, remove).
- **Stock mode**: « Simple » card → confirmation dialog text; confirm blocked (safety), page unchanged.
- **Credits**: tiles, filters Période / Action / Agent / Origine (URL kept after F5), pagination (`?page=2`, « 26–50 sur 151 »), CSV export job (« Export terminé · credits-2026-11-15.csv » + Télécharger), « Acheter un pack » dialog (checkout blocked), `?buy=1`, calculator dialog.
- **Billing**: plan cards, monthly / yearly toggle (`?cycle=yearly` kept after F5), « Renouveler » greyed with reason, free-plan card → « Résilier l'abonnement » dialog (Garder), change-plan dialog (prorata, promo: unknown / Arabic / blank / 60 chars, pay → blocked), deep links `?change=pro`, `?change=nope` (ignored), invoices (status filter `?status=unpaid` → filtered-empty state with « Effacer les filtres »), invoice menu, PDF download (F-2026-00004.pdf ✓), « Ouvrir la facture » (opens a tab — blank in headless Chromium, not judged), billing info dialog (NIF `abc` accepted then restored), « Résilier à la fin de la période » dialog (cancelled), return page `?ref=nope` (« Paiement introuvable »).
- **Integrations**: Sheets (state ERREUR · ACCÈS RÉVOQUÉ · VÉRIFICATION GOOGLE EN ATTENTE, filters dialog, disconnect dialog cancelled, « Reconnecter Google »), API keys (create: empty name / no scope / valid → shown once + Copier, ESC closes; revoke confirm; RÉVOQUÉE row), webhooks (empty URL, http, garbage, localhost / private IPs refused, no event, create → secret once, edit events, deliveries log with endpoint / status filters in the URL kept after F5, Tester → blocked, Régénérer le secret, Réactiver greyed, Supprimer).
- **Danger zone**: delete-workspace dialog (typed name: lower case refused, e-mail refused with hint, exact name + password enables « Programmer la suppression »; submit blocked by my own route block), delete-account dialog.
- **Locales / widths**: every settings page in fr, ar (RTL) and en at 1440 px and fr + ar at 390 px: no page-level horizontal scroll, no untranslated French in en, Arabic fully translated; kit text-leak hits are only the intended variable chips `{prénom} {total} {boutique}`, `{PRODUCT}` / `{SHOP}` (SETTINGS-02) and the developer note « 403 API_SCOPE_FORBIDDEN » on the API-keys tab (developer documentation, not counted).
- No console errors and no failed API calls other than the expected 4xx of the validation tests and the 418 safety blocks.

## Blocked by safety
- `PATCH /workspace/members/:id` (section access checkbox, « Passer Opérateur ») — 2 calls.
- `POST /workspaces/:id/transfer-ownership` (wrong password) — 1.
- `PATCH /me/password` — 1 (×2 runs).
- `POST /auth/2fa/setup` — 1 (×2 runs).
- `PATCH /workspace {"stockMode":"simple"}` — 1.
- `POST /billing/checkout` (yearly Pro) — 1.
- `POST /credits/packs/checkout` — 1.
- `POST /webhooks/:id/test` — 1.
- `DELETE /workspace` (danger zone) — blocked by a route I added in my script: **the kit does not block it** (it only blocks `POST /workspace/deletion`), nor `POST /billing/cancel` (« Résilier ») nor `GET /integrations/google-sheets/connect` (« Reconnecter Google » navigates to accounts.google.com; I stopped at the Google sign-in page) nor `DELETE /me/sessions/:id`. Recommend adding these four to `BLOCKED` in `tools/qa/pw-kit.mjs`.

## Not tested
- Real 2FA setup / disable / recovery codes, password change, e-mail change, ownership transfer, role change, member removal, stock-mode switch, workspace / account deletion, pack and plan payment, Chargily online-payment toggle, webhook test ping, Google OAuth: safety rules (dialogs only).
- Avatar / logo crop and upload with a valid image (would change the shared accounts' pictures); only the error states were checked.
- Billing return states verifying / success / pending / failed / expired: need a real checkout ref.
- Conflict 409 on a stale form: the second session received the live update before saving, so no stale version could be produced.
- « Déconnecter tous les autres appareils »: would sign out every other agent.
- Role views (admin / operator) of the settings: covered by the `roles` area.
