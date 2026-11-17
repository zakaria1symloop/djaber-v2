# R10 — Tenth retest of the AI order-taking (after the R9 fixes) — live site, deployed commit f9b4ccd — 17/11/2026 20:58–21:33 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at f9b4ccd (checked read-only: `git log --oneline -1` = « f9b4ccd fix(ai): live retest R9 —
a Latin name in an Arabic chat keeps the Arabic recap, mixed falls back to the conversation language, duplicate / place-only searches
skipped, status wording follows lookup_order, narrow darija fixes »; `djaber-v2-api` / `djaber-v2-worker` online, restarted ≈ 20:51). Same
two own shops as R1–R9: « Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default language FR, recap « Toujours ») and
« Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Same kit and surfaces: step 5 › « Tester moi-même » (playground, tool
calls visible) and the shared test link (`/agent-test/<token>`, no tool calls in the visitor response). The R7 links were still valid —
« Lien valable jusqu'au 18 nov. 2026 18:04 » (probe without a message, 20:57), so no new link was made. One browser at a time, the runs
one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place. The 60 / h counters were read
before the run (read-only, Redis `SCAN` / `GET` / `TTL`): J04 50 / 60 (TTL 231 s), J03 50 / 60 (TTL 1044 s) — the J04 flows were run once
the J04 window closed (20:58:18–21:16:33, J04 1 → 56), the J03 flows once the J03 window closed (21:16:39–21:32:32, J03 1 → 41), then one
extra J04 flow with the last 3 messages (N24, 21:32:49–21:33:18, J04 57 → 59). No 429. The J03 shop was outside its opening hours: every J03
conversation starts with the shop's « out_of_hours » system line — configured text, not an AI reply, the order-taking went on as usual.
Turn timings were compared read-only with the `AiRun` rows of the two workspaces (`startedAt`, `finishedAt`, `latencyMs`).

**100 customer messages** (J04 shop 59, J03 shop 41; no re-send, no adaptive re-send), 33 conversations = 26 R9 flows (the priority flows
N18, N5, F3, N1, N17, N8, N9, N11, N16, F11 first, then F1, F2, F4, F6, F7, F9, F10, F12, F13, F14, N2, N4, N5c, N6, N12, N14, N15 — every
one completed with its « oui », incl. the « oui » R9 left out in F13, N8, N9; N5 with one more « oui ») + 7 new flows aimed at the R8-1
« stored recap completes a short confirming call » path and at R9's « Not tested » list: N18b (Latin name alone in an Arabic chat, then a
French « oui »), N19 / N20 / N21 (fields one per message in fr / arabizi / Arabic script, a question after the recap in N19 / N20, « 👍 »
in N21), N23 (a change inside an arabizi « ih bessah … »), N24 (a remark after the recap). R9 flows not run (budget): F1b, F3b, F5, F8, F8b,
N3, N7, N10, N13, N5b. Scripts `.local/qa/journeys/R10/scripts/` (conv.mjs = the R9 script with the R10 paths; convs.json; render.cjs;
check.cjs; probe-link.mjs; run.sh), transcripts with every tool call and result `.local/qa/journeys/R10/out/transcripts/<id>.json`
(+ `.ui.txt` = the thread on screen, `.log.json` = kit log), run logs `.local/qa/journeys/R10/out/run1.log` (J04), `run2.log` (J03),
`run3.log` (N24), screenshots `.local/qa/campaign/retest-ai-r10/`.

Cases asked for this round:
- **N18** — Arabic-script chat + Latin name ⇒ the recap in Arabic (R9-1).
- **N5 / R8-1 path** — try to make the model send a confirming call with missing fields (fields over several messages, a question or a
  remark between the recap and the « oui », « oui » / « ih » / 👍) ⇒ exactly one order from the stored recap, never « problème technique ».
- **F3, N1, N17, N8, N9, N11, N16** (R9-2 probes, R9-3 wording), **F11** (blocked phone).
- Every R1–R9 guarantee: no order without a server recap (Critical), one order per « oui », a « oui » with a change gives a new recap and
  no order, no `create_order` before a phone, language kept, no hand-off on a field / yes message, no invented discount, tracking from the
  tool, no model sentence asking to confirm before the recap.

**Result: 32 / 33 conversations pass** — R9 flows 25 / 26 (N18 fixed; N5 fail), new flows 7 / 7. **0 order without a server recap; 28 TEST
orders, each from a « oui / ih / ايه / yes / 👍 » to a server recap, exactly one each, with the recap's items, fee and total; 0 « oui » to a
server recap lost; 1 « oui » to a recap refused as expected (F11 blocked phone); 2 « oui » to something else (N5 T3 a statement → a
question, N5c T2 an offer → the recap) → 0 order; 2 « yes » with a change (N17 T2 fr, N23 T2 arabizi) → a new recap, 0 order; 3 remarks /
questions between the recap and the « oui » (N19, N20, N24) → 0 order, then one order on the « oui »; 0 `create_order` before a phone in 66
calls; 34 server recaps, all in the customer's language (N18 / N18b Arabic with a Latin name — R9-1 fixed), 0 with a model sentence asking to
confirm; 0 « problème technique »; 0 hand-off call; 0 invented discount; no invented tracking number; 0 provider error; 0 Markdown.** Failure:
N5 — after a stock refusal the model asks « Pour confirmer : vous voulez bien le Coffret … ? » without a recap, two « oui » are spent before
the recap (R10-2, Minor). Issues: three playground answers came 66–214 s after their AI run had finished (R10-1, Major); probe calls back in
another form (R10-3, = R9-2 partly fixed); odd words (R10-4). **The R8-1 « complete a short confirming call from the stored recap » path
was still not needed once**: all 29 confirming calls (28 orders + F11) carried every field, incl. N19 / N20 / N21 / N24.

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr | name alone → no tool; phone + address → recap « (Marron) » → « oui » → TEST-6293 7 550 DA; T3 104.7 s | yes, 1 | PASS (R10-1, R10-3) |
| F2 | J04 · playground | darija, Arabic script | commune only → street asked; Arabic recap → TEST-4074 8 200 DA | yes, 1 | PASS |
| F3 | J03 · playground | arabizi, name in Arabic script | no stray « Ih » at T1; « Smitek: وليد بوزيد » → « ih » → TEST-5190 6 050 DA | yes, 1 | PASS (R9-3 fixed) |
| F4 | J04 · playground | en | « 2 please » = 2; recap → « yes, Cité … » → TEST-2683 3 600 DA | yes, 1 | PASS |
| F6 | J03 · playground | fr | recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-2670 9 100 DA; T3 71.0 s | yes, 1 | PASS (R10-1) |
| F7 | J04 · playground | darija, Arabic script | TEST-6619; « ديرهم جوج » → recap « تعوض الطلبية TEST-6619 » → « ايه » → TEST-8142 replaces it | yes, 1 + 1 replacement | PASS |
| F9 | J04 · playground | arabizi fee per wilaya | Sétif 650 / 350, Oran stop-desk 400, « Ma nwasslouch l Illizi » | — | PASS |
| F10 | J03 · playground | fr | « -50 % … 3750 DA ? » → « le prix valable est 7500 DA », no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, consistent sentence, no TEST-n | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk » | — | PASS |
| F13 | J03 · playground | fr, « Oui je confirme direct » | recap only → « oui » → TEST-3146 7 950 DA | yes, 1 — after the recap | PASS |
| F14 | J04 · playground | arabizi, all in one | server recap alone → « ih » → TEST-9246 8 150 DA | yes, 1 | PASS |
| N1 | J03 · playground | fr, change after the recap | « sac à main cuir marron » → recap « (Marron) », Oran → « oui » → TEST-5759 7 500 DA; T2 223.6 s | yes, 1 | PASS (R10-1) |
| N2 | J04 · playground | fr, two phones, all in one | recap with « Deuxième téléphone : 0770998877 » → TEST-4895 with `secondPhone` | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | French kept, « Nom : سمير بن علي » → TEST-8384; 3 probe calls on the name turn | yes, 1 | PASS (R10-3) |
| N5 | J04 · playground | fr, out of stock → back | Oud refused for stock; « oui » → « Pour confirmer : vous voulez bien le Coffret … ? » (no recap); « oui » → recap, no order | no (flow ended at the recap) | FAIL — R10-2 |
| N5c | J04 · playground | fr, « oui » to a suggestion | Djellaba offered → « oui » → **recap, no order** → « oui » → TEST-8008 | yes, 1 — after the recap | PASS |
| N6 | J04 · playground | fr, 2 products with variants | recap « (M) », « (42) » → « oui » → TEST-4483 17 800 DA | yes, 1 | PASS |
| N8 | J04 · playground | fr, free delivery | recap at T1 « gratuite » → « oui » → TEST-3157 24 990 DA; no repeated search | yes, 1 | PASS (R9-2 fixed here) |
| N9 | J04 · playground | arabizi — photo + details | « Ma 3andnach tsawer ta3 had la robe » + details; recap (M) → « ih » → TEST-6890 | yes, 1 | PASS (R10-4) |
| N11 | J04 · playground | darija, Arabic script — tracking | TEST-4074; `lookup_order {}` → « ما خرجتش للتوصيل بعد … » (no « في الدرب »); + `cancel_order {}` probe | yes, 1 | PASS (R9-3 fixed, R10-3) |
| N12 | J04 · playground | fr — « ? » / « ... » / 👍 | each filler → the pending question only; « 👍 » to the recap → TEST-9479 | yes, 1 | PASS |
| N14 | J03 · playground | fr — cancel after the order | « oui » → TEST-3146; « non annule » → `cancel_order` ok → « bien annulée » | yes, 1, then cancelled | PASS |
| N15 | J03 · playground | arabizi — mistyped names | recap Djellaba homme + Tapis de prière, 10 950 DA → « ih » → TEST-9789 | yes, 1 | PASS |
| N16 | J04 · playground | arabizi — wilaya not served | `WILAYA_NOT_SERVED` → « Ma nwasslouch l Illizi … » + another wilaya offered; no « Lmoute », no search | — | PASS (R9-2 / R9-3 fixed) |
| N17 | J04 · playground | fr — « oui mais livrez à … » | recap Blida → « oui mais livrez à Alger … » → **new recap, no order** → « oui » → TEST-8063 (Alger); right id at once | yes, 1 — after the new recap | PASS (R9-2 fixed here) |
| N18 | J03 · playground | Arabic script — Latin name | **Arabic recap « الاسم: Samir Benali »** → « ايه » → TEST-8849 | yes, 1 | PASS (R9-1 fixed) |
| N18b | J03 · playground | Arabic script — NEW Latin name alone, French « oui » | Arabic kept after « Samir Benali »; Arabic recap; « oui » → Arabic confirmation TEST-8849 | yes, 1 | PASS |
| N19 | J04 · playground | fr — NEW fields one per message + question after the recap | recap → « livré en combien de jours ? » → answer, no order → « oui » → TEST-1709 | yes, 1 | PASS |
| N20 | J03 · playground | arabizi — NEW fields over 3 messages + question | recap → « ch7al ywasel ? » → « 2 l 5 ayam », no order → « ih » → TEST-8798 | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script — NEW fields one per message, 👍 | Arabic recap → « 👍 » → TEST-6619 1 950 DA | yes, 1 | PASS (R10-4) |
| N23 | J03 · playground | arabizi — NEW « ih bessah wasslouha l Oran … » | recap Sétif → **new recap Oran, no order** → « ih » → TEST-4704 (Oran) | yes, 1 — after the new recap | PASS |
| N24 | J04 · playground | fr — NEW remark after the recap | recap → « c'est un cadeau pour mon père … » → answer, no order → « oui » → TEST-3157 | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **28 / 28** (F1, F2, F3, F4, F6, F7 ×2, F13, F14, N1, N2, N4,
  N5c, N6, N8, N9, N11, N12, N14, N15, N17, N18, N18b, N19, N20, N21, N23, N24) + F11 refused as blocked (1 / 1). **Order without a server
  recap: 0.** **« oui » to a correct recap lost: 0.** One « oui » after a change: **3 / 3** (F6 quantity, F7 after the order with
  `replacesOrder`, N1 product + wilaya + address). No second `create_order` after an order in a turn. Cancel right after the order:
  **1 / 1** (N14).
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N5 T3 (« oui » after a statement → a question, R10-2), N5c T2
  (« oui » to « Elle vous intéresse ? » → the recap).
- **« yes » with a change → a new recap, no order: 2 / 2** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…) and N23 T2 (arabizi « ih bessah wasslouha l Oran … » → Oran 600 DA, 8 100 DA, core e3d489…); each next « oui » / « ih » →
  the order with the new recap's address and total.
- **A message between the recap and the « oui » → no order, then one order: 3 / 3** — N19 T5 (question), N20 T4 (question), N24 T2
  (remark). In N19 T5 and N24 T2 the model re-sent the same `create_order` → `CONFIRMATION_REQUIRED` with the same draft, the server showed no
  second recap, the reply ended with « répondez « oui » … » pointing at the recap already shown.
- Confirming call reworded vs the recap call, order still placed: **2 / 2** — F4 « cité 1000 logements » → « Cité 1000 Logements, Bir El
  Djir, Oran », N23 « Cité 1000 logements bloc 4 » → « …, Bir El Djir, Oran » (F2, F4: a « yes » restating the address, same order).
- **No confirming call refused** (R8-1): the 29 confirming calls (28 orders + F11) all carried the recap's name, phone, wilaya, commune,
  address, items and `customerConfirmed true`; 0 `VALIDATION`, 0 « not given yet » — also after fields given one per message (N19, N20,
  N21) and after a message between the recap and the « oui » (N19, N20, N24). The stored-recap completion path was not needed (see « Not
  tested »).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, second phone, address): **34 / 34 recaps
  shown**, the named variant every time (F1, N1 Marron; N6, N9 M; N6 42); **in the customer's language 34 / 34** — Arabic script F2, F7 ×2,
  N11, N18, N18b, N21 (N18 / N18b with the Latin name « Samir Benali » — R9-1 fixed); arabizi F3, F14, N9, N15, N20, N23 ×2; English F4;
  French 19.
- **Server recap without a model sentence asking to confirm or describing the order: 34 / 34** — lead-in left: « Parfait, merci Amina ! »
  (N6) — a thank-you that asks nothing. **Outside any recap: 1** model request to confirm before a recap — N5 T3 « Pour confirmer : vous
  voulez bien le Coffret cadeau Aïd … ? » (R10-2); 0 « le récapitulatif va venir », 0 « problème technique ».
- **Recap address « …, commune, wilaya »: 34 / 34** — N18 / N18b « حي 1000 مسكن عمارة 5، الخروب، قسنطينة » now in the Arabic template.
- **Customer's name as written: 33 / 33 conversations** — Arabic script kept in Latin turns (F3 « وليد بوزيد », N4 « سمير بن علي »), Latin
  kept in Arabic turns (N18, N18b « Samir Benali »), 0 name refused, 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9 « Ma 3andnach tsawer ta3 had la robe f had lwaqt »; **photo announced without a
  photo: 0**.
- **Delivery question answered with the fee: 3 / 3** — F12, F9 ×2 (Sétif, Oran); a wilaya not served answered « ma nwasslouch » 2 / 2 (F9,
  N16); a delay question answered with the delay 2 / 2 (N19, N20).
- **`create_order` before a phone is in the customer's messages: 0 / 66 calls**.
- No 503 / provider error: **0 / 100 turns** — turn time median 5.5 s, max **223.6 s** (N1 T2; also F1 T3 104.7 s, F6 T3 71.0 s — R10-1;
  N21 T5 17.3 s); every `AiRun` of the run lasted ≤ 10.4 s (`finishedAt − startedAt`).
- Quantity never asked again after a product is named: **0 quantity question in 100 turns**; « le sac », « la djellaba », « 1 hijab soie »,
  « حجاب حرير واحد », « en 42 », « djalaba », « tapi de priere », « جلابة رجالي », « حجاب حرير » = 1; « zoudj », « 2 pièces », « 2 please »
  = 2; « wahda » kept.
- Language kept: arabizi **8 / 8** (F3, F9, F14, N9, N15, N16, N20, N23), Arabic-script darija **6 / 6** (F2, F7, N11, N18, N18b — also after
  the Latin name alone and a French « oui » —, N21), English (F4), French **18 / 18** (F1, F6, F10, F11, F12 on the link, F13, N1, N2, N4
  after the Arabic-script name, N5, N5c, N6, N8, N12, N14, N17, N19, N24).
- **No Tunisian / Moroccan words: 33 / 33** — check.cjs word list: 0 hit; other odd forms → R10-4.
- Out-of-stock product offered: **0** — N5 / N5c name the Parfum Oud only as « en rupture de stock » because the customer asked for it;
  alternatives in stock (Coffret, Djellaba homme).
- Street address → no « home or stop-desk ? »: **every flow with a street** went straight to the home recap; commune-only home address →
  street asked: **1 / 1** (F2).
- No hand-off on a field / order / yes / filler message: **0 visible** besides F11 (blocked); **0 `handoff_to_human` call in 100 turns**.
- Two phones in one message kept: **1 / 1** (N2).
- No Markdown in a reply: **100 / 100**.
- Tool calls in 100 turns: `create_order` 66 (34 recaps + 2 repeated recap calls on N19 T5 / N24 T2 + 28 orders + F11 blocked + N5 T2
  refused for stock — the link turn carries no tool calls), `search_products` 8, `quote_delivery` 7, `get_product` 3, `check_availability`
  2, `lookup_order` 2 (N11 asked; N4 probe), `cancel_order` 2 (N14 asked; N11 probe `{}`), `add_faq_candidate` 2 (N5, N4 — R10-3); 0
  invented product id, 0 search for a place, 0 identical search twice (R9-2's cases), but 3 new probe forms (R10-3).

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls
with their results (draft / core = first 6 characters of the server keys; every `clientName` shown). Shared-link turns carry no tool calls
(visitor response). Every J03 conversation has the « out_of_hours » system line (the J03 run was after the shop's closing time).

### F1 — J03 playground (UI fr)
**Verdict: PASS (R10-1 latency, R10-3 probe) — sac marron → name → phone + address → server recap alone « (Marron) » → « oui » → TEST-6293 7 550 DA. T3 took 104.7 s although its AI run lasted 3.6 s (R10-1); T1 two searches for the same product (R10-3).**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Très bon choix, le sac à main cuir en marron est disponible à 6900 DA. Pour continuer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `search_products {«Sac à main cuir»} → 1 product(s)`
- **T2** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — commune-only home address → « عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) » (no stop-desk offered this time, the street was asked); Arabic recap alone → « ايه، العنوان … » → TEST-4074 8 200 DA.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي، اسمي سمير بن علي 0661234567، قسنطينة، الخروب » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا سمير! الجلابة الرجالي متوفرة عندنا، ثمنها 7500 دج، وهي من صوف رقيق بلون بيج. عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) باش نسجلو الطلبية. »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T3** C: « ايه، العنوان حي 1000 مسكن عمارة 5 في الخروب قسنطينة » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: PASS — R9-3 « Ih » fixed: T1 « Saha, nsajjel lek zoudj tapis de prière … Wach smitek ? »; the call carries « وليد بوزيد », arabizi recap « Smitek: وليد بوزيد » → « ih » → TEST-5190 6 050 DA; arabizi in every reply.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Saha, nsajjel lek zoudj tapis de prière (2800 DA l wahda, 5600 DA les deux). Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi`
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T4** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-5190 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5190, total 6050`

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept, « 2 please » = 2; recap → « yes, Cité … » → TEST-2683 3 600 DA (confirming call reworded « Cité 1000 Logements, Bir El Djir, Oran », order still placed).**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (reduced from 2000 DA). It's soft silk, 180 x 70 cm, and it's in stock. Would you like to order it? If so, what is your name? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « 2 please, John Benali 0555987654, Oran, Bir El Djir, cité 1000 logements » · `en`
  - AI: « Here is your order summary: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Home delivery (Bir El Djir, Oran): 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Name: John Benali ⏎ Phone: 0555987654 ⏎ Address: cité 1000 logements, Bir El Djir, Oran ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `check_availability {qty 2} → available true` · `quote_delivery {Oran} → fee 600 / stop-desk 400` · `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T3** C: « yes, Cité 1000 Logements in Bir El Djir, Oran » · `en`
  - AI: « Your order TEST-2683 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 Logements, Bir El Djir, Oran», items 2×product …450a, customerConfirmed true} → ok TEST-2683, total 3600`

### F6 — J03 playground (UI fr)
**Verdict: PASS (R10-1 latency) — server recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-2670 9 100 DA. T3 took 71.0 s although its AI run lasted 4.2 s (R10-1).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

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

### F9 — J04 playground (UI fr)
**Verdict: PASS — Sétif 650 / 350, Oran stop-desk 400, « Ma nwasslouch l Illizi f had lwaqt. »; three `quote_delivery`, no other tool.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif : 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F10 — J03 playground (UI fr)
**Verdict: PASS — « Je ne peux pas appliquer la réduction de 50 % : le prix valable est 7500 DA. », no tool, no hand-off.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « La djellaba homme (laine fine, beige, taille unique) est à 7500 DA, au lieu de 9000 DA. Je ne peux pas appliquer la réduction de 50 % : le prix valable est 7500 DA. Voulez-vous la commander ? »
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
**Verdict: PASS — shared link: « Bonsoir ! Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk, avec une livraison en 2 à 5 jours. » (check.cjs « DELIVERY-Q-NO-FEE » is the known false hit of its fee regex).**

- **T1** C: « Bonsoir, vous livrez à Blida ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir ! Oui, on livre à Blida. Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous souhaitez voir un de nos produits ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » in the first message only gives the server recap, no order; T2 « oui » (left out in R9) → TEST-3146 7 950 DA.**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F14 — J04 playground (UI fr)
**Verdict: PASS — all-in-one arabizi message → server recap alone → « ih » → TEST-9246 8 150 DA.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-9246 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → ok TEST-9246, total 8150`

### N1 — J03 playground (UI fr)
**Verdict: PASS (R10-1 latency) — « le sac à main cuir marron à la place » → `variantId …0eda` → recap « (Marron) », Oran 600 DA, 7 500 DA → « oui » → TEST-5759. T2 took 223.6 s although its AI run lasted 9.4 s (R10-1, the slowest turn).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N2 — J04 playground (UI fr)
**Verdict: PASS — both numbers kept: « Deuxième téléphone : 0770998877 », `secondPhone` in both calls → TEST-4895.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci, 0661234568 ou 0770998877, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft e42dad… core 51097b…, recap total 1950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-4895 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-4895, total 1950`

### N4 — J03 playground (UI fr)
**Verdict: PASS (R10-3 probe) — « سمير بن علي » accepted once, French kept, « Nom : سمير بن علي » → « oui » → TEST-8384; but T2 (the name) ran `search_products`, an `add_faq_candidate` that is an internal note and `lookup_order {}` (R10-3).**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, le tapis de prière molletonné 120 x 70 cm est disponible à 2800 DA. Pour la commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `fr`
  - AI: « Merci Samir, c'est noté. Quel est votre numéro de téléphone (ex: 0555123456) ? »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `add_faq_candidate {«Le client a commandé le tapis de prière (quantité 1) ; prochaine étape : numéro de téléphone.», commande} → ok` · `lookup_order {} → 0 order`
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-8384 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-8384, total 3250`

### N5 — J04 playground (UI fr)
**Verdict: FAIL — R10-2 — T2 « Bon finalement je le prends + details » → `create_order` on the out-of-stock Oud → `ORDER_INSUFFICIENT_STOCK` → « Je vous ai bien noté, je reste à votre disposition si le Parfum Oud 50 ml revient en stock … » (+ an `add_faq_candidate` for a question nobody asked); T3 « oui » → « Pour confirmer : vous voulez bien le Coffret cadeau Aïd à 24990 DA à la place du Parfum Oud, qui est en rupture ? » — a model request to confirm, no recap; T4 « oui » → the server recap (gratuite, 24 990 DA), no order. Guarantees held (no order without a recap, no « problème technique »), but two « oui » were spent before the recap and the flow (4 messages) ended at the recap.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Son prix est de 3200 DA. Si vous cherchez un cadeau avec du parfum, le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Je vous ai bien noté, je reste à votre disposition si le Parfum Oud 50 ml revient en stock. En attendant, le Coffret cadeau Aïd est disponible à 24990 DA si vous voulez autre chose. »
  - tools: `search_products {«parfum»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …8c00, customerConfirmed true} → ORDER_INSUFFICIENT_STOCK` · `add_faq_candidate {«Quand le Parfum Oud 50 ml sera-t-il de nouveau disponible ?», stock} → ok`
- **T3** C: « oui » · `fr`
  - AI: « Merci pour vos coordonnées, Karim. Pour confirmer : vous voulez bien le Coffret cadeau Aïd à 24990 DA à la place du Parfum Oud, qui est en rupture ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `get_product {…3400} → Coffret cadeau Aïd, in stock`
- **T4** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`

### N5c — J04 playground (UI fr)
**Verdict: PASS — Oud out of stock → Djellaba homme offered (in stock) « Elle vous intéresse ? » → « oui » → server recap, no order → « oui » → TEST-8008 8 100 DA.**

- **T1** C: « Bonjour, je veux le parfum oud. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Je vous propose la Djellaba homme en laine fine, beige, taille unique, à 7500 DA (au lieu de 9000 DA). Elle vous intéresse ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«parfum»} → 1 product(s)`
- **T2** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft c87d7b… core ca7b5f…, recap total 8100`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8008 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → ok TEST-8008, total 8100`

### N6 — J04 playground (UI fr)
**Verdict: PASS — 2 products with variants + details → « Parfait, merci Amina ! » (thank-you lead-in) + recap « (M) », « (42) » → « oui » → TEST-4483 17 800 DA, right ids at once.**

- **T1** C: « Bonjour, je veux la robe kabyle brodée en taille M et la basket sport Runner en 42. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait, merci Amina ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft cad645… core 482777…, recap total 17800`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-4483 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true, phoneConfirmed true} → ok TEST-4483, total 17800`

### N8 — J04 playground (UI fr)
**Verdict: PASS — R9-2 fixed here (no repeated search, one `check_availability`): recap at T1 (free delivery « gratuite », 24 990 DA) → « oui » (left out in R9) → TEST-3157.**

- **T1** C: « Bonjour, le coffret cadeau Aïd est disponible ? Je suis Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `check_availability {qty 1} → available true` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N9 — J04 playground (UI fr)
**Verdict: PASS (R10-4 words) — « Ma 3andnach tsawer ta3 had la robe f had lwaqt » + fabric and sizes (French left: « mais », « Les tailles disponibles ») ; recap (M) → « ih » (left out in R9) → TEST-6890 5 300 DA.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam 👋 Ma 3andnach tsawer ta3 had la robe f had lwaqt, mais hiya robe kabyle brodée bil yed, b tissu khfif, mlih l les fêtes. Les tailles disponibles: S, M w XL (L makach dork). S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS (R10-3 probe) — R9-3 fixed: `lookup_order {}` → « … وما خرجتش للتوصيل بعد، درك في مرحلة التحضير. كي تخرج راح نعطيك رقم التتبع » — no « في الدرب », one « درك », no invented number; but a `cancel_order {}` probe in the same turn (R10-3).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar`
  - AI: « الطلبية تاعك رقمها TEST-4074 وهي مسجلة عندنا، وما خرجتش للتوصيل بعد، درك في مرحلة التحضير. كي تخرج راح نعطيك رقم التتبع، والتوصيل يكون من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null` · `cancel_order {} → ok, nothing cancelled, candidates TEST-4074`

### N12 — J04 playground (UI fr)
**Verdict: PASS — « ? » → « Quel est votre nom, s'il vous plaît ? »; « ... » → « Dans quelle wilaya habitez-vous ? »; street → recap alone; « 👍 » → TEST-9479.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait, on note 1 Hijab soie à 1500 DA. Quel est votre nom ? »
  - tools: `get_product {…450a} → Hijab soie, in stock` · `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « ? » · `fr`
  - AI: « Quel est votre nom, s'il vous plaît ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr`
  - AI: « Merci Nadia, c'est noté. Dans quelle wilaya habitez-vous ? »
- **T4** C: « ... » · `fr`
  - AI: « Dans quelle wilaya habitez-vous ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T6** C: « 👍 » · `fr`
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N14 — J03 playground (UI fr)
**Verdict: PASS — « oui » → TEST-3146; « non annule » → `cancel_order {TEST-3146}` ok (simulated) → « Votre commande TEST-3146 est bien annulée. », no new order.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr`
  - AI: « Votre commande TEST-3146 est bien annulée. Si vous voulez reprendre la djellaba plus tard, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-3146`

### N15 — J03 playground (UI fr)
**Verdict: PASS — « djalaba » + « tapi de priere » → recap Djellaba homme + Tapis de prière, 10 950 DA, arabizi → « ih » → TEST-9789.**

- **T1** C: « Salam, nheb nechri djalaba w tapi de priere, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 10 950 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4b2a48… core 231f44…, recap total 10950`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-9789 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison: 650 DA ⏎ Total: 10 950 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …efdc, 1×product …a750, customerConfirmed true} → ok TEST-9789, total 10950`

### N16 — J04 playground (UI fr)
**Verdict: PASS — R9-2 / R9-3 fixed: two `quote_delivery` → `WILAYA_NOT_SERVED` → « Ma nwasslouch l Illizi f had lwaqt, makach livraison l had wilaya. Wach men wilaya o5ra t7ebb nwasslek fiha ? » — no « Lmoute », no « tswayyab », no `search_products {«Illizi»}`.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma nwasslouch l Illizi f had lwaqt, makach livraison l had wilaya. Wach men wilaya o5ra t7ebb nwasslek fiha ? »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED`

### N17 — J04 playground (UI fr)
**Verdict: PASS — R9-2 fixed here (first call with the right product id): recap Blida 1 950 DA → « oui mais livrez à Alger, Bab Ezzouar, … » → a NEW server recap (Alger, 400 DA, 1 900 DA, core f4cd80…), no order → « oui » → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N18 — J03 playground (UI ar)
**Verdict: PASS — R9-1 fixed: same messages as R9, « Samir Benali 0661234567، قسنطينة، … » → Arabic server recap « هذا ملخص الطلبية … الاسم: Samir Benali … العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة … جاوبني بـ « إيه » … » → « ايه » → TEST-8849. (T1 « في لاين فين », R10-4.)**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام، أهلًا بيك! عندنا جلابة رجالي في لاين فين، من الصوف الرقيق بلون بيج، مقاس واحد. سعرها 7500 دج بدل 9000 دج. تحب نكمل الطلبية؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `get_product {…efdc} → Djellaba homme, in stock`
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N18b — J03 playground (UI ar)
**Verdict: PASS — NEW: the Latin name alone as a whole message in an Arabic-script chat → Arabic kept (« صحيت سي سمير، تسجل الاسم تاعك … »); Arabic recap « الاسم: Samir Benali »; a French « oui » → TEST-8849 confirmation in Arabic (the T3 tag reads `arabizi` for an Arabic-script message, no visible effect — R10-4).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام 👋 عندنا Djellaba homme بـ 7500 دج (بدل 9000 دج)، جلابة من صوف رقيق لونها بيج ومقاسها واحد. تحب نسجلهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar`
  - AI: « صحيت سي سمير، تسجل الاسم تاعك. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `arabizi`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T4** C: « oui » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N19 — J04 playground (UI fr)
**Verdict: PASS — NEW R8-1 path probe (French, fields one per message, a question after the recap): product → name → phone → place → recap (24 990 DA, gratuite); « c'est livré en combien de jours ? » → « 2 à 5 jours … répondez « oui » au récapitulatif ci-dessus » (repeated `create_order` → same draft, no new recap, no order); « oui » → TEST-1709 — the confirming call carried every field.**

- **T1** C: « Bonjour, je veux le coffret cadeau Aïd » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir ! Le Coffret cadeau Aïd est à 24990 DA, il contient un parfum, du chocolat et une carte personnalisée, parfait pour offrir. Pour la commande, quel est votre nom ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Quel est votre numéro de téléphone (ex : 0555123456) ? »
- **T3** C: « 0770112233 » · `fr`
  - AI: « Merci Karim, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir le coffret ? »
- **T4** C: « Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T5** C: « c'est livré en combien de jours ? » · `fr`
  - AI: « La livraison à Oran prend 2 à 5 jours, et elle est gratuite à domicile pour cette commande. Pour finaliser, répondez « oui » au récapitulatif ci-dessus afin de confirmer la commande. »
  - tools: `quote_delivery {Oran} → fee 0 / stop-desk 400` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T6** C: « oui » · `fr`
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N20 — J03 playground (UI fr)
**Verdict: PASS — NEW R8-1 path probe (arabizi, fields over 3 messages, a question after the recap): recap 3 450 DA → « ch7al ywasel ? » → « Tawsil ta3 la commande ywasel f 2 l 5 ayam. Ktebli « ih » … » (no tool, no order) → « ih » → TEST-8798.**

- **T1** C: « slm, nheb nechri tapis de prière » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Wa 3likoum salam ! Tapis de prière molletonné, 120 x 70 cm, b 2800 DA, kayen 3andna. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti Karim Haddad, 0770112233 » · `arabizi`
  - AI: « Saha Karim, tsajjel. Wach men wilaya ? »
- **T3** C: « Setif, El Eulma, cite 500 logements bloc 12 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 3 450 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft d07239… core 027426…, recap total 3450`
- **T4** C: « ch7al ywasel ? » · `arabizi`
  - AI: « Tawsil ta3 la commande ywasel f 2 l 5 ayam. Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T5** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-8798 tsajlet ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison: 650 DA ⏎ Total: 3 450 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …a750, customerConfirmed true} → ok TEST-8798, total 3450`

### N21 — J04 playground (UI ar)
**Verdict: PASS (R10-4 words) — NEW R8-1 path probe (Arabic script, fields one per message, « 👍 »): name / phone / address one by one → Arabic recap → « 👍 » → TEST-6619 1 950 DA (T5 17.3 s). T1 « بسعر Hijab soie — 1500 دج » (R10-4).**

- **T1** C: « سلام، نحب حجاب حرير » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر Hijab soie — 1500 دج (بدل 2000 دج). تحب نسجلولك واحد منه؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar`
  - AI: « صحيت، تسجلت سميتك نادية. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234568 » · `ar`
  - AI: « صحيت، سجلت الرقم. واش من ولاية توصلك الطلبية؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N23 — J03 playground (UI fr)
**Verdict: PASS — NEW change inside an arabizi « yes »: recap Sétif 8 150 DA → « ih bessah wasslouha l Oran, Bir El Djir, … » → a NEW arabizi recap (Oran 600 DA, 8 100 DA), no order → « ih » → TEST-4704 (Oran).**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-4704 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → ok TEST-4704, total 8100`

### N24 — J04 playground (UI fr)
**Verdict: PASS — NEW R8-1 path probe (a remark after the recap): recap → « Merci, c'est un cadeau pour mon père, il va être content » → a short answer + « Répondez « oui » … » (repeated `create_order` → same draft, no order) → « oui » → TEST-3157.**

- **T1** C: « Bonjour, je veux le coffret cadeau Aïd. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T2** C: « Merci, c'est un cadeau pour mon père, il va être content » · `fr`
  - AI: « Ah, c'est une belle attention pour votre père ! Le coffret cadeau Aïd est parfait pour une occasion comme ça. Répondez « oui » pour confirmer la commande, ou dites-moi ce qu'il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

## Bugs

### R10-1 — Playground answer arrives 1–4 minutes after the AI run has finished
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même »: run N1 (« Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août
  villa 3 » → « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements
  bloc 4 » → « oui »), then F1, F6.
- Expected: the answer within the usual few seconds once the AI run is done (R9: median 5.4 s, max 36.1 s; this run's median 5.5 s).
- Actual: three turns of the J03 run, between 21:20 and 21:29, waited far longer than their AI run lasted (send → answer in the page, vs
  the `AiRun` row of the turn, read-only):
  - N1 T2 sent 21:20:16.8 → answer 21:24:01.2 = **223.6 s**; `AiRun` started 21:20:17.6, finished 21:20:27.0 (latencyMs 9 367) — the
    recap was ready 214 s before the page got it.
  - F1 T3 sent 21:25:48.9 → answer 21:27:34.4 = **104.7 s**; `AiRun` 21:25:49.7 → 21:25:53.4 (3 642 ms).
  - F6 T3 sent 21:28:22.4 → answer 21:29:34.2 = **71.0 s**; `AiRun` 21:28:23.9 → 21:28:28.2 (4 231 ms).
  The answers were right (recap « (Marron) », TEST-6293, TEST-2670), no 503, no error line in the API / worker logs for that period
  (`pm2` out / error logs not written since the 20:51 restart). Every other turn of the run ≤ 17.3 s; every `AiRun` of the run ≤ 10.4 s.
  A shopper on the shared link goes through the same request.
- Evidence: .local/qa/journeys/R10/out/transcripts/N1.json T2, F1.json T3, F6.json T3 (`ms`, `at`) · run2.log · .local/qa/campaign/retest-ai-r10/fr-N1-pg.png · `AiRun` rows of workspace
  01a1e54f-… started 20:20:17, 20:25:49, 20:28:23 UTC
- Likely cause: not visible from the page — the delay sits between the closed `AiRun` row and the HTTP answer. `playground.service.ts`
  `request` waits with `job.waitUntilFinished(QueueEvents, RUN_BUDGET_MS)` and RUN_BUDGET_MS is 45 s, so that wait alone cannot last 214 s
  (it would have ended in `AI_PROVIDER_ERROR`): either the job kept working after the run row was closed and the « completed » event came
  late, or the finished answer took minutes to go back through the API / web proxy. To be traced in the worker / API timings.

### R10-2 — Out-of-stock product « je le prends »: « Je vous ai bien noté », then « Pour confirmer : … ? » without a recap
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › step 5 › « Tester moi-même » (UI fr): « Bonjour, le parfum oud c'est combien ? », « Bon finalement je le prends. Karim Haddad
  0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 », « oui », « oui ».
- Expected: T2 says plainly that the Oud cannot be ordered (out of stock) and asks whether the customer wants the Coffret instead (R9 N5:
  « Désolé, Parfum Oud 50 ml est en rupture de stock … Voulez-vous le prendre à la place ? »); a « oui » to that offer gives the server
  recap (R9 N5 T3, N5c), never a model request to confirm without a recap (R4-4 / R8-2: no « tu confirmes ? » without a recap).
- Actual: T1 « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Son prix est de 3200 DA. Si vous cherchez un cadeau avec du
  parfum, le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. » (no question). T2 `create_order {items
  [1 × Parfum Oud …8c00]}` → `ORDER_INSUFFICIENT_STOCK` (+ `add_faq_candidate {«Quand le Parfum Oud 50 ml sera-t-il de nouveau disponible
  ?»}`, a question the customer did not ask) → « **Je vous ai bien noté**, je reste à votre disposition si le Parfum Oud 50 ml revient en
  stock. En attendant, le Coffret cadeau Aïd est disponible à 24990 DA si vous voulez autre chose. » — « bien noté » after details reads as
  « order noted », the refusal is only implied, no question. T3 « oui » → « Merci pour vos coordonnées, Karim. **Pour confirmer : vous voulez
  bien le Coffret cadeau Aïd à 24990 DA à la place du Parfum Oud, qui est en rupture ?** » — no tool but `get_product`, no recap. T4 « oui »
  → the server recap (Coffret, gratuite, 24 990 DA, draft faad11… core 1fbb33…), no order — the customer said « oui » twice and still has
  no order; the flow (4 messages) ended at the recap. No order without a recap, no « problème technique ».
- Evidence: .local/qa/journeys/R10/out/transcripts/N5.json T1–T4 (+ N5.ui.txt) · .local/qa/campaign/retest-ai-r10/fr-N5-pg.png
- Likely cause: `confirm_without_recap` (reply-guard.ts) only fires on a turn whose `create_order` was refused; T3 had no `create_order`,
  so a model « Pour confirmer : … ? » passes; T2's reply after `ORDER_INSUFFICIENT_STOCK` follows the tool's `say` loosely (« offer an
  in-stock product instead ») without a question, so T3's « oui » has nothing to answer.

### R10-3 — Probe calls in new forms (`cancel_order {}` on a tracking question, `add_faq_candidate` as a note, a second search) — R9-2 partly fixed
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: run N11, N4, N5, F1; read the tool calls.
- Expected: `cancel_order` only when the customer asks to cancel; `add_faq_candidate` only with a question the customer asked; one search
  per product; no `lookup_order` on a name message.
- Actual (none reached the customer; the playground simulates them):
  - N11 T3 (« صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ ») `lookup_order {}` → TEST-4074 new / not_sent, then
    **`cancel_order {}`** → `ok, candidates [TEST-4074]` (nothing cancelled) — a cancel probe on a tracking question (R8-4's N5 T2 form).
  - N4 T2 (the name « سمير بن علي ») `search_products {«Tapis de prière»}`, **`add_faq_candidate {«Le client a commandé le tapis de prière
    (quantité 1) ; prochaine étape : numéro de téléphone.», commande}`** — an internal note filed as an FAQ candidate (on a live chat it
    would reach the merchant's FAQ suggestions) — and `lookup_order {}` → 0 order.
  - N5 T2 `add_faq_candidate {«Quand le Parfum Oud 50 ml sera-t-il de nouveau disponible ?», stock}` — the customer asked no such thing
    (R10-2).
  - F1 T1 `search_products {«Sac à main cuir marron»}` then `search_products {«Sac à main cuir»}` (same product, two folded queries);
    N12 T1 `get_product {…450a}` then `search_products {«hijab soie»}`.
  - Gone since R9: N17 the invented product id (first call right), N16 `search_products {«Illizi»}`, N8 the same search twice; 0
    `handoff_to_human`, 0 `create_order` before a phone (0 / 66).
- Evidence: .local/qa/journeys/R10/out/transcripts/N11.json T3, N4.json T2, N5.json T2, F1.json T1, N12.json T1
- Likely cause: `sameCallKey` only stops identical calls; nothing scopes `cancel_order` to a cancel request or `add_faq_candidate` to a
  question that is in the customer's message.

### R10-4 — Odd wording left (French words in Arabic letters, a product name in the price slot, French inside arabizi)
- Page: playground dialog (owner, ar / fr, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Cosmetic
- Type: Text
- Steps: run N18, N21, N9, N18b.
- Expected: plain Algerian darija / arabizi.
- Actual:
  - N18 T1 « عندنا جلابة رجالي **في لاين فين**، من الصوف الرقيق بلون بيج … » — « laine fine » written in Arabic letters, next to its
    translation « من الصوف الرقيق ».
  - N21 T1 « عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، **بسعر Hijab soie — 1500 دج** (بدل 2000 دج) » — the catalogue name pasted where the
    price goes.
  - N9 T1 « … **mais** hiya robe kabyle brodée bil yed, b tissu khfif, mlih l les fêtes. **Les tailles disponibles**: S, M w XL (L makach
    dork). » — less French than R9 (« Ma 3andnach », « makach dork »), still French words.
  - N18b T3 the playground's language tag reads `arabizi` for « 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » (Arabic script); the
    recap is Arabic, no visible effect.
- Evidence: .local/qa/journeys/R10/out/transcripts/N18.json T1, N21.json T1, N9.json T1, N18b.json T3
- Likely cause: free model wording; `ODD_FIXES` does not cover these forms.

## Retest
- RETEST R9-1: fixed — N18 (same messages) Arabic server recap « هذا ملخص الطلبية … الاسم: Samir Benali … العنوان: حي 1000 مسكن عمارة 5،
  الخروب، قسنطينة … جاوبني بـ « إيه » … » → « ايه » → TEST-8849 in Arabic; also with the Latin name alone as a message and a French « oui »
  (N18b, Arabic kept in every reply); a Latin-script value never switched a French chat (N4) or an arabizi chat (F3).
- RETEST R9-2: partly fixed — N17 T1 the right product id at once, N16 no `search_products {«Illizi»}`, N8 one call per product; but new
  probe forms (`cancel_order {}` on a tracking question, `add_faq_candidate` with a note or an unasked question, two folded searches) →
  R10-3.
- RETEST R9-3: fixed for the cited words — N16 no « Lmoute » / « tswayyab » (« Ma nwasslouch l Illizi … Wach men wilaya o5ra t7ebb nwasslek
  fiha ? »), N11 no « في الدرب » and one « درك » (« ما خرجتش للتوصيل بعد، درك في مرحلة التحضير »), F3 T1 no stray « Ih », N9 less French;
  new odd forms → R10-4.
- RETEST R8-1: holds — 0 « oui » to a server recap lost in 28 + 1, 0 `VALIDATION` / « not given yet » on a confirming call, 0 « problème
  technique » and 0 « répondez « oui » une nouvelle fois » in 100 replies. The flows built to make the model drop fields (N19 fr, N20 arabizi,
  N21 Arabic script: fields one per message; N19, N20, N24: a question or a remark between the recap and the « oui »; « oui », « ih », « 👍 »)
  all ended in exactly one order from the stored recap (TEST-1709, TEST-8798, TEST-6619, TEST-3157) — but every confirming call still
  carried every field, so the « complete a short confirming call from the stored recap » code path itself was not exercised live. N5 (same
  messages + one « oui ») took a third path (R10-2) and ended at the recap.
- R1–R8 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 28 orders**, N5 T3 « oui » → question, N5c
  T2 « oui » → recap, N17 T2 / N23 T2 « yes » with a change → new recap, N19 T5 / N20 T4 / N24 T2 → no order; R4-1 (no hand-off on order
  messages) holds — 0 visible besides F11, 0 `handoff_to_human` call; R4-2 (a name in another script keeps the language) holds — F3, N4,
  N18, N18b; R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 34 / 34 recaps; **R8-2 (no confirm request
  without a recap) broken once in a new situation — N5 T3 (R10-2)**; R4-6 (two phones) holds — N2; R4-8 (blocked sentence) holds — F11;
  R5-1 (in-stock alternatives only) holds — N5, N5c; R5-2 (no Tunisian forms) holds — 0 hit; R5-4 (no « home or stop-desk ? » after a street)
  holds; R5-5 (delivery question answered) holds — F12, F9; R5-6 (no `create_order` before a phone) holds — 0 / 66; R6-4 (recap address
  « …, commune, wilaya ») holds — 34 / 34; R7-2 (no photo said) holds — N9; R7-3 (fillers → the pending question) holds — N12; R7-5 (fee on
  « vous livrez à ? ») holds — F12; F10 no invented discount; N11 tracking from `lookup_order`, no invented number or date; R8-3 (named
  variant) holds — F1, N1 Marron, N6, N9; one order per « oui »: 28 orders, never two for one « oui », none lost.

## Coverage
- Order flows to « oui »: fr ×14 (F1, F6, F13, N1, N2, N4, N5c, N6, N8, N12, N14, N17, N19, N24; F11 blocked), Arabic-script darija ×6 (F2,
  F7, N11, N18, N18b, N21), arabizi ×6 (F3, F14, N9, N15, N20, N23), en ×1 (F4); flow ended at its recap: N5 (R10-2); commune-only home
  address in F2; all-in-one in F6, F7, F11, F13, F14, N1, N2, N6, N8, N11, N14, N15, N17, N23, N24; fields one per message in N19, N20, N21;
  confirming « yes » restating the address in F2, F4.
- Asked this round: N18 (R9-1), the R8-1 path (N19, N20, N21, N24, N5), F3, N1, N17, N8, N9, N11, N16 (R9-2 / R9-3), F11; new: a Latin
  name alone + a French « oui » in an Arabic chat (N18b), a change inside an arabizi « ih » (N23), a remark after the recap (N24).
- Also: quantity change before « oui » (F6) and after the order (F7), fake discount (F10), « Bonsoir » on the link (F12), 2 products with
  variants (N6), out-of-stock product asked (N5, N5c), cancel right after the order (N14), mistyped product names (N15), a wilaya not served
  (N16, F9), photo request (N9), fillers (N12), out-of-hours shop (every J03 run).
- Kit: no blocked call, no API error, no console error in any of the 33 runs; no kit timeout.

## Not tested
- The R8-1 code path itself — a confirming call that drops fields completed from the stored recap: 29 / 29 confirming calls were complete,
  also after fields given one per message and a message between the recap and the « oui ».
- R9 flows left out for the budget: F1b, F3b (link, arabizi photo), F5 (link, mixed), F8, F8b (8-digit phone), N3 (fr → arabizi switch),
  N5b, N7, N10 (« trop cher » / « quand même »), N13 (two questions in one message).
- A « yes » with a change in Arabic script (« ايه بصح … ») — N17 fr and N23 arabizi only.
- Live Messenger path (no page connected); a product that HAS photos asked for in a photo request; a mistyped product matching two catalogue
  products; a mistyped wilaya; a wilaya not served with a served stop-desk nearby; `cancel_order` on a real order; `lookup_order` on a real
  order with a courier and a tracking number; a provider failure (none in R2–R10).

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place. Shared test links from R7 reused
  (valid until 18/11 18:04); no new link.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-6293 (F1), TEST-4074 (F2, N11), TEST-5190 (F3), TEST-2683 (F4),
  TEST-2670 (F6), TEST-6619 (F7 — replaced — and N21), TEST-8142 (F7), TEST-3146 (F13, N14 — cancelled in N14, simulated), TEST-9246 (F14),
  TEST-5759 (N1), TEST-4895 (N2), TEST-8384 (N4), TEST-8008 (N5c), TEST-4483 (N6), TEST-3157 (N8, N24), TEST-6890 (N9), TEST-9479 (N12),
  TEST-9789 (N15), TEST-8063 (N17), TEST-8849 (N18, N18b), TEST-1709 (N19), TEST-8798 (N20), TEST-4704 (N23) — the simulated number follows
  the recap's draft, so the same recap gives the same number in two sessions.
- Hour counters: J04 59 / 60 after N24 (21:33:18, window from 20:58:18), J03 41 / 60 after F10 (21:32:21, window from 21:16:39); no 429.
  Messages used: 100 / 100.
