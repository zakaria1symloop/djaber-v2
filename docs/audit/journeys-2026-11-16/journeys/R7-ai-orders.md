# R7 — Seventh retest of the AI order-taking (after the R6 fixes) — live site, deployed commit c063252 — 17/11/2026 17:54–18:16 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at c063252 (checked read-only: `git log -1` = c063252 « fix(ai): live retest R6 — allow-list
for the model's text before the server recap (thanks / answers only), photo_claim guard and PHOTO:none, darija wording, recap address
order, keyword handoff only on a keyword », `djaber-v2-api` / `djaber-v2-worker` restarted 17:49:06). Same two own shops as R1–R6:
« Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default language FR, recap « Toujours ») and « Boutique de Karima » (J04 shop,
« Agent J04 », preset Vendeur Pro). Same kit and surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and the two shared
test links (`/agent-test/<token>`, no tool calls in the visitor response). One browser at a time, the 33 runs one after the other. The block
« 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place. The 60 / h counters were read (read-only, Redis `GET` / `TTL`) before
the run: J04 no key (0 / 60), J03 50 / 60 (window until 18:09:28) — the 18 J04 flows were run first (17:54:36–18:05:20, J04 1 → 49), the 15
J03 flows after the J03 window closed (18:09:58–18:16:41, 1 → 48). No 429.

The two R6 shared test links had expired (24 h): the first F5 and F12 runs stopped before any message (page « Lien expiré », `GET
/agent-test/<token>` → 410 `AGENT_TEST_LINK_EXPIRED`); a new 24 h link was created for each shop with the owner's `POST
/agents/:id/test-links` (as in J03 / J04 setup) and F5, F12 (then F3b) were run on it.

**97 customer messages** (J04 shop 49, J03 shop 48; no re-send, the adaptive re-sends of F3 / N4 / N14 were never triggered), 33
conversations = the 30 R6 flows + 3 new everyday flows (N12 « ? » / « ... » / 👍 between fields, N13 two questions in one message then the
order, N14 « non annule » right after the order). Scripts `.local/qa/journeys/R7/scripts/` (conv.mjs = the R6 script with the R7 paths, card
photos recorded, adaptive step skipped once `cancel_order` succeeded; convs.json; render.cjs (+ « (no photo) » on cards); check.cjs = R6
checks + photo announcements « hak tsawer / voici les photos / هاهي التصاور … »; probe-link.mjs; run.sh), transcripts with every tool call and
result `.local/qa/journeys/R7/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen, `.log.json` = kit log), run logs
`.local/qa/journeys/R7/out/run1.log` (J04), `run1b.log` (J04 links), `run2.log` (J03), screenshots `.local/qa/campaign/retest-ai-r7/`.

To fit 30 + 3 flows in 100 messages some steps were joined (the step each flow checks is kept): F2 product + name + phone + wilaya +
commune (the commune-only home address is kept), F3b wilaya + commune + street, F5 product + name + phone + wilaya + commune (the
street-only step that drew R6-1 is kept), F6 product + details, F7 product + details, F8b product + name + wrong phone (the corrected-phone
step that drew R6-1 is kept), F10 price + « -50 % », F11 product + details, N3 product + name + phone (the switch to arabizi with the
delivery question is kept), N5 without « ok merci » / « Vous livrez à Oran ? », N5b without « ok merci, vous livrez à Oran ? » (the fee
question is in N13), N6 product + details. Cases asked for this round:
- **No model sentence asking to confirm / describing the order before the server recap (any wording)**, while a real answer to another
  question still stays (N3): every recap (32), F5, F8b, F14, N9 with the R6-1 messages.
- **No announced photo without a photo / card sent** (N9, F3b — no product of either shop has a photo except the J03 Robe kabyle brodée;
  every card of the run was without photo).
- **Recap address « …, commune, wilaya »** (R6-4): every recap, incl. N4 and calls with the commune or the wilaya inside `address`.
- **Darija wording** (R6-3): every darija reply (F2, F3, F3b, F5, F7, F9, F14, N3, N9, N11).
- Every R1–R6 guarantee: no order without a server recap (Critical), one order per « oui », no `create_order` before a phone, language
  kept, no hand-off on a field / yes message, no invented discount, tracking from the tool, two phones, blocked customer.
- **New everyday flows**: N12 (J04, fr) « Bonjour, je veux 1 hijab soie », « ? », « Nadia Kaci 0661234568 », « ... », « Blida, Boufarik, cité
  20 août villa 3 », « 👍 »; N13 (J04, fr) « Bonjour, la basket sport Runner c'est combien ? Et la livraison à Oran, ça coûte combien ? » then
  the order; N14 (J03, fr) all-in-one order, « oui », « non annule ».

**Result: 32 / 33 conversations pass** — R6 flows 29 / 30 (N9 fails), new flows 3 / 3. **0 order without a server recap; 29 « oui / ih /
ايه / yes / 👍 » to a server recap → 29 TEST orders, exactly one each, with the recap's items, fee and total; 2 « oui » to something else
(N5c a product suggestion, N7 a two-product offer) → 0 order; 0 `create_order` before a phone in 97 turns; 0 model sentence asking to
confirm or describing the order in front of 32 server recaps (R6: 4 / 29), the N3 delivery answer kept; 0 photo announced (R6: 2); 32 / 32
recap addresses « …, commune, wilaya »; 0 Tunisian / Moroccan form; 0 visible hand-off on an order message; 0 invented discount; no
invented tracking number; « non annule » → one `cancel_order`, no new order; 0 provider error; 0 Markdown; 0 quantity question.**
Failures / issues: the N9 photo request is not answered at all (no « hak tsawer » any more, but no « ma 3andnach tsawer » either — R7-2,
the only failing flow); « quand même » read as a question lets a non-answer sentence through the allow-list (N10, R7-1, cosmetic); odd
words (R7-3); tool probes still refused and invisible (R7-4, = R6-5); F12 fee not given (R7-5, cosmetic).

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr | name alone → no tool; phone + address → recap alone → « oui » → TEST-1506 7 550 DA | yes, 1 | PASS |
| F1b | J03 · playground | fr | « Sétif, El Eulma » → 650 / 350 DA + street asked; recap → « oui, c'est bien … » → TEST-6293 | yes, 1 | PASS (R7-4 probes) |
| F2 | J04 · playground | darija, Arabic script | « واش العنوان تاعك بالضبط في الخروب (الشارع، الحي …)؟ »; Arabic recap → TEST-4074 8 200 DA | yes, 1 | PASS |
| F3 | J03 · playground | arabizi, name in Arabic script | street address → server recap at once; « ih » → TEST-5998 | yes, 1 | PASS |
| F3b | J03 · shared link | arabizi | **« Ma 3andnach tsawer ta3 tapis de prière f had lwaqt »**; « t7ebb tchouf »; TEST-7279 | yes, 1 | PASS (R6-2 fixed here) |
| F4 | J04 · playground | en | « 2 please … » = 2; recap → « yes, Cité … » → TEST-2683 3 600 DA | yes, 1 | PASS |
| F5 | J04 · shared link | mixed fr / arabizi | street asked; **server recap alone** → « oui c'est bon » → TEST-6890 | yes, 1 | PASS (R6-1 fixed here) |
| F6 | J03 · playground | fr | recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-2670 9 100 DA | yes, 1 | PASS |
| F7 | J04 · playground | darija, Arabic script | TEST-6619; « ديرهم جوج » → recap « تعوض الطلبية TEST-6619 » → « ايه » → TEST-8142 replaces it | yes, 1 + 1 replacement | PASS |
| F8 | J03 · playground | fr | 8-digit phone re-asked; « Merci Yacine ! » + recap → « oui » → TEST-3146 | yes, 1 | PASS |
| F8b | J03 · playground | fr | wrong phone re-asked; **« Merci Yacine ! » + recap** (no confirm request) → TEST-3146 | yes, 1 | PASS (R6-1 fixed here) |
| F9 | J04 · playground | arabizi fee per wilaya | Sétif 650 / 350, Oran stop-desk 400, « Ma nwasslouch l Illizi f had lwaqt » | — | PASS |
| F10 | J03 · playground | fr | « -50 % … 3750 DA ? » → price stays 7500 DA, no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, consistent sentence, no TEST-n | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « Bonsoir ! Oui, on livre à Blida. … ZR Express, en 2 à 5 jours. » — no fee | — | PASS (R7-5) |
| F13 | J03 · playground | fr, « Oui je confirme direct » | recap only, then « oui » → TEST-4326 | yes, 1 | PASS |
| F14 | J04 · playground | arabizi, all in one | **server recap alone** (R6: « Ktb "oui" … ») → « ih » → TEST-8190 | yes, 1 | PASS (R6-1 fixed here) |
| N1 | J03 · playground | fr, change after the recap | one full new recap (Sac Marron, Oran, 7 500 DA) → « oui » → TEST-5759 | yes, 1 | PASS |
| N2 | J04 · playground | fr, two phones, all in one | recap with « Deuxième téléphone : 0770998877 » → TEST-3380 with `secondPhone` | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | **« Ih, nwasslou l Constantine. »** kept + arabizi recap → TEST-1310 | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | French kept, « Nom : سمير بن علي », **« Cité 20 août, villa 3, Boufarik, Blida »** → TEST-6832 | yes, 1 | PASS (R6-4 fixed) |
| N5 | J04 · playground | fr, out of stock → back | Coffret offered; « je le prends + details » → recap → « oui » → TEST-1709 | yes, 1 — after the recap | PASS (R7-4 probe) |
| N5b | J04 · playground | fr, in-stock product, back later | « je la prends » = Djellaba → recap → « oui » → TEST-8008 | yes, 1 | PASS |
| N5c | J04 · playground | fr, « oui » to a suggestion | « Voulez-vous que je le commande pour vous à Bir El Djir ? » → « oui » → **recap, no order** → « oui » → TEST-3157 | yes, 1 — after the recap | PASS (R7-4 probe) |
| N6 | J04 · playground | fr, 2 products with variants | recap « (M) », « (42) » → « oui » → TEST-8762 17 800 DA | yes, 1 | PASS |
| N7 | J03 · playground | fr, « oui » to a suggestion | Sac à main cuir + Montre connectée only; « oui » → « vous préférez … ? », no order | — (right) | PASS |
| N8 | J04 · playground | fr, free delivery | server recap at T1 → « oui » → TEST-1709 | yes, 1 | PASS |
| N9 | J04 · playground | arabizi — photo + details | details right, no « hak tsawer », **but the photo request gets no answer** (card without photo); T2 recap alone → TEST-6890 | yes, 1 | FAIL — R7-2 |
| N10 | J03 · playground | fr — « trop cher » | « je ne peux pas modifier le prix … ni offrir la livraison gratuite »; TEST-8010 16 550 DA; non-answer lead-in kept (R7-1) | yes, 1 | PASS (R7-1 cosmetic) |
| N11 | J04 · playground | darija, Arabic script — tracking | TEST-4074; `lookup_order {}` → « جديدة … ما عندناش رقم تتبع للحين » | yes, 1 | PASS (R7-3 word) |
| N12 | J04 · playground | fr — NEW « ? » / « ... » / 👍 | each filler answered with the pending question, no probe, no hand-off; « 👍 » to the recap → TEST-9479 | yes, 1 | PASS |
| N13 | J04 · playground | fr — NEW two questions | price 12 500 DA + Oran 600 / 400 DA in one reply; order in 42 → TEST-2203 13 100 DA | yes, 1 | PASS |
| N14 | J03 · playground | fr — NEW cancel after the order | « oui » → TEST-3146; « non annule » → `cancel_order` ok → « Votre commande TEST-3146 est bien annulée. » | yes, 1, then cancelled | PASS |

Pass criteria, counted over all flows:
- « oui » to a recap → exactly one order with the recap's content: **29 / 29** (F1, F1b, F2, F3, F3b, F4, F5, F6, F7 ×2, F8, F8b, F13,
  F14, N1, N2, N3, N4, N5, N5b, N5c, N6, N8, N9, N10, N11, N12 « 👍 », N13, N14). **Order without a server recap: 0.** One « oui » after a
  change: **3 / 3** (F6 quantity, F7 after the order with `replacesOrder`, N1 product + wilaya + address). No second `create_order` after an
  order in a turn. Blocked phone refused: **1 / 1** (F11). Cancel right after the order: **1 / 1** (N14, one `cancel_order`, no new order).
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N5c T2 (« oui » to « Voulez-vous que je le commande pour vous à
  Bir El Djir ? » → `create_order … → CONFIRMATION_REQUIRED` and the recap), N7 T2 (« oui » to a two-product offer → « Vous préférez … ? »,
  no `create_order`).
- Confirming call reworded vs the recap call, order still placed: **5 / 5** — F1 « Cité 500 logements bloc 12 » → « …, El Eulma, Sétif »,
  F4 « cité 1000 logements » → « Cité 1000 Logements, Bir El Djir, Oran », F14 « Cité … » → « Cite … », N1 « …, Bir El Djir, Oran » → « Cité
  1000 logements bloc 4 », N10 « …, El Eulma » → « …, El Eulma, Sétif » (F1b, F2: « oui, c'est bien … » restating the address, same call).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, second phone, address): **32 / 32 recaps
  shown**; in the customer's language **32 / 32** (F3, F3b, F14, N3, N9 arabizi; F2, F7, N11 Arabic script; F4 English; F5 French on a mixed
  message; N4 French with the name in Arabic script).
- **Server recap without a model sentence asking to confirm or describing the order: 32 / 32** (R6: 25 / 29). Lead-ins left: « Merci
  Yacine ! » (F8, F8b), « Merci Samir ! » (N4), « Merci Karim ! » (N5b), « Avec plaisir ! » (F11), « صحيت، سمير. » (N11) — thank-yous that ask
  nothing; « Ih, nwasslou l Constantine. » (N3) — the answer to the customer's question, kept as asked; « Merci Karim ! La montre peut prendre
  un peu plus de temps à être livrée. » (N10) — asks nothing but is not an answer (R7-1).
- **Recap address « …, commune, wilaya »: 32 / 32** — incl. N4 (R6: « …, Blida, Boufarik »), N3 and N10 (call `address` ending with the
  commune), N1 T2 (call `address` ending with « Bir El Djir, Oran »), F2 / F7 / N11 in Arabic script.
- **Photo announced without a photo: 0** (R6: F3b, N9); photo request answered « no photo »: **1 / 2** (F3b yes, N9 no → R7-2).
- **`create_order` before a phone is in the customer's messages: 0 / 97 turns**.
- No 503 / provider error: **0 / 97 turns** — turn time median 5.2 s, max 16.2 s (N9 T1, guard rewrite after a `moroccan_darija` hit).
- Quantity never asked again after a product is named: **0 quantity question in 97 turns**; « le sac », « la djellaba », « taille M »,
  « 1 hijab soie », « حجاب حرير واحد », « en 42 » = 1; « zoudj », « jouj », « 2 pièces », « 2 please », « 2 tapis » = 2; « 1 seul », « wahda »
  kept.
- Language kept: arabizi **6 / 6** (F3 after the Arabic-script name, F3b, F9, F14, N3 after the switch, N9), Arabic-script darija **3 / 3**
  (F2, F7, N11 incl. the tracking answer), English (F4), French **22 / 22** (F1, F1b, F6, F8, F8b, F10–F13, N1, N2, N4 after the
  Arabic-script name, N5, N5b, N5c, N6, N7, N8, N10, N12, N13, N14 — F12 on the link), mixed fr / arabizi (F5); switch French → arabizi
  followed **1 / 1** (N3, recap and confirmation).
- **No Tunisian / Moroccan words: 33 / 33** — 0 « taw / tawa », 0 « متاع… », 0 « nchouf », 0 « نهار », 0 « نهج » (check.cjs over 97 replies;
  the N9 T1 draft had one and was rewritten by the guard); odd but understandable words left → R7-3.
- Out-of-stock product offered: **0** — N5 T1 / N5c T1 name the Parfum Oud only as « en rupture de stock » because the customer asked for it;
  N7 alternatives in stock or orderable beyond stock; F3b T1 catalogue list without the Parfum Oud.
- Street address → no « home or stop-desk ? »: **every flow with a street** went straight to the home recap; commune-only home address →
  street asked: **3 / 3** (F1b, F2, F5).
- Questions answered in words: N3 delivery (1 / 1), N13 price + fee in one reply (1 / 1), F9 ×3, F12 (without the fee, R7-5), F1b T2 fee.
- No hand-off on a field / order / yes / filler message: **0 visible** besides F11 (blocked); 1 refused, invisible (N5 T2, R7-4); no
  `handoff_to_human {keyword}` probe (R6: N3 T3).
- Two phones in one message kept: **1 / 1** (N2). Arabic-script name with a Latin product never asked again: **2 / 2** (F3, N4).
- No Markdown in a reply: **97 / 97**.
- New flows: fillers (N12) — « ? » and « ... » each answered with the pending question (name, wilaya), no tool probe, no hand-off, no
  order; « 👍 » to the recap = a confirmation by rule → one order; two questions (N13) — both answered in the same reply from the tools
  (`search_products`, `quote_delivery`); cancel (N14) — « non annule » read as a cancellation of the order just placed, `cancel_order` called
  once, no second order, no question.

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls
with their results (draft / core = first 6 characters of the server keys; every `clientName` shown). Shared-link turns carry no tool calls
(visitor response).

### F1 — J03 playground (UI fr)
**Verdict: PASS — name alone at T2 → no tool call (no `create_order` before the phone); phone + full address → server recap alone → « oui » → TEST-1506.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonne nouvelle, le Sac à main cuir en couleur Marron est disponible, à 6900 DA. C'est du cuir véritable. Souhaitez-vous le commander ? Si oui, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `search_products {«Sac à main cuir»} → 1 product(s)`
- **T2** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550` · `search_products {«sac à main cuir»} → 1 product(s)`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS — « Sétif, El Eulma » → fee 650 / 350 DA given in words, street asked (stop-desk offered); recap « …, El Eulma, Sétif » → « oui, c'est bien … » → TEST-6293. Two refused, invisible probes: T1 `create_order` with an invented `wilayaId 1` (the customer gave no wilaya), T2 without the address (R7-4).**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Merci Karim ! Le sac à main cuir Marron à 6900 DA est noté pour vous. Dans quelle wilaya souhaitez-vous être livré ? »
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 1, items 1×variant …0eda, customerConfirmed true} → VALIDATION wilayaId`
- **T2** C: « Sétif, El Eulma » · `fr`
  - AI: « Parfait, Sétif est bien desservi : la livraison à domicile coûte 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Quelle est votre adresse à El Eulma (rue, cité ou repère) ? Sinon, je peux vous réserver un stop-desk. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», items 1×variant …0eda, customerConfirmed false} → VALIDATION address`
- **T3** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — name + phone + wilaya + commune in one message → « واش العنوان تاعك بالضبط في الخروب (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة)؟ » (no « متاعك », no « نهار », no « فالصوف الفاين »); Arabic recap alone → « ايه، العنوان … » → TEST-4074.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي، اسمي سمير بن علي 0661234567، قسنطينة، الخروب » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت سمير، تسجل. واش العنوان تاعك بالضبط في الخروب (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة)؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T3** C: « ايه، العنوان حي 1000 مسكن عمارة 5 في الخروب قسنطينة » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: PASS — arabizi kept after « smiti وليد بوزيد »; full street address → server recap at once; « ih » → « Commande ta3ek TEST-5998 tsajlet ✅ ».**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Ih, 3andna tapis de prière molletonné 120 x 70 cm, 2800 DA l'wahed, donc zoudj = 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi`
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456) ? »
- **T3** C: « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T4** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F3b — J03 shared link (UI fr)
**Verdict: PASS — R6-2 fixed here: « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt, mais howa tapis molletonné, 120 x 70 cm, b 2800 DA. » (no photo announced); no « nchouf » (« Wach men wa7ed t7ebb tchouf ? »); « Blida, Boufarik, cite 20 aout villa 3 » → recap → « ih » → TEST-7279.**

- **T1** C: « slm, ach kayen ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Wa 3likoum salam ! Kayen : sac à main cuir, robe kabyle brodée, djellaba homme, basket Runner, montre connectée, tapis de prière, coffret cadeau Aïd. Wach men wa7ed t7ebb tchouf ? »
- **T2** C: « sifetli tsawer ta3 tapis de prière, nheb nechri jouj, smiti Walid Bouzid 0770112244 »
  - AI: « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt, mais howa tapis molletonné, 120 x 70 cm, b 2800 DA. Saha, 2 tapis b smitek Walid Bouzid w numéro 0770112244. Wach men wilaya t7ebb nwasslouhom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T3** C: « Blida, Boufarik, cite 20 aout villa 3 »
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T4** C: « ih »
  - AI: « Commande ta3ek TEST-7279 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept, « 2 please » = 2, recap alone → « yes, Cité … » → TEST-2683 (confirming call reworded).**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (was 2000 DA). It's soft silk, 180 x 70 cm, and it's in stock. To start your order, what's your name? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « 2 please, John Benali 0555987654, Oran, Bir El Djir, cité 1000 logements » · `en`
  - AI: « Here is your order summary: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Home delivery (Bir El Djir, Oran): 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Name: John Benali ⏎ Phone: 0555987654 ⏎ Address: cité 1000 logements, Bir El Djir, Oran ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T3** C: « yes, Cité 1000 Logements in Bir El Djir, Oran » · `en`
  - AI: « Your order TEST-2683 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 Logements, Bir El Djir, Oran», items 2×product …450a, customerConfirmed true} → ok TEST-2683, total 3600`

### F5 — J04 shared link (UI fr)
**Verdict: PASS — R6-1 fixed here: street asked after « Bab Ezzouar » (stop-desk offered), the street gives the server recap alone (R6: « Pouvez-vous confirmer la commande en répondant oui ? » in front); « oui c'est bon » → TEST-6890. (The first try failed before any message: the R6 link had expired, 410 `AGENT_TEST_LINK_EXPIRED`; re-run on a new 24 h link.)**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar »
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Merci Amina ! La robe kabyle brodée taille M est disponible, à 4900 DA. Bach nkammlou la commande, wach l'adresse exacte f Bab Ezzouar (rue, cité, bloc wela repère) ? Wela t7ebb stop-desk ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « rue des frères Bouadou n 5 »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T3** C: « oui c'est bon »
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — server recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-2670 9 100 DA.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F7 — J04 playground (UI ar)
**Verdict: PASS — Arabic recap at T1 → « ايه » → TEST-6619; « زيدلي واحد، ديرهم جوج » → recap « هذي الطلبية تعوض الطلبية TEST-6619 » → « ايه » → TEST-8142 replaces it.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`
- **T3** C: « لا غير زيدلي واحد، ديرهم جوج » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ هذي الطلبية تعوض الطلبية TEST-6619. ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3c0efb… core 10ab1a…, recap total 3450`
- **T4** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8142 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ هذي الطلبية تعوض الطلبية TEST-6619، اللي تلغات. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → ok TEST-8142 (replaces TEST-6619), total 3450`

### F8 — J03 playground (UI fr)
**Verdict: PASS — « la djellaba » = 1; 8-digit phone re-asked without a tool call; « Merci Yacine ! » + recap → « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux la djellaba. Yacine Mansouri » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Yacine ! La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine beige, taille unique. Quel numéro de téléphone pouvons-nous utiliser pour la commande ? (ex : 0555123456) »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « 05559876 » · `fr`
  - AI: « Merci Yacine ! Ce numéro semble incomplet (il doit contenir 10 chiffres). Pouvez-vous me redonner votre numéro complet, par exemple 0555123456 ? »
- **T3** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Yacine ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F8b — J03 playground (UI fr)
**Verdict: PASS — R6-1 fixed here: the corrected phone gives « Merci Yacine ! » + the server recap (R6: « Pouvez-vous me confirmer la commande ci-dessus en répondant oui ? »); « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux 1 djellaba homme. Yacine Mansouri 05559876 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Yacine ! La djellaba homme en laine fine, beige, taille unique, est à 7500 DA au lieu de 9000 DA. Le numéro que vous avez donné semble incomplet (il manque des chiffres) : pouvez-vous me redonner votre numéro de téléphone complet ? (ex : 0555123456) »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Yacine ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F9 — J04 playground (UI fr)
**Verdict: PASS — Sétif 650 / 350, Oran stop-desk 400, « Ma nwasslouch l Illizi f had lwaqt. », delay given; no Tunisian / Moroccan form.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F10 — J03 playground (UI fr)
**Verdict: PASS — price question + « -50 % … 3750 DA ? » in one message → « Je ne peux pas appliquer une réduction de -50 % : le prix affiché est de 7500 DA. », no tool, no hand-off.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonjour ! La djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine, couleur beige, taille unique. Je ne peux pas appliquer une réduction de -50 % : le prix affiché est de 7500 DA. Souhaitez-vous que je vous prépare la commande ? »
  - cards: « Djellaba homme 7500 DA » (no photo)

### F11 — J04 playground (UI fr)
**Verdict: PASS — « Avec plaisir ! » + recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », no TEST-n. One refused probe at T1 (mistyped product id → `PRODUCT_NOT_AVAILABLE`, R7-4).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → PRODUCT_NOT_AVAILABLE` · `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr`
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS — French welcome and answer on the link « Bonsoir ! Oui, on livre à Blida. La livraison se fait avec ZR Express, en 2 à 5 jours. » (ZR Express = the shop's delivery policy); the fee is not given this time (R6: 450 / 300 DA) → R7-5.**

- **T1** C: « Bonsoir, vous livrez à Blida ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir ! Oui, on livre à Blida. La livraison se fait avec ZR Express, en 2 à 5 jours. Vous cherchez quelque chose en particulier ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » only gives the recap; « oui » → TEST-4326.**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-4326 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-4326, total 7950`

### F14 — J04 playground (UI fr)
**Verdict: PASS — R6-1 fixed here: all-in-one arabizi message → server recap alone (R6: « Ktb "oui" bach nkammlou la commande. » in front) → « ih » → TEST-8190.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-8190 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cite 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → ok TEST-8190, total 8150`

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya + address changed after the recap → one new recap (address « …, Bir El Djir, Oran » although the call carried it in `address`) → « oui » → TEST-5759.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6e57bf… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N2 — J04 playground (UI fr)
**Verdict: PASS — both numbers kept: « Deuxième téléphone : 0770998877 », `secondPhone` in TEST-3380.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci, 0661234568 ou 0770998877, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft e42dad… core 51097b…, recap total 1950` · `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3380 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-3380, total 1950`

### N3 — J03 playground (UI fr)
**Verdict: PASS — the delivery answer stays in front of the arabizi recap: « Ih, nwasslou l Constantine. » (a real answer kept by the allow-list); no `handoff_to_human {keyword}` probe this time; « ih saha » → TEST-1310.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Samira, on a bien 2 tapis de prière disponibles ! Le tapis est à 2800 DA l'unité, molletonné, 120 x 70 cm. Dans quelle wilaya habitez-vous ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi`
  - AI: « Ih, nwasslou l Constantine. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5f3486… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi`
  - AI: « Commande ta3ek TEST-1310 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1310, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — « سمير بن علي » accepted once, French kept, « Nom : سمير بن علي »; recap address « Cité 20 août, villa 3, Boufarik, Blida » (R6-4 fixed) → TEST-6832.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait ! Le Tapis de prière — 2800 DA est disponible. C'est un tapis molletonné de 120 x 70 cm, bien doux pour la prière. Pour commander, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `ar`
  - AI: « Merci Samir ! Quel est votre numéro de téléphone ? (exemple : 0555123456) »
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Samir ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-6832 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-6832, total 3250`

### N5 — J04 playground (UI fr)
**Verdict: PASS — Parfum Oud out of stock, Coffret offered; « Bon finalement je le prends + details » → recap → « oui » → TEST-1709. One refused probe at T2 (`handoff_to_human {off_catalogue, evidence «none»}`, R7-4).**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau, nous avons le Coffret cadeau Aïd — 24990 DA, avec parfum, chocolat et carte personnalisée. Voulez-vous que je vous le présente davantage ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `search_products {«Coffret cadeau Aïd»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed false} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990` · `handoff_to_human {off_catalogue, evidence «none»} → HANDOFF_NOT_NEEDED`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N5b — J04 playground (UI fr)
**Verdict: PASS — in-stock product remembered; « Merci Karim ! » + recap → « oui » → TEST-8008.**

- **T1** C: « Bonjour, la djellaba homme c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine, couleur beige, taille unique. Elle est disponible en ce moment. Voulez-vous que je vous la réserve ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Bon finalement je la prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft c87d7b… core ca7b5f…, recap total 8100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8008 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → ok TEST-8008, total 8100`

### N5c — J04 playground (UI fr)
**Verdict: PASS — « Voulez-vous que je le commande pour vous à Bir El Djir ? » → « oui » → server recap, no order → « oui » → TEST-3157. One refused probe at T1 (`create_order` on the out-of-stock Parfum Oud → `ORDER_INSUFFICIENT_STOCK`, R7-4).**

- **T1** C: « Bonjour, je veux le parfum oud. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Je peux vous proposer le Coffret cadeau Aïd — 24990 DA : il contient un parfum, du chocolat et une carte personnalisée, parfait pour offrir. Voulez-vous que je le commande pour vous à Bir El Djir ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …8c00, customerConfirmed true} → ORDER_INSUFFICIENT_STOCK` · `search_products {«coffret cadeau Aïd parfum»} → 2 product(s)` · `get_product {…3400} → Coffret cadeau Aïd, in stock`
- **T2** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N6 — J04 playground (UI fr)
**Verdict: PASS — 2 products with variants + details in one message → recap « (M) », « (42) » → « oui » → TEST-8762 17 800 DA.**

- **T1** C: « Bonjour, je veux la robe kabyle brodée en taille M et la basket sport Runner en 42. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft cad645… core 482777…, recap total 17800`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-8762 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → ok TEST-8762, total 17800`

### N7 — J03 playground (UI fr)
**Verdict: PASS — alternatives sac à main cuir + montre connectée (orderable beyond stock), no Parfum Oud; « oui » → « Vous préférez le sac … ou la montre … ? », no `create_order`.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Merci Yacine, j'ai bien noté vos coordonnées. Nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre sac à main en cuir véritable à 6900 DA ou notre montre connectée à écran couleur à 15900 DA. Lequel vous intéresse ? »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)`
- **T2** C: « oui » · `fr`
  - AI: « Parfait, Yacine. Vous préférez le sac à main en cuir (6900 DA, en noir ou marron) ou la montre connectée (15900 DA) ? »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)`

### N8 — J04 playground (UI fr)
**Verdict: PASS — availability question with every detail → recap at T1 (free delivery) → « oui » → TEST-1709.**

- **T1** C: « Bonjour, le coffret cadeau Aïd est disponible ? Je suis Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `check_availability {qty 1} → available true` · `quote_delivery {Oran} → fee 0 / stop-desk 400` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N9 — J04 playground (UI fr)
**Verdict: FAIL — R6-1 fixed (T2 recap alone) and no « Hak tsawer » any more, but the photo request « ab3athli tswira » gets no answer at all: no « ma 3andnach tsawer », a card without photo (R7-2); details right (S, M, XL; L « makach »; 4 900 / 5 200 DA); « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Robe kabyle brodée bil yed, b tissu léger, mlih l3id w l'fêtes. Kayen f taille S w M b 4900 DA, w XL b 5200 DA (taille L makach disponible had lwaqt). T7ebb nwarrik wach men taille ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
  - tools: `search_products {«Robe kabyle brodée»} → 1 product(s)` · `search_products {«Robe kabyle brodée»} → 1 product(s)` · `get_product {…48ee} → Robe kabyle brodée, in stock`
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N10 — J03 playground (UI fr)
**Verdict: PASS — « je ne peux pas modifier le prix … ni offrir la livraison gratuite »; order at the catalogue price → TEST-8010 16 550 DA; « commandée au-delà du stock » gone; the lead-in « La montre peut prendre un peu plus de temps à être livrée. » kept although the customer asked nothing (R7-1) and repeated by the server line; one refused mistyped-id probe (R7-4).**

- **T1** C: « Bonjour, la montre connectée c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « La montre connectée est à 15900 DA. Elle a un écran couleur et une autonomie de 5 jours. Elle est disponible à la commande, mais la livraison peut prendre un peu plus de temps. Vous voulez que je vous la réserve ? »
  - cards: « Montre connectée 15900 DA » (no photo)
- **T2** C: « Ah c'est trop cher… Faites-moi 12 000 DA, ou au moins la livraison gratuite, et je la prends » · `fr`
  - AI: « Je comprends, c'est un bel investissement. Malheureusement, je ne peux pas modifier le prix de la montre connectée (15900 DA), ni offrir la livraison gratuite. Si vous voulez, je peux vous donner le tarif de livraison pour votre wilaya pour que vous voyiez le total exact. »
  - cards: « Montre connectée 15900 DA » (no photo)
- **T3** C: « Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr`
  - AI: « Merci Karim ! La montre peut prendre un peu plus de temps à être livrée. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Montre connectée : 15 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×product …3123, customerConfirmed true} → PRODUCT_NOT_AVAILABLE` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×product …3123, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7ab3c2… core 091af2…, recap total 16550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-8010 est bien enregistrée ✅ ⏎ - 1 × Montre connectée : 15 900 DA ⏎ Livraison : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …3123, customerConfirmed true} → ok TEST-8010, total 16550`

### N11 — J04 playground (UI ar)
**Verdict: PASS — « صحيت، سمير. » + Arabic recap → TEST-4074; `lookup_order {}` → « حالتها الآن "جديدة" … ما عندناش رقم تتبع للحين » — status from the tool, no invented number or date; « للحين » (R7-3).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت، سمير. ⏎ هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar`
  - AI: « طلبيتك رقمها TEST-4074، وحالتها الآن "جديدة"، يعني مازالت ما خرجتش للتوصيل. ما عندناش رقم تتبع للحين، وبمجرد ما تتشحن راح نعطيك الرقم. مدة التوصيل عادة من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N12 — J04 playground (UI fr)
**Verdict: PASS — NEW (« ? » / « ... » / 👍 between fields): « ? » → « Oui, je suis là ! … quel est votre nom ? »; « ... » → « Vous êtes toujours là, Nadia ? Dans quelle wilaya … ? » (no tool probe, no hand-off, no `create_order` before the phone); street → recap; « 👍 » → TEST-9479 (👍 is a confirmation by rule: 04-ai-pipeline row 40 `confirmation()` « oui / ok / wah / ih / نعم / ايه / 👍 »).**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait ! Le Hijab soie est à 1500 DA (au lieu de 2000 DA), en soie douce, 180 x 70 cm, et il est disponible. Pour commander, quel est votre nom ? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « ? » · `fr`
  - AI: « Oui, je suis là ! Pour commander votre Hijab soie à 1500 DA, quel est votre nom ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr`
  - AI: « Merci Nadia, c'est noté ! Dans quelle wilaya habitez-vous ? »
- **T4** C: « ... » · `fr`
  - AI: « Vous êtes toujours là, Nadia ? Dans quelle wilaya habitez-vous pour que je calcule la livraison de votre Hijab soie ? »
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950` · `search_products {«hijab soie»} → 1 product(s)`
- **T6** C: « 👍 » · `fr`
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N13 — J04 playground (UI fr)
**Verdict: PASS — NEW (two questions in one message): both answered in one reply — « La basket sport Runner est à 12500 DA … Pour Oran, la livraison à domicile coûte 600 DA (400 DA en stop-desk), délai de 2 à 5 jours. » (+ sizes, 41 out of stock); « Je la prends en 42 + details » → recap → « oui » → TEST-2203 13 100 DA.**

- **T1** C: « Bonjour, la basket sport Runner c'est combien ? Et la livraison à Oran, ça coûte combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La basket sport Runner est à 12500 DA, et elle est légère avec une semelle amortie. Les pointures 40, 42 et 43 sont disponibles, la 41 est en rupture pour le moment. Pour Oran, la livraison à domicile coûte 600 DA (400 DA en stop-desk), délai de 2 à 5 jours. Quelle pointure vous intéresse ? »
  - cards: « Basket sport Runner 12500 DA » (no photo)
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `search_products {«Basket sport Runner»} → 1 product(s)`
- **T2** C: « Je la prends en 42. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 13 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Basket sport Runner 12500 DA » (no photo)
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft fde1b2… core 278a27…, recap total 13100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-2203 est bien enregistrée ✅ ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 600 DA ⏎ Total : 13 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …f843, customerConfirmed true} → ok TEST-2203, total 13100`

### N14 — J03 playground (UI fr)
**Verdict: PASS — NEW (cancel right after the order): « oui » → TEST-3146; « non annule » → `cancel_order {TEST-3146}` → ok (simulated) → « Votre commande TEST-3146 est bien annulée. » — no new order, no hand-off, no extra confirmation needed (the adaptive « oui annulez » was not sent).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr`
  - AI: « Votre commande TEST-3146 est bien annulée. Si vous voulez autre chose, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Le client a demandé l'annulation de sa commande"} → ok`

## Bugs

### R7-1 — « quand même » is read as a question: a sentence that answers nothing stays in front of the server recap
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Cosmetic
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même »: « Bonjour, la montre connectée c'est combien ? », « Ah c'est trop cher… Faites-moi 12 000 DA,
  ou au moins la livraison gratuite, et je la prends », « Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma,
  cité 500 logements bloc 12 ».
- Expected: the customer asked nothing in T3, so at most the thank-you « Merci Karim ! » before the server recap (the R6-1 allow-list:
  a thank-you lead-in, or the answer to a question of the customer's message).
- Actual: N10 T3 « Merci Karim ! **La montre peut prendre un peu plus de temps à être livrée.** ⏎ Voici le récapitulatif de votre commande :
  ⏎ - 1 × Montre connectée : 15 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎
  Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ **Une partie de la commande peut
  prendre un peu plus de temps à être livrée.** ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. » — the
  same information twice in one message. It asks nothing and no order came from it (TEST-8010 after the « oui » to this recap).
- Evidence: .local/qa/journeys/R7/out/transcripts/N10.json T3 (+ N10.ui.txt) · .local/qa/campaign/retest-ai-r7/fr-N10-pg.png
- Likely cause: `ASKS` in apps/api/src/modules/ai/tools/order-confirmation-text.ts matches the word « quand » of « quand même », so
  `recapLeadIn` treats the message as a question and keeps a sentence with « livr… » (`ANSWER_CONTENT`).

### R7-2 — A photo request for a product without a photo gets no answer at all (no « hak tsawer » any more, but no « no photo » either)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › step 5 › « Tester moi-même »: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? ».
- Expected: the R6-2 rule (catalogue PHOTOS rule, contract « PHOTO:none ⇒ « Ma 3andnach tsawer ta3ou f had lwaqt » »): say the shop has no
  photo of it for now, then the details — as F3b T2 on the J03 link did: « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt, mais howa
  tapis molletonné, 120 x 70 cm, b 2800 DA. » (J04 Robe kabyle brodée: 0 product image, read-only DB check in R6).
- Actual: N9 T1 « Robe kabyle brodée bil yed, b tissu léger, mlih l3id w l'fêtes. Kayen f taille S w M b 4900 DA, w XL b 5200 DA (taille L
  makach disponible had lwaqt). T7ebb nwarrik wach men taille ? » + the card « Robe kabyle brodée 4 900 DA » without a photo — the
  customer's « ab3athli tswira » is not mentioned. The false « Hak tsawer » of R6 is gone. The run's guard record (`AiRun.meta.guard`,
  read-only) is `{ action: "rewritten", retried: true, violations: [{ rule: "moroccan_darija" }] }` — the shown text is the rewrite
  (16.2 s turn), the photo sentence is not in it.
- Evidence: .local/qa/journeys/R7/out/transcripts/N9.json T1 (+ N9.ui.txt) · .local/qa/campaign/retest-ai-r7/fr-N9-pg.png
- Likely cause: nothing checks that a photo request on a PHOTO:none product is answered; the guard rewrite (moroccan_darija) does not
  carry the « no photo » sentence.

### R7-3 — Odd wording left (Mashreq / Gulf words, a « show you » question, filler answers)
- Page: playground dialog (owner, ar / fr, 1440) — « Boutique de Karima »
- Severity: Cosmetic
- Type: Text
- Steps: run N11 (« السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 », « ايه », « صحيت. وين راهي
  الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ »), N9 T1, N12 (« Bonjour, je veux 1 hijab soie », « ? », « Nadia Kaci 0661234568 »,
  « ... »).
- Expected: plain Algerian darija / plain French.
- Actual: N11 T3 « ما عندناش رقم تتبع **للحين**، وبمجرد ما **تتشحن راح نعطيك** الرقم » (« للحين », « تتشحن » are Gulf / Mashreq; Algerian:
  « مازال ما عندناش رقم تتبع », « كي تخرج الطلبية »); N9 T1 « T7ebb **nwarrik** wach men taille ? » (« do you want me to show you which size »
  for « Wach men taille t7ebb ? »); N12 T2 « ? » → « **Oui, je suis là !** Pour commander votre Hijab soie à 1500 DA, quel est votre nom ? »
  and T4 « ... » → « **Vous êtes toujours là, Nadia ?** Dans quelle wilaya habitez-vous … ? » (the customer is the one who wrote; the
  pending question alone would do).
- Evidence: .local/qa/journeys/R7/out/transcripts/N11.json T3, N9.json T1, N12.json T2 / T4
- Likely cause: free model wording; `ODD_FIXES` / the darija word list do not cover these forms.

### R7-4 — Tool calls still used as probes (refused, invisible) — R6-5 not fixed
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run F1b, F11, N10, N5c, N5; read the tool calls.
- Expected: `create_order` only with values the customer gave and ids from the tool results; `handoff_to_human` only when a rule applies.
- Actual (none reached the customer):
  - F1b T1 (« … 1 seul. Karim Haddad 0770112233 », no wilaya) `create_order {clientName «Karim Haddad», clientPhone 0770112233, wilayaId 1,
    items 1 × Sac (Marron), customerConfirmed true}` → `VALIDATION wilayaId, notGivenByCustomer [wilayaId]` (wilaya 1 = Adrar, invented);
    F1b T2 (« Sétif, El Eulma ») `create_order` without the address → `VALIDATION address` (as R6).
  - F11 T1 `create_order {items [{ productId «01a1e51f-737c-7bdb-8104-25ba3e09450a» }]}` → `PRODUCT_NOT_AVAILABLE`, then the right id
    «01a1e51f-4737-…» → `CONFIRMATION_REQUIRED`; N10 T3 «01a1e54f-9ef5-766e-…» → `PRODUCT_NOT_AVAILABLE`, then «01a1e54f-9fb5-766e-…» →
    `CONFIRMATION_REQUIRED` (one or two hex characters of the id mistyped).
  - N5c T1 `create_order` on the out-of-stock Parfum Oud (…8c00) → `ORDER_INSUFFICIENT_STOCK available 0`, then the Coffret offered.
  - N5 T2 `handoff_to_human {reason «off_catalogue», evidence «none»}` → `HANDOFF_NOT_NEEDED evidence_not_in_message`, next to the recap.
  - Gone since R6: `create_order` before a phone (0 / 97 turns), `create_order {}`, placeholder name / phone, `handoff_to_human {keyword}` on
    a delivery question.
- Evidence: .local/qa/journeys/R7/out/transcripts/F1b.json T1–T2, F11.json T1, N10.json T3, N5c.json T1, N5.json T2
- Likely cause: as R5-6 / R6-5 — the model calls `create_order` to learn what is missing and copies UUIDs by hand; the platform refuses
  each call, so the customer sees nothing, but each probe costs a tool round (and a mistyped id could, in theory, hit another product of the
  shop).

### R7-5 — « Vous livrez à Blida ? » answered without the fee
- Page: shared test link /fr/agent-test/<J04 token> (« Boutique de Karima », visitor, fr, 1440)
- Severity: Cosmetic
- Type: Bug
- Steps: open the J04 shared test link, send « Bonsoir, vous livrez à Blida ? ».
- Expected: as in R6 (« La livraison à domicile coûte 450 DA, ou 300 DA en stop-desk, avec un délai de 2 à 5 jours. ») — the fee is what the
  customer needs to decide.
- Actual: F12 T1 « Bonsoir ! Oui, on livre à Blida. La livraison se fait avec ZR Express, en 2 à 5 jours. Vous cherchez quelque chose en
  particulier ? » — no fee (ZR Express and 2–5 days come from the shop's delivery policy). The `fee_missing` guard only fires when
  `quote_delivery` ran in the turn; here the model answered from the policy text.
- Evidence: .local/qa/journeys/R7/out/transcripts/F12.json T1 · .local/qa/campaign/retest-ai-r7/fr-F12-link.png
- Likely cause: no rule asks for `quote_delivery` on « vous livrez à <wilaya> ? »; the policy line « Livraison dans 58 wilayas avec ZR
  Express, 2 à 5 jours » is enough for the model.

## Retest
- RETEST R6-1: fixed — F5 (same street message) T2 the server recap alone « Voici le récapitulatif de votre commande : … Répondez « oui »
  pour confirmer … » (R6: « Pouvez-vous confirmer la commande en répondant oui ? » in front); F8b T2 (same corrected-phone message) « Merci
  Yacine ! ⏎ Voici le récapitulatif … » (R6: « … ci-dessus en répondant oui ? »); F14 T1 (same message) recap alone (R6: « Ktb "oui" bach
  nkammlou la commande. »); N9 T2 (same message) recap alone (R6: « Saha Amina, la commande t7adret. »). 0 / 32 recaps with a request to
  confirm or an « order ready » sentence; the N3 answer « Ih, nwasslou l Constantine. » still stays. One allow-list gap (« quand même »)
  → R7-1, cosmetic.
- RETEST R6-2: partly fixed — no photo announced in 97 replies (check.cjs: 0 « hak tsawer / voici les photos / هاهي التصاور »); F3b T2
  (same message) « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt, mais howa tapis molletonné, 120 x 70 cm, b 2800 DA. »; but N9 T1 (same
  message) no word on the photo → R7-2.
- RETEST R6-3: fixed for the cited words — F3b T1 « Wach men wa7ed t7ebb tchouf ? » (no « nchouf »), F3b T2 « Wach men wilaya t7ebb
  nwasslouhom ? » (no « nwasslouk l'commande »), F2 T1 no « فالصوف الفاين » (« صحيت سمير، تسجل. واش العنوان تاعك بالضبط في الخروب … ؟ »),
  N10 no « commandée au-delà du stock » (« Elle est disponible à la commande, mais la livraison peut prendre un peu plus de temps. »); new
  odd forms → R7-3.
- RETEST R6-4: fixed — N4 (same messages) T3 « Adresse : Cité 20 août, villa 3, Boufarik, Blida » (R6: « …, Blida, Boufarik »); 32 / 32
  recap addresses « …, commune, wilaya », incl. calls whose `address` already ended with the commune (N3 « …, El Khroub », N10 « …, El
  Eulma ») or with commune + wilaya (N1 T2 « …, Bir El Djir, Oran »).
- RETEST R6-5: not fixed — no `handoff_to_human {keyword}` probe any more (N3 T2, the R6 case, has no hand-off call) and still 0
  `create_order` before a phone, but F1b T1 invented `wilayaId 1`, F1b T2 no address, F11 T1 / N10 T3 mistyped product ids, N5c T1 an
  out-of-stock product, N5 T2 `handoff_to_human {off_catalogue, evidence «none»}` — all refused, invisible → R7-4.
- R1–R5 guarantees re-checked: R4-1 (no hand-off on order messages) holds — 0 visible hand-off besides F11; R4-2 (Arabic-script name keeps
  the language) holds — F3 arabizi to the confirmation, N4 French; **R4-3 (no order without a server recap, Critical) holds — 0 / 29
  orders**, N5c T2 « oui » → recap, N7 T2 « oui » → question; R4-4 (no model sentence asking to confirm) holds again (R6-1 fixed); R4-6 (two
  phones) holds — N2; R4-8 (blocked sentence) holds — F11 T2 « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en
  occuper. »; R5-1 (in-stock alternatives only) holds — N5, N5c, N7, F3b list; R5-2 (no Tunisian forms) holds — 0 « taw / متاع… »; R5-4 (no
  « home or stop-desk ? » after a street) holds; R5-5 (delivery question answered) holds — N3, N13; R5-6 (no `create_order` before a phone)
  holds — 0 / 97; F10 / N10 no invented discount or free delivery; N11 tracking from `lookup_order`, no invented number or date.

## Coverage
- Order flows to « oui »: fr ×19 (F1, F1b, F6, F8, F8b, F13, N1, N2, N4, N5, N5b, N5c, N6, N8, N10, N12, N13, N14 + F5 mixed; F11 blocked),
  Arabic-script darija ×3 (F2, F7, N11), arabizi ×5 (F3, F3b link, F14, N3 after the switch, N9), en ×1 (F4); commune-only home address in
  F1b, F2, F5; all-in-one in F6, F7, F11, F13, F14, N1, N2, N6, N8, N11, N14; confirming « yes » restating the address in F1b, F2, F4.
- Asked this round: model text in front of 32 server recaps (any wording, with the R6-1 messages F5, F8b, F14, N9), the N3 answer kept;
  photo request on products without a photo (N9, F3b); recap address order (32 recaps, N4); darija wording (10 darija flows); every R1–R6
  guarantee; new: fillers « ? » / « ... » / « 👍 » (N12), two questions in one message (N13), cancel right after the order (N14).
- Also: quantity change before « oui » (F6) and after the order (F7), wrong 8-digit phone then right (F8, F8b), fee per wilaya incl. a
  wilaya not served (F9), fake discount (F10), « Bonsoir » on a link (F12), 2 products with variants (N6), a product orderable beyond stock
  (N10), out-of-stock product asked (N5, N5c).
- Kit: no blocked call, no API error, no console error in any of the 33 runs (the two first F5 / F12 tries on the expired link: one 410,
  expected).

## Not tested
- Live Messenger path (no page connected): Messenger rendering of the plain-text replies, of a card without a photo, and of a 👍 sent as
  the Messenger « like » sticker (here typed as text).
- A product that HAS photos asked for in a photo request (only the J03 Robe kabyle brodée has one; budget spent) — whether `productPhotos`
  really sends them and the reply may then say « hak tsawer ».
- `cancel_order` on a real (non-simulated) order and on an order the shop has already confirmed (`ORDER_CONFIRMED_BY_SELLER` ⇒ hand-off);
  « non annule » when two orders are open.
- `lookup_order` on a real order with a courier and a tracking number.
- A provider failure (none in R2–R7).
- A customer switching from darija back to French; R4-2 in the darija shop J04.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place. New 24 h shared test links for both
  shops (owner `POST /agents/:id/test-links` at 18:04 local, expiring 18/11 18:04); `J03/out/state.json`, `J04/out/state.json`
  `linkToken` updated.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-1506 (F1), TEST-6293 (F1b), TEST-4074 (F2, N11), TEST-5998 (F3),
  TEST-7279 (F3b), TEST-2683 (F4), TEST-6890 (F5, N9), TEST-2670 (F6), TEST-6619 (replaced) and TEST-8142 (F7), TEST-3146 (F8, F8b, N14 —
  cancelled in N14, simulated), TEST-4326 (F13), TEST-8190 (F14), TEST-5759 (N1), TEST-3380 (N2), TEST-1310 (N3), TEST-6832 (N4), TEST-1709
  (N5, N8), TEST-8008 (N5b), TEST-3157 (N5c), TEST-8762 (N6), TEST-8010 (N10), TEST-9479 (N12), TEST-2203 (N13).
- Hour counters: J04 49 / 60 after F12 (18:05), J03 48 / 60 at N14 T3 (18:16, window from 18:09:58); no 429. Messages used: 97 / 100.
