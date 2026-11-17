# R13 — Thirteenth retest of the AI order-taking (after the R12 fixes) — live site, deployed commit e1b230f — 18/11/2026 00:29–00:45 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at e1b230f (checked read-only: `git log --oneline -1` = « e1b230f fix(ai): live retest R12 —
one punctuation-proof normaliser for every model/customer comparison, places match in either script, confirm requests need no « ? », no
« order registered » claim without an order, fewer lookups / duplicate searches, wording fixes »; `djaber-v2-api` / `djaber-v2-worker`
online, restarted 00:18:17). Same two own shops as R1–R12: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR)
and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Surface: step 5 › « Tester moi-même » (playground, tool calls
visible) only — no flow of this round's list runs on the shared test link (F5 not asked), so the R7 links (valid until 18/11 18:04) were
neither used nor renewed. One browser at a time, the runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04
shop was still in place (F11, A5). The 60 / h counters were read before the run (read-only, Redis `rl:playground:*`): the R12 windows were
still open (J04 47, J03 51), so each shop's run waited until its key had expired (J04 00:29:41, J03 00:35:51). J04 flows 00:29:41–00:35:07,
J03 flows 00:35:51–00:42:23, two re-runs 00:44:32–00:45:20 (F1c, A3b, J03). No 429. The J03 shop was outside its opening hours: every J03
conversation starts with the shop's « out_of_hours » system line — configured text, not an AI reply (the J04 shop was not).

**Latency method (as R11 / R12).** `conv.mjs` of R12 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`,
sent / ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » log lines (`runMs`, `waitMs`, `totalMs`, `replayed`) and the `AiRun` rows (`latencyMs`,
`status`, `error`, `flags`, `meta.guard`). No stall / dup probe.

**99 customer messages** (J04 shop 45, J03 shop 54; 1 budget left), 30 conversations, all on the playground: priority 1 — N21 ×2, N18 ×2
(the R12-1 / R12-2 flows, same messages), and 6 NEW Arabic-script flows that mix scripts and punctuation on purpose: A1 (wilaya « ، »
commune, wilaya « الجزائر »), A2 (« ؛ » and « - »), A3 + re-run A3b (Arabic-Indic digits « ٠٥٥٠١٢٣٤٥٦ » in the phone, then wilaya commune
street with no separator), A4 (commune written in Latin by the customer inside Arabic text, before the wilaya), A5 (the J04 blocked number
in Arabic-Indic digits); priority 2 — F1 (+ re-run F1c), F1b, F3, F6, F9, F11, N1, N3, N4, N5, N7, N9, N11, N12, N14, N16, N17, N23, N25;
each order flow to its final « oui ». The order flows of priority 1 carried one guarded extra « ايه » (sent only if no order was placed
yet — never needed). Scripts `.local/qa/journeys/R13/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs, lat-table.cjs, server.sh =
read-only `AiRun` query, waitkey.sh, run.sh, all.sh), transcripts `.local/qa/journeys/R13/out/transcripts/<id>.json` (+ `.ui.txt`,
`.log.json`), run logs `.local/qa/journeys/R13/out/run1.log` (J04), `run2.log` (J03), `run3.log` (F1c, A3b), `airun.txt`, rendered turns
`out/render.md`, screenshots `.local/qa/campaign/retest-ai-r13/`.

Cases asked for this round:
- **R12-1 / R12-2**: N21 ×2 and N18 ×2 as in R12, plus 4 new Arabic-script flows mixing scripts and punctuation (here A1–A4, + A3b, + A5),
  each to its final « oui »; watch for any confirm request or « order registered » claim without a recap.
- A sweep: F1, F1b, F3, F6, F9, F11, N1, N3, N4, N5, N7, N9, N11, N12, N14, N16, N17, N23, N25 with their final « oui ».
- Latency per turn with `Server-Timing`; every R1–R12 guarantee (no order without a server recap — Critical; one order per « oui »; a « oui »
  with a change gives a new recap; no `create_order` before a phone; no confirm question / registered claim without a server recap; no
  hand-off for a product not sold or on a field / yes message; language kept; no invented discount; tracking real; address street, commune,
  wilaya).

**Result: 28 / 30 conversations pass** — priority 1: 9 / 10 (N21 ×2, N18 ×2, A1, A2, A3b, A4, A5 pass; A3 fails), sweep 19 / 20 (F1 fails,
its re-run F1c passes). **R12-1 is fixed: 0 `VALIDATION wilayaId` on a wilaya the customer wrote in 61 `create_order` calls** — N18 ×2 sent
the commune in Latin (« El Khroub ») after « قسنطينة، … » exactly as the R12 failure and got the recap at once; « ، », « ؛ », « - », no
separator, a Latin commune inside Arabic text and Arabic-Indic digits all reach the recap (A1–A5). **R12-2 not seen: 0 confirm request and
0 « order registered » claim without a server recap in 99 turns** (the guard caught `confirm_without_recap` twice before sending, N21 T1,
N18b T1). **R12-3 fixed on its flows** (F3, F6: one `create_order`, no lookup after the order; N4 T1 one search). **Latency: median 4.9 s,
p90 7.7 s, slowest 12.6 s (N7 T1, server 12.4 s); 3 turns above 10 s, 0 above 15 s; 0 page re-send; `Server-Timing` on 99 / 99 answers;
page − server median 0.23 s, max 0.53 s; 0 provider error.** **0 order without a server recap; 25 TEST orders, each from a « oui / ih / ايه
/ 👍 / ih saha / oui c'est bien … » to a server recap, exactly one each; F11 and A5 « oui » refused as blocked; 3 « yes » with a change (N17
fr, N23 arabizi, N25 Arabic script) → a new recap, 0 order; 0 `create_order` before a phone in 61 calls.** Failures — **one Major: a
hand-off for a product the shop sells** (F1 T1 « Je voudrais le sac à main cuir marron » → `handoff_to_human {off_catalogue}` accepted,
HANDOFF line shown, 1 run in 2) (R13-1); one Minor: with no separator between wilaya and commune the recap / order address can read
« street، wilaya commune » (A3, 1 run in 2) (R13-2). Issues: the customer's Arabic street rewritten in French (R13-3), probe / redundant tool
calls (R13-4), a substitution recap without saying so (R13-5), wording left (R13-6).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| N21 | J04 · playground | Arabic script, fields one per message, 👍 | T4 « البليدة، بوفاريك، … » → recap at once; « 👍 » → TEST-6619 1 950 دج | T1 5.6 s / 5.3 s | yes, 1 | PASS (R12-1, R12-2) |
| N21b | J04 · playground | Arabic script (re-run) | same → recap → « 👍 » → TEST-9414 | T1 5.1 s / 4.6 s | yes, 1 | PASS (R12-1) |
| N18 | J03 · playground | Arabic script, Latin name | commune sent « El Khroub » → recap (no `VALIDATION`) → « ايه » → TEST-8849 8 200 دج | T1 10.5 s / 10.3 s | yes, 1 | PASS (R12-1, R12-2) |
| N18b | J03 · playground | Arabic script (re-run) | « El Khroub » → recap → « ايه » → TEST-7130; street sent in French | T2 6.8 s / 6.6 s | yes, 1 | PASS (R13-3 noted) |
| A1 | J04 · playground | Arabic script, wilaya « ، » commune | « الجزائر، باب الزوار، … » → recap Alger → « ايه » → TEST-1852 1 900 دج | T5 4.9 s / 4.7 s | yes, 1 | PASS |
| A2 | J03 · playground | Arabic script, « ؛ » / « - » | « سطيف؛ العلمة - حي 500 … » → recap « (Marron) » → « ايه » → TEST-5502 7 550 دج | T3 5.3 s / 5.1 s | yes, 1 | PASS |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠١٢٣٤٥٦ », no separator | phone 0550123456; « قسنطينة الخروب حي … » → recap address « حي 1000 مسكن عمارة 5، قسنطينة الخروب » → « ايه » → TEST-5403 | T3 6.6 s / 6.3 s | yes, 1 | FAIL — R13-2 |
| A3b | J03 · playground | Arabic script (re-run of A3) | recap « حي 1000 مسكن عمارة 5، الخروب، قسنطينة » → « ايه » → TEST-5126 6 300 دج | T3 6.6 s / 6.4 s | yes, 1 | PASS |
| A4 | J04 · playground | Arabic script, Latin commune | « نسكن في Bir El Djir ولاية وهران، … » → recap « (بئر الجير، وهران) » → « ايه » → TEST-4053 8 100 دج | T3 5.0 s / 4.8 s | yes, 1 | PASS |
| A5 | J04 · playground | Arabic script, blocked phone in Arabic-Indic digits | recap 0550123456 → « ايه » → `CUSTOMER_BLOCKED`, hand-off | T2 5.0 s / 4.7 s | no (refused, as expected) | PASS |
| F1 | J03 · playground | fr | T1 `handoff_to_human {off_catalogue}` accepted on « Je voudrais le sac à main cuir marron »; recap → « oui » → TEST-6293 | T1 7.1 s / 6.9 s | yes, 1 | FAIL — R13-1 |
| F1c | J03 · playground | fr (re-run of F1) | no hand-off; recap → « oui » → TEST-6293 7 550 DA | T4 4.7 s / 4.5 s | yes, 1 | PASS |
| F1b | J03 · playground | fr, fields over 3 messages | T1 guessed wilaya refused; T2 street asked (home fee not said); T3 recap; T4 → TEST-6313 | T1 8.0 s / 7.7 s | yes, 1 | PASS (R13-4, R13-6) |
| F3 | J03 · playground | arabizi, Arabic-script name | recap « Smitek: وليد بوزيد » → « ih » → TEST-1845 6 050 DA | T3 7.7 s / 7.5 s | yes, 1 | PASS (R12-3; R13-4) |
| F6 | J03 · playground | fr, quantity change | 2 → 3 tapis new recap → « oui » → TEST-2670 9 100 DA | T1 7.2 s / 6.9 s | yes, 1 | PASS (R12-3) |
| F9 | J04 · playground | arabizi, 3 delivery questions | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 4.6 s / 4.4 s | — | PASS (R13-6) |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider cette commande ici … » | T2 6.7 s / 6.5 s | no (refused, as expected) | PASS |
| N1 | J03 · playground | fr, product + wilaya change | new recap « (Marron) » Oran → « oui » → TEST-5759 7 500 DA | T1 8.2 s / 8.0 s | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | fee answered + arabizi recap → « ih saha » → TEST-4551 6 300 DA | T2 10.8 s / 10.5 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | « سمير بن علي » kept; recap → « oui » → TEST-8384 3 250 DA | T1 5.7 s / 5.5 s | yes, 1 | PASS |
| N5 | J04 · playground | fr, out of stock « je le prends » | Coffret recap straight away (no substitution sentence) → « oui » → TEST-3157 24 990 DA | T2 10.0 s / 9.8 s | yes, 1 | PASS (R13-5) |
| N7 | J03 · playground | fr, product not sold + details | « nous ne vendons pas de lunettes de soleil » + 3 products, no hand-off; « oui » ×2 → « Lequel … ? » | **T1 12.6 s / 12.4 s** (slowest) | no (right: nothing chosen) | PASS |
| N9 | J04 · playground | arabizi, photo + details | « Ma 3andnach tsawer … »; recap (M) → « ih » → TEST-6890 5 300 DA | T1 7.7 s / 7.5 s | yes, 1 | PASS |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; `lookup_order {}` → not sent, no tracking number, none invented | T2 4.9 s / 4.7 s | yes, 1 | PASS |
| N12 | J04 · playground | fr, « ? » / « ... » | question repeated; recap → « 👍 » → TEST-7500 1 950 DA | T6 5.1 s / 4.8 s | yes, 1 | PASS |
| N14 | J03 · playground | fr, cancel after the order | TEST-3146 → « non annule » → `cancel_order` → « Commande TEST-3146 annulée » | T1 5.7 s / 5.5 s | yes, 1 (then cancelled, simulated) | PASS |
| N16 | J04 · playground | arabizi, wilaya not served | « Smahli, ma nwasslouch l Illizi … » | T1 3.3 s / 3.1 s | — | PASS |
| N17 | J04 · playground | fr — « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 6.9 s / 6.7 s | yes, 1 — after the new recap | PASS |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-4974 | T2 7.5 s / 7.3 s | yes, 1 — after the new recap | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, 3 450 دج, no order → « ايه » → TEST-6971 | T3 6.3 s / 6.1 s | yes, 1 — after the new recap | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **25 / 25** (N21, N21b, N18, N18b, A1, A2, A3, A3b, A4, F1, F1c,
  F1b, F3, F6, N1, N3, N4, N5, N9, N11, N12, N14, N17, N23, N25) + F11 and A5 refused as blocked (2 / 2). **Order without a server recap:
  0.** **« oui » to a correct recap lost: 0.** One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya,
  N23 wilaya, N25 quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N7 T2 / T3 (« which one? » again).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…), N23 T2 (arabizi « ih bessah wasslouha l Oran … » → Oran 600 DA, 8 100 DA, core e3d489…), N25 T2 (Arabic script « ايه بصح ديرلي جوج
  ماشي واحد » → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **7 / 7** — N21 (recap call `address` « البليدة،
  بوفاريك، حي الورود رقم 12 », confirming call « حي الورود رقم 12 »), N21b and A1 (the other way round: commune and wilaya appended on the
  confirming call), N12 (« Cité 20 août villa 3 » / « …, Boufarik, Blida »), N3 (« …, El Khroub » / « …, El Khroub, Constantine »), N23
  (« …, Bir El Djir, Oran » / street only), F3 (« Cité 20 Août, villa 3 » / « Cité 20 Août villa 3 »); N18 / N18b commune « El Khroub » on
  the recap call, « الخروب » on the confirming call.
- **Confirming calls refused: 0** — the 25 confirming calls + F11 + A5 all carried name, phone, wilaya, commune, address, items and
  `customerConfirmed true`. **Recap calls refused: 0.** **`VALIDATION` on a field the customer gave: 0** — the only two refusals are F1b
  T1 `wilayaId 1` before any wilaya was written (rightly refused, R2-4) and F1b T2 `items []` (R13-4).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **32 / 32**, the named variant every
  time (F1, F1c, F1b, A2, N1 Marron; N9 M); **in the customer's language 32 / 32** — Arabic script 13 (N21, N21b, N18, N18b, A1, A2, A3,
  A3b, A4, A5, N11, N25 ×2), arabizi 5 (F3, N3, N9, N23 ×2), French 14.
- **Server recap without a model sentence asking to confirm or describing the order: 32 / 32** — one lead-in left: « Ih, nwasslou l
  Constantine. Tawsil l dar 700 DA, wela f stop-desk 450 DA, ywasel f 2 l 5 ayam. » (N3, the answer to « twasslou l Constantine ? »).
  **Outside any recap: 0** model turn asking to confirm or claiming the order — the guard stripped `confirm_without_recap` twice before
  sending (N21 T1, N18b T1, both a product offer turn); the item-noted lines left (« … est bien noté pour vous », F1b T1; « تسجل زوج سجادات
  الصلاة », A3 T1; « سجلت لك Djellaba homme وحدة », A4 T1) name a product, not an order (R13-6).
- **Recap address « street, commune, wilaya »: 31 / 32** — A3 « حي 1000 مسكن عمارة 5، قسنطينة الخروب » (R13-2); the model's whole-place
  `address` (N21, N3, F6, N23, A1 / N21b confirming calls) still gives « street, commune, wilaya ». N18b street in French (R13-3).
- **Phone in Arabic-Indic digits read as Latin: 3 / 3** — A3, A3b (« الهاتف: 0550123456 »), A5 (and refused as the blocked number).
- **Customer's name as written: 30 / 30 conversations** — Arabic script kept in French / arabizi chats (N4 « سمير بن علي », F3 « وليد بوزيد »),
  Latin kept in an Arabic chat (N18, N18b « Samir Benali »); 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9; photo announced without a photo: 0.
- **Delivery question answered with the fee: 3 / 3** — F9 (three wilayas), N16 (not served), N3; commune only → street asked 1 / 1 (F1b, home
  fee not said — R13-6).
- **`create_order` before a phone is in the customer's messages: 0 / 61 calls.**
- **No hand-off on a field / order / yes message, nor for a product not sold: holds** (N7 lunettes: no hand-off). **Broken once for a
  product the shop sells: F1 T1 `handoff_to_human {off_catalogue}` accepted (R13-1)**; the other two hand-offs are F11 and A5 (blocked,
  expected).
- **No 503 / provider error: 99 / 99 turns**; `AiRun` 99 rows, 96 `ok` + 3 `handoff` (F1 T1, F11 T2, A5 T2), 0 `error`, 0 fallback,
  `attempt` 1 everywhere; 6 runs carry a reply-guard retry (`guard_enforced` 5 — moroccan_darija stripped on N21 T1, F9 T1, N9 T1, N18 T1,
  N18b T1, with confirm_without_recap on N21 T1 / N18b T1 and language_switch on N9 T1; `guard_rewritten` 1 — language_switch, N4 T2).
- Latency: **median 4.9 s, p90 7.7 s, max 12.6 s on 99 turns** (N7 T1 12.6 s / server 12.4 s, N3 T2 10.8 / 10.5 s, N18 T1 10.5 / 10.3 s,
  N5 T2 10.0 / 9.8 s, N3 T3 8.7 / 8.4 s, N1 T1 8.2 / 8.0 s); `AiRun` median 4.4 s (J04) / 5.3 s (J03), max 12.3 s; API « playground turn
  answered » lines: 99, 0 replay, `waitMs − runMs` max 78 ms, 0 « did not finish »; 1 POST per turn, 0 re-send.
- Quantity never asked again after a product is named: **0 quantity question in 99 turns** (« 1 seul », « 2 pièces », « zoudj », « زوج »,
  « 3 tapis au lieu de 2 », « ديرلي جوج », « وحدة » kept).
- Language kept: arabizi **6 / 6** (F3, F9, N9, N16, N23; N3 after the switch), Arabic-script darija **12 / 12** (N21, N21b, N18, N18b,
  A1–A5, A3b, N11, N25), French **12 / 12**.
- **No Tunisian / Moroccan words: 30 / 30** — check.cjs word list: 0 hit; the guard stripped a Moroccan form from 5 replies before they
  were sent (R13-6).
- Out-of-stock product offered: **0** — N5 names the Parfum Oud only because the customer asked for it; N7 « Montre connectée » is
  « orderable (delivery may take longer) » as in R12.
- No Markdown in a reply: **99 / 99**. No invented discount: only the catalogue's old prices (N21 / N21b / A1 / N12 « 1500 … بدل 2000 »,
  N18 / N18b « 7500 … بدل 9000 »); N5 « Livraison … gratuite » is the shop's rule (Oran home delivery free from 20 000 DA, `quote_delivery` result of F9 T1).
- Tool calls in 99 turns: `create_order` 61 (32 recaps + 25 orders + 2 blocked + 2 `VALIDATION`), `search_products` 13, `quote_delivery`
  10, `check_availability` 4, `lookup_order` 2 (N11 tracking, F3 T1 probe — R13-4), `get_product` 1, `cancel_order` 1 (N14, asked),
  **`handoff_to_human` 1 (F1 T1 — R13-1)**, 0 `add_faq_candidate`.

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line.

### N21 — J04 playground (UI ar)
**Verdict: PASS (R12-1, as R12 N21b / N21c) — T4 « البليدة، بوفاريك، حي الورود رقم 12 » → the server recap at once (the model sent the whole place in `address`, the recap still reads « street, commune, wilaya »); T5 « 👍 » → TEST-6619 1 950 دج. The guarded 6th message was not needed.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 5.6 s (server 5.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا حجاب حرير ناعم، مقاسو 180 x 70 سم، بثمن 1500 دج بدل 2000 دج، وهو متوفر. تحب نسجلهولك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 3.3 s (server 3.1 s)
  - AI: « أهلاً نادية! صحيت، تسجل الاسم. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234568 » · `ar` · 2.5 s (server 2.3 s)
  - AI: « صحيت، تسجل الرقم. واش من ولاية تحب نوصلولك فيها الطلبية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.5 s (server 4.3 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 4.9 s (server 4.7 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N21b — J04 playground (UI ar)
**Verdict: PASS (R12-1) — same messages; T4 → recap (address street only), T5 « 👍 » → TEST-9414 (confirming call `address` « حي الورود رقم 12، بوفاريك، البليدة », order placed from the stored recap). In both N21 runs the model sent the commune in Arabic (« بوفاريك ») — the Latin-commune variant of R12-1 is covered by N18 / N18b and A4.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 5.1 s (server 4.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie ناعم وخفيف، مقاسه 180 x 70 سم، ومتوفر دروك. ثمنه 1500 دج بدل 2000 دج. تحب نسجلوه ليك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.3 s (server 2.0 s)
  - AI: « تشرفنا يا نادية! صحيت، سجلت السمية. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0661234568 » · `ar` · 2.3 s (server 2.1 s)
  - AI: « صحيت، سجلت الرقم تاعك. واش من ولاية تحبي نوصلوا ليها الطلبية؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.5 s (server 4.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 4.6 s (server 4.3 s)
  - AI: « تم تسجيل طلبيتك TEST-9414 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12، بوفاريك، البليدة», items 1×product …450a, customerConfirmed true} → ok TEST-9414, total 1950`

### N18 — J03 playground (UI ar)
**Verdict: PASS (R12-1 fixed on its exact failing case) — T2 « Samir Benali 0661234567، قسنطينة، الخروب، … » → `create_order {wilayaId 25, communeName «El Khroub»}` (Latin commune, as in R12) → the server recap, no `VALIDATION wilayaId`; T3 « ايه » → TEST-8849 8 200 دج.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 10.5 s (server 10.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام، أهلًا بيك! عندنا جلابة رجالي بيج من صوف رقيق، مقاسها واحد (taille unique)، ثمنها 7500 دج بدل 9000 دج. تحب نسجّلوهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 3.4 s (server 3.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2ddb8b… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar` · 6.4 s (server 6.2 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N18b — J03 playground (UI ar)
**Verdict: PASS (R12-1) — same messages; T2 commune « El Khroub » again → the recap; T3 « ايه » → TEST-7130. Issue: the model translated the customer's Arabic street into French (« Cité 1000 logements, immeuble 5 »), kept in the recap and the order → R13-3.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 5.5 s (server 5.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا Djellaba homme — 7500 دج (بدل 9000 دج)، صوف رقيق بلون بيج، مقاس واحد، ومتوفرة. تحب نطلبوهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 6.8 s (server 6.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: Cité 1000 logements, immeuble 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, immeuble 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 285c95… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar` · 4.7 s (server 4.5 s)
  - AI: « تم تسجيل طلبيتك TEST-7130 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «Cité 1000 logements, immeuble 5», items 1×product …efdc, customerConfirmed true} → ok TEST-7130, total 8200`

### A1 — J04 playground (UI ar)
**Verdict: PASS (new: wilaya « ، » commune, all Arabic, wilaya « الجزائر ») — T4 « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » → recap Alger 400 دج, address « شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر »; T5 « ايه » → TEST-1852 1 900 دج.**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 4.7 s (server 4.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام 😊 عندنا Hijab soie بسعر 1500 دج (بدل 2000 دج)، حرير ناعم بمقاس 180 x 70 سم. تحب نسجّلولك وحدة؟ واش سميتك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « أمينة سعدي » · `ar` · 2.1 s (server 1.9 s)
  - AI: « أهلاً أمينة 😊 تسجّل الاسم تاعك. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0698765432 » · `ar` · 3.7 s (server 3.5 s)
  - AI: « صحيت، تسجّل الرقم تاعك. واش من ولاية تحب نوصلوهالك؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 4.3 s (server 4.2 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 4.9 s (server 4.7 s)
  - AI: « تم تسجيل طلبيتك TEST-1852 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر», items 1×product …450a, customerConfirmed true} → ok TEST-1852, total 1900`

### A2 — J03 playground (UI ar)
**Verdict: PASS (new: « ؛ » and « - ») — T3 « سطيف؛ العلمة - حي 500 مسكن عمارة 12 » → `wilayaId 19, communeName «العلمة», address «حي 500 مسكن عمارة 12»` → recap « (Marron) » 7 550 دج; T4 « ايه » → TEST-5502.**

- **T1** C: « سلام، نحب الساك تاع الجلد البني » · `ar` · 4.3 s (server 4.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام، نعم، Sac à main cuir باللون Marron متوفر بـ 6900 دج، وهو من الجلد الحقيقي. واش سميتك باش نبداو الطلب؟ »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « كريم حداد 0770112233 » · `ar` · 3.8 s (server 3.6 s)
  - AI: « صحيت يا كريم، تسجل. واش من ولاية ؟ »
- **T3** C: « سطيف؛ العلمة - حي 500 مسكن عمارة 12 » · `ar` · 5.3 s (server 5.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Sac à main cuir (Marron) : 6 900 دج ⏎ - التوصيل للدار (العلمة، سطيف): 650 دج ⏎ المجموع: 7 550 دج، الدفع عند الاستلام. ⏎ الاسم: كريم حداد ⏎ الهاتف: 0770112233 ⏎ العنوان: حي 500 مسكن عمارة 12، العلمة، سطيف ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «كريم حداد», phone 0770112233, wilaya 19, commune «العلمة», address «حي 500 مسكن عمارة 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft eefcb5… core f3d302…, recap total 7550`
- **T4** C: « ايه » · `ar` · 4.8 s (server 4.6 s)
  - AI: « تم تسجيل طلبيتك TEST-5502 ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 دج ⏎ التوصيل: 650 دج ⏎ المجموع: 7 550 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «كريم حداد», phone 0770112233, wilaya 19, commune «العلمة», address «حي 500 مسكن عمارة 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-5502, total 7550`

### A3 — J03 playground (UI ar)
**Verdict: FAIL — R13-2 (new: Arabic-Indic phone + no separator) — T1 « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456 (recap « الهاتف: 0550123456 »); T2 « قسنطينة الخروب حي 1000 مسكن عمارة 5 » → the recap, but its address reads « حي 1000 مسكن عمارة 5، قسنطينة الخروب » (wilaya and commune glued, reversed, not « street, commune, wilaya ») and the placed order TEST-5403 keeps that `address`.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 3.3 s (server 3.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت يا سميرة، تسجل زوج سجادات الصلاة (2 × 2800 دج). واش من ولاية تحب نوصلوها ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 6.5 s (server 6.3 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، قسنطينة الخروب ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5، قسنطينة الخروب», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 519c57… core 4e537f…, recap total 6300` · `search_products {«Tapis de prière»} → 1 product(s)`
- **T3** C: « ايه » · `ar` · 6.6 s (server 6.3 s)
  - AI: « تم تسجيل طلبيتك TEST-5403 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5، قسنطينة الخروب», items 2×product …a750, customerConfirmed true} → ok TEST-5403, total 6300`

### A3b — J03 playground (UI ar)
**Verdict: PASS (re-run of A3) — same messages; the model sent `address` « حي 1000 مسكن عمارة 5 » this time → recap « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; « ايه » → TEST-5126 6 300 دج. R13-2 is 1 run in 2.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 3.8 s (server 3.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت يا سميرة، سجلت زوج سجادات الصلاة (2 × 2800 دج) والرقم تاعك. واش من ولاية تحب نوصلوليك الطلبية؟ »
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 6.4 s (server 6.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 6.6 s (server 6.4 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### A4 — J04 playground (UI ar)
**Verdict: PASS (new: Latin commune inside Arabic text, commune before wilaya) — T2 « نسكن في Bir El Djir ولاية وهران، حي 1000 مسكن عمارة 4 » → `wilayaId 31, communeName «Bir El Djir»` → recap « (بئر الجير، وهران) » 600 دج, address « حي 1000 مسكن عمارة 4، بئر الجير، وهران »; T3 « ايه » → TEST-4053 8 100 دج.**

- **T1** C: « سلام، نحب جلابة رجالي واحدة، سمير بن علي 0661234567 » · `ar` · 4.1 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت، سجلت لك Djellaba homme وحدة (بيج، taille unique) بسعر 7500 دج. واش من ولاية تحب نوصلوها لها ؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « نسكن في Bir El Djir ولاية وهران، حي 1000 مسكن عمارة 4 » · `ar` · 4.3 s (server 4.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بئر الجير، وهران): 600 دج ⏎ المجموع: 8 100 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، بئر الجير، وهران ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «Bir El Djir», address «حي 1000 مسكن عمارة 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 164ad0… core fab579…, recap total 8100`
- **T3** C: « ايه » · `ar` · 5.0 s (server 4.8 s)
  - AI: « تم تسجيل طلبيتك TEST-4053 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 8 100 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «Bir El Djir», address «حي 1000 مسكن عمارة 4», items 1×product …4766, customerConfirmed true} → ok TEST-4053, total 8100`

### A5 — J04 playground (UI ar)
**Verdict: PASS (new: the blocked number in Arabic-Indic digits) — T1 « ٠٥٥٠١٢٣٤٥٦ » → recap with « 0550123456 »; T2 « ايه » → `CUSTOMER_BLOCKED`, hand-off, « ما نقدرش نأكد هذي الطلبية هنا، الفريق تاع المحل راح يتكفل بيها. » — no order.**

- **T1** C: « سلام، نحب حجاب حرير واحد، لمياء تواتي ٠٥٥٠١٢٣٤٥٦، الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 4.6 s (server 4.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: لمياء تواتي ⏎ الهاتف: 0550123456 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «لمياء تواتي», phone 0550123456, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2de1db… core a38026…, recap total 1900`
- **T2** C: « ايه » · `ar` · 5.0 s (server 4.7 s)
  - system: « handoff: سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. »
  - AI: « ما نقدرش نأكد هذي الطلبية هنا، الفريق تاع المحل راح يتكفل بيها. »
  - tools: `create_order {name «لمياء تواتي», phone 0550123456, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F1 — J03 playground (UI fr)
**Verdict: FAIL — R13-1 — T1 « Je voudrais le sac à main cuir marron » → `search_products` found the product (Marron in stock), then `handoff_to_human {off_catalogue, evidence «Je voudrais le sac à main cuir marron»} → ok`; turn status HANDOFF and the system line « Je transmets à un membre de l'équipe … » under a reply that sells the product. The playground kept answering: T3 recap « (Marron) », T4 « oui » → TEST-6293 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 7.1 s (server 6.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Parfait ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA. Voulez-vous le commander ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `handoff_to_human {off_catalogue, evidence «Je voudrais le sac à main cuir marron»} → ok`
- **T2** C: « Karim Haddad » · `fr` · 2.5 s (server 2.4 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 4.0 s (server 3.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.6 s (server 4.4 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1c — J03 playground (UI fr)
**Verdict: PASS (re-run of F1) — same messages, no tool on T1, no hand-off; T3 recap; T4 « oui » → TEST-6293. R13-1 is 1 run in 2.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 3.2 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir — 6900 DA en Marron est disponible, il est en cuir véritable. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 2.3 s (server 2.1 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 4.3 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS — T1 recap impossible (no wilaya): `create_order {wilayaId 1}` → `VALIDATION wilayaId notGivenByCustomer` (a guessed wilaya, rightly refused) → « … est bien noté pour vous. Dans quelle wilaya … ? »; T2 « Sétif, El Eulma » → street asked (home fee not said — R13-6) + a probe `create_order {items []}` (R13-4); T3 recap « (Marron) »; T4 « oui, c'est bien … » → TEST-6313 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 8.0 s (server 7.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci Karim, le Sac à main cuir Marron (6900 DA) est bien noté pour vous. Dans quelle wilaya souhaitez-vous être livré ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 1, items 1×variant …0eda, customerConfirmed true} → VALIDATION wilayaId`
- **T2** C: « Sétif, El Eulma » · `fr` · 7.5 s (server 7.3 s)
  - AI: « Parfait Karim, je note le Sac à main cuir Marron (1 pièce). Pour la livraison à domicile à El Eulma, donnez-moi votre adresse (rue, cité ou repère). Sinon, on peut aussi la livrer en stop-desk à 350 DA. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», customerConfirmed false} → VALIDATION items`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 7.0 s (server 6.8 s)
  - AI: « Votre commande TEST-6313 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-6313, total 7550`

### F3 — J03 playground (UI fr)
**Verdict: PASS — arabizi, Arabic-script name; T1 `check_availability` + a `lookup_order {}` probe on a product message (R13-4); T3 recap « Smitek: وليد بوزيد »; T4 « ih » → TEST-1845 6 050 DA, one `create_order`, no lookup after the order (R12-3 fixed).**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 5.6 s (server 5.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Zoudj tapis de prière kayen. Kol wahda b 2800 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `check_availability {qty 2} → available true` · `lookup_order {} → 0 order`
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.9 s (server 2.7 s)
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 7.7 s (server 7.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T4** C: « ih » · `arabizi` · 6.2 s (server 6.1 s)
  - AI: « Commande ta3ek TEST-1845 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-1845, total 6050`

### F6 — J03 playground (UI fr)
**Verdict: PASS — recap 2 → « 3 tapis au lieu de 2 » new recap 9 100 DA → « oui » → TEST-2670, one `create_order`, no lookup after the order (R12-3 fixed); a `search_products` listed after the T1 recap call (R13-4).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 7.2 s (server 6.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300` · `search_products {«tapis de prière»} → 1 product(s)`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 6.8 s (server 6.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 4.4 s (server 4.2 s)
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F9 — J04 playground (UI fr)
**Verdict: PASS — Sétif 650 / 350, Oran stop-desk 400, Illizi not served (three `quote_delivery`); the closing « T7ebb nwarrik produit m3a l livraison ? » is still odd (R13-6).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 4.6 s (server 4.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Illizi: makach tawsil l Illizi f had lwaqt. T7ebb nwarrik produit m3a l livraison ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici : l'équipe de la boutique va s'en occuper. »**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 6.1 s (server 5.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 6.7 s (server 6.5 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya change → new recap « (Marron) » Oran 7 500 DA → « oui » → TEST-5759.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 8.2 s (server 8.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 6.1 s (server 5.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.9 s (server 5.7 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N3 — J03 playground (UI fr)
**Verdict: PASS — T1 `check_availability` only; T2 arabizi switch « twasslou l Constantine ? … » → fee answered (700 / 450 DA) + arabizi recap; « ih saha » → TEST-4551 6 300 DA.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 4.3 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci Samira ! Les 2 tapis de prière sont disponibles, à 2800 DA l'unité (5600 DA au total). Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 10.8 s (server 10.5 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela f stop-desk 450 DA, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `quote_delivery {Constantine, stop-desk} → fee 450 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 8.7 s (server 8.4 s)
  - AI: « Commande ta3ek TEST-4551 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub, Constantine», items 2×product …a750, customerConfirmed true} → ok TEST-4551, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — « سمير بن علي » kept in the French chat (guard rewrote one language switch, N4 T2); T1 one search (R12-3 duplicate gone); recap → « oui » → TEST-8384 3 250 DA; a `search_products` listed after the T3 recap call (R13-4).**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 5.7 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le tapis de prière molletonné, 120 x 70 cm, est à 2800 DA et disponible. Pour commencer la commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « سمير بن علي » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Merci Samir, c'est noté. Pouvez-vous me donner votre numéro de téléphone (ex : 0555123456) pour continuer la commande ? »
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.5 s (server 5.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250` · `search_products {«tapis de prière»} → 1 product(s)`
- **T4** C: « oui » · `fr` · 5.1 s (server 4.8 s)
  - AI: « Votre commande TEST-8384 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-8384, total 3250`

### N5 — J04 playground (UI fr)
**Verdict: PASS (with R13-5) — T1 Oud out of stock, Coffret offered; T2 « Bon finalement je le prends » + details → `check_availability` Oud false, then straight to the recap of the Coffret cadeau Aïd 24 990 DA (free delivery from 20 000 DA, the real rule) with no sentence saying the Oud is replaced (R12: a substitution question first) → « oui » → TEST-3157. No `create_order` on the Oud.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 5.8 s (server 5.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau avec du parfum, nous avons le Coffret cadeau Aïd à 24990 DA, avec parfum, chocolat et carte personnalisée. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `search_products {«Coffret cadeau Aïd»} → 1 product(s)`
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 10.0 s (server 9.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `check_availability {qty 1} → available false` · `check_availability {qty 1} → available true` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr` · 7.7 s (server 7.5 s)
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N7 — J03 playground (UI fr)
**Verdict: PASS (R11-2) — « nous ne vendons pas de lunettes de soleil » + 3 products, no hand-off; « oui » ×2 → « Lequel … ? », no order (right: nothing chosen). Slowest turn of the round (T1 12.6 s, three lookups).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 12.6 s (server 12.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Parmi nos articles disponibles, vous avez la Montre connectée à 15900 DA, le Sac à main cuir à 6900 DA ou la Robe kabyle brodée à 4900 DA. Est-ce que l'un de ces produits vous intéresse, Yacine ? »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)` · `get_product {…3123} → Montre connectée, orderable (delivery may take longer)` · `search_products {«lunettes»} → 0 product(s)`
- **T2** C: « oui » · `fr` · 2.7 s (server 2.5 s)
  - AI: « Super, merci Yacine ! Lequel vous intéresse : la Montre connectée, le Sac à main cuir ou la Robe kabyle brodée ? Dites-moi aussi la taille ou la couleur si besoin. »
- **T3** C: « oui » · `fr` · 1.9 s (server 1.7 s)
  - AI: « Parfait, Yacine ! Pour savoir lequel vous plaît, dites-moi juste le nom : la Montre connectée (15900 DA), le Sac à main cuir (6900 DA) ou la Robe kabyle brodée (4900 DA) ? »

### N9 — J04 playground (UI fr)
**Verdict: PASS — « Ma 3andnach tsawer … »; recap (M) → « ih » → TEST-6890 5 300 DA.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 7.7 s (server 7.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma 3andnach tsawer ta3 had la robe f had lwaqt. Hiya Robe kabyle brodée, mtarza bel yed, b tissu khfif, w mliha lel a3yad. Tailles li kayn: S w M b 4900 DA, w XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.6 s (server 4.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.0 s (server 4.7 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS — recap → « ايه » → TEST-4074; tracking: `lookup_order {}` → « … مازالت درك ما خرجتش للتوصيل … ما عندناش رقم تتبع ولا رابط لحد الساعة », no number or date invented.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.0 s (server 3.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 4.9 s (server 4.7 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 2.7 s (server 2.5 s)
  - AI: « الطلبية تاعك رقم TEST-4074 مازالت درك ما خرجتش للتوصيل، راهي في طور التحضير. ما عندناش رقم تتبع ولا رابط لحد الساعة، وكي تخرج الطلبية نعلموك. التوصيل يكون من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N12 — J04 playground (UI fr)
**Verdict: PASS — « ? » → name asked again, « ... » → wilaya asked again; recap → « 👍 » → TEST-7500 1 950 DA; a `search_products` listed after the T5 recap call (R13-4).**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr` · 2.4 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir ! Le Hijab soie est à 1500 DA (au lieu de 2000 DA), en soie douce, 180 x 70 cm. Pour continuer la commande, quel est votre nom ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « ? » · `fr` · 1.8 s (server 1.5 s)
  - AI: « Désolé, je n'ai pas été claire : quel est votre nom pour la commande ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr` · 2.2 s (server 2.0 s)
  - AI: « Merci Nadia, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir la commande ? »
- **T4** C: « ... » · `fr` · 2.0 s (server 1.8 s)
  - AI: « Dans quelle wilaya souhaitez-vous recevoir la commande ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950` · `search_products {«hijab soie»} → 1 product(s)`
- **T6** C: « 👍 » · `fr` · 5.1 s (server 4.8 s)
  - AI: « Votre commande TEST-7500 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3, Boufarik, Blida», items 1×product …450a, customerConfirmed true} → ok TEST-7500, total 1950`

### N14 — J03 playground (UI fr)
**Verdict: PASS — recap → « oui » → TEST-3146 → « non annule » → `cancel_order` → « Commande TEST-3146 annulée … » (simulated); a `search_products` listed after the T1 recap call (R13-4).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.7 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950` · `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « oui » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr` · 3.5 s (server 3.3 s)
  - AI: « Commande TEST-3146 annulée, pas de souci. N'hésitez pas à revenir si vous voulez la djellaba plus tard ! »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande."} → ok, cancelled TEST-3146`

### N16 — J04 playground (UI fr)
**Verdict: PASS — « Smahli, ma nwasslouch l Illizi f had lwaqt … ».**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 3.3 s (server 3.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Smahli, ma nwasslouch l Illizi f had lwaqt. Ila 3andek wilaya o5ra, n9dr nchouflek ch7al tkhellas. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED`

### N17 — J04 playground (UI fr)
**Verdict: PASS — « oui mais livrez à Alger … » → new recap Alger 1 900 DA, no order → « oui » → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.5 s (server 5.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 6.9 s (server 6.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 4.7 s (server 4.4 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N23 — J03 playground (UI fr)
**Verdict: PASS — « ih bessah wasslouha l Oran … » → new arabizi recap 8 100 DA, no order → « ih » → TEST-4974.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 5.1 s (server 4.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 7.5 s (server 7.3 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 5.9 s (server 5.6 s)
  - AI: « Commande ta3ek TEST-4974 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → ok TEST-4974, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS — « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 ×, 3 450 دج, no order → « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.9 s (server 3.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 5.6 s (server 5.4 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 6.3 s (server 6.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

## Bugs

### R13-1 — A hand-off « off_catalogue » for a product the shop sells (F1 T1)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même » (UI fr): « Je voudrais le sac à main cuir marron », « Karim Haddad », « 0770112233, Sétif, El
  Eulma, Cité 500 logements bloc 12 », « oui ».
- Expected: the product is in the catalogue (Marron in stock) → answered, no `handoff_to_human` (R4-1, R11-2: never a hand-off on an order
  / product message, nor for a product the shop does not sell — let alone one it sells).
- Actual (F1, 00:37:43): T1 `search_products {«Sac à main cuir», limit 1}` → 1 product (Noir / Marron in stock, Rouge out of stock), then
  **`handoff_to_human {reason «off_catalogue», evidence «Je voudrais le sac à main cuir marron»} → {ok: true}`**. Reply (7.1 s, server
  6.9 s): « Parfait ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA. Voulez-vous le commander ? » with card « Sac à main cuir
  6 900 DA » and **the system line « Je transmets à un membre de l'équipe qui vous répondra très vite. »**; turn status `HANDOFF`, detail
  `off_catalogue`; `AiRun` 01a1ebdf-a43f-78b4-af01-b27d2451e6a5 `status handoff`, `meta.handoff true`, no guard flag. The playground kept
  answering (T2 name, T3 recap « (Marron) », T4 « oui » → TEST-6293 7 550 DA); on Messenger the conversation would be with the team from T1
  while the AI is selling. Re-run F1c (same messages, 00:44:32): T1 no tool, no hand-off → PASS — 1 run in 2; 0 such call in R12 (98 turns).
- Evidence: .local/qa/journeys/R13/out/transcripts/F1.json T1 (+ F1.ui.txt « AGENT J03 VENDEUR · HANDOFF · SALE · 0,90 », « — Message de
  transfert … — ») · run2.log · .local/qa/campaign/retest-ai-r13/fr-F1-pg.png · `AiRun` 01a1ebdf-a43f-78b4-af01-b27d2451e6a5 (read-only) ·
  F1c.json (same messages, passed)
- Likely cause: `judgeHandoff` (`handoff-judge.ts`) refuses `off_catalogue` only when `productAsk()` sees a « do you have / sell … » phrase
  (`PRODUCT_ASK`: « vous avez », « je cherche », « عندكم » …); « Je voudrais … » / « je veux … » is not in the list and nothing checks that the
  quoted words name a product the same turn's `search_products` just found in the catalogue, so `reasonFits()` returns true and the hand-off
  is accepted.

### R13-2 — No separator between wilaya and commune: the recap / order address can read « street، wilaya commune »
- Page: playground dialog (owner, ar, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même » (UI ar): « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ », « قسنطينة الخروب حي 1000 مسكن عمارة 5 »,
  « ايه ».
- Expected: recap and placed order address « حي 1000 مسكن عمارة 5، الخروب، قسنطينة » (street, commune, wilaya — R6-4 / R11-4), as A3b and every
  message with « ، » / « ؛ » / « - ».
- Actual (A3, 00:37:23): T2 `create_order {wilayaId 25, communeName «الخروب», address «حي 1000 مسكن عمارة 5، قسنطينة الخروب»}` (the model
  appended the customer's « قسنطينة الخروب » to the street) → recap « التوصيل للدار (الخروب، قسنطينة): 700 دج … **العنوان: حي 1000 مسكن عمارة 5،
  قسنطينة الخروب** » — the place segment is not recognised as « wilaya commune » (no separator), so it is neither dropped nor reordered and
  the standard « ، الخروب، قسنطينة » is not appended; T3 « ايه » → TEST-5403 with the same `address`. Wilaya, commune and fee are right (the
  courier fields are fine); only the address text is wrong. Re-run A3b (same messages): the model sent the street only → « حي 1000 مسكن
  عمارة 5، الخروب، قسنطينة » → TEST-5126 — 1 run in 2.
- Evidence: .local/qa/journeys/R13/out/transcripts/A3.json T2–T3, A3b.json T2 · run2.log, run3.log ·
  .local/qa/campaign/retest-ai-r13/ar-A3-pg.png, ar-A3b-pg.png
- Likely cause: `withoutPlaceSegments` (R12 fix) splits the model's `address` on « ، , ؛ » and a spaced dash and drops a segment that is
  the commune or the wilaya; the segment « قسنطينة الخروب » is both names in one, so it matches neither and stays as « street ».

### R13-3 — The customer's Arabic street is rewritten in French in the recap and the order
- Page: playground dialog (owner, ar, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même » (UI ar): « السلام عليكم، نحب نشري جلابة رجالي », « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن
  عمارة 5 », « ايه ».
- Expected: the street as the customer wrote it (« حي 1000 مسكن عمارة 5 », as N18 the same night and the name rule R9-1).
- Actual (N18b, 00:36:32): T2 `create_order {address «Cité 1000 logements, immeuble 5», communeName «El Khroub», …}` → recap « **العنوان:
  Cité 1000 logements, immeuble 5، الخروب، قسنطينة** »; T3 « ايه » → TEST-7130 with `address` « Cité 1000 logements, immeuble 5 ». The
  server accepted a street the customer never wrote (translated by the model); the customer saw it and said yes, so it is no wrong order,
  but the address the courier gets is the model's translation. N18 (same messages) kept the Arabic street.
- Evidence: .local/qa/journeys/R13/out/transcripts/N18b.json T2–T3, N18.json T2 · .local/qa/campaign/retest-ai-r13/ar-N18b-pg.png
- Likely cause: `address` is not compared with the customer's words the way `clientName` and the places are (R2-4 / R9-1 checks), so any
  rewording passes.

### R13-4 — Probe / redundant tool calls left
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run F1b, F3, F6, N4, N12, N14, A3; read the tool calls.
- Expected: no tool call whose result cannot change the answer (R11-3, R12-3).
- Actual (none reached the customer):
  - `search_products` listed after the recap call of the same turn, for the product the recap already holds: F6 T1, N4 T3, N12 T5, N14 T1,
    A3 T2 (5 times in 32 recaps).
  - F3 T1 « nheb nechri zoudj tapis de prière » → `check_availability {qty 2}` and `lookup_order {} → {orders: []}` (no order asked about).
  - F1b T1 « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » → `create_order {wilayaId 1, items …}` with no wilaya
    written → `VALIDATION wilayaId notGivenByCustomer` (rightly refused); F1b T2 « Sétif, El Eulma » → `create_order {items [],
    customerConfirmed false}` → `VALIDATION items`.
  - Gone since R12: `lookup_order` after the order in the « oui » turn (F3 T4, F6 T3 — R12-3), the second search in N4 T1, every hand-off
    probe on a field message.
- Evidence: .local/qa/journeys/R13/out/transcripts/F6.json T1, N4.json T3, N12.json T5, N14.json T1, A3.json T2, F3.json T1, F1b.json T1–T2
- Likely cause: `search_products` and `lookup_order` stay offered on product / order-detail messages; `create_order` used as a field check.

### R13-5 — « je le prends » after an out-of-stock answer: the recap of the substitute comes with no sentence saying so
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › « Tester moi-même » (UI fr): « Bonjour, le parfum oud c'est combien ? », « Bon finalement je le prends. Karim Haddad 0770112233,
  Oran, Bir El Djir, cité 1000 logements bloc 4 », « oui ».
- Expected: as R12 N5 — the substitute named and asked first (« vous voulez bien le Coffret … à la place ? ») or at least one line saying
  the recap is for the Coffret because the Oud is out of stock.
- Actual (N5, 00:32:18): T1 « Désolé, Parfum Oud 50 ml est en rupture de stock … nous avons le Coffret cadeau Aïd à 24990 DA … »; T2
  `check_availability` Oud → `available false`, Coffret → true, then the recap « - 1 × Coffret cadeau Aïd : 24 990 DA … Total : 24 990 DA »
  with no sentence before it (10.0 s); T3 « oui » → TEST-3157 24 990 DA. The recap names the product, so the « oui » is to the right content
  (no guarantee broken), but « le » was most likely the Oud the customer asked about, and the price is five times higher.
- Evidence: .local/qa/journeys/R13/out/transcripts/N5.json T1–T3 · .local/qa/campaign/retest-ai-r13/fr-N5-pg.png
- Likely cause: free model choice; the recap turn forbids any model sentence in front of the server recap (R4-4 / R6-1), so a substitution
  decided on that turn is never said.

### R13-6 — Wording left
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run F1b, F9, N18, A4, A2, N9.
- Expected: plain Algerian darija / arabizi / French, both fees when the wilaya is known.
- Actual:
  - F1b T2 « Parfait Karim, je note le Sac à main cuir Marron (1 pièce). Pour la livraison à domicile à El Eulma, donnez-moi votre adresse
    (rue, cité ou repère). **Sinon, on peut aussi la livrer en stop-desk à 350 DA.** » — the home fee (650 DA, quoted in the same turn) is not
    said (R12 F1b T2 gave both).
  - F9 T1 « … Illizi: makach tawsil l Illizi f had lwaqt. **T7ebb nwarrik produit m3a l livraison ?** » — still an odd closing (R12-4).
  - French inside Arabic replies: N18 T1 « مقاسها واحد **(taille unique)** », A4 T1 « صحيت، سجلت لك Djellaba homme وحدة **(بيج، taille unique)**
    بسعر 7500 دج. **واش من ولاية تحب نوصلوها لها ؟** » (also odd grammar); N9 T1 « **Tailles li kayn**: S w M b 4900 DA … ».
  - A2 T1 « وعليكم السلام، **نعم**، Sac à main cuir … » — Standard Arabic « نعم » in darija.
  - Item-noted lines that read like a registration: A4 T1 « سجلت لك Djellaba homme وحدة », A3b T1 « سجلت زوج سجادات الصلاة … والرقم تاعك »
    (no order claimed, accepted).
  - Fixed since R12-4: « DA » in an Arabic-script reply (N18 T1 now « 7500 دج بدل 9000 دج »), « Livraison à domicile » in arabizi (N3 T2 now
    « Tawsil l dar 700 DA »), « تسجّلت الاسم بالصح » (N21 T2 now « تسجل الاسم »).
  - The reply guard stripped a Moroccan form from 5 replies before sending (`guard_enforced`, `moroccan_darija`: N21 T1, F9 T1, N9 T1, N18
    T1, N18b T1) — nothing Moroccan reached the customer, but the model still writes them.
- Evidence: .local/qa/journeys/R13/out/transcripts/F1b.json T2, F9.json T1, N18.json T1, A4.json T1, N9.json T1, A2.json T1, A3b.json T1 ·
  `AiRun.meta.guard` (out/airun.txt)
- Likely cause: free model wording.

## Retest
- RETEST R12-1: fixed — N18 and N18b (same messages as R12 N18): the model again sent `communeName « El Khroub »` after « قسنطينة، الخروب »
  and got the server recap at once (R12: `VALIDATION wilayaId notGivenByCustomer`); N21 ×2 (« البليدة، بوفاريك، … ») recap at T4 both times
  (the model sent « بوفاريك », so N21's own Latin-commune variant did not recur); new mixes all reached the recap with the right wilaya and
  fee: A1 « الجزائر، باب الزوار، … », A2 « سطيف؛ العلمة - … », A3 / A3b « قسنطينة الخروب حي … » (no separator), A4 « Bir El Djir ولاية وهران »
  (Latin commune by the customer, before the wilaya), A3 / A3b / A5 phone « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456 (and A5 refused as the blocked
  number). **0 `VALIDATION wilayaId` on a wilaya the customer wrote in 61 calls**; the R2-4 refusal still works (F1b T1 `wilayaId 1` with
  no wilaya written → refused). Left in the same family: the no-separator address text (A3) → R13-2.
- RETEST R12-2: not reproduced — no Arabic `create_order` was refused this round, so the exact R12 turns (a refused recap call followed by
  « عطيني من فضلك كي تحب تأكد الطلبية. » / « ممتاز، سجلتلك الطلب ») did not recur; over 99 turns **0 confirm request and 0 « order registered »
  claim without a server recap** in fr / ar / arabizi (only « TEST-xxxx » confirmations after a real order); the guard raised
  `confirm_without_recap` on N21 T1 and N18b T1 (product-offer turns) and the reply sent was a plain offer (« تحب نسجلهولك؟ », « تحب
  نطلبوهالك؟ »). The refused-call path itself (F1b T1 / T2, French) answered with a wilaya / street question, no claim.
- RETEST R12-3: fixed on its flows — F6 T3 « oui » and F3 T4 « ih »: one `create_order`, no `lookup_order` after the order; N4 T1 one
  `search_products` (« tapis de prière » only). New probes left (search after the recap call ×5, `lookup_order` on F3 T1, two `create_order`
  field checks on F1b) → R13-4.
- RETEST R12-4: partly fixed — « DA » in Arabic script gone (N18 T1 « 7500 دج »), N3 T2 « Tawsil l dar » (no « Livraison à domicile »), N21
  T2 « تسجل الاسم »; left: F9 T1 closing « T7ebb nwarrik produit m3a l livraison ? », « taille unique » / « Tailles li kayn » in Arabic /
  arabizi, Moroccan forms still stripped by the guard (5 replies) → R13-6.
- R1–R11 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 25 orders**; N7 « oui » ×2 to a question →
  no order; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; one order per « oui »: 25 orders, never two for one « oui », none
  lost after a recap; **R4-1 / R11-2 (no hand-off on an order / field message, nor for a product not sold) holds for N7 and every field / yes
  message, broken once on a product message for a product the shop sells (F1 T1) → R13-1**; R4-2 (a name in another script keeps the
  language) holds — N4, F3, N18 / N18b; R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 32 / 32; R8-2 /
  R10-2 / R12-2 (no confirm request / claim without a recap) holds — 0 in 99 turns; R4-8 (blocked sentence) holds — F11 fr, A5 ar; R5-1
  (in-stock alternatives only) holds — N5, N7; R5-2 (no Tunisian / Moroccan forms sent) holds (guard-stripped ×5); R5-4 (no « home or
  stop-desk ? » after a street) holds; R5-5 / R7-5 (delivery question answered with the fee) holds — F9, N16, N3; R5-6 (no `create_order`
  before a phone) holds — 0 / 61; R6-4 / R11-4 (recap address « …, commune, wilaya ») 31 / 32 — A3 → R13-2; R7-2 (no photo said) holds —
  N9; N5 / N12 no invented discount, N5 free delivery from the shop's rule; N11 tracking from `lookup_order`, no invented number or date;
  R8-3 (named variant) holds — F1, F1c, F1b, A2, N1 Marron, N9 M; R9-1 (Latin name in an Arabic chat) holds — N18 / N18b « الاسم: Samir
  Benali »; R10-1 (latency) holds — max 12.6 s, 0 page re-send; R11-5 (no provider error) holds — 0 / 99.

## Coverage
- Order flows to « oui »: Arabic-script darija ×11 (N21, N21b, N18, N18b, A1, A2, A3, A3b, A4, N11, N25; A5 blocked), French ×10 (F1, F1c,
  F1b, F6, N1, N4, N5, N12, N14, N17; F11 blocked), arabizi ×4 (F3, N3 after a switch, N9, N23); no order, rightly: N7 (nothing chosen),
  F9, N16 (delivery questions only).
- Asked this round: N21 ×2, N18 ×2, 4 + 2 new Arabic-script flows mixing scripts and punctuation (A1 « ، », A2 « ؛ » / « - », A3 / A3b no
  separator + Arabic-Indic phone, A4 Latin commune in Arabic text, A5 blocked phone in Arabic-Indic digits); the sweep F1 (+ F1c), F1b, F3,
  F6, F9, F11, N1, N3, N4, N5, N7, N9, N11, N12, N14, N16, N17, N23, N25; latency of every turn.
- Also: « oui mais … » in three scripts (N17, N23, N25), a product not sold (N7), « ? » / « ... » (N12), a cancel after the order (N14,
  simulated), a wilaya not served (F9, N16), commune-only address → street asked (F1b), photo request (N9), out-of-stock product (N5), free
  delivery threshold (N5, 24 990 DA to Oran), out-of-hours shop (every J03 run).
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout.

## Not tested
- The shared test link (`/agent-test/<token>`) — no flow of this round's list uses it (F5 not asked); the R7 links were not probed.
- R12-2's exact path in Arabic (a refused recap call followed by the model's own sentence): no Arabic `create_order` was refused this round.
- N21 with the commune sent in Latin script by the model (both runs sent « بوفاريك »); a mistyped wilaya; a wilaya alone on its line
  followed by a Latin commune on the next message.
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`); the back-office search of R12 was not
  repeated. The live Messenger path (no page connected), so the effect of R13-1's hand-off on a real conversation was not seen.
- `cancel_order` / `lookup_order` on a real order with a courier and a tracking number; a product that HAS photos in a photo request; the
  stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11, A5).
- Playground TEST orders (simulated, nothing written): TEST-6619 (N21), TEST-9414 (N21b), TEST-8849 (N18), TEST-7130 (N18b), TEST-1852 (A1),
  TEST-5502 (A2), TEST-5403 (A3), TEST-5126 (A3b), TEST-4053 (A4), TEST-6293 (F1, F1c), TEST-6313 (F1b), TEST-1845 (F3), TEST-2670 (F6),
  TEST-5759 (N1), TEST-4551 (N3), TEST-8384 (N4), TEST-3157 (N5), TEST-6890 (N9), TEST-4074 (N11), TEST-7500 (N12), TEST-3146 (N14 — then
  cancelled, simulated), TEST-8063 (N17), TEST-4974 (N23), TEST-6971 (N25); F11 and A5 refused (`CUSTOMER_BLOCKED`).
- Server reads (read-only): `git log --oneline -1` on the VPS, Redis `rl:playground:*` TTL / count, `AiRun` rows since 23:25 UTC
  (out/airun.txt), API « playground turn answered » lines; nothing written.
- Hour counters (read-only, 00:44 before the re-runs): J04 45 / 60 (window from 00:29:41), J03 47 / 60 (window from 00:35:51) → 54 / 60
  after F1c and A3b; no 429. Messages used: 99 / 100.
