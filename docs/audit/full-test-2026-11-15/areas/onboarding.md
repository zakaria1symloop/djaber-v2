# Area onboarding — tested 16/11/2026 12:00–12:20 (Africa/Algiers)

Live https://djaber.vercel.app. Three brand-new merchants created through the real sign-up page (`qa-onb-1|2|3@test.djaber.local`). All browser sessions ran through `tools/qa/pw-kit.mjs`. The kit's `allow` list held only `PATCH /workspace/onboarding` and `PATCH /workspace`, and only for these 3 accounts. For account 3, the sign-up and the skip happened in one browser (`signedOut` + the same `allow`), so that the plan picked on /pricing stayed in that browser's storage. Each script also aborted `GET /channels/connect/(facebook|instagram)` itself, which is stricter than the kit. Screenshots: `.local/qa/campaign/onboarding/`. Scripts and logs: `.local/qa/campaign/onboarding/scripts/` and `*.log` (passwords redacted).

Summary: 1 Major, 12 Minor, 2 Cosmetic. The tunnel works from start to finish in fr, ar and en, and on a 390 px phone. The saved progress, the resume rule, the stepper, F5, browser Back, « plus tard » and « Passer la configuration » all behave as written in 02 §3.3. No console errors except the known visitor `POST /auth/refresh` 401 (PUBLIC-12). No technical text on screen.

### ONBOARDING-01 — Step 4 « Choisissez votre agent IA » shows 3 test presets (« test », « testtest », « Mohamed benkhelifa ») and hides 3 of the 4 real templates
- Page: /fr/onboarding/agent, /ar/onboarding/agent (new owner, fr / ar, 1440 and 390)
- Severity: Major
- Type: Bug
- Steps: 1. Sign up. 2. Go through steps 1–3. 3. Look at step 4.
- Expected: 4 Preset Cards: Vendeur Pro · Service client · Conseiller produit · Réponse express (02 §3.3, 12 §2, Figma ONB-01 step 4).
- Actual: the 4 cards are « test (Chaleureux, il conclut la vente) », « testtest » (no tagline; « testest » in AR), « Vendeur Pro » and « Mohamed benkhelifa » (a person's name). Service client, Conseiller produit and Réponse express never appear on this step. They exist in the server list (the agent wizard shows them in position 6–8). Cause: `apps/web/src/features/onboarding/presets.ts` keeps `server.slice(0, 4)` of `GET /agents/presets`, and the platform's QA presets come first (same data as AGENTS-06). This is the first agent choice every new merchant makes, and 3 of its 4 options are junk.
- Evidence: .local/qa/campaign/onboarding/fr-s2-agent-first.png · ar-s7-agent-full.png · API: GET /agents/presets → 200 (keys test, testtesttest, vendeur-pro, elmo, …)

### ONBOARDING-02 — The plan picked on /pricing is never offered after the onboarding: the « Voir ce plan » banner is always hidden behind the e-mail verification banner
- Page: /en/pricing → /en/signup?plan=pro&cycle=yearly → onboarding → /en/home (new owner, en, 1440, one browser)
- Severity: Minor
- Type: UX
- Steps: 1. Pricing › Yearly › Pro CTA. 2. Sign up. 3. Skip or finish the tunnel. 4. Look at Home and any other page.
- Expected: « paid plans: plan intent kept in the browser, offered after onboarding by the shell banner "Voir ce plan" → /settings/billing?change=<slug>&cycle= » (02 §1 `/pricing` row, FL-04).
- Actual: `djaber.planIntent = {"plan":"pro","cycle":"yearly"}` is stored, but the shell shows one banner at a time. `planIntent` is last in `BANNER_PRIORITY`, and every new account has the higher `emailUnverified` banner (« Verify your email to be able to connect a page… », no dismiss). So the plan offer never shows until the e-mail is verified, and only in that same browser. The Ready step does not mention the plan either. The /settings/billing?change=pro&cycle=yearly target itself works: the « Change plan » dialog opens with Yearly 49 000 DA preselected.
- Evidence: .local/qa/campaign/onboarding/en-s8-home-full.png (data-shell-banner = emailUnverified) · en-s8-billing.png · fr-s4-home-intent.png

### ONBOARDING-03 — « Partir de zéro »: the agent wizard runs inside the tunnel with the full app sidebar, whose links throw the merchant back to step 4
- Page: /fr/agents/new?start=scratch, /knowledge, /behaviour during onboarding step 4 (new owner, fr, 1440)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Step 4 › « Partir de zéro (assistant 5 étapes) ». 2. Look at the screen. 3. Click « Commandes » in the sidebar.
- Expected: « agent wizard in transit (step 4 "Partir de zéro": /agents/new steps 1–3, links to other app pages hidden) » (12 §17 Onboarding — transverse).
- Actual: the full merchant shell is shown: sidebar (Accueil, File d'attente, Commandes, Livraison, Clients, Produits, Agents IA, Paramètres…), global search, credits, bell. Every sidebar link silently redirects to /fr/onboarding/agent (resume rule), so the wizard is closed. Steps « 4 · Canaux » and « 5 · Test & activation » are also shown in the wizard stepper, and the link is labelled « assistant 5 étapes », although only steps 1–3 run in the tunnel. The rest works: steps 1–3, Précédent, clean « Annuler » → back to step 4, and « Enregistrer et passer à la page » → /onboarding/connect with the draft saved and the progress set to 5.
- Evidence: .local/qa/campaign/onboarding/fr-s3-wizard-1.png · fr-s3b-sidebar-click.png

### ONBOARDING-04 — The first product created in the tunnel is « En attente de validation Djaber » (hidden from the AI), but the tunnel says « Premier produit ajouté » and never mentions it
- Page: /fr/onboarding/first-product → /ready, then /fr/products (new owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Step 3: create « QA onboarding produit robe … » (12 500 DA, stock 8, photo). 2. Finish the tunnel. 3. Open Produits.
- Expected: the merchant learns that the product must be validated before the agent can sell it. MOD-01 says every creation is moderated, and the readiness check of wizard step 5 lists « products pending moderation » (03 AGV-02).
- Actual: Ready shows « ✓ Premier produit ajouté » and Home shows « 1 / 4 ». Agent wizard step 2 says « Tout le catalogue (0 produit actif) » with no explanation. Only /products shows « EN ATTENTE · EXCLU · En attente de validation Djaber : l'IA le proposera une fois validé ». Right after the tunnel, a new merchant's agent would answer « pas disponible » about the only product they entered.
- Evidence: .local/qa/campaign/onboarding/fr-s4-products.png · fr-s3b-ready.png

### ONBOARDING-05 — Option cards (stock mode, page type) show the selection only with a tiny « ACTIF » badge; on step 5 « Facebook (Messenger) ACTIF » before anything is connected
- Page: /fr/onboarding/stock-mode, /fr/onboarding/connect, /ar/… (new owner, fr / ar, 1440 / 390)
- Severity: Minor
- Type: UX
- Steps: 1. Step 2: click « Avancé ». 2. Step 5: look at the two cards.
- Expected: a clearly selected Option Card (Figma ONB-01 step 2 / step 5: border + radio).
- Actual: the selected card has the same border as the other one. The only sign is a 9-px label « ACTIF » (AR « نشطة »), which is the text of `enum.Workspace.status.active` (`tunnel.tsx` passes `badge={t('enum.Workspace.status.active')}` to every OptionCard). On step 2 it reads as if « Avancé » were already active before saving. On step 5 it says « Facebook (Messenger) ACTIF » for a shop with no page connected.
- Evidence: .local/qa/campaign/onboarding/fr-s2-stock-advanced.png · fr-s3b-connect-hover.png · ar-s6-stock.png

### ONBOARDING-06 — First product: a price above the maximum says « Prix de vente requis (> 0) », and the stock « Quantité invalide » gives no limit
- Page: /fr/onboarding/first-product (new owner, fr, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Type `99999999999999` in Prix (kept as 999 999 999) and `999999999999` in Stock (kept as 99 999 999). 2. « Enregistrer et continuer ».
- Expected: a message that says what is wrong (`validation.range`-style « Maximum … »). 11-error-catalogue: the message must explain the error.
- Actual: « Prix de vente requis (> 0) » under 999 999 999 DA, and « Quantité invalide » under 99 999 999, the schema max being 10 000 000. The inputs accept more digits than the schema allows (MoneyInput 9 digits, NumberInput `maxDigits={8}`).
- Evidence: .local/qa/campaign/onboarding/fr-s2-product-extreme.png

### ONBOARDING-07 — First product: invalid characters are silently dropped (« -12,5 » becomes 125 DA, « -3.7 » becomes stock 37)
- Page: /fr/onboarding/first-product (new owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Type `-12,5abc` in Prix and `-3.7x` in Stock. 2. Read the fields.
- Expected: a refusal or a hint (integer DA, no negative), not a different number.
- Actual: the fields show « 125 » and « 37 ». The minus sign and the decimal separator are removed, so a merchant who types « 12,5 » (meaning 12 500) gets 125 DA with no warning, and the product is created at that price.
- Evidence: .local/qa/campaign/onboarding/fr-s2-product-wrong.png · s2.log « values typed 125 | 37 »

### ONBOARDING-08 — First product: errors stay after the field is fixed, and the empty-stock error only appears on a second submit
- Page: /fr/onboarding/first-product, /ar/onboarding/first-product (new owner, fr / ar, 1440 / 390)
- Severity: Minor
- Type: UX
- Steps: 1. Submit the empty form. 2. Fill name and price, leave Stock empty. 3. Submit again.
- Expected: one validation pass shows every missing required field (Nom *, Prix *, Stock *), and an error disappears once the field is filled (12 GLOBAL field-error state).
- Actual: the first submit flags only Nom and Prix. Stock * gets « Champ requis » only on the second submit (the stock rule is a `superRefine` that zod runs only when the base fields pass). After typing a valid name / price, « Champ requis » stays red under the filled fields until the next submit (AR screenshot: « حقل مطلوب » under « QA onboarding produit 2 … » and « 4 900 »).
- Evidence: .local/qa/campaign/onboarding/fr-s2-product-empty.png · ar-s6-product-filled.png · ar-s7-product-nostock.png

### ONBOARDING-09 — First-product form has no leave guard: the back link, the stepper and F5 throw away the typed values and the photo
- Page: /fr/onboarding/first-product (new owner, fr, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Step 3 › « Ajouter un autre produit ». 2. Type a name and a price (or pick a photo). 3. Click « ← Stock », or press F5.
- Expected: the GLOBAL leave guard « Quitter sans enregistrer ? » (CLAUDE rule 7, 12 GLOBAL), as the agent wizard does (« Quitter sans enregistrer ? Rester / Quitter » works there).
- Actual: no dialog and no `beforeunload`. The page changes and the typed product is lost.
- Evidence: .local/qa/campaign/onboarding/fr-s9-dirty-back.png · s9.log

### ONBOARDING-10 — « Passer la configuration » is one click, with no confirmation, and the tunnel can never be reopened
- Page: /en/onboarding/welcome → /en/home (new owner, en, 1440)
- Severity: Minor
- Type: UX
- Steps: 1. Sign up. 2. Click « Skip setup » (a ghost link at the top right). 3. Try /en/onboarding/welcome or /en/onboarding/ready. 4. Look in Settings.
- Expected: « quitter ("Passer la configuration" → Home 0/4) » (12 §17), and the merchant can come back to the guided setup.
- Actual: one click writes `onboardingStep = 99` (`PATCH /workspace/onboarding {"step":99}` → 200), with no confirm and no undo toast. After that, every /onboarding/* URL redirects to /home, and no « Reprendre la configuration » entry exists (Settings, user menu, Home). Only the Home « Get started 0 / 4 » list remains, and it links to the full screens (/channels, /products, /agents, /orders), not to the tunnel. A merchant who clicks it by mistake never sees the preset choice or the stock-mode question again. That card's order (page, products, agent, sale) also differs from the tunnel's (product, agent, page).
- Evidence: .local/qa/campaign/onboarding/en-s8-home-full.png · s8.log

### ONBOARDING-11 — No « reprise » banner when a merchant signs in again in the middle of the tunnel
- Page: /ar/login → /ar/onboarding/agent (new owner, ar, 390)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Stop at step 4 and close the browser. 2. Sign in again.
- Expected: « reprise (banner at next login) » (12 §17 Onboarding — transverse).
- Actual: the resume itself is correct: login lands on /ar/onboarding/agent, the saved step. But nothing tells the merchant that they are resuming the setup: no banner and no toast.
- Evidence: .local/qa/campaign/onboarding/ar-s7-resume.png

### ONBOARDING-12 — Agent wizard (in the tunnel) promises « plan : 5 000 crédits » while a new trial has 300 credits
- Page: /fr/agents/new?start=scratch (and /knowledge, /behaviour) (new owner, fr, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Step 4 › « Partir de zéro ». 2. Read « ESTIMATION CRÉDITS » in the right column, and the credit counter at the top.
- Expected: the trial grant of 300 credits (D60), the figure the top bar shows (« 5 / 300 »).
- Actual: « Estimation mensuelle : — (aucune conversation ce mois-ci ; plan : 5 000 crédits) ». Billing shows « CREDITS · PERIOD … 0 / 300 » for the same trial.
- Evidence: .local/qa/campaign/onboarding/fr-s3-wizard-1.png · en-s8-billing.png

### ONBOARDING-13 — Agent preset cards: the arrow keys do not move the selection (radiogroup without keyboard handling)
- Page: /fr/onboarding/agent (new owner, fr, 1440, keyboard)
- Severity: Minor
- Type: Bug
- Steps: 1. Focus the first preset card. 2. Press →.
- Expected: `role="radiogroup"` / `role="radio"`: the arrow keys move focus and selection (WAI-ARIA radio group), as the stock-mode Option Cards do.
- Actual: focus stays on the first card and the selection does not change. The cards are buttons with `role="radio"`, and every card is a separate Tab stop.
- Evidence: s3.log « after ArrowRight focused test checked: false,false,false,true »

### ONBOARDING-14 — « Remplir avec l'IA » dialog in the tunnel: out-of-place subtitle and a pointer to « Générer des variantes », which does not exist there
- Page: /fr/onboarding/first-product › « Remplir avec l'IA » (new owner, fr, 1440)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Step 3: pick a photo. 2. « Remplir avec l'IA » › « Analyser (5 crédits) ».
- Expected: texts that match the onboarding step (name, price, stock, photo only; simple stock mode has no variants).
- Actual: the subtitle is a breadcrumb from another screen: « Produits › + Nouveau › « Remplir avec l'IA » · 5 crédits ». The result says « Attributs détectés : Couleurs : Rouge, Jaune-vert… — utilisez « Générer des variantes » ». That button exists neither in the tunnel nor in simple mode. The analysis itself works: the name was filled (« Dégradé de couleurs abstrait »), and the price was not proposed.
- Evidence: .local/qa/campaign/onboarding/fr-s2-ai-result.png · API: POST /products/ai-fill → 200

### ONBOARDING-15 — Step 5 unverified-e-mail notice: the e-mail address is split and reordered in Arabic, and broken at the hyphen in French
- Page: /ar/onboarding/connect (390), /fr/onboarding/connect (1440) (new owner)
- Severity: Cosmetic
- Type: Bug
- Steps: 1. Reach step 5 with an unverified e-mail.
- Expected: the e-mail kept in one LTR run (`<Ltr>` / `<bdi>`, CLAUDE rule 7).
- Actual: AR reads « أُرسل الرابط إلى -qa-onb » on one line and « 2@test.djaber.local. » on the next, so the hyphen jumps to the wrong side. FR breaks « qa-onb- / 1@test.djaber.local ». The same text sits in the Home banner.
- Evidence: .local/qa/campaign/onboarding/ar-s7-connect-full.png · fr-s3b-connect-hover.png

## Coverage
- **Sign-up** (fr 1440, ar 1440, en 1440):
  - Plan note from /pricing (`?plan=pro&cycle=yearly`): shown, but it does not name the plan (already PUBLIC-10).
  - Empty submit; weak password with the character count; e-mail with spaces around it (accepted).
  - Double-click on the submit button, then a third click: one `POST /auth/register` (201).
  - Second sign-up with the same e-mail in upper case: 409 `AUTH_EMAIL_TAKEN`, « Cet e-mail est déjà utilisé — Se connecter · Mot de passe oublié ? ».
  - After sign-up: /<locale>/onboarding/welcome. Workspace named « Boutique de QA onboarding » (fr) / « متجر QA onboarding » (ar). Trial Pro ends 30 Nov 2026; 300 credits.
- **E-mail verification:**
  - Banner « Vérifiez votre e-mail… » + « Renvoyer » on every app page (not on tunnel steps 1–4). Step 5 notice, with the connect button disabled and « Renvoyer » → `POST /auth/verify-email/resend` 200, then « Renvoyer dans 0:58 ».
  - The verification link itself could not be opened (mailbox @test.djaber.local).
- **Step 1, Welcome** (fr, ar, en): texts and tiles. The kit-blocked PATCH shows the error toast and stays on the step (save-failure state). F5 works.
- **Step 2, Stock mode:**
  - Both cards; changed my mind twice; saved « Avancé » (`PATCH /workspace {stockMode:"advanced"}` 200).
  - Reopened the step from the stepper (Avancé preselected), switched back to « Simple » (PATCH 200).
  - « Plus tard »; F5; browser Back / Forward.
- **Step 3, First product:**
  - Empty; spaces only; negative / decimal / letters; 300-char name (capped at 255); extreme price / stock; Arabic + emoji name.
  - `.txt` file refused (« Format non supporté »); a 200×200 PNG accepted and uploaded (`POST /products/:id/images` 201).
  - « Remplir avec l'IA » once (5 credits).
  - Product already created (« Votre catalogue contient déjà… » + Continuer / « Ajouter un autre produit »); « Ajouter un autre » with empty stock; « Plus tard » from the add-another form.
  - Double-click on « Enregistrer et continuer »: 1 `POST /products`.
- **Step 4, Agent:**
  - Clicked each of the 4 cards (the label follows: « Créer « test » » …); keyboard.
  - « Partir de zéro »: wizard steps 1–3 in the tunnel (empty name error, Précédent, stepper tabs 4–5 not reachable, clean Annuler → back to step 4, sidebar link, « Enregistrer et passer à la page » → step 5).
  - Agent already created (« Continuer avec « … » », no card preselected).
  - Preset creation « Créer « Vendeur Pro » » in fr and in ar (« البائع المحترف »); double-click → 1 `POST /agents`.
  - Dirty wizard « Annuler » → leave guard OK.
- **Step 5, Connect:**
  - Explainer, the two cards, « Ce que Djaber ne fera jamais ».
  - Connect button disabled (e-mail unverified): the Meta call was never reachable; see Blocked by safety.
  - « Plus tard » → Ready. F5, Back.
- **Step 6, Ready:**
  - Checklist rows (stock mode, product done, agent todo for a draft, page todo, first sale).
  - « Tester mon agent » → `/agents/new/activate?draft=…` (draft); « Importer mon catalogue » → /products/import; « Inviter mon équipe » → /settings/members; « Aller à l'accueil ».
  - Stepper back to Welcome after completion; F5.
- **Resume rule:**
  - Closed the browser at step 4, signed in again → /ar/onboarding/agent.
  - /onboarding/connect ahead of the progress → step 4; /home and /orders during the tunnel → step 4.
  - Leaving a reopened step never lowered the saved step (no PATCH sent when going back).
  - Unknown slug /onboarding/nope → saved step.
  - After completion (6): all steps reopenable, login → /home.
  - After skip (99): every /onboarding/* → /home.
- **Skip** (en): lands on /en/home. New-shop Home: « All quiet », KPI 0, « No connected page », Get started 0 / 4 with links, e-mail banner. Billing change dialog from the plan-intent URL (opened, not paid).
- **Layout:** ar RTL at 1440 and 390 (welcome, stock, product, agent, connect, ready, Home): `dir=rtl`; price / stock inputs LTR; no horizontal scroll (scrollWidth = clientWidth on every step). en 1440.
- **Recorder:** console errors only the visitor `POST /auth/refresh` 401 on /login and /signup (PUBLIC-12). No API error besides the expected 409 and the kit's 418. No text leak in the tunnel. The `{name} {price}…` hits on wizard step 3 are the insert chips of the card template, not leaks.

## Blocked by safety
- Meta page connect (step 5, « Continuer avec Facebook / Instagram »): never sent. The button is disabled while the e-mail is unverified (by spec), and the scripts additionally aborted `GET /channels/connect/(facebook|instagram)`. So the pop-up, waiting dialog, OAuth refused, per-page report, page-limit warning and « pages already connected + Continuer » states were not reached.
- Paying the plan from the plan-intent dialog (« Pay 49 000 DA (CIB / Edahabia) »): not clicked.
- First sale / courier: out of scope, not attempted.

## Not tested
- The verification e-mail and the /verify-email link (the @test.djaber.local mailbox cannot be read), so the « e-mail verified » path of step 5 was not reached.
- Step 5 with a connected page, Instagram « approval pending » note (the API says Instagram is approved, so the note does not show), plan-limit rows.
- Ready next actions disabled at the plan limit (a trial Pro shop is far from the limits).
- « Créer mon espace » for invited-only users (/workspaces/new) and the tunnel for a non-owner member.
- Session expiry in the middle of the tunnel, and offline mode.

## Test data
- `qa-onb-1@test.djaber.local` (fr). Workspace « Boutique de QA onboarding ». Onboarding finished (step 6). Stock mode simple (was advanced then simple).
  - Products: « QA onboarding produit robe فستان صيفي » (12 500 DA, stock 8, 1 photo, pending moderation); « QA onboarding produit double-clic » (3 000 DA, stock 2).
  - Agents (drafts): « QA onboarding agent zéro » (from scratch, display name Amina, saved at wizard step 4 / 5); « Vendeur Pro » (preset vendeur-pro).
  - 5 credits used by « Remplir avec l'IA ».
- `qa-onb-2@test.djaber.local` (ar). Workspace « متجر QA onboarding ». Onboarding finished (step 6). Stock mode simple.
  - Products: « QA onboarding produit 2 حذاء رياضي 👟 » (4 900 DA, stock 15); « QA onboarding produit 2b بدون مخزون » (1 500 DA, stock 3).
  - Agent (draft): « البائع المحترف » (preset vendeur-pro).
- `qa-onb-3@test.djaber.local` (en). Workspace created at sign-up (default name). Onboarding skipped (step 99). No product, no agent. Plan intent pro / yearly stored in that browser only.
- Passwords: `.local/qa/onboarding-accounts.json` (git-ignored).
