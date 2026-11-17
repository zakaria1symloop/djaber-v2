# R9 — Ninth retest of the AI order-taking (after the R8 fixes) — live site, deployed commit 5bf56a2 — 17/11/2026 19:57–20:21 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 5bf56a2 (checked read-only: `git log --oneline -1` = « 5bf56a2 fix(ai): live retest R8 —
a « oui » places the stored recap's order, no invented technical problem or confirm question without a recap, customer's own-script name
kept, named variant wins, fewer probe calls, darija fixes »; `djaber-v2-api` / `djaber-v2-worker` restarted 19:52:57). Same two own shops as
R1–R8: « Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default language FR, recap « Toujours ») and « Boutique de Karima »
(J04 shop, « Agent J04 », preset Vendeur Pro). Same kit and surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and the two
shared test links (`/agent-test/<token>`, no tool calls in the visitor response). The R7 links were still valid — « Lien valable jusqu'au
18 nov. 2026 18:04 » on both (probe without a message, 19:56), so no new link was made. One browser at a time, the 37 runs one after the
other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place. The 60 / h counters were read before the run
(read-only, Redis `SCAN` / `GET` / `TTL`): J04 no key (window free), J03 50 / 60 (window until 20:10) — the 20 J04 flows were run first
(19:57:55–20:08:55, J04 1 → 50), the 17 J03 flows once the J03 window closed (20:10:48–20:20:35, J03 1 → 50). No 429. The J03 shop was
outside its opening hours during its run: every J03 conversation starts with the shop's « out_of_hours » system line (« Notre équipe est
absente pour le moment, je prends votre commande en attendant … ») — configured text, not an AI reply, the order-taking went on as usual.

**100 customer messages** (J04 shop 50, J03 shop 50; no re-send, no adaptive re-send — F3's name was never asked again), 37 conversations =
the 35 R8 flows + 2 new flows (N17 « oui mais livrez à … », N18 a Latin name in an Arabic-script conversation). To fit the 100 messages, 7
messages that test nothing asked this round were left out, every other R8 message is unchanged: the N12 fallback « oui » (never sent in R8),
F3b T1 « slm, ach kayen ? » (catalogue list), and the last « oui » of F8b, F13, N8, N9 and N13 (those flows stop at their server recap; the
« oui → one order » path is checked by the 27 other yes-to-recap turns). Scripts `.local/qa/journeys/R9/scripts/` (conv.mjs = the R8 script
with the R9 paths and a 100-message plan; convs.json = R8's less the 7 messages + N17, N18; render.cjs; check.cjs; probe-link.mjs; run.sh),
transcripts with every tool call and result `.local/qa/journeys/R9/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen,
`.log.json` = kit log), run logs `.local/qa/journeys/R9/out/run1.log` (J04), `run2.log` (J03), screenshots `.local/qa/campaign/retest-ai-r9/`.

Cases asked for this round:
- **N5** — « oui » to a correct recap ⇒ exactly one order, never « problème technique » (R8-1).
- **F3** — Arabic-script name « وليد بوزيد » kept in the recap, order placed, language kept, no « tu confirmes ? » without a recap (R8-2).
- **N1** — « sac à main cuir marron » ⇒ the recap says Marron (R8-3).
- Every R1–R8 guarantee: no order without a server recap (Critical), one order per « oui », a « oui » with a change gives a new recap and
  no order, no `create_order` before a phone, language kept, no hand-off on a field / yes message, no invented discount, tracking from the
  tool, no model sentence asking to confirm before the recap.
- **New flows**: N17 (J04, fr) « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » → « oui mais
  livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » → « oui » — a new recap at T2, no order until T3; N18 (J03, Arabic script)
  « السلام عليكم، نحب نشري جلابة رجالي » → « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » → « ايه » — the Latin name kept.

**Result: 36 / 37 conversations pass** — R8 flows 35 / 35 (F3, N1, N5 fixed), new flows 1 / 2 (N17 pass, N18 fail). **0 order without a
server recap; 26 TEST orders, each from a « oui / ih / ايه / yes / 👍 » to a server recap, exactly one each, with the recap's items, fee
and total; 0 « oui » to a server recap lost (R8: 1); 1 « oui » to a recap refused as expected (F11 blocked phone); 3 « oui » to something
else (N5 T3, N5c T2 an offer → the recap; N7 T2 an offer → a question) → 0 order; 1 « oui » with a change (N17 T2) → a new recap, 0 order;
0 `create_order` before a phone in 60 calls; 36 server recaps, 0 with a model sentence asking to confirm, 0 such sentence anywhere else
(R8: F3, N5); 0 « problème technique »; the variant named by the customer in every recap (N1, F1, F1b Marron; N6, N9 sizes); Arabic-script
name kept 2 / 2 (F3, N4), Latin name kept 2 / 2 (N18, F3b); photo request answered « no photo » 2 / 2; delivery question answered with the
fee 4 / 4; 36 / 36 recap addresses « …, commune, wilaya »; 0 hand-off call; 0 invented discount; no invented tracking number; 0 provider
error; 0 Markdown.** Failure: N18 the server recap is in French in an Arabic-script conversation once the customer writes a Latin name
(R9-1, Major). Issues: probes left (R9-2, = R8-4 partly fixed); odd words (R9-3).

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr | name alone → no tool; phone + address → recap « (Marron) » alone → « oui » → TEST-1506 7 550 DA | yes, 1 | PASS |
| F1b | J03 · playground | fr | T2 « Sétif, El Eulma » → fee 650 / 350, street asked, **no probe call**; recap → TEST-6293 | yes, 1 | PASS (R8-4 fixed here) |
| F2 | J04 · playground | darija, Arabic script | commune only → street or stop-desk asked; Arabic recap → TEST-4074 8 200 DA | yes, 1 | PASS |
| F3 | J03 · playground | arabizi, name in Arabic script | **« Smitek: وليد بوزيد »** in the T3 arabizi recap → « ih » → TEST-5998 6 050 DA | yes, 1 | PASS (R8-2 fixed) |
| F3b | J03 · shared link | arabizi | « Ma 3andnach tsawer ta3 tapis de prière dork »; recap → TEST-1493 | yes, 1 | PASS |
| F4 | J04 · playground | en | « 2 please » = 2; recap → « yes, Cité … » → TEST-6620 3 600 DA | yes, 1 | PASS |
| F5 | J04 · shared link | mixed fr / arabizi | street asked; server recap alone → « oui c'est bon » → TEST-6890 | yes, 1 | PASS |
| F6 | J03 · playground | fr | recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-4345 9 100 DA | yes, 1 | PASS |
| F7 | J04 · playground | darija, Arabic script | TEST-6619; « ديرهم جوج » → recap « تعوض الطلبية TEST-6619 » → « ايه » → TEST-8142 replaces it | yes, 1 + 1 replacement | PASS |
| F8 | J03 · playground | fr | 8-digit phone re-asked; recap → « oui » → TEST-3146 | yes, 1 | PASS |
| F8b | J03 · playground | fr | wrong phone re-asked; recap alone (last « oui » left out) | — (recap) | PASS |
| F9 | J04 · playground | arabizi fee per wilaya | Sétif 650 / 350, Oran stop-desk 400, « ma nwasslouch l Illizi » | — | PASS |
| F10 | J03 · playground | fr | « -50 % … 3750 DA ? » → price stays 7500 DA, no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, consistent sentence, no TEST-n | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou de 300 DA en stop-desk » | — | PASS |
| F13 | J03 · playground | fr, « Oui je confirme direct » | recap only, no order (last « oui » left out) | no (right) | PASS |
| F14 | J04 · playground | arabizi, all in one | server recap alone → « ih » → TEST-9246 | yes, 1 | PASS |
| N1 | J03 · playground | fr, change after the recap | « sac à main cuir marron » → **recap « (Marron) »**, Oran → « oui » → TEST-3924 7 500 DA | yes, 1 | PASS (R8-3 fixed) |
| N2 | J04 · playground | fr, two phones, all in one | recap with « Deuxième téléphone : 0770998877 » → TEST-5278 with `secondPhone` | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | « Ih, nwasslou l Constantine. Livraison l dar: 700 DA, wela f stop-desk: 450 DA … » + arabizi recap → TEST-1310 | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | French kept, « Nom : سمير بن علي » → TEST-1344 | yes, 1 | PASS |
| N5 | J04 · playground | fr, out of stock → back | Oud out of stock; T2 the Coffret offered (no recap); T3 « oui » → recap, no order; no « problème technique » | no (flow ended at the recap) | PASS (path changed; R8-1 checked in N5c) |
| N5b | J04 · playground | fr, in-stock product, back later | « je la prends » = Djellaba → recap → « oui » → TEST-8008 | yes, 1 | PASS |
| N5c | J04 · playground | fr, « oui » to a suggestion | Coffret offered → « oui » → **recap, no order** → « oui » → TEST-1709 | yes, 1 — after the recap | PASS |
| N6 | J04 · playground | fr, 2 products with variants | recap « (M) », « (42) » → « oui » → TEST-8762 17 800 DA, right ids at once | yes, 1 | PASS |
| N7 | J03 · playground | fr, « oui » to a suggestion | Sac à main cuir + Montre connectée offered; « oui » → « Lequel vous tente … ? », no order | — (right) | PASS |
| N8 | J04 · playground | fr, free delivery | server recap at T1 « gratuite » (last « oui » left out) | — (recap) | PASS (R9-2 probe) |
| N9 | J04 · playground | arabizi — photo + details | « Ma 3andnach tsawer ta3 had robe f had lwaqt » + details; T2 recap alone (last « ih » left out) | — (recap) | PASS (R9-3 words) |
| N10 | J03 · playground | fr — « trop cher » / « quand même » | no discount, no free delivery; T3 recap only → TEST-4165 16 550 DA | yes, 1 | PASS |
| N11 | J04 · playground | darija, Arabic script — tracking | TEST-4074; `lookup_order {}` → « ما عندناش رقم تتبع دروك » | yes, 1 | PASS (R9-3 words) |
| N12 | J04 · playground | fr — « ? » / « ... » / 👍 | each filler → the pending question only; « 👍 » to the recap → TEST-9479 | yes, 1 | PASS |
| N13 | J04 · playground | fr — two questions | price 12 500 DA + Oran 600 / 400 DA in one reply; « en 42 » → recap 13 100 DA (last « oui » left out) | — (recap) | PASS |
| N14 | J03 · playground | fr — cancel after the order | « oui » → TEST-3146; « non annule » → `cancel_order` ok → « Commande TEST-3146 annulée » | yes, 1, then cancelled | PASS |
| N15 | J03 · playground | arabizi — mistyped names | recap Djellaba homme + Tapis de prière, 10 950 DA → « ih » → TEST-9789 | yes, 1 | PASS |
| N16 | J04 · playground | arabizi — wilaya not served | `WILAYA_NOT_SERVED` → « Lmoute, ma nwasslouch l Illizi … » + another wilaya offered | — | PASS (R9-2 probe, R9-3 words) |
| N17 | J04 · playground | fr — NEW « oui mais livrez à … » | recap Blida 1 950 DA → « oui mais livrez à Alger … » → **new recap Alger 1 900 DA, no order** → « oui » → TEST-8063 (Alger) | yes, 1 — after the new recap | PASS (R9-2 probe) |
| N18 | J03 · playground | Arabic script — NEW Latin name | « Samir Benali » kept in call, recap and order, **but the recap is French** → « ايه » → TEST-8849 (Arabic confirmation) | yes, 1 | FAIL — R9-1 |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **26 / 26** (F1, F1b, F2, F3, F3b, F4, F5, F6, F7 ×2, F8, F14, N1,
  N2, N3, N4, N5b, N5c, N6, N10, N11, N12 « 👍 », N14, N15, N17, N18) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.**
  **« oui » to a correct recap lost: 0** (R8: N5). One « oui » after a change: **3 / 3** (F6 quantity, F7 after the order with
  `replacesOrder`, N1 product + wilaya + address — R8 failed it). No second `create_order` after an order in a turn. Cancel right after
  the order: **1 / 1** (N14).
- **« oui » that is not an answer to a server recap → no order: 3 / 3** — N5 T3 (« oui » to « Voulez-vous le prendre à la place ? » → the
  recap), N5c T2 (« oui » to « Ça vous intéresse ? » → the recap), N7 T2 (« oui » to an offer → « Lequel vous tente … ? »).
- **« oui » with a change → a new recap, no order: 1 / 1** (N17 T2 « oui mais livrez à Alger, Bab Ezzouar, … » → recap with the Alger
  address, 400 DA, 1 900 DA, a new core; T3 « oui » → TEST-8063 with that recap's content).
- Confirming call reworded vs the recap call, order still placed: **4 / 4** — F1 « …, El Eulma » → « …, El Eulma, Sétif », F4 « Cité 1000
  logements » → « …, Bir El Djir, Oran », N1 « …bloc 4 » → « …, Bir El Djir, Oran », N15 « …bloc 12 » → « …, El Eulma, Sétif » (F1b, F2,
  F4: a « yes » restating the address, same order).
- **No confirming call refused** (R8-1): the 25 confirming calls seen on the playground (24 orders + F11) all carried the recap's name, phone, wilaya, commune, address, items and
  `customerConfirmed true`; 0 `VALIDATION`, 0 « not given yet ». (So the new « stored recap completes a short confirming call » path was not
  needed once in 100 turns — see « Not tested ».)
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, second phone, address): **36 / 36 recaps shown**,
  the named variant every time (F1, F1b, N1 Marron; F5, N6, N9 M; N6, N13 42); in the customer's language **35 / 36** — **N18 T2 French in
  an Arabic-script conversation (R9-1)**; F3, F3b, F14, N3, N15, N9 arabizi; F2, F7 ×2, N11 Arabic script; F4 English; F5 French on a mixed
  message; N4 French with the name in Arabic script.
- **Server recap without a model sentence asking to confirm or describing the order: 36 / 36** — lead-ins left: « Merci Samir ! » (N4) — a
  thank-you that asks nothing; « Ih, nwasslou l Constantine. Livraison l dar: 700 DA, wela f stop-desk: 450 DA, ywasel f 2 l 5 ayam. » (N3)
  — the answer to the customer's question. **Outside any recap: 0** model sentence asking to confirm, 0 « le récapitulatif va venir », 0
  « problème technique » (R8: F3 T3–T4, N5 T3).
- **Recap address « …, commune, wilaya »: 36 / 36** — incl. calls whose `address` ended with the commune (F1, F1b, N3 « …, El Khroub »)
  and N18 « حي 1000 مسكن عمارة 5, الخروب, Constantine » (French template, Arabic commune — R9-1).
- **Customer's name as written: 37 / 37 conversations** — Arabic script kept in Latin turns (F3 « وليد بوزيد », N4 « سمير بن علي »), Latin
  kept in an Arabic turn (N18 « Samir Benali »), 0 name refused, 0 name asked again once given (F3: no adaptive re-send needed).
- **Photo request answered « no photo »: 2 / 2** — N9 « Ma 3andnach tsawer ta3 had robe f had lwaqt », F3b « Ma 3andnach tsawer ta3 tapis de
  prière dork »; **photo announced without a photo: 0**.
- **Delivery question answered with the fee: 4 / 4** — F12, F9 ×3, N3, N13; a wilaya not served answered « ma nwasslouch » 2 / 2 (F9, N16).
- **`create_order` before a phone is in the customer's messages: 0 / 60 calls**.
- No 503 / provider error: **0 / 100 turns** — turn time median 5.4 s, max 36.1 s (N5b T2; also N17 T1 25.3 s, F1b T3 24.2 s).
- Quantity never asked again after a product is named: **0 quantity question in 100 turns**; « le sac », « la djellaba », « taille M »,
  « 1 hijab soie », « حجاب حرير واحد », « en 42 », « djalaba », « tapi de priere », « جلابة رجالي » = 1; « zoudj », « jouj », « 2 pièces »,
  « 2 please », « 2 tapis » = 2; « 1 seul », « wahda » kept.
- Language kept: arabizi **8 / 8** (F3 now in every reply, F3b, F9, F14, N3 after the switch, N9, N15, N16), Arabic-script darija **3 / 4**
  (F2, F7, N11 incl. the tracking answer; **N18 recap French**, R9-1), English (F4), French **23 / 23** (F1, F1b, F6, F8, F8b, F10–F13, N1,
  N2, N4 after the Arabic-script name, N5, N5b, N5c, N6, N7, N8, N10, N12, N13, N14, N17 — F12 on the link), mixed fr / arabizi (F5).
- **No Tunisian / Moroccan words: 37 / 37** — check.cjs word list: 0 hit (0 « taw / tawa », 0 « متاع… », 0 « نهار », 0 « nchouf ash »); other odd
  forms → R9-3.
- Out-of-stock product offered: **0** — N5 / N5c name the Parfum Oud only as « en rupture de stock » because the customer asked for it; N7
  alternatives in stock.
- Street address → no « home or stop-desk ? »: **every flow with a street** went straight to the home recap; commune-only home address →
  street asked: **3 / 3** (F1b, F2, F5).
- No hand-off on a field / order / yes / filler message: **0 visible** besides F11 (blocked); **0 `handoff_to_human` call in 100 turns**.
- Two phones in one message kept: **1 / 1** (N2).
- No Markdown in a reply: **100 / 100**.
- Tool calls in 100 turns: `create_order` 60 (34 recaps + 24 orders on the playground — the 2 link recaps and 2 link orders carry no tool calls —, F11 blocked, 1 refused probe), `search_products`
  15, `get_product` 7, `quote_delivery` 8, `check_availability` 2, `lookup_order` 1, `cancel_order` 1 (N14, asked) — 0 `cancel_order` /
  `handoff_to_human` probe (R8: N5 T2), 1 invented product id (N17 T1, R9-2).

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls
with their results (draft / core = first 6 characters of the server keys; every `clientName` shown). Shared-link turns carry no tool calls
(visitor response). Every J03 conversation has the « out_of_hours » system line (the J03 run was after the shop's closing time).

### F1 — J03 playground (UI fr)
**Verdict: PASS — name alone at T2 → no tool call; phone + full address → server recap alone « (Marron) » → « oui » → TEST-1506 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir marron est disponible, à 6900 DA, en cuir véritable. Pour préparer votre commande, quel est votre nom complet ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `get_product {…d155} → Sac à main cuir, in stock`
- **T2** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Quel numéro de téléphone pouvons-nous utiliser pour la commande ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 714283… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS — R8-4 fixed here: T2 « Sétif, El Eulma » → `quote_delivery` only (no refused probe `create_order` any more), « 650 DA à domicile, ou 350 DA en stop-desk » + street asked; recap « …, El Eulma, Sétif » → « oui, c'est bien … » → TEST-6293 (T3 24.2 s).**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, merci Karim ! Le sac à main cuir en marron (6900 DA) est bien disponible pour 1 pièce. Dans quelle wilaya souhaitez-vous être livré ? »
- **T2** C: « Sétif, El Eulma » · `fr`
  - AI: « Livraison à Sétif : 650 DA à domicile, ou 350 DA en stop-desk, délai de 2 à 5 jours. Vous préférez être livré à domicile ? Si oui, donnez-moi l'adresse (rue, cité ou repère à El Eulma). »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `search_products {«sac à main cuir marron»} → 1 product(s)`
- **T3** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 714283… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — commune-only home address → « واش هو العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة)، ولا تحب نوصلوها لنقطة الاستلام (ستوب ديسك)؟ »; Arabic recap alone → « ايه، العنوان … » → TEST-4074 8 200 DA.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي، اسمي سمير بن علي 0661234567، قسنطينة، الخروب » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا سمير، الجلابة الرجالي Djellaba homme بـ 7500 دج، وهي متوفرة (taille unique). واش هو العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة)، ولا تحب نوصلوها لنقطة الاستلام (ستوب ديسك)؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T3** C: « ايه، العنوان حي 1000 مسكن عمارة 5 في الخروب قسنطينة » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: PASS — R8-2 fixed: the call carries « وليد بوزيد » as written, arabizi recap at T3 « Smitek: وليد بوزيد » → « ih » → TEST-5998 6 050 DA; arabizi kept in every reply; no « le récapitulatif va venir », no « tu confirmes ? ». In the chat the AI calls the customer « Walid » (T2 « Saha Walid, tsajjel. »), the recap and the order keep the Arabic script. (Same messages and same result as R7 F3, TEST-5998.)**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Ih, tapis de prière disponible, zoudj b 2800 DA l wa7ed (molletonné, 120 x 70 cm). Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `check_availability {qty 2} → available true` · `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « smiti وليد بوزيد » · `arabizi`
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456) ? »
- **T3** C: « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T4** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F3b — J03 shared link (UI fr)
**Verdict: PASS — (T1 « slm, ach kayen ? » left out for the budget) photo request → « Ma 3andnach tsawer ta3 tapis de prière dork » + details, « jouj » = 2; recap « Smitek: Walid Bouzid » → « ih » → TEST-1493.**

- **T1** C: « sifetli tsawer ta3 tapis de prière, nheb nechri jouj, smiti Walid Bouzid 0770112244 »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Ma 3andnach tsawer ta3 tapis de prière dork, bessah howa molletonné, 120 x 70 cm. Saha Walid, tsajjel jouj tapis de prière (2 x 2800 DA). Wach men wilaya ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « Blida, Boufarik, cite 20 aout villa 3 »
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « ih »
  - AI: « Commande ta3ek TEST-1493 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept (T2 detected `fr` because of the address words, the reply stays English), « 2 please » = 2; recap → « yes, Cité … » → TEST-6620 3 600 DA (confirming call reworded « Cité 1000 logements, Bir El Djir, Oran »).**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « The Hijab soie is available at 1500 DA (it was 2000 DA). It's a soft silk scarf, 180 x 70 cm. ⏎ To place your order, what's your full name? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `get_product {…450a} → Hijab soie, in stock`
- **T2** C: « 2 please, John Benali 0555987654, Oran, Bir El Djir, cité 1000 logements » · `fr`
  - AI: « Here is your order summary: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Home delivery (Bir El Djir, Oran): 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Name: John Benali ⏎ Phone: 0555987654 ⏎ Address: Cité 1000 logements, Bir El Djir, Oran ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T3** C: « yes, Cité 1000 Logements in Bir El Djir, Oran » · `en`
  - AI: « Your order TEST-6620 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements, Bir El Djir, Oran», items 2×product …450a, customerConfirmed true} → ok TEST-6620, total 3600`

### F5 — J04 shared link (UI fr)
**Verdict: PASS — street asked after « Bab Ezzouar » (stop-desk offered, mixed fr / arabizi as the customer wrote); street → server recap alone → « oui c'est bon » → TEST-6890.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar »
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Saha Amina, robe kabyle brodée taille M disponible b 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib), wala t7ebb stop-desk ? »
- **T2** C: « rue des frères Bouadou n 5 »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T3** C: « oui c'est bon »
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — server recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-4345 9 100 DA.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements, bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements, bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-4345 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-4345, total 9100`

### F7 — J04 playground (UI ar)
**Verdict: PASS — Arabic recap at T1 → « ايه » → TEST-6619; « لا غير زيدلي واحد، ديرهم جوج » → recap « هذي الطلبية تعوض الطلبية TEST-6619 » → « ايه » → TEST-8142 replaces it.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - cards: « Hijab soie 1500 DA » (no photo)
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
**Verdict: PASS — « la djellaba » = 1; 8-digit phone re-asked without a tool call; recap alone → « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux la djellaba. Yacine Mansouri » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Avec plaisir Yacine ! La Djellaba homme — 7500 DA (au lieu de 9000 DA), en laine fine beige, taille unique. Pour continuer la commande, quel est votre numéro de téléphone ? (ex : 0555123456) »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro que vous avez donné semble incomplet, il faut 10 chiffres. Pouvez-vous me le redonner ? (ex : 0555123456) »
- **T3** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F8b — J03 playground (UI fr)
**Verdict: PASS — the 8-digit phone re-asked in the product reply; the corrected phone gives the server recap alone (T3 « oui » left out for the budget).**

- **T1** C: « Bonjour, je veux 1 djellaba homme. Yacine Mansouri 05559876 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Bonjour Yacine, la Djellaba homme est disponible : 7500 DA au lieu de 9000 DA, en laine fine beige, taille unique. Le numéro donné ne compte que 8 chiffres : pouvez-vous me donner votre numéro complet (ex : 0555123456) ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `get_product {…efdc} → Djellaba homme, in stock`
- **T2** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`

### F9 — J04 playground (UI fr)
**Verdict: PASS — Sétif 650 / 350, Oran stop-desk 400, « Illizi: ma nwasslouch l Illizi f had lwaqt. », delay given; three `quote_delivery`, no other tool.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran f stop-desk: 400 DA, ywasel f 2 l 5 ayam. Illizi: ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F10 — J03 playground (UI fr)
**Verdict: PASS — « Je ne peux pas appliquer -50 % : le prix reste 7500 DA. », no tool, no hand-off.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine, couleur beige, taille unique. Je ne peux pas appliquer -50 % : le prix reste 7500 DA. Souhaitez-vous la commander ? »
  - cards: « Djellaba homme 7500 DA » (no photo)

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », no TEST-n.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr`
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS — « Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou de 300 DA en stop-desk, avec une livraison en 2 à 5 jours. » (check.cjs « DELIVERY-Q-NO-FEE » is a false hit of its fee regex).**

- **T1** C: « Bonsoir, vous livrez à Blida ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou de 300 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous cherchez un produit en particulier ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » in the first message only gives the server recap, no order (T2 « oui » left out for the budget).**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`

### F14 — J04 playground (UI fr)
**Verdict: PASS — all-in-one arabizi message → server recap alone → « ih » → TEST-9246.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-9246 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → ok TEST-9246, total 8150`

### N1 — J03 playground (UI fr)
**Verdict: PASS — R8-3 fixed: « le sac à main cuir marron à la place » → `variantId …0eda` → recap « 1 × Sac à main cuir (Marron) : 6 900 DA », Oran 600 DA, total 7 500 DA → « oui » → TEST-3924 (Marron, Bir El Djir).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-3924 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×variant …0eda, customerConfirmed true} → ok TEST-3924, total 7500`

### N2 — J04 playground (UI fr)
**Verdict: PASS — both numbers kept: « Deuxième téléphone : 0770998877 », `secondPhone` in TEST-5278.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci, 0661234568 ou 0770998877, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft e42dad… core 51097b…, recap total 1950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-5278 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true, phoneConfirmed true} → ok TEST-5278, total 1950`

### N3 — J03 playground (UI fr)
**Verdict: PASS — the delivery answer with the fee stays in front of the arabizi recap: « Ih, nwasslou l Constantine. Livraison l dar: 700 DA, wela f stop-desk: 450 DA, ywasel f 2 l 5 ayam. »; « ih saha » → TEST-1310.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Samira, on a bien 2 tapis de prière molletonnés (120 x 70 cm) à 2800 DA chacun. Dans quelle wilaya souhaitez-vous être livrée ? »
  - tools: `check_availability {qty 2} → available true` · `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi`
  - AI: « Ih, nwasslou l Constantine. Livraison l dar: 700 DA, wela f stop-desk: 450 DA, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5f3486… core 9816bc…, recap total 6300` · `search_products {«Tapis de prière»} → 1 product(s)`
- **T3** C: « ih saha » · `arabizi`
  - AI: « Commande ta3ek TEST-1310 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1310, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — « سمير بن علي » accepted once, French kept, « Nom : سمير بن علي »; « Merci Samir ! » (a thank-you, asks nothing) + recap → « oui » → TEST-1344.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Tapis de prière — 2800 DA, molletonné 120 x 70 cm, est disponible chez nous. Pour passer la commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `ar`
  - AI: « Merci Samir, c'est noté. Quel est votre numéro de téléphone ? (exemple : 0555123456) »
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Samir ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N5 — J04 playground (UI fr)
**Verdict: PASS (path changed — the R8-1 check is made in N5c) — T1 the out-of-stock Parfum Oud, no alternative named (R8: the Coffret at T1); T2 « Bon finalement je le prends + details » refers to the Oud → « rupture de stock » + the Coffret offered « Voulez-vous le prendre à la place ? » (no recap, no `create_order`, no `cancel_order` probe — R8-4 fixed here); T3 « oui » to that offer → the server recap (Coffret, gratuite, 24 990 DA), no order — right. The flow had no message left for the « oui » to the recap; no « problème technique » anywhere.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous voulez, je peux vous montrer d'autres articles disponibles dans la boutique. »
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Je peux vous proposer le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) à 24990 DA, il est disponible. Voulez-vous le prendre à la place ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `search_products {«Coffret cadeau Aïd»} → 1 product(s)`
- **T3** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`

### N5b — J04 playground (UI fr)
**Verdict: PASS — in-stock product discussed at T1, « je la prends » = Djellaba → recap → « oui » → TEST-8008 (T2 36.1 s, the slowest turn).**

- **T1** C: « Bonjour, la djellaba homme c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme est à 7500 DA au lieu de 9000 DA, en promotion en ce moment. C'est une djellaba en laine fine, couleur beige, taille unique. Voulez-vous la commander ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `get_product {…4766} → Djellaba homme, in stock`
- **T2** C: « Bon finalement je la prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft c87d7b… core ca7b5f…, recap total 8100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8008 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → ok TEST-8008, total 8100`

### N5c — J04 playground (UI fr)
**Verdict: PASS — R8-1 retest: the Coffret offered → « oui » → recap (draft faad11… core 1fbb33…, the very recap R8 N5 lost) → « oui » → TEST-1709 24 990 DA, the confirming call complete.**

- **T1** C: « Bonjour, je veux le parfum oud. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Par contre, notre Coffret cadeau Aïd — 24990 DA, avec parfum, chocolat et carte personnalisée — est disponible. Ça vous intéresse ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `get_product {…3400} → Coffret cadeau Aïd, in stock` · `get_product {…8c00} → Parfum Oud 50 ml, out of stock` · `search_products {«parfum»} → 1 product(s)`
- **T2** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990` · `search_products {«Coffret cadeau Aïd»} → 1 product(s)`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N6 — J04 playground (UI fr)
**Verdict: PASS — 2 products with variants + details → recap « (M) », « (42) » → « oui » → TEST-8762 17 800 DA; R8-4 fixed here: the first call carries the right ids.**

- **T1** C: « Bonjour, je veux la robe kabyle brodée en taille M et la basket sport Runner en 42. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft cad645… core 482777…, recap total 17800`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-8762 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → ok TEST-8762, total 17800`

### N7 — J03 playground (UI fr)
**Verdict: PASS — no sunglasses; sac à main cuir / montre connectée offered; « oui » → « Lequel vous tente … ? », no `create_order`.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Malheureusement, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre sac à main en cuir véritable (Noir ou Marron, 6900 DA) ou notre montre connectée (15900 DA). Quelque chose vous tente ? »
  - cards: « Sac à main cuir 6900 DA » (no photo) · « Montre connectée 15900 DA » (no photo)
- **T2** C: « oui » · `fr`
  - AI: « Avec plaisir Yacine ! Lequel vous tente : le sac à main en cuir véritable (Noir ou Marron, 6900 DA) ou la montre connectée (15900 DA) ? »

### N8 — J04 playground (UI fr)
**Verdict: PASS — availability question with every detail → recap at T1 (free delivery « gratuite », 24 990 DA) (T2 « oui » left out for the budget); two identical `search_products` (R9-2).**

- **T1** C: « Bonjour, le coffret cadeau Aïd est disponible ? Je suis Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `search_products {«Coffret cadeau Aïd»} → 1 product(s)` · `search_products {«Coffret cadeau Aïd»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`

### N9 — J04 playground (UI fr)
**Verdict: PASS (R9-3 words) — « Ma 3andnach tsawer ta3 had robe f had lwaqt » (no photo said first, « 3andnachch » gone) + fabric and sizes; T2 recap alone (T3 « ih » left out for the budget).**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam ! Ma 3andnach tsawer ta3 had robe f had lwaqt, bessah hia Robe kabyle brodée à la main, b tissu léger, zina bezzaf l les fêtes. Les tailles disponibles : S et M à 4900 DA, et XL à 5200 DA. Taille L ma 3andnach f had lwaqt. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`

### N10 — J03 playground (UI fr)
**Verdict: PASS — no discount, no free delivery; T3 « quand même » → recap only (beyond-stock line once, from the server) → « oui » → TEST-4165 16 550 DA.**

- **T1** C: « Bonjour, la montre connectée c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « La Montre connectée coûte 15 900 DA. Elle a un écran couleur et une autonomie de 5 jours. Elle est disponible à la commande, mais la livraison peut prendre un peu plus de temps. Voulez-vous la commander ? »
  - cards: « Montre connectée 15900 DA » (no photo)
  - tools: `search_products {«Montre connectée»} → 1 product(s)`
- **T2** C: « Ah c'est trop cher… Faites-moi 12 000 DA, ou au moins la livraison gratuite, et je la prends » · `fr`
  - AI: « Je comprends que le prix vous semble élevé. Malheureusement, je ne peux pas modifier le prix de la Montre connectée, qui reste à 15 900 DA, ni offrir la livraison gratuite. Si vous me donnez votre wilaya, je vous calcule les frais de livraison exacts. »
  - cards: « Montre connectée 15900 DA » (no photo)
- **T3** C: « Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Montre connectée : 15 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 500 logements bloc 12, El Eulma, Sétif ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …3123, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59f104… core 091af2…, recap total 16550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-4165 est bien enregistrée ✅ ⏎ - 1 × Montre connectée : 15 900 DA ⏎ Livraison : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …3123, customerConfirmed true} → ok TEST-4165, total 16550`

### N11 — J04 playground (UI ar)
**Verdict: PASS (R9-3 words) — Arabic recap → TEST-4074; `lookup_order {}` → « … ومازالت ما خرجتش. ما عندناش رقم تتبع دروك، وكي تخرج الطلبية نعطيوك المعلومات » — status from the tool, no invented number (« ما خرجتش » now right, R8-5); but « مازالت في الدرب » (R9-3).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar`
  - AI: « طلبيتك رقم TEST-4074 مازالت في الدرب، درك راهي تتحضر ومازالت ما خرجتش. ما عندناش رقم تتبع دروك، وكي تخرج الطلبية نعطيوك المعلومات. التوصيل يكون من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N12 — J04 playground (UI fr)
**Verdict: PASS — « ? » → « Quel est votre nom complet pour la commande du Hijab soie ? »; « ... » → « Dans quelle wilaya habitez-vous, Nadia ? »; street → recap alone; « 👍 » → TEST-9479.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Le Hijab soie est disponible à 1500 DA (au lieu de 2000 DA) : une soie douce, 180 x 70 cm. Pour commander, quel est votre nom complet ? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « ? » · `fr`
  - AI: « Quel est votre nom complet pour la commande du Hijab soie ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr`
  - AI: « Parfait Nadia, c'est noté ! Dans quelle wilaya habitez-vous ? »
- **T4** C: « ... » · `fr`
  - AI: « Dans quelle wilaya habitez-vous, Nadia ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T6** C: « 👍 » · `fr`
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N13 — J04 playground (UI fr)
**Verdict: PASS — price 12 500 DA + Oran 600 / 400 DA in one reply (pointures, 41 épuisée); « en 42 » → recap 13 100 DA (T3 « oui » left out for the budget).**

- **T1** C: « Bonjour, la basket sport Runner c'est combien ? Et la livraison à Oran, ça coûte combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La basket sport Runner est à 12500 DA, légère avec une semelle amortie. Les pointures 40, 42 et 43 sont disponibles, la 41 est épuisée. ⏎ Pour Oran, la livraison à domicile est à 600 DA, ou 400 DA en stop-desk, avec un délai de 2 à 5 jours. ⏎ Quelle pointure vous fait envie ? »
  - cards: « Basket sport Runner 12500 DA » (no photo)
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `get_product {…7252} → Basket sport Runner, in stock`
- **T2** C: « Je la prends en 42. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 13 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft fde1b2… core 278a27…, recap total 13100`

### N14 — J03 playground (UI fr)
**Verdict: PASS — « oui » → TEST-3146; « non annule » → `cancel_order {TEST-3146}` ok (simulated) → « Commande TEST-3146 annulée, pas de souci. », no new order.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr`
  - AI: « Commande TEST-3146 annulée, pas de souci. Si vous voulez reprendre la djellaba plus tard, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Annulation demandée par le client"} → ok`

### N15 — J03 playground (UI fr)
**Verdict: PASS — « djalaba » + « tapi de priere » → recap Djellaba homme 7 500 DA + Tapis de prière 2 800 DA, 10 950 DA, arabizi → « ih » → TEST-9789.**

- **T1** C: « Salam, nheb nechri djalaba w tapi de priere, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 10 950 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4b2a48… core 231f44…, recap total 10950`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-9789 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison: 650 DA ⏎ Total: 10 950 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …efdc, 1×product …a750, customerConfirmed true} → ok TEST-9789, total 10950`

### N16 — J04 playground (UI fr)
**Verdict: PASS (R9-2 probe, R9-3 words) — `quote_delivery` home and stop-desk → `WILAYA_NOT_SERVED` → « ma nwasslouch l Illizi f had lwaqt » + another wilaya offered, no fee invented (« nchouf ash » gone); but the reply opens with « Lmoute » and an extra `search_products {«Illizi»}`.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Lmoute, ma nwasslouch l Illizi f had lwaqt, ma 3andnach livraison l hadi wilaya. Wach wilaya okhra t7ebb tswayyab fiha? »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED` · `search_products {«Illizi»} → 0 product(s)`

### N17 — J04 playground (UI fr)
**Verdict: PASS (R9-2 probe) — NEW « oui mais livrez à … »: recap Blida 1 950 DA → « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » → a NEW server recap (Bab Ezzouar, Alger, 400 DA, 1 900 DA, other core f4cd80…), no order → « oui » → TEST-8063 with the Alger address and total. T1 first call with an invented product id (R9-2).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …f0f2, customerConfirmed true} → PRODUCT_NOT_AVAILABLE` · `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N18 — J03 playground (UI ar)
**Verdict: FAIL — R9-1 — NEW Latin name in an Arabic-script conversation: « Samir Benali » kept as written in the call, the recap and TEST-8849 (pass for the name), but the server recap at T2 is in French (« Voici le récapitulatif … Livraison à domicile (الخروب, Constantine) … Répondez « oui » … ») while the customer writes Arabic and T1 / T3 are Arabic.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « عندنا جلابة رجالي من الصوف الرقيق، لونها بيج ومقاسها واحد، بثمن 7500 دج بدل 9000 دج. تحب نسجلهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (الخروب, Constantine) : 700 DA ⏎ Total : 8 200 DA, à payer à la livraison. ⏎ Nom : Samir Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : حي 1000 مسكن عمارة 5, الخروب, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

## Bugs

### R9-1 — Arabic-script conversation: the customer gives a Latin name, the server recap comes out in French
- Page: playground dialog (owner, ar, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même » (UI ar): « السلام عليكم، نحب نشري جلابة رجالي », « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000
  مسكن عمارة 5 », « ايه ».
- Expected: the customer writes Arabic script (T1, and everything but the name in T2): the recap in Arabic, as in F2 / N11 with the same
  product and address (« هذا ملخص الطلبية: … التوصيل للدار (الخروب، قسنطينة): 700 دج … الاسم: … جاوبني بـ « إيه » … »), with the name
  kept as written « Samir Benali » (04-ai-pipeline §3.6: the reply in the customer's language; R4-2 / R8-2: a name in another script is a
  value, it does not decide the language).
- Actual: T1 Arabic « عندنا جلابة رجالي من الصوف الرقيق، لونها بيج ومقاسها واحد، بثمن 7500 دج بدل 9000 دج. تحب نسجلهالك؟ ». T2 `create_order
  {clientName «Samir Benali», clientPhone 0661234567, wilayaId 25, communeName «الخروب», address «حي 1000 مسكن عمارة 5», items [1 × Djellaba
  homme …efdc], customerConfirmed true}` → `CONFIRMATION_REQUIRED` (draft 125d54…, core 64b204…, total 8200) → reply « **Voici le
  récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (الخروب, Constantine) : 700 DA ⏎ Total :
  8 200 DA, à payer à la livraison. ⏎ Nom : Samir Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : حي 1000 مسكن عمارة 5, الخروب, Constantine ⏎
  Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer.** » — French template, French « oui », Arabic commune
  next to the French wilaya name. T3 « ايه » → « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع:
  8 200 دج، الدفع عند الاستلام. … » — the confirmation is Arabic again. The order itself is right (name, items, fee, total) and the name
  is kept; the customer reads the one message he must check before saying yes in a language he did not write, and is told to answer « oui ».
- Evidence: .local/qa/journeys/R9/out/transcripts/N18.json T1–T3 (+ N18.ui.txt) · .local/qa/campaign/retest-ai-r9/ar-N18-pg.png
- Likely cause: `detectLanguage` (apps/api/src/modules/ai/language.ts) reads T2 as `mixed` — about 26 Arabic-script characters to 11 Latin
  letters (ratio ≈ 0.70, inside the 0.4–0.75 « mixed » band with ≥ 6 Latin letters; the playground's language tag for the turn still
  shows `ar`, so the tag and the recap's language come from different readings) — because the Latin name counts as language, while
  R4-2 only strips Arabic-script values from a Latin conversation (`withoutArabicValues` runs when `previous` is not `ar`); the recap texts
  (`order-confirmation-text.ts` `locOf`) map `mixed` to French. The « ايه » of T3 reads `ar`, hence the Arabic confirmation.

### R9-2 — Tool calls still used as probes (refused or repeated, invisible) — R8-4 partly fixed
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run N17, N16, N8; read the tool calls.
- Expected: `create_order` only with ids from the tool results; one search per product; no product search for a wilaya.
- Actual (none reached the customer):
  - N17 T1 (« Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 ») `create_order {items
    [{ productId «01a1e51f-450e-7c2d-8103-6bb5b0d8f0f2», quantity 1 }]}` → `PRODUCT_NOT_AVAILABLE`, then the right id
    «01a1e51f-4737-7bdb-8104-25ba3e09450a» → `CONFIRMATION_REQUIRED` (an invented id ending like the real one; the turn took 25.3 s).
  - N16 T1 (« slm, tawsil l Illizi ? ») `search_products {«Illizi»}` → 0 product, after the two `quote_delivery` → `WILAYA_NOT_SERVED`.
  - N8 T1 `search_products {«Coffret cadeau Aïd»}` twice in the same turn.
  - Gone since R8: F1b T2 `create_order` without items / place, N5 T2 `cancel_order {}`, N6 T1 the zero-filled product id; 0
    `handoff_to_human`, 0 `create_order` before a phone (0 / 60).
- Evidence: .local/qa/journeys/R9/out/transcripts/N17.json T1, N16.json T1, N8.json T1
- Likely cause: as R8-4 — product ids are still typed by hand when no tool result of the turn carries them (N17 T1 had no search before the
  call); nothing stops a repeated or off-topic search.

### R9-3 — Odd wording left (a Latin « Lmoute », « في الدرب » for an order not sent, French inside arabizi)
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run N16, N11, N9, F3.
- Expected: plain Algerian darija / arabizi, nothing that contradicts the tool status.
- Actual:
  - N16 T1 « **Lmoute**, ma nwasslouch l Illizi f had lwaqt, ma 3andnach livraison l hadi wilaya. Wach wilaya okhra t7ebb **tswayyab**
    fiha? » — « lmout » reads « la mort » (meant « smahli » / « ma3lich »); « tswayyab » is not a usual darija form here.
  - N11 T3 « طلبيتك رقم TEST-4074 **مازالت في الدرب**، درك راهي تتحضر ومازالت ما خرجتش. ما عندناش رقم تتبع **دروك** … » — « في الدرب » reads
    « on its way », next to « ما خرجتش » (not sent) from `lookup_order` (`new / not_sent`); « درك » and « دروك » in the same reply.
  - N9 T1 « … b tissu léger, zina bezzaf **l les fêtes**. **Les tailles disponibles : S et M à 4900 DA, et XL à 5200 DA.** Taille L ma
    3andnach f had lwaqt. » — a French sentence in an arabizi reply.
  - F3 T1 « **Ih**, tapis de prière disponible, … » — a « yes » that answers no question.
- Evidence: .local/qa/journeys/R9/out/transcripts/N16.json T1, N11.json T3, N9.json T1, F3.json T1
- Likely cause: free model wording; `ODD_FIXES` / the darija word list do not cover these forms.

## Retest
- RETEST R8-1: fixed — 0 « oui » to a server recap lost in 26 + 1 (R8: N5), 0 `VALIDATION` on a confirming call, 0 « problème technique »
  and 0 « répondez « oui » une nouvelle fois » in 100 replies. N5 itself (same messages) took another path — T1 named no alternative, so T2
  « je le prends » went to the out-of-stock Oud and got the Coffret offered instead of a recap, and T3 « oui » gave the recap (right) with no
  message left; the very recap R8 N5 lost (Coffret, gratuite, draft faad11… core 1fbb33…) was confirmed in N5c T3 → TEST-1709. Every
  confirming call carried every field, so the new « complete a short confirming call from the stored recap » path was never needed live.
- RETEST R8-2: fixed — F3 (same messages) `clientName «وليد بوزيد»` in both calls, « Smitek: وليد بوزيد » in the arabizi recap at T3, « ih » →
  TEST-5998, arabizi in every reply, no « le récapitulatif … va venir », no « tu confirmes la commande ? »; T1 « Ghir after that » gone. N4
  still right (« Nom : سمير بن علي », French kept).
- RETEST R8-3: fixed — N1 (same messages) T2 `variantId …0eda` → « 1 × Sac à main cuir (Marron) : 6 900 DA » → « oui » → TEST-3924 (R8: « (Noir) »,
  then a second recap); F1 / F1b Marron too.
- RETEST R8-4: partly fixed — F1b T2 no `create_order` without items / place, N5 T2 no `cancel_order {}`, N6 T1 the right ids at once; but N17 T1
  an invented product id, N16 a `search_products` for a wilaya, N8 a repeated search → R9-2.
- RETEST R8-5: fixed for the cited words — F3 T1 no « after that » (« Wach smitek ? »), N16 no « nchouf ash » / « Ila », N9 « Ma 3andnach »
  (R8: « 3andnachch »), N11 « ما خرجتش » (R8: « ما تخرجتش »); new odd forms → R9-3.
- R1–R7 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 26 orders**, N5 T3 / N5c T2 « oui » → recap,
  N7 T2 « oui » → question, N17 T2 « oui mais … » → new recap; R4-1 (no hand-off on order messages) holds — 0 visible besides F11, 0
  `handoff_to_human` call; **R4-2 (a name in another script keeps the language) holds in F3, N4 and for the name in N18, but N18's recap is
  French (R9-1)**; R4-4 / R6-1 (no model sentence asking to confirm) holds — 36 / 36 recaps and 0 outside them; R4-6 (two phones) holds — N2;
  R4-8 (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5, N5c, N7; R5-2 (no Tunisian forms) holds — 0 « taw /
  متاع… »; R5-4 (no « home or stop-desk ? » after a street) holds; R5-5 (delivery question answered) holds — F12, F9, N3, N13; R5-6 (no
  `create_order` before a phone) holds — 0 / 60; R6-4 (recap address « …, commune, wilaya ») holds — 36 / 36; R7-1 (« quand même » → recap
  only) holds — N10; R7-2 (no photo said) holds — N9, F3b; R7-3 (fillers → the pending question) holds — N12; R7-5 (fee on « vous livrez
  à ? ») holds — F12; F10 / N10 no invented discount or free delivery; N11 tracking from `lookup_order`, no invented number or date; one
  order per « oui »: 26 orders, never two for one « oui », none lost.

## Coverage
- Order flows to « oui »: fr ×14 (F1, F1b, F6, F8, N1, N2, N4, N5b, N5c, N6, N10, N12, N14, N17 + F5 mixed; F11 blocked), Arabic-script
  darija ×4 (F2, F7, N11, N18), arabizi ×5 (F3, F3b link, F14, N3 after the switch, N15), en ×1 (F4); flows stopped at their recap (last
  « oui » left out for the budget): F8b, F13, N8, N9, N13, and N5 (no message left); commune-only home address in F1b, F2, F5; all-in-one in
  F6, F7, F11, F13, F14, N1, N2, N6, N8, N11, N14, N15, N17; confirming « yes » restating the address in F1b, F2, F4.
- Asked this round: N5 (R8-1 — the lost recap confirmed in N5c), F3 (R8-2), N1 (R8-3), every R1–R8 guarantee; new: a change inside the
  « oui » (N17), a Latin name in an Arabic-script conversation (N18).
- Also: quantity change before « oui » (F6) and after the order (F7), wrong 8-digit phone then right (F8, F8b), fake discount (F10),
  « Bonsoir » on a link (F12), 2 products with variants (N6), a product orderable beyond stock (N10), out-of-stock product asked (N5, N5c),
  two questions in one message (N13), cancel right after the order (N14), mistyped product names (N15), a wilaya not served (N16, F9),
  photo requests (N9, F3b), fillers (N12), out-of-hours shop (every J03 run).
- Kit: no blocked call, no API error, no console error in any of the 37 runs; no kit timeout.

## Not tested
- The R8-1 fix's own path — a confirming call that drops fields (commune, address, `customerConfirmed`) completed from the stored recap: the
  model sent complete calls in all 25 confirming turns seen, so it never ran live; and N5's R8 sequence (Coffret named at T1, recap at T2,
  « oui » at T3) did not recur.
- The « oui » after the recap of F8b, F13, N8, N9, N13 (left out to fit 100 messages with the 2 new flows); a « oui » after R9-1's French
  recap answered « oui » instead of « ايه » (N18 answered « ايه »).
- A change inside an arabizi or Arabic « yes » (« ih bessah wasslouha l … », « ايه بصح … ») — N17 is French only.
- A Latin name alone as the whole message in an Arabic-script conversation (N18 had the name with the Arabic address in one message).
- Live Messenger path (no page connected); a product that HAS photos asked for in a photo request; a mistyped product matching two catalogue
  products; a mistyped wilaya; a wilaya not served with a served stop-desk nearby; `cancel_order` on a real order; `lookup_order` on a real
  order with a courier and a tracking number; a provider failure (none in R2–R9).

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place. Shared test links from R7 reused
  (valid until 18/11 18:04); no new link.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-1506 (F1), TEST-6293 (F1b), TEST-4074 (F2, N11), TEST-5998 (F3),
  TEST-1493 (F3b), TEST-6620 (F4), TEST-6890 (F5), TEST-4345 (F6), TEST-6619 (replaced) and TEST-8142 (F7), TEST-3146 (F8, N14 — cancelled in
  N14, simulated), TEST-9246 (F14), TEST-3924 (N1), TEST-5278 (N2), TEST-1310 (N3), TEST-1344 (N4), TEST-8008 (N5b), TEST-1709 (N5c),
  TEST-8762 (N6), TEST-4165 (N10), TEST-9479 (N12), TEST-9789 (N15), TEST-8063 (N17), TEST-8849 (N18).
- Hour counters: J04 50 / 60 after F12 (20:08:55, window from 19:57:55), J03 50 / 60 after N18 (20:20:35, window from 20:10:48); no 429.
  Messages used: 100 / 100.
