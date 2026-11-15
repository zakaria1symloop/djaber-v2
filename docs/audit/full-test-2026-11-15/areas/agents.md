# Area agents — tested 15/11/2026 17:30–18:20 (Africa/Algiers)

Owner account, test shop « Boutique Test Équipe », live https://djaber.vercel.app (Playwright, kit `tools/qa/pw-kit.mjs`).
Scripts and raw outputs: `.local/qa/campaign/agents/scripts/` and `.local/qa/campaign/agents/*.txt`.
Test data created is named « QA agents … »: draft agent « QA agents Vendeur » (id 01a1e00a-9f90-74ac-af79-2f0c622b4793,
preset Vendeur Pro, 6 FAQ rows « QA agents … » / imported). The « QA ai-chat Agent » of the ai-chat area was not touched.
A copy « QA agents Vendeur (copie) » was created (Dupliquer) and deleted again; one 24 h test link was created for « QA agents Vendeur ».
Context: every Facebook page of the test shop is « DÉCONNECTÉ », so no agent can be activated / paused / linked (see « Not tested »).
**Data incident (mine, reverted):** while testing the « Résoudre l'insight » dialog of the shop agent « Pro Seller », a 500 × « x »
instruction was submitted by mistake (`POST /agent-insights/01a1736e-…/resolve` → 200, 3 grouped insights now « Résolus », version v10).
It was reverted at once by restoring v9 (« Pro Seller » is now v11 = v9 content, instructions checked clean). The 3 insights stay « Résolus ».
AI messages used: 15 (8 step-5 scenarios + 7 playground turns).

### AGENTS-01 — Step 5 scenario labels do not match the messages actually sent: the merchant reads « vous avez des iPhone ? » → « Non, nous ne vendons pas de voitures neuves »
- Page: /fr/agents/new/activate?draft=… (owner, fr, 1440 px), block « Scénarios de test automatiques »
- Severity: Major
- Type: Bug
- Steps: 1. Create an agent through the wizard up to step 5. 2. Click « Relancer les 8 scénarios ». 3. Read each row (label + answer).
- Expected: each row shows the customer message that was really sent and the AI answer to it (12 §22 « 8 scenario rows with results and Ouvrir › »; AGV-02 « darija price, arabizi fee … 12 units »).
- Actual: the labels are i18n texts that differ from the server's seeded messages, so the answers look absurd:
  « Hors catalogue : « vous avez des iPhone ? » » → « Non, nous ne vendons pas de voitures neuves 🙂 … » (server sends « Est-ce que vous vendez des voitures neuves ? »);
  « Arabizi : « nwasli l setif ch7al livraison » » → « Le tawsil l'Oran coûte 600 DA … » (server sends « salam, chhal tawsil l Oran ? »);
  « Darija : « kayen parfum oud ? ch7al ? » » → « وعليكم السلام 😊 أي منتوج تقصد بالضبط؟ » (server sends « سلام، بشحال هذا المنتوج؟ » — no product named);
  « Commande de 12 unités » (server sends « 500 pièces »); « Colère : « c'est une arnaque je vais porter plainte » » (server sends « … je veux parler à un humain ! »).
  A merchant concludes the AI answers beside the question (wrong wilaya, iPhone → cars) and loses trust right before activating.
- Evidence: .local/qa/campaign/agents/fr-16-done.png · 16.txt · Likely cause: `packages/shared/src/i18n/messages/app.fr.json:1304-1310` (`agents.scenario.full.*`) vs `apps/api/src/modules/ai/prompt/scenarios.ts:9-16` (`SCENARIOS[*].message`)

### AGENTS-02 — The 3 « hand-off » scenarios always fail with the raw text « failed: replied »
- Page: /fr/agents/new/activate?draft=… (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Step 5 › « Relancer les 8 scénarios » on an agent with every « Passer la main à un humain » rule checked and « Quantité max » = 5.
- Expected: Colère / Remboursement pass when the AI hands off; Commande de 12 (500) unités passes when no order is created; the result is a sentence in the UI language (12 §22; rule 8 of CLAUDE.md: no technical text).
- Actual: the three rows show « ✕ failed: replied » (English, internal check name). Only the `replied` check failed, i.e. `handoff_on_complaint` passed (status HANDOFF) and no order was created: the AI behaved correctly, but a hand-off turn has an empty AI text (the hand-off text is the workspace system message) while the scenario also requires `replied` (non-empty text). These 3 scenarios can therefore never pass when the agent hands off as configured — the merchant sees 3 red crosses on a correct agent, with no answer to read. The summary `failed: <check>` is printed as is.
- Evidence: .local/qa/campaign/agents/fr-16-done.png · API GET /agents/:id/test-scenarios → `{"scenarioKey":"anger","status":"fail","summary":"failed: replied"}` (same for qty_limit, refund) · Likely cause: apps/api/src/modules/ai/prompt/scenarios.ts:14-16 (`checks: ['replied', …]`) + apps/api/src/modules/ai/playground.service.ts:305 (summary) + apps/web/src/features/agents/wizard/activate.tsx:187 (prints `run.summary`)

### AGENTS-03 — Playground: a scenario chip clicked after the first message sends an EMPTY customer message and ends in « L'IA ne répond pas ; la conversation passe en file. »
- Page: /fr/agents/new/activate?draft=… › « Tester moi-même (bac à essai) » (same component on /fr/agents/[id]/playground) (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Open the playground, send « Salam » and a few more messages. 2. Click the chip « Réclamation (transfert) » (any chip).
- Expected: the scenario's seeded message is sent as the next customer turn and the AI answers (12 §22 « scenario chips »; AGT-07).
- Actual: the thread shows a customer bubble « Réclamation (transfert) », the API answers `POST /agents/:id/test → 503 AI_PROVIDER_ERROR` and the thread prints « L'IA ne répond pas ; la conversation passe en file. » + « Réessayer » (also wrong wording here: there is no queue in the playground). The chips only work as the very first message of a session.
- Evidence: .local/qa/campaign/agents/fr-19-turn6.png · 19.txt · API: POST /agents/01a1e00a-…/test → 503 · Likely cause: apps/web/src/features/agents/playground/playground.tsx:27-29 — when `history.length > 0` the scenario is dropped and `{ role: 'user', text: '' }` is appended (empty text sent to the provider). Seen once (playground message budget of the campaign reached); the code path makes it systematic.

### AGENTS-04 — Playground product card shows the base price (« Gourde isotherme en inox 2 200 DA · CARTE RÉELLE ») while the AI and the variant say 1 800 DA
- Page: playground (embedded « Tester moi-même » and /fr/agents/[id]/playground) (owner, fr, 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. Playground › « ch7al la gourde isotherme ? ».
- Expected: the card shows the price the customer will get — for a product with variants, the variants' price / range, exactly like the real Messenger card (AGT-07 « product cards rendered with real product data »; apps/api/src/modules/messaging/product-card.ts:62-66 « never the base price »).
- Actual: AI text « La gourde isotherme en inox coûte 1800 DA, en Argent 500 ml » (tool get_product → price 1800) and right below the card « Gourde isotherme en inox 2 200 DA · ARGENT – 500 ML · CARTE RÉELLE ». The merchant sees two prices for the same product in the screen meant to build trust before activation. Same family as PRODUCTS-03.
- Evidence: .local/qa/campaign/agents/fr-19-turn2.png · 19.txt (`"cards":[{"price":2200,…}]` vs `get_product … "price":1800`) · Likely cause: apps/api/src/modules/ai/playground.service.ts:181 (`price: p.price` instead of the variant min / max of `productCards()`)

### AGENTS-05 — Phone (390 px): on every ACTIVE agent card the name is squeezed to 5 px — the card does not say which agent it is
- Page: /fr/agents (owner, fr, 390 × 844)
- Severity: Major
- Type: UX
- Steps: 1. Open Agents IA on a phone.
- Expected: name, status and actions readable on the card (12 §9 list; README « 390 px wide »).
- Actual: the header row « Actif [switch] Tester Actions ⌄ » takes the whole width; the name link measures 5 × 19 px for « pedro 2 », « Pro Seller », « pedro » (only a sliver of the first letter shows), an empty box sits under it, and the « Rattachez au moins une page… » strip wraps one word per line. Draft cards (no switch) are fine (« QA agents Vendeur » 272 px).
- Evidence: .local/qa/campaign/agents/fr-32-390-list.png · fr-33-phone-list-full.png · 33-phone-list output (« pedro 2 w=5 h=19 »)

### AGENTS-06 — Every merchant sees the platform's test presets as starting points: « test », « testtest », « groq », « Mohamed benkhelifa », « Retest UX-008 Vendeur »
- Page: /fr/agents/new step 1 « POINT DE DÉPART » and /fr/agents filter « Préréglage d'origine » (owner, fr / ar / en)
- Severity: Major
- Type: UX
- Steps: 1. Agents IA › « + Nouvel agent ».
- Expected: the published presets only (AGT-02: Vendeur Pro / Service client / Conseiller produit / Réponse express + « De zéro »).
- Actual: 9 preset cards + De zéro: « test (Chaleureux, il conclut la vente) », « testtest » (no tagline), « Mohamed benkhelifa » (a person's name), « Retest UX-008 Vendeur — Vendeur de test pour le retest UX-008 », « groq » (badge `popular` in the API) next to the real ones. `GET /agents/presets` returns them to every workspace, so real merchants on the live site see QA leftovers on the first screen of agent creation. Likely a data clean-up in Admin › Préréglages (archive) plus a publish check.
- Evidence: .local/qa/campaign/agents/fr-04-step1.png · api-agents.json (`/agents/presets`: keys test, testtesttest, elmo, retest_ux_008_vendeur, groq)

### AGENTS-07 — « Quantité max par commande » / « Montant max (DA) » drop the minus sign and the decimal separator (« 12500,50 » → 1 250 050 DA)
- Page: /fr/agents/new/behaviour?draft=… (and Configuration › Comportement) (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Step 3 › QUANTITÉ MAX: type `-3`, `1.5`. 2. MONTANT MAX: type `-500`, `12500,50`.
- Expected: refused with a message or rounded (integer DZD, 04 §2) — never silently changed.
- Actual: `-3` → 3, `1.5` → 15, `-500` → 500, `12500,50` → 1 250 050 (×100). The hand-off threshold becomes 100× higher without warning. Same input component as PRODUCTS-01 / ORDERS-01.
- Evidence: 11.txt (« QTY typed 1.5 -> 15 », « AMT typed 12500,50 -> 1 250 050 »)

### AGENTS-08 — « Montant max » above 100 000 000 DA: the field accepts it, the server answers « Valeur invalide » without the limit
- Page: /fr/agents/new/behaviour?draft=… (owner, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. MONTANT MAX = 200000000. 2. Continuer.
- Expected: client-side check with the range (« entre 1 et 100 000 000 DA »), like « La quantité max doit être ≥ 1 (et ≤ 1000) » for the quantity.
- Actual: `PATCH /agents/:id → 422 {"fields":{"wizard.maxAmountPerOrder":"validation.invalid"}}` (sent twice for one click), shown as « MONTANT MAX (DA) : Valeur invalide ».
- Evidence: .local/qa/campaign/agents/fr-12-continue1.png · 12c.txt

### AGENTS-09 — Step 5 readiness rows show no numbers (the API sends them)
- Page: /fr/agents/new/activate?draft=… (owner, fr, 1440 px and 390 px)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Wizard step 5 « Prêt à activer ? ».
- Expected: AGV-02 « readiness checklist: catalogue active / without photo, fee grid 69, policies n/4 … products pending moderation » — counts shown.
- Actual: labels with ✓ / ⚠ / ✕ only (« Produits sans photo », « Produits en attente de validation », « Crédits disponibles »…) while `GET /agents/:id/readiness` returns counts 25 / 16 / 68 / 0 / 4 999 / 6. The merchant does not know how many products lack a photo or wait for validation; « Politiques » has no n / 4 either (3 filled).
- Evidence: .local/qa/campaign/agents/fr-15-step5.png · api-step5.json

### AGENTS-10 — Configuration tab: browser « Back » leaves with unsaved changes, no leave guard
- Page: /fr/agents/[id]/configuration (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Configuration › change a field (« Enregistrer (1 section modifiée) »). 2. A sidebar link asks « Quitter sans enregistrer ? » (correct). 3. Press the browser Back button.
- Expected: the same leave guard (AGV-05 « leave-guard dialog »; 12 §22).
- Actual: the page goes back to /fr/home at once and the changes are lost. Same as PRODUCTS-06.
- Evidence: 22.txt (« browser back with dirty | URL /fr/home … DLG (none) »)

### AGENTS-11 — An active agent without a page says « Rattachez au moins une page avant d'activer. »
- Page: /fr/agents (cards) and /fr/agents/[id] (banner) (owner, fr / ar / en)
- Severity: Minor
- Type: Text
- Steps: 1. Look at « pedro 2 », « Pro Seller », « pedro » (status ACTIF, 0 page — their pages were disconnected).
- Expected: a sentence for the real situation, e.g. « Actif mais sans page : il ne répond à personne. Rattachez une page. »
- Actual: « AUCUNE PAGE LIÉE · Rattachez au moins une page avant d'activer. » under a green « ACTIF » pill and an « Actif » switch.
- Evidence: .local/qa/campaign/agents/fr-01-list.png · fr-20-page-pedro2.png

### AGENTS-12 — Bulk « Mettre en pause » on a draft fails with « Modifié entre-temps, rechargez. »
- Page: /fr/agents › Sélectionner › draft « QA agents Vendeur » › Mettre en pause (owner, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Select a draft. 2. « Mettre en pause » › confirm.
- Expected: Pause / Reprendre greyed for drafts with the reason, or a result row « Un brouillon ne peut pas être mis en pause » (rule 7 « disabled reasons »).
- Actual: `POST /agents/bulk/pause → 200 { ok:0, failed:1, error:{ code:"CONFLICT", message:"Modifié entre-temps, rechargez." } }` — the server reason `AGENT_NOT_ACTIVE` is hidden behind the generic CONFLICT text, which invites the merchant to reload for nothing.
- Evidence: 34.txt · Likely cause: apps/api/src/modules/agents/agent.service.ts:620 (`conflict({ reason: 'AGENT_NOT_ACTIVE' })`)

### AGENTS-13 — Sort « Nom » is case-sensitive: « Pro Seller, QA ai-chat Agent, kjbglkjgvhlyjigv, pedro, pedro 2, test pro »
- Page: /fr/agents?sort=name (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Sort select › « Nom ».
- Expected: alphabetical order ignoring case (« kjbg…, pedro, pedro 2, Pro Seller, QA…, test pro »).
- Actual: capitals first, then lower case (byte order).
- Evidence: 02.txt (« sort Nom »)

### AGENTS-14 — Insights « Ignorés » tab prints the raw cause « malformed_output:no_json »
- Page: /fr/agents/[Pro Seller]/insights?status=dismissed (owner, fr, 1440 px)
- Severity: Minor
- Type: Text
- Steps: 1. Agent page › Insights › « Ignorés ».
- Expected: a sentence (« Réponse IA illisible ») — no internal code on shop screens (UX-059).
- Actual: « ERREUR IA · 10 × · IA : (aucune réponse) · Cause : malformed_output:no_json ».
- Evidence: .local/qa/campaign/agents/fr-26-Ignorés.png · kit leaks (snake_case value)

### AGENTS-15 — Agent page KPI tile 2 changes meaning for the same period: « 0 CONVERSATIONS » on load, « n TRANSFERTS » after a click
- Page: /fr/agents/[id] (owner, fr, 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Open « pedro 2 » (default 30 j). 2. Click 7 j, then 90 j (or 30 j again).
- Expected: the same tiles for every period, with hand-offs and AI replies (AGV-04 « conversations + handoffs »).
- Actual: on load (embedded metrics) tile 2 reads « 0 CONVERSATIONS · 0 % TRAITÉES SANS HUMAIN » and tile 1 has no « réponses IA »; once a period is clicked (`GET /agents/:id/metrics`) the same tiles read « 1 TRANSFERTS » and « 30 RÉPONSES IA ».
- Evidence: .local/qa/campaign/agents/fr-20-page-pedro2.png · fr-21-diff.png · Likely cause: apps/web/src/features/agents/agent-page/overview.tsx:96-97 (`extra ? … : handledCount`)

### AGENTS-16 — The public test page shows the display name that is still « en attente de validation »
- Page: https://djaber.vercel.app/agent-test/<token> (visitor, fr, 390 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Step 5 › « Envoyer un lien de test à un collègue » › Créer le lien. 2. Open the link without a session.
- Expected: same rule as the playground prompt and the Configuration note (« Nom en attente de validation par Djaber. En attendant, l'agent se présente sans prénom »).
- Actual: the public page header shows « أ أمينة » (the unapproved display name, `nameReview.status = pending`).
- Evidence: .local/qa/campaign/agents/fr-29-public-390.png · 29.txt

### AGENTS-17 — 390 px: a long hand-off keyword chip overflows the screen and its « × » cannot be reached
- Page: /fr/agents/new/behaviour?draft=… (owner, fr, 390 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Add a 60-character keyword (the maximum accepted). 2. View on a phone.
- Expected: the chip truncates / wraps; its remove button stays visible.
- Actual: chip spans x 42–465 px, the « × » sits at 444–460 px, outside the 390 px screen.
- Evidence: .local/qa/campaign/agents/fr-32-390-wizard3.png · 32-fr390.txt

### AGENTS-18 — Name and policy fields let you type 120 / 550 characters while the limit is 100 / 500
- Page: /fr/agents/new (NOM INTERNE), step 2 policies, Configuration › Identité (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Paste 150 characters in NOM INTERNE (kept: 120) or 600 in LIVRAISON (kept: 550). 2. Continuer / Enregistrer.
- Expected: `maxlength` = the real limit (AGENT_NAME_MAX 100, AGENT_POLICY_MAX 500) or a live counter.
- Actual: the text is accepted, then « Trop long (100 caractères max). » / « Trop long (500 caractères max). » appears only at save.
- Evidence: 05.txt (maxlength 120) · 07.txt (maxlength 550) · 22.txt

### AGENTS-19 — Card template: the variable buttons insert without a space (« {name}{price}{stock} » → preview « La Robe satin4 900 DAen stock »)
- Page: /fr/agents/new/behaviour?draft=… « MODÈLE DE CARTE PRODUIT » (owner, fr, 1440 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Click « {name} », « {price} », « {stock} ».
- Expected: a separator (space or « — ») between inserted variables, like the placeholder « {name} — {price} ».
- Actual: « 🛍 {name}{price}{stock} »; preview « 🛍 La Robe satin4 900 DAen stock ».
- Evidence: .local/qa/campaign/agents/fr-11-card.png · 11.txt

### AGENTS-20 — Small texts: « Aucun(e) agent », « 1 tours », « il y a maintenant », welcome message printed under the AI's first reply
- Page: /fr/agents (search), playground, wizard conflict dialog (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Search « zzz » → « Aucun(e) agent ne correspond à « zzz… ». » 2. Playground after one turn → « 1 tours · limite 60 / h ». 3. Two tabs on the same draft, save in one, then the other → conflict dialog « Modifié par Karim Proprio il y a maintenant ». 4. Playground first turn: « — Message système « welcome » : Bonjour 👋 … — » printed under the AI reply although in production it is sent before it.
- Expected: « Aucun agent ne correspond », « 1 tour », « à l'instant », welcome above the first reply.
- Actual: as in Steps.
- Evidence: 02.txt · fr-18-turn1.png · 31.txt

## Coverage
- **Agents list** (/agents) fr 1440: header and plan counter, 6 filters (Statut, Canal, Capacités, Préréglage, Activité, Langue) with URL state and F5, search (Latin, Arabic, emoji, no result, F5), sort, select mode + bulk bar (pause → result row, delete dialog cancelled), card « Actions » menus (active / draft), Actif switch → pause dialog (cancelled), insights side panel + « Ajouter aux instructions » dialog (cancelled), export JSON (download OK, no secrets), duplicate (copy opens at step 2 with its 6 FAQ), delete with typed name (wrong name keeps the button disabled; copy deleted). Also ar 1440, en 1440, fr 390.
- **Wizard** fr 1440: step 1 (empty / spaces / 150 chars / no language / Annuler dirty → « Quitter sans enregistrer ? », preset prefill, Arabic display name, emoji description, avatar initials, tone / emojis, preview); step 2 (catalogue scope + category list, policies 600 chars / Arabic / emoji, FAQ add empty / long / Arabic, edit, delete confirm, import TXT / real DOCX / fake DOCX / PDF / 6 MB / duplicates); step 3 (capabilities, order fields, max qty / amount with negative, decimal, extreme values, risky client, recap, hand-off rules + keywords (Enter, comma, duplicate, 70 chars, Arabic), business hours (overnight refused, valid), delay, card template + preview); step 4 (no page state); step 5 (readiness, 8 scenarios, embedded playground, test link dialog + creation, « Enregistrer en brouillon »); 409 conflict with two tabs (dialog « Écraser / Recharger » OK). Also ar 1440, en 1440, fr 390 (steps 1, 3, 5).
- **Agent page** (pedro 2, read-only): KPIs 7 / 30 / 90 j + F5 keeps the period, config summary links, versions list, Diff (inline), Restaurer dialog (cancelled), Actions menu, pause dialog (cancelled); Configuration tab (dirty state, « Enregistrer (1 section modifiée) », 110-char name, no language, leave guard via sidebar, « Annuler les modifications », Back button); Insights tab (Pro Seller: En attente / Résolus / Ignorés + F5, Type filter, Période, grouped / ungrouped, resolve dialog); Playground tab. ar / en / 390 of overview, configuration, insights, playground.
- **Playground** (7 turns + 8 scenarios). Verdicts: « Salam » → arabizi greeting (correct); « ch7al la gourde isotherme ? » → 1 800 DA, Argent 500 ml (correct text, wrong card = AGENTS-04); « Salam » again mid-conversation → short reply that goes back to the gourde (correct); « باقي منها؟ شحال كاين في الستوك؟ » → available, quantity not disclosed (correct, STOCK_PRIVATE); full order in arabizi (2 gourdes, Amine Benali, 0550123456, Sétif / El Eulma) → quote_delivery 650 DA and a correct recap 2 × 1 800 + 650 = 4 250 DA waiting for « oui » (correct; odd opener « Wach 3andek, n9dro nkmlou ? » and create_order called twice unconfirmed — harmless); chip « Réclamation » → AGENTS-03. Scenarios: 5 pass (answers correct for the messages really sent), 3 « fail » = AGENTS-02.
- **Public test link** /agent-test/<token> at 390 px (valid token, unknown token → « Lien expiré »).
- **Generate from page** (/agents/generate) fr / ar / en / 390: only the « no connected page » state (Analyser greyed with its reason).

## Blocked by safety
- None: the kit stopped no call in this area (`blocked: []` in every run).

## Not tested
- Activation (now / scheduled / « Annuler la programmation »), plan limit at activation, step 4 channel cards (LIÉE À / Déplacer ici / À RECONNECTER), pause / resume, delete of an agent with pages (`AGENT_HAS_CHANNELS`), « Extraire depuis ma page Facebook », Generate from page (progress / review / apply / rate limit): every page of the test shop is « DÉCONNECTÉ » and reconnecting is a Meta call (not allowed).
- Version restore / preset update / Configuration save on an active agent: the only active agents (pedro, pedro 2, Pro Seller) are shared shop data; only dialogs were opened (plus the reverted incident above). The « Version vN créée » toast was therefore not checked.
- Insight « Ignorer » / « Ignorer tout » / « Créer une FAQ »: not submitted on shared data.
- Playground photo / voice uploads, rate limit 60 / h, flag a turn, session export: AI message budget (15) used up.
- Operator / admin read-only states: « roles » area.
