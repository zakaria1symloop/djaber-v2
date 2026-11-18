# R14 — Fourteenth retest of the AI order-taking (after the R13 fixes) — live site, deployed commit d6fd6cc — 18/11/2026 01:29–01:43 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at d6fd6cc (checked read-only: `git log --oneline -1` = « d6fd6cc fix(ai): live retest R13 —
no off_catalogue hand-off for a product the shop sells (any phrasing), wilaya/commune never inside the street, customer's own street kept,
substitute recap explained, both fees given, fewer probes, wording fixes »; `djaber-v2-api` / `djaber-v2-worker` online, restarted 01:17:02).
Same two own shops as R1–R13: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR) and « Boutique de Karima » (J04
shop, « Agent J04 », preset Vendeur Pro). Surface: step 5 › « Tester moi-même » (playground, tool calls visible) only — no flow of this
round's list needs the shared test link, so the links were neither used nor renewed. One browser at a time, the runs one after the other.
The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place (F11). The 60 / h counters were read before the run
(read-only, Redis `rl:playground:*`, 01:18): the R13 windows were still open (J04 45, TTL 706 s; J03 54, TTL 1 073 s), so each shop's run
waited until its key had expired (J04 01:29:58, J03 01:36:25). J04 flows 01:29:58–01:36:23, J03 flows 01:36:25–01:43:16. No 429. The J03
shop was outside its opening hours: every J03 conversation starts with the shop's « out_of_hours » system line — configured text, not an
AI reply (the J04 shop was not).

**Latency method (as R11–R13).** `conv.mjs` of R13 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » log lines (`runMs`, `waitMs`, `totalMs`, `replayed`) and the `AiRun` rows (`latencyMs`,
`status`, `error`, `flags`, `meta.guard`). No stall / dup probe.

**100 customer messages** (J04 shop 46, J03 shop 54; budget used to the last message), 33 conversations, all on the playground: priority 1
— F1 ×3 (F1, F1c, F1d, the R13-1 messages) and 6 NEW product-request phrasings for products the shop sells, each to its final « oui »:
P1 « je veux … » (fr, J03), P2 « nheb … » (arabizi, J04), « بغيت … » (Arabic script, J03 — T1 of A3b), P4 « I want … » (English, J04), P5
« vous avez … ? » (fr, J04), « je cherche … » (fr, J03 — T1 of F1b), plus one real wholesale request W1 « prix de gros pour 50 pièces ? »;
priority 2 — A3 ×2 (A3 = the R13 messages, A3b = same T2 with T1 « بغيت … »), N18b, N5, F1b; priority 3 — the sweep F3, F6, F9, F11, N1, N3,
N4, N7, N9, N11, N12, N14, N16, N17, N21, N23, N25, A1, A2, A4. To fit 100 messages, four sweep flows were sent with two fields merged in
one message (F3 name + phone + address, N4 name + phone + address, A1 product + name + phone, A2 product + name + phone), N7 with one « oui »
instead of two, and N5 with 3 messages instead of 4 (its final « oui » was never sent — see N5). No guarded extra message, no re-send.
Scripts `.local/qa/journeys/R14/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs, lat-table.cjs, server.sh = read-only `AiRun` query,
waitkey.sh, run.sh, all.sh), transcripts `.local/qa/journeys/R14/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs
`.local/qa/journeys/R14/out/run1.log` (J04), `run2.log` (J03), `airun.txt`, `api-lines.txt`, rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r14/`.

Cases asked for this round:
- **R13-1**: F1 ×3 and 6 new product-request phrasings across languages for products the shop sells — no hand-off, a normal sale to the
  final « oui »; one real wholesale request, which may go to the team.
- **R13-2 / R13-3 / R13-5 / R13-6**: A3 ×2 (no separator — address street, commune, wilaya), N18b (street kept in Arabic), N5 (substitute
  line before the recap), F1b T2 (both fees).
- A sweep: F3, F6, F9, F11, N1, N3, N4, N7, N9, N11, N12, N14, N16, N17, N21, N23, N25, A1, A2, A4 with their final « oui ».
- Latency per turn with `Server-Timing`; every R1–R13 guarantee (no order without a server recap — Critical; one order per « oui »; a « oui »
  with a change gives a new recap; no `create_order` before a phone; no confirm question / registered claim without a server recap; no
  hand-off for a product sold / not sold / on a field / yes message; language kept; no invented discount; tracking real; address street,
  commune, wilaya).

**Result: 31 / 33 conversations pass** — priority 1: 8 / 10 (F1, F1c, F1d, P1, A3b, P4, P5, W1 pass; P2 fails on the language, F1b on the
fees), priority 2: A3 ×2, N18b, N5 pass (N5 not taken to the order — budget), F1b T2 fails; sweep 20 / 20. **R13-1 is fixed: 0 hand-off for a
product the shop sells in 9 product-request flows** (F1 ×3 with the exact R13 message, « je veux », « nheb », « بغيت », « I want », « vous
avez … ? », « je cherche ») — every T1 status OK, the product answered, the sale taken to the order; the wholesale request W1 still goes to
the team (`off_catalogue` accepted, as the fix intends). **R13-2 fixed: A3 with the exact R13 messages — the model again put « الخروب،
قسنطينة » inside the street and the recap / order read « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; A3b the same.** **R13-3 fixed on N18b (street
kept in Arabic), R13-5 fixed on N5 (« … ce récapitulatif est pour Coffret cadeau Aïd à la place. » before the recap).** **Latency: median
5.0 s, p90 7.5 s, slowest 15.7 s (N9 T1, server 15.5 s); 3 turns above 10 s, 1 above 15 s; 0 page re-send; `Server-Timing` on 100 / 100
answers; page − server median 0.22 s, max 0.76 s; 0 provider error.** **0 order without a server recap; 27 TEST orders, each from a « oui /
ih / ايه / 👍 / yes / oui c'est bien … » to a server recap, exactly one each; F11 « oui » refused as blocked; 3 « yes » with a change (N17 fr,
N23 arabizi, N25 Arabic script) → a new recap, 0 order; 0 `create_order` before a phone in 62 calls.** Failures — two Minor: an arabizi
conversation answered in French from a field message with French address words (P2 T2–T3, R14-1); « Sétif, El Eulma » answered with the
home / stop-desk question and no fee at all (F1b T2, R14-2). Issues: refused hand-off probes and duplicate product lookups (they make the
slowest turn, R14-3), wording left (R14-4).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| F1 | J03 · playground | fr | T1 no tool, no hand-off → recap « (Marron) » → « oui » → TEST-6293 7 550 DA | T2 4.3 s / 4.1 s | yes, 1 | PASS (R13-1) |
| F1c | J03 · playground | fr (re-run) | T1 no tool, no hand-off → recap → « oui » → TEST-6313 | T3 4.7 s / 4.5 s | yes, 1 | PASS (R13-1) |
| F1d | J03 · playground | fr (re-run) | T1 search + availability, no hand-off; recap call Noir → server recap Marron → « oui » → TEST-1506 | T1 7.8 s / 7.6 s | yes, 1 | PASS (R13-1) |
| P1 | J03 · playground | fr « je veux … » | no hand-off → recap → « oui » → TEST-5324 7 950 DA | T2 5.4 s / 5.2 s | yes, 1 | PASS |
| P2 | J04 · playground | arabizi « nheb … » | no hand-off; recap and confirmation in French → TEST-1158 5 300 DA | T1 5.5 s / 5.2 s | yes, 1 | FAIL — R14-1 |
| A3b | J03 · playground | Arabic script « بغيت … », no separator | no hand-off; « قسنطينة الخروب حي … » → recap « …، الخروب، قسنطينة » → TEST-5126 | T1 8.9 s / 8.7 s | yes, 1 | PASS (R13-2) |
| P4 | J04 · playground | en « I want … » | no hand-off, English kept → « yes » → TEST-2029 1 950 DA | T3 7.3 s / 7.0 s | yes, 1 | PASS |
| P5 | J04 · playground | fr « vous avez … ? » | no hand-off → recap, delivery free → « oui » → TEST-3838 24 990 DA | T2 4.2 s / 4.0 s | yes, 1 | PASS |
| F1b | J03 · playground | fr « je cherche … », fields over 3 messages | no hand-off; T2 home / stop-desk asked with no fee; T3 recap; T4 → TEST-6293 | T4 7.6 s / 7.3 s | yes, 1 | FAIL — R14-2 |
| W1 | J04 · playground | fr, wholesale | `handoff_to_human {off_catalogue}` accepted (« prix de gros pour 50 pièces »), empty AI text | T1 5.1 s / 4.9 s | — (team) | PASS |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | model's street with commune + wilaya → recap « …، الخروب، قسنطينة » → « ايه » → TEST-5126 6 300 دج | T2 6.8 s / 6.6 s | yes, 1 | PASS (R13-2) |
| N18b | J03 · playground | Arabic script, Latin name | street kept in Arabic in recap and order → « ايه » → TEST-6540 8 200 دج | T3 6.4 s / 6.2 s | yes, 1 | PASS (R13-3) |
| N5 | J04 · playground | fr, out of stock « je le prends » | T2 substitute asked first; T3 « oui » → server line + Coffret recap; final « oui » not sent (budget) | T1 10.5 s / 10.3 s | no (final « oui » not sent) | PASS (R13-5), no order |
| F3 | J03 · playground | arabizi, Arabic-script name | recap « Smitek: وليد بوزيد » → « ih » → TEST-5998 6 050 DA | T3 5.0 s / 4.8 s | yes, 1 | PASS |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2340 9 100 DA | T2 5.8 s / 5.6 s | yes, 1 | PASS |
| F9 | J04 · playground | arabizi, 3 delivery questions | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 4.5 s / 4.3 s | — | PASS (R14-4) |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider … » | T2 7.5 s / 7.3 s | no (refused, as expected) | PASS |
| N1 | J03 · playground | fr, product + wilaya change | new recap « (Marron) » Oran → « oui » → TEST-5759 7 500 DA | T2 7.6 s / 7.4 s | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | fee + arabizi recap → « ih saha » → TEST-7010 6 300 DA | T3 6.5 s / 6.4 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | « سمير بن علي » kept → « oui » → TEST-1344 3 250 DA | T3 5.5 s / 5.3 s | yes, 1 | PASS |
| N7 | J03 · playground | fr, product not sold + details | « Nous ne vendons pas de lunettes … » + 3 products, no hand-off; « oui » → « Lequel … ? » | T1 3.9 s / 3.7 s | no (right: nothing chosen) | PASS |
| N9 | J04 · playground | arabizi, photo + details | « Ma 3andnach tsawer … »; recap (M) → « ih » → TEST-6890 5 300 DA | **T1 15.7 s / 15.5 s** (slowest) | yes, 1 | PASS (R14-3) |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; `lookup_order` → not sent, no tracking, none invented | T1 7.3 s / 7.1 s | yes, 1 | PASS (R14-3) |
| N12 | J04 · playground | fr, « ? » / « ... » | question repeated; recap → « 👍 » → TEST-9479 1 950 DA | T5 5.4 s / 5.2 s | yes, 1 | PASS |
| N14 | J03 · playground | fr, cancel after the order | TEST-3146 → « non annule » → « Commande TEST-3146 annulée » | T1 6.2 s / 5.9 s | yes, 1 | PASS |
| N16 | J04 · playground | arabizi, wilaya not served | « ma nwasslouch l Illizi … » | T1 3.0 s / 2.8 s | — | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 10.4 s / 10.1 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, 👍 | T4 recap at once → « 👍 » → TEST-6619 1 950 دج | T5 5.7 s / 5.5 s | yes, 1 | PASS (R14-4) |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-4704 | T2 7.0 s / 6.9 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-6971 | T3 7.0 s / 6.8 s | yes, 1 | PASS |
| A1 | J04 · playground | Arabic script, wilaya « ، » commune | recap Alger → « ايه » → TEST-4104 1 900 دج | T3 5.2 s / 4.9 s | yes, 1 | PASS |
| A2 | J03 · playground | Arabic script, « ؛ » / « - » | recap « (Marron) » → « ايه » → TEST-9905 7 550 دج | T3 7.9 s / 7.7 s | yes, 1 | PASS |
| A4 | J04 · playground | Arabic script, Latin commune | recap « (بئر الجير، وهران) » → « ايه » → TEST-4053 8 100 دج | T1 8.9 s / 8.6 s | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **27 / 27** (F1, F1c, F1d, P1, P2, A3b, P4, P5, F1b, A3, N18b, F3,
  F6, N1, N3, N4, N9, N11, N12, N14, N17, N21, N23, N25, A1, A2, A4) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.**
  **« oui » to a correct recap lost: 0.** One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N23
  wilaya, N25 quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N7 T2 (« which one? » again), N5 T3 (a « oui » to « Ça vous
  tente ? » → the substitute's recap, no order).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…), N23 T2 (arabizi « ih bessah wasslouha l Oran … » → Oran 600 DA, 8 100 DA, core e3d489…), N25 T2 (Arabic script « ايه بصح ديرلي
  جوج ماشي واحد » → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **5 / 5** — F1d (recap call variant Noir, street
  only / confirming call variant Marron, « …, El Eulma, Sétif »), A3 (recap call street + « الخروب، قسنطينة », commune « El Khroub » /
  street only, « الخروب »), N18b (« الخروب » / « El Khroub »), P5 (« Cité 1000 logements bloc 4, Bir El Djir » / street only), A2 (« حي 500
  مسكن، عمارة 12، العلمة » / « حي 500 مسكن عمارة 12 »); N23 recap calls carried the wilaya / commune inside the street (« Cité 500
  logements bloc 12, Sétif », « …, Bir El Djir, Oran ») and the recaps still read « street, commune, wilaya ».
- **Confirming calls refused: 0** — the 27 confirming calls + F11 carried name, phone, wilaya, commune, address, items and
  `customerConfirmed true`. **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 62 `create_order` calls** (R13: 2 field-check calls
  on F1b — gone).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **34 / 34**, the named variant every
  time (F1 ×3, F1b, N1, A2 Marron — F1d's recap call said Noir, the server's recap Marron; P2 S, N9 M); **in the customer's language 33 /
  34** — Arabic script 10 (A1, A2, A3, A3b, A4, N11, N18b, N21, N25 ×2), arabizi 5 (F3, N3, N9, N23 ×2), English 1 (P4), French 17; **P2
  French for an arabizi conversation (R14-1)**.
- **Server recap without a model sentence asking to confirm or describing the order: 34 / 34** — lead-ins left: N3 « Ih, nwasslou l
  Constantine. Tawsil l dar 700 DA, 2 à 5 jours. » (the answer to « twasslou l Constantine ? »), N12 « Merci Nadia ! », and N5's server line
  (R13-5). **Outside any recap: 0** model turn asking to confirm or claiming the order — the guard stripped `confirm_without_recap` once
  before sending (N21 T1, a product offer turn); item-noted lines left (« تسجل زوج تابيس الصلاة », A3b T1; « سجلنا الاسم والرقم تاعك »,
  A1 T1) name a product / a field, not an order.
- **Recap address « street, commune, wilaya »: 34 / 34** — A3 / A3b no separator, A1 « ، », A2 « ؛ » / « - », A4 Latin commune inside Arabic,
  and the model's whole-place `address` (A3, P5, A2, N23 T1–T2) → commune and wilaya once, at the end. **Street as the customer wrote it:
  34 / 34** (N18b Arabic kept; A2 one « ، » added by the model inside the street of the recap, the order keeps the customer's text).
- **Phone in Arabic-Indic digits read as Latin: 2 / 2** — A3, A3b (« الهاتف: 0550123456 »).
- **Customer's name as written: 33 / 33 conversations** — Arabic script kept in French / arabizi chats (N4 « سمير بن علي », F3 « وليد بوزيد »),
  Latin kept in an Arabic chat (N18b « Samir Benali »); 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9; photo announced without a photo: 0.
- **Delivery question answered with the fee: 3 / 3** — F9 (three wilayas), N16 (not served), N3; **wilaya + commune with no street → the
  street asked with both fees: 0 / 1** (F1b T2, no fee — R14-2).
- **`create_order` before a phone is in the customer's messages: 0 / 62 calls.**
- **No hand-off for a product the shop sells: 9 / 9 product-request flows** (R13-1 fixed); **no hand-off for a product not sold (N7), on a
  field / order / yes message: holds**; the three `handoff_to_human` calls are W1 (wholesale — accepted, allowed), N9 T1 `{complaint,
  evidence «unused»}` and N11 T3 `{customer_request}` (both refused by the platform, nothing reached the customer — R14-3); F11's hand-off is
  the server's (`CUSTOMER_BLOCKED`).
- **No 503 / provider error: 100 / 100 turns**; `AiRun` 100 rows, 98 `ok` + 2 `handoff` (W1 T1, F11 T2), 0 `error`, 0 fallback, `attempt` 1
  everywhere; 7 runs carry a reply-guard retry (`guard_enforced` 6 — moroccan_darija stripped on P2 T1 (after a language_switch retry), F9
  T1, N11 T3, A4 T1, N18b T1, confirm_without_recap on N21 T1; `guard_rewritten` 1 — moroccan_darija, N9 T1).
- Latency: **median 5.0 s, p90 7.5 s, max 15.7 s on 100 turns** (N9 T1 15.7 s / server 15.5 s, N5 T1 10.5 / 10.3 s, N17 T2 10.4 / 10.1 s,
  A3b T1 8.9 / 8.7 s, A4 T1 8.9 / 8.6 s, A2 T3 7.9 / 7.7 s); page median J04 5.2 s, J03 4.9 s; `AiRun` median 4.8 s (J04) / 4.5 s (J03), max
  15.5 s; API « playground turn answered » lines: 100, 0 replay, `waitMs − runMs` max 78 ms, 0 « did not finish »; 1 POST per turn, 0
  re-send.
- Quantity never asked again after a product is named: **0 quantity question in 100 turns** (« 1 seul », « 2 pièces », « zoudj », « زوج »,
  « 3 tapis au lieu de 2 », « ديرلي جوج », « واحد / وحدة » kept).
- Language kept: arabizi **6 / 7** (F3, F9, N9, N16, N23; N3 after the switch; **P2 fails — R14-1**), Arabic-script darija **9 / 9** (A1, A2,
  A3, A3b, A4, N11, N18b, N21, N25), French **16 / 16**, English **1 / 1** (P4).
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard stripped / rewrote a Moroccan form in 6 replies
  before they were sent (R14-4).
- Out-of-stock product offered: **0** — N5 names the Parfum Oud only because the customer asked for it; P2 / N9 list S, M, XL only (L out of
  stock said in N9); N7 lists in-stock products.
- No Markdown in a reply: **100 / 100**. No invented discount: only the catalogue's old prices (P1 / N18b / A4 « 9000 », P4 / N12 / N21
  « 2000 »); P5 / N5 « Livraison … gratuite » is the shop's rule (Oran home delivery free from 20 000 DA, `quote_delivery` of F9 T1:
  `freeFrom 20000, freeFor home`).
- Tool calls in 100 turns: `create_order` 62 (34 recaps + 27 orders + 1 blocked), `search_products` 5, `quote_delivery` 5, `get_product` 4,
  `check_availability` 3, `lookup_order` 1 (N11 tracking), `cancel_order` 1 (N14, asked), **`handoff_to_human` 3 (W1 accepted, N9 T1 / N11 T3
  refused)**, 0 `add_faq_candidate`; **0 search after a recap call in 34 recaps** (R13: 5 / 32).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line.
### F1 — J03 playground (UI fr)
**Verdict: PASS (R13-1, run 1 of 3, same messages as R13 F1) — T1 no tool call, no hand-off, turn status OK, the product answered and the name asked; T3 the server recap « (Marron) »; T4 « oui » → TEST-6293 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir — 6900 DA est disponible en Marron, en cuir véritable. Pour que je prépare votre commande, quel est votre nom complet ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 4.3 s (server 4.1 s)
  - AI: « Merci Karim, c'est noté ! Pour finaliser votre commande du sac à main cuir Marron, quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 4.2 s (server 4.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.3 s (server 4.1 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1c — J03 playground (UI fr)
**Verdict: PASS (R13-1, run 2 of 3) — same messages; T1 no tool, no hand-off; T4 « oui » → TEST-6313 7 550 DA (confirming call `phoneConfirmed true`).**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA, en cuir véritable. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 2.0 s (server 1.8 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone pour la commande ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Votre commande TEST-6313 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-6313, total 7550`

### F1d — J03 playground (UI fr)
**Verdict: PASS (R13-1, run 3 of 3) — same messages; T1 `search_products` + `check_availability` (Marron in stock), no hand-off; T3 the model's recap call carried the Noir variant (…5b35) while the customer wrote « marron » — the server's recap holds « (Marron) » (same core f3d302… as F1); T4 « oui » → TEST-1506 with the Marron variant (…0eda) — the confirming call appended « , El Eulma, Sétif » to the street, the order was placed from the stored recap.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 7.8 s (server 7.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, le Sac à main cuir en marron est bien disponible à 6900 DA. Pour préparer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `check_availability {qty 1} → available true`
- **T2** C: « Karim Haddad » · `fr` · 2.6 s (server 2.4 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …5b35, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### P1 — J03 playground (UI fr)
**Verdict: PASS (new phrasing « je veux … », fr) — T1 « Salut, je veux la djellaba homme » → `search_products`, the product answered (7 500 DA instead of 9 000 DA, the catalogue's old price), name asked, no hand-off; T2 recap; T3 « oui » → TEST-5324 7 950 DA.**

- **T1** C: « Salut, je veux la djellaba homme » · `fr` · 3.7 s (server 3.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! La Djellaba homme est en laine fine, couleur beige, taille unique, et elle est disponible. Elle est à 7500 DA au lieu de 9000 DA. Pour la commande, à quel nom dois-je l'enregistrer ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T3** C: « oui » · `fr` · 4.7 s (server 4.4 s)
  - AI: « Votre commande TEST-5324 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-5324, total 7950`

### P2 — J04 playground (UI fr)
**Verdict: FAIL — R14-1 (new phrasing « nheb … », arabizi) — T1 answered in arabizi, no hand-off (the guard retried a language switch and stripped a Moroccan form before sending); T2 the server recap in French after a field message with no arabizi word, and T3 « ih » → TEST-1158 5 300 DA confirmed in French. The sale itself is right (S variant, Alger 400 DA, one order).**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 5.5 s (server 5.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykom salam! Robe kabyle brodée hia brodia b yedd, tissu khfif, mliha l lafrah. Kayna f S, M w XL: S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 4.2 s (server 3.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « ih » · `fr` · 5.4 s (server 5.1 s)
  - AI: « Votre commande TEST-1158 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### A3b — J03 playground (UI ar)
**Verdict: PASS (R13-2, run 2 of 2, T1 with the new phrasing « بغيت … ») — T1 no hand-off, « زوج » kept, phone « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456; T2 « قسنطينة الخروب حي … » (no separator) → recap address « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; T3 « ايه » → TEST-5126 6 300 دج.**

- **T1** C: « السلام، بغيت زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 8.9 s (server 8.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت يا سميرة، تسجل زوج تابيس الصلاة (2800 دج للقطعة). واش من ولاية تحب نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 6.0 s (server 5.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 5.9 s (server 5.7 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### P4 — J04 playground (UI en)
**Verdict: PASS (new phrasing « I want … », English) — T1 answered in English, no hand-off; T2 the server recap in English (« Here is your order summary », « Reply « yes » to confirm … »); T3 « yes » → TEST-2029 1 950 DA, English kept on every turn.**

- **T1** C: « Hi, I want the silk hijab » · `en` · 3.4 s (server 3.1 s)
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (reduced from 2000 DA). It's a soft silk scarf, 180 x 70 cm, and it's in stock. Would you like me to take your order? If so, what's your name? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `en` · 5.7 s (server 5.4 s)
  - AI: « Here is your order summary: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Home delivery (Boufarik, Blida): 450 DA ⏎ Total: 1 950 DA, cash on delivery. ⏎ Name: Nadia Kaci ⏎ Phone: 0661234568 ⏎ Address: cité 20 août villa 3, Boufarik, Blida ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T3** C: « yes » · `en` · 7.3 s (server 7.0 s)
  - AI: « Your order TEST-2029 is confirmed ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Delivery: 450 DA ⏎ Total: 1 950 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-2029, total 1950`

### P5 — J04 playground (UI fr)
**Verdict: PASS (new phrasing « vous avez … ? ») — T1 « Oui, le coffret cadeau Aïd est disponible ! », no hand-off; T2 recap with « Livraison à domicile (Bir El Djir, Oran) : gratuite » (the shop's rule: Oran home delivery free from 20 000 DA); the model's recap call `address` « Cité 1000 logements bloc 4, Bir El Djir » → recap « …, Bir El Djir, Oran » (commune not doubled); T3 « oui » → TEST-3838 24 990 DA.**

- **T1** C: « Bonsoir, vous avez le coffret cadeau Aïd ? » · `fr` · 3.0 s (server 2.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, le coffret cadeau Aïd est disponible ! Il est à 24990 DA et comprend un parfum, du chocolat et une carte personnalisée, idéal pour offrir à l'occasion de l'Aïd. Vous voulez que je vous le réserve ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Lamia Bensalem 0661122334, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Lamia Bensalem ⏎ Téléphone : 0661122334 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Bensalem», phone 0661122334, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft 1f108e… core f6df88…, recap total 24990`
- **T3** C: « oui » · `fr` · 3.9 s (server 3.7 s)
  - AI: « Votre commande TEST-3838 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Lamia Bensalem», phone 0661122334, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3838, total 24990`

### F1b — J03 playground (UI fr)
**Verdict: FAIL — R14-2 (T1 with the new phrasing « je cherche … ») — T1 no hand-off, no `create_order` field check (R13-4 gone), the wilaya asked; T2 « Sétif, El Eulma » → « … préférez-vous être livré à domicile (il me faut alors votre rue ou votre cité) ou au stop-desk ? » with no fee at all (no `quote_delivery`; R13 gave the stop-desk fee only, R12 both); T3 recap; T4 « oui, c'est bien … » → TEST-6293 7 550 DA.**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 3.0 s (server 2.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en Marron est disponible à 6900 DA, cuir véritable. Pour continuer la commande, dans quelle wilaya êtes-vous ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Sétif, El Eulma » · `fr` · 6.3 s (server 5.6 s)
  - AI: « Merci Karim, c'est noté : Sétif, El Eulma. Pour la livraison, préférez-vous être livré à domicile (il me faut alors votre rue ou votre cité) ou au stop-desk ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.2 s (server 3.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 7.6 s (server 7.3 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### W1 — J04 playground (UI fr)
**Verdict: PASS (real wholesale request — may go to the team) — « prix de gros pour 50 pièces du hijab soie ? » → `handoff_to_human {off_catalogue}` accepted (the R13 fix keeps wholesale / quote / custom order for the team even for a product sold), turn status HANDOFF. The turn's AI text is empty: the customer gets only the system line « Je transmets à un membre de l'équipe … » (R14-4).**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 5.1 s (server 4.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: «  »
  - tools: `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie ?»} → ok`

### A3 — J03 playground (UI ar)
**Verdict: PASS (R13-2, run 1 of 2, the exact R13 failing messages) — T2 the model again put the place inside the street: `address «حي 1000 مسكن عمارة 5، الخروب، قسنطينة», communeName «El Khroub»` → the recap address « حي 1000 مسكن عمارة 5، الخروب، قسنطينة » (street, commune, wilaya — not doubled); T3 « ايه » → TEST-5126 6 300 دج, confirming call `address «حي 1000 مسكن عمارة 5»`.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 5.4 s (server 5.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت سميرة، الكمية 2 من Tapis de prière، 2800 دج للواحد، والمنتج متوفر. واش من ولاية تحب نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 6.8 s (server 6.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5، الخروب، قسنطينة», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft c58c18… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 5.6 s (server 5.4 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### N18b — J03 playground (UI ar)
**Verdict: PASS (R13-3, same messages as R13 N18b) — T2 the customer's Arabic street kept: `address «حي 1000 مسكن عمارة 5»` in the call, the recap and the order (no French translation); T3 « ايه » → TEST-6540 8 200 دج.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 5.3 s (server 5.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا Djellaba homme بـ 7500 دج (كانت 9000 دج)، من صوف رقيق، لونها بيج ومقاسها واحد. تحب نسجّلهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 5.5 s (server 5.2 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar` · 6.4 s (server 6.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6540 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-6540, total 8200`

### N5 — J04 playground (UI fr)
**Verdict: PASS (R13-5) — not taken to the order (budget). T1 Oud out of stock (3 200 DA) + the in-stock Coffret offered; T2 « Bon finalement je le prends » + details → the model asks first (« … le Coffret cadeau Aïd — 24990 DA … est disponible, et je peux enregistrer la commande … Ça vous tente ? »), no recap; T3 « oui » → the server line « Parfum Oud 50 ml n'est pas disponible pour le moment : ce récapitulatif est pour Coffret cadeau Aïd à la place. » before the recap, no order. The flow was planned at 3 messages to fit the 100-message budget; the model asked before recapping, so the final « oui » to the recap was never sent.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 10.5 s (server 10.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Son prix est de 3200 DA. Si vous cherchez un cadeau parfumé, notre Coffret cadeau Aïd — 24990 DA contient un parfum, du chocolat et une carte personnalisée, et il est disponible. Voulez-vous que je vous le réserve ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `search_products {«parfum»} → 1 product(s)` · `get_product {…3400} → Coffret cadeau Aïd, in stock` · `get_product {…8c00} → Parfum Oud 50 ml, out of stock`
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.4 s (server 4.2 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Merci pour vos coordonnées, Karim : je les garde. Si vous voulez, le Coffret cadeau Aïd — 24990 DA (parfum, chocolat et carte personnalisée) est disponible, et je peux enregistrer la commande avec vos infos à Bir El Djir, Oran. Ça vous tente ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T3** C: « oui » · `fr` · 6.8 s (server 6.6 s)
  - AI: « Parfum Oud 50 ml n'est pas disponible pour le moment : ce récapitulatif est pour Coffret cadeau Aïd à la place. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`

### F3 — J03 playground (UI fr)
**Verdict: PASS — arabizi kept, Arabic-script name « وليد بوزيد » kept (« Smitek: وليد بوزيد »); T1 no tool, no `lookup_order` (R13-4 gone); T2 recap; T3 « ih » → TEST-5998 6 050 DA.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 3.1 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Saha, zoudj tapis de prière (120 x 70 cm, molletonné) b 2800 DA l wahed, ya3ni 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد, 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 4.3 s (server 4.1 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T3** C: « ih » · `arabizi` · 5.0 s (server 4.8 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F6 — J03 playground (UI fr)
**Verdict: PASS — T1 recap 2 ×; T2 « 3 tapis au lieu de 2 » → new recap 9 100 DA (core 1f98a5…); T3 « oui » → TEST-2340 9 100 DA; no search after a recap call.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 5.3 s (server 5.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 5.8 s (server 5.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 4.3 s (server 4.0 s)
  - AI: « Votre commande TEST-2340 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### F9 — J04 playground (UI fr)
**Verdict: PASS — Sétif 650 / 350 DA, Oran stop-desk 400 DA, Illizi not served, in arabizi; closing « T7ebb nwarrik produit ? » still odd (R14-4).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 4.5 s (server 4.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif : 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5 ayam. Illizi : makach tawsil l Illizi f had lwaqt. T7ebb nwarrik produit ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap with 0550123456 → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », status HANDOFF `risky_client`, no order.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 6.3 s (server 6.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 7.5 s (server 7.3 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### N1 — J03 playground (UI fr)
**Verdict: PASS — T2 product + wilaya + address change → new recap « Sac à main cuir (Marron) » Oran 600 DA (core 146d71…); T3 « oui » → TEST-5759 7 500 DA. (check.cjs « DELIVERY-Q-NO-FEE » is a false hit: « livrez-moi plutôt à … » with a full address, the fee is in the recap.)**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.2 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 7.6 s (server 7.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 4.4 s (server 4.1 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N3 — J03 playground (UI fr)
**Verdict: PASS — fr → arabizi at T2; « twasslou l Constantine ? » answered with the fee in a lead-in, then the arabizi recap; T3 « ih saha » → TEST-7010 6 300 DA.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Avec plaisir Samira, 2 tapis de prière c'est noté ! Le tapis est molletonné, 120 x 70 cm, à 2800 DA l'unité. Dans quelle wilaya êtes-vous ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 6.0 s (server 5.8 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, 2 à 5 jours. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 6.5 s (server 6.4 s)
  - AI: « Commande ta3ek TEST-7010 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-7010, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — name in Arabic script « سمير بن علي » kept in a French chat, French kept; T3 « oui » → TEST-1344 3 250 DA.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 4.8 s (server 4.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Tapis de prière — 2800 DA, disponible. C'est un tapis molletonné de 120 x 70 cm, bien doux pour la prière. Comment vous appelez-vous, pour la commande ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `get_product {…a750} → Tapis de prière, in stock`
- **T2** C: « سمير بن علي, 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.7 s (server 3.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T3** C: « oui » · `fr` · 5.5 s (server 5.3 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N7 — J03 playground (UI fr)
**Verdict: PASS — « Nous ne vendons pas de lunettes de soleil pour le moment » + 3 in-stock products, no hand-off, details acknowledged; T2 « oui » → « Lequel vous intéresse … ? », no order (nothing chosen).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.9 s (server 3.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Nous ne vendons pas de lunettes de soleil pour le moment, désolé. Merci pour vos coordonnées, Yacine : Blida, Boufarik, cité 20 août villa 3. Parmi nos articles disponibles, il y a le sac à main en cuir (6900 DA, en noir ou marron), la montre connectée (15900 DA) ou le tapis de prière (2800 DA). Lequel vous intéresse ? »
- **T2** C: « oui » · `fr` · 2.4 s (server 2.1 s)
  - AI: « Super, merci Yacine ! Lequel vous intéresse : le sac à main en cuir (noir ou marron), la montre connectée ou le tapis de prière ? »

### N9 — J04 playground (UI fr)
**Verdict: PASS — T1 « Ma 3andnach tsawer … », sizes in stock only (L out of stock said); T2 recap (M); T3 « ih » → TEST-6890 5 300 DA. Slowest turn of the round: T1 15.7 s (server 15.5 s) — `search_products`, `get_product` for the same product, a refused hand-off probe `{complaint, evidence «unused»}` and a reply-guard rewrite (R14-3).**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 15.7 s (server 15.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma 3andnach tsawer ta3 had la robe f had lwaqt, bessah hiya brodée à la main, b qmach khfif, et mnasba bezzaf lel fêtes. Lmqasat li kaynin: S, M w XL (L makach dork). S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
  - tools: `search_products {«Robe kabyle brodée»} → 1 product(s)` · `get_product {…48ee} → Robe kabyle brodée, in stock` · `handoff_to_human {complaint, evidence «unused»} → HANDOFF_NOT_NEEDED`
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.0 s (server 4.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.2 s (server 5.0 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS — T2 « ايه » → TEST-4074; T3 tracking question → `lookup_order {}` → new / not sent, « ما عندناش رقم تتبع », no number or date invented (« كي تخرج لشركة التوصيل نبعثلك الرقم والرابط » — a promise, not checked here); a refused hand-off probe `{customer_request}` on the same turn (R14-3).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 7.3 s (server 7.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 7.3 s (server 7.0 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 6.6 s (server 6.4 s)
  - AI: « طلبيتك رقم TEST-4074 درك عند الفريق وتتجهز، ما خرجاتش للتوصيل بعد، فما عندناش رقم تتبع. كي تخرج لشركة التوصيل نبعثلك الرقم والرابط باش تتبعها. التوصيل عادة من 2 لـ 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null` · `handoff_to_human {customer_request, evidence «وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟»} → HANDOFF_NOT_NEEDED`

### N12 — J04 playground (UI fr)
**Verdict: PASS — « ? » and « ... » → the open question repeated; T5 recap (lead-in « Merci Nadia ! », harmless); T6 « 👍 » → TEST-9479 1 950 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr` · 2.7 s (server 2.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait ! Le Hijab soie est à 1500 DA au lieu de 2000 DA, en soie douce, 180 x 70 cm. Pour continuer la commande, quel est votre nom ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « ? » · `fr` · 1.9 s (server 1.7 s)
  - AI: « Quel est votre nom, s'il vous plaît ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr` · 2.1 s (server 1.8 s)
  - AI: « Merci Nadia, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir le Hijab soie ? »
- **T4** C: « ... » · `fr` · 1.9 s (server 1.7 s)
  - AI: « Dans quelle wilaya souhaitez-vous recevoir votre Hijab soie ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Merci Nadia ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T6** C: « 👍 » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N14 — J03 playground (UI fr)
**Verdict: PASS — T2 « oui » → TEST-3146; T3 « non annule » → `cancel_order` → « Commande TEST-3146 annulée » (simulated).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.2 s (server 5.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr` · 4.3 s (server 4.0 s)
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr` · 3.9 s (server 3.6 s)
  - AI: « Commande TEST-3146 annulée, pas de souci. N'hésitez pas à revenir si vous changez d'avis, on sera ravis de vous aider ! »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-3146`

### N16 — J04 playground (UI fr)
**Verdict: PASS — « ma nwasslouch l Illizi f had lwaqt », arabizi.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 3.0 s (server 2.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykoum salam, ma nwasslouch l Illizi f had lwaqt. Ila t7ebb, nqder n3awnek f wilaya okhra. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### N17 — J04 playground (UI fr)
**Verdict: PASS — T2 « oui mais livrez à Alger … » → new recap Alger 400 DA, 1 900 DA (core f4cd80…), no order; T3 « oui » → TEST-8063 1 900 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 7.1 s (server 6.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 10.4 s (server 10.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 5.3 s (server 5.0 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N21 — J04 playground (UI ar)
**Verdict: PASS — fields one per message; T4 « البليدة، بوفاريك، … » → the recap at once; T5 « 👍 » → TEST-6619 1 950 دج. T1: the guard stripped a confirm question (`confirm_without_recap`) and the reply sent ends with no next step (R14-4); the customer still sent her name.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 4.4 s (server 4.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر 1500 دج (بدل 2000 دج). »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.7 s (server 2.5 s)
  - AI: « أهلًا نادية، صحيت، تسجل. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0661234568 » · `ar` · 2.4 s (server 2.2 s)
  - AI: « صحيت، تسجل. واش من ولاية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.3 s (server 4.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 5.7 s (server 5.5 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N23 — J03 playground (UI fr)
**Verdict: PASS — T2 « ih bessah wasslouha l Oran … » → new arabizi recap Oran 600 DA (core e3d489…), no order; T3 « ih » → TEST-4704 8 100 DA.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 4.9 s (server 4.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, Sétif», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 7.0 s (server 6.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 6.9 s (server 6.7 s)
  - AI: « Commande ta3ek TEST-4704 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → ok TEST-4704, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS — T2 « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 ×, 3 450 دج (core 1e692b…), no order; T3 « ايه » → TEST-6971 3 450 دج.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.5 s (server 4.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 6.5 s (server 6.3 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `check_availability {qty 2} → available true` · `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 7.0 s (server 6.8 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### A1 — J04 playground (UI ar)
**Verdict: PASS — wilaya « ، » commune (« الجزائر، باب الزوار، … ») → recap Alger 400 دج, address « شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر »; T3 « ايه » → TEST-4104 1 900 دج.**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد، أمينة سعدي 0698765432 » · `ar` · 4.2 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام أمينة، صحيت، سجلنا الاسم والرقم تاعك. حجاب الحرير متوفر، بـ 1500 دج، ناعم ومريح، المقاس 180 x 70 سم. واش من ولاية تحبي نوصلوها ليك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 4.0 s (server 3.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T3** C: « ايه » · `ar` · 5.2 s (server 4.9 s)
  - AI: « تم تسجيل طلبيتك TEST-4104 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → ok TEST-4104, total 1900`

### A2 — J03 playground (UI ar)
**Verdict: PASS — « سطيف؛ العلمة - حي 500 مسكن عمارة 12 » → recap « (Marron) » 7 550 دج, address « حي 500 مسكن، عمارة 12، العلمة، سطيف » (the model added a « ، » inside the street; commune not doubled; the order's `address` is the customer's « حي 500 مسكن عمارة 12 »); T3 « ايه » → TEST-9905.**

- **T1** C: « سلام، نحب الساك تاع الجلد البني، كريم حداد 0770112233 » · `ar` · 3.9 s (server 3.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت كريم! الساك تاع الجلد البني متوفر، بـ 6900 دج. واش من ولاية توصلك الطلبية؟ »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « سطيف؛ العلمة - حي 500 مسكن عمارة 12 » · `ar` · 5.5 s (server 5.3 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Sac à main cuir (Marron) : 6 900 دج ⏎ - التوصيل للدار (العلمة، سطيف): 650 دج ⏎ المجموع: 7 550 دج، الدفع عند الاستلام. ⏎ الاسم: كريم حداد ⏎ الهاتف: 0770112233 ⏎ العنوان: حي 500 مسكن، عمارة 12، العلمة، سطيف ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «كريم حداد», phone 0770112233, wilaya 19, commune «العلمة», address «حي 500 مسكن، عمارة 12، العلمة», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft eefcb5… core f3d302…, recap total 7550`
- **T3** C: « ايه » · `ar` · 7.9 s (server 7.7 s)
  - AI: « تم تسجيل طلبيتك TEST-9905 ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 دج ⏎ التوصيل: 650 دج ⏎ المجموع: 7 550 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «كريم حداد», phone 0770112233, wilaya 19, commune «العلمة», address «حي 500 مسكن عمارة 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-9905, total 7550`

### A4 — J04 playground (UI ar)
**Verdict: PASS — « نسكن في Bir El Djir ولاية وهران، … » → recap « (بئر الجير، وهران) » 600 دج, address « حي 1000 مسكن عمارة 4، بئر الجير، وهران »; T3 « ايه » → TEST-4053 8 100 دج.**

- **T1** C: « سلام، نحب جلابة رجالي واحدة، سمير بن علي 0661234567 » · `ar` · 8.9 s (server 8.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت سمير، Djellaba homme بـ 7500 دج (كانت 9000 دج)، بيج وصوف رقيق. واش من ولاية تحب نوصلوها؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « نسكن في Bir El Djir ولاية وهران، حي 1000 مسكن عمارة 4 » · `ar` · 7.1 s (server 6.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بئر الجير، وهران): 600 دج ⏎ المجموع: 8 100 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، بئر الجير، وهران ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «Bir El Djir», address «حي 1000 مسكن عمارة 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 164ad0… core fab579…, recap total 8100`
- **T3** C: « ايه » · `ar` · 4.5 s (server 4.3 s)
  - AI: « تم تسجيل طلبيتك TEST-4053 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 8 100 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «Bir El Djir», address «حي 1000 مسكن عمارة 4», items 1×product …4766, customerConfirmed true} → ok TEST-4053, total 8100`

## Bugs

### R14-1 — An arabizi conversation answered in French from a field message with French address words (P2 T2–T3)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › step 5 › « Tester moi-même » (UI fr): « salam, nheb la robe kabyle brodée », « taille S, Amina Saadi 0698765432, Alger, Bab
  Ezzouar, rue des frères Bouadou n 5 », « ih ».
- Expected: the conversation's language (arabizi, set by T1 and answered in arabizi) kept on a message that only gives fields — « Hada récap
  ta3 la commande … Ktebli « ih » bach nconfirmi … » and « Commande ta3ek TEST-… tsajlet ✅ », as N9 the same night (« 3jbatni, nedi taille
  M. Amina Saadi … » → arabizi recap) and the R4-2 rule (a field in another script / language keeps the language).
- Actual (P2, 01:30:14–01:30:37): T1 detected `arabizi`, reply « Wa 3alaykom salam! Robe kabyle brodée hia brodia b yedd, tissu khfif,
  mliha l lafrah. Kayna f S, M w XL: S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? » (the guard had retried a `language_switch`
  and stripped a Moroccan form, `AiRun` 01a1ec0f-d0d8…). **T2 detected `fr`** → « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe
  kabyle brodée (S) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom :
  Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la
  commande, ou dites-moi ce qu’il faut changer. » (4.2 s); **T3 « ih » detected `fr`** → « Votre commande TEST-1158 est bien enregistrée ✅
  … Merci pour votre confiance ! ». The order content is right (S, Alger 400 DA, 5 300 DA, one order); only the language moved, and an
  arabizi « ih » did not bring it back.
- Evidence: .local/qa/journeys/R14/out/transcripts/P2.json T1–T3 (`language` arabizi / fr / fr) + P2.ui.txt · run1.log ·
  .local/qa/campaign/retest-ai-r14/fr-P2-pg.png · `AiRun` 01a1ec0f-d0d8…, 01a1ec0f-e8c7…, 01a1ec0f-fb7d… (read-only) · N9.json T2 (same
  shape with one arabizi word, kept)
- Likely cause: the turn language follows the latest message's detection; « taille S … Alger, Bab Ezzouar, rue des frères … » has French
  words and no arabizi word, so it reads as French, and the short « ih » then inherits the French turn instead of the conversation's
  first language — the R4-2 « field keeps the language » rule covers a name in another script, not a field message in French words.

### R14-2 — « Sétif, El Eulma » answered with « domicile ou stop-desk ? » and no fee at all (F1b T2)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même » (UI fr): « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 », « Sétif, El Eulma »,
  « Cité 500 logements bloc 12 », « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif ».
- Expected: once the wilaya is known, the street asked with both fees (« à domicile 650 DA, ou en stop-desk 350 DA ») — the R13-6 fix
  (`withBothFees`), as R12 F1b T2.
- Actual (F1b, 01:39:34): T2 no tool call (`AiRun` 01a1ec18-456b…, `toolCallCount 0`), reply « Merci Karim, c'est noté : Sétif, El Eulma.
  Pour la livraison, préférez-vous être livré à domicile (il me faut alors votre rue ou votre cité) ou au stop-desk ? » (6.3 s) — **no fee
  for either mode** (R13 T2 gave the stop-desk fee only). T3 the recap gives the home fee (650 DA) and T4 → TEST-6293 7 550 DA, so the
  order is right; the customer chose without knowing either price.
- Evidence: .local/qa/journeys/R14/out/transcripts/F1b.json T2 · run2.log · .local/qa/campaign/retest-ai-r14/fr-F1b-pg.png · `AiRun`
  01a1ec18-456b… (read-only)
- Likely cause: `withBothFees` adds the missing fee only from a home quote made in the same turn; the model made no `quote_delivery`
  call this turn, so there was nothing to complete and the mode question went out bare.

### R14-3 — Probe hand-offs and repeated product lookups left; they make the slowest turn
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: run N9, N11, N5, F1d, A3; read the tool calls.
- Expected: no tool call whose result cannot change the answer (R11-3, R12-3, R13-4); a hand-off only when the current message matches a
  rule.
- Actual (none reached the customer):
  - N9 T1 « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » → `search_products {«Robe kabyle
    brodée»}` → 1 product, then `get_product` for the same id, then **`handoff_to_human {reason «complaint», evidence «unused»}` →
    `HANDOFF_NOT_NEEDED evidence_not_in_message`**, and a reply-guard rewrite (`guard_rewritten`, moroccan_darija): **15.7 s (server 15.5 s),
    the slowest turn of the round** (`AiRun` 01a1ec11-cf53…, 15 507 ms, 3 tool calls).
  - N11 T3 « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » → `lookup_order {}` (right) and **`handoff_to_human {reason
    «customer_request», evidence «وين راهي الطلبية تاعي؟ …»}` → `HANDOFF_NOT_NEEDED reason_mismatch`** (a tracking question, no request for
    a person).
  - Repeated lookups for a product the turn already has: N5 T1 `search_products {«parfum»}` then `get_product` ×2 (10.5 s); F1d T1
    `search_products` then `check_availability` for the same variant; A3 T1 `check_availability {qty 2}` on « نحب زوج سجادات صلاة »; N25 T2
    `check_availability {qty 2}` before the recap call (that `create_order` checks stock itself).
  - F1d T3 the model's recap call named the Noir variant (…5b35) for « marron »; the server's recap held Marron (no impact, noted).
  - Gone since R13: `search_products` after the recap call (0 / 34 recaps, R13 5 / 32), `lookup_order` on a first product message (F3 T1),
    `create_order` field checks (F1b T1 / T2).
- Evidence: .local/qa/journeys/R14/out/transcripts/N9.json T1, N11.json T3, N5.json T1, F1d.json T1 / T3, A3.json T1, N25.json T2 ·
  out/airun.txt
- Likely cause: `handoff_to_human` stays offered with `complaint` / `customer_request` on product and tracking messages (the R13 enum
  filter removes only `off_catalogue` there), and the model uses it as a probe; `get_product` / `check_availability` stay offered after a
  search that already returned the stock.

### R14-4 — Wording left
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run F9, N5, W1, N21, A3, A3b, N9, N3.
- Expected: plain Algerian darija / arabizi / French; a reply always ends on the next step.
- Actual:
  - F9 T1 « … Illizi : makach tawsil l Illizi f had lwaqt. **T7ebb nwarrik produit ?** » — still an odd closing (R13 « … produit m3a l
    livraison ? »).
  - N5 T3 server line « Parfum Oud 50 ml n'est pas disponible pour le moment : **ce récapitulatif est pour Coffret cadeau Aïd à la place.** »
    — no article (« pour le Coffret cadeau Aïd »).
  - W1 T1 the hand-off turn has an empty AI text: the customer's wholesale question gets only the system line « Je transmets à un membre de
    l'équipe qui vous répondra très vite. » (no word on the wholesale request itself).
  - N21 T1 after the guard stripped the confirm question: « أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر 1500 دج (بدل 2000 دج). » —
    ends with no question / next step.
  - Standard Arabic or odd forms in darija: A3 T1 « صحيت سميرة، **الكمية 2 من** Tapis de prière، 2800 دج للواحد، **والمنتج متوفر**. », A3b T1
    « زوج **تابيس** الصلاة ».
  - French inside arabizi: N9 T1 « hiya **brodée à la main**, b qmach khfif, **et** mnasba bezzaf **lel fêtes** », N3 T2 « Tawsil l dar 700 DA,
    **2 à 5 jours**. ».
  - The reply guard stripped / rewrote a Moroccan form in 6 replies before sending (P2 T1, F9 T1, N9 T1, N11 T3, A4 T1, N18b T1) — nothing
    Moroccan reached the customer, but the model still writes them (one more than R13's 5).
  - Fixed since R13-6: « taille unique » in Arabic replies (N18b T1 « مقاسها واحد », A4 T1 « بيج وصوف رقيق »), « Tailles li kayn » (N9 now
    « Lmqasat li kaynin »), « نعم » in darija (A2 T1 « صحيت كريم! … »).
- Evidence: .local/qa/journeys/R14/out/transcripts/F9.json T1, N5.json T3, W1.json T1 (+ W1.ui.txt), N21.json T1, A3.json T1, A3b.json T1,
  N9.json T1, N3.json T2 · `AiRun.meta.guard` (out/airun.txt)
- Likely cause: free model wording; the N5 line is a server template (product name inserted without an article); a hand-off turn sends
  the system line only.

## Retest
- RETEST R13-1: fixed — F1 ×3 with the exact R13 message « Je voudrais le sac à main cuir marron »: T1 status OK each time, 0
  `handoff_to_human` (F1 / F1c no tool, F1d `search_products` + `check_availability`), the product answered, three orders (TEST-6293,
  TEST-6313, TEST-1506); the six new phrasings for products the shop sells — P1 « je veux la djellaba homme » (fr), P2 « nheb la robe kabyle
  brodée » (arabizi), A3b « بغيت زوج سجادات صلاة » (Arabic script), P4 « I want the silk hijab » (English), P5 « vous avez le coffret cadeau
  Aïd ? » (fr), F1b « Je cherche le sac à main cuir marron » (fr) — 0 hand-off, each taken to its order (TEST-5324, TEST-1158, TEST-5126,
  TEST-2029, TEST-3838, TEST-6293). The real wholesale request W1 « prix de gros pour 50 pièces du hijab soie ? » → `off_catalogue` accepted,
  status HANDOFF (team-only request kept for the team, as intended). N7 (not sold) still answered, no hand-off. Left in the family: two
  refused probe hand-offs (`complaint`, `customer_request`) on product / tracking messages → R14-3.
- RETEST R13-2: fixed — A3 with the exact R13 messages (« قسنطينة الخروب حي 1000 مسكن عمارة 5 », no separator): the model's recap call again
  carried the place inside the street (`address «حي 1000 مسكن عمارة 5، الخروب، قسنطينة»`) and the recap / order read « حي 1000 مسكن عمارة 5،
  الخروب، قسنطينة »; A3b (same T2) street-only call, same recap; P5 « Cité 1000 logements bloc 4, Bir El Djir » and A2 « …، العلمة » calls not
  doubled; 34 / 34 recaps « street, commune, wilaya ».
- RETEST R13-3: fixed on its flow — N18b (same messages): `address «حي 1000 مسكن عمارة 5»` in the recap call, the recap and the order, no
  French translation (R13 1 run in 2; one run here). The other Arabic streets (A1–A4, A3b, N11, N21, N25) kept as written; A2 one « ، »
  added inside the street of the recap only.
- RETEST R13-4: mostly fixed — 0 `search_products` after a recap call (R13 5 / 32), no `lookup_order` on « nheb nechri zoudj tapis de
  prière » (F3 T1), no `create_order` field check on F1b (T1 / T2). Left: refused hand-off probes (N9 T1, N11 T3) and repeated
  `get_product` / `check_availability` after a search (N5 T1, N9 T1, F1d T1, A3 T1, N25 T2) → R14-3.
- RETEST R13-5: fixed — N5 (same messages): T2 « je le prends » → the model names the substitute and asks first (« Ça vous tente ? »), no
  recap; T3 « oui » → the server line « Parfum Oud 50 ml n'est pas disponible pour le moment : ce récapitulatif est pour Coffret cadeau Aïd
  à la place. » before the Coffret recap. The final « oui » to that recap was not sent (budget), so no order was placed in this flow.
- RETEST R13-6: partly fixed — « taille unique » / « Tailles li kayn » / « نعم » gone (N18b, A4, N9, A2); left: F1b T2 asks home or stop-desk
  with no fee at all (worse than R13's one fee) → R14-2; F9 closing « T7ebb nwarrik produit ? », Moroccan forms still stripped by the guard
  (6 replies), French in arabizi → R14-4.
- R1–R12 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 27 orders**; N7 « oui » and N5 T3 « oui » to
  a question → no order; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; one order per « oui »: 27 orders, never two for one
  « oui », none lost after a recap; **R4-1 / R11-2 / R13-1 (no hand-off on an order / field / yes message, nor for a product not sold or
  sold) holds — 0 accepted hand-off outside W1 (wholesale, allowed) and F11 (blocked, server)**; R4-2 (a name in another script keeps the
  language) holds — N4, F3, N18b; **language kept broken once on a French-worded field message (P2 → R14-1)**; R4-4 / R6-1 (no model
  sentence asking to confirm in front of the recap) holds — 34 / 34; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) holds
  — 0 in 100 turns; R4-8 (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5, N7, P2, N9; R5-2 (no Tunisian /
  Moroccan forms sent) holds (guard ×6); R5-4 (no « home or stop-desk ? » after a street) holds — F1b T2 asked it before any street; R5-5 /
  R7-5 (delivery question answered with the fee) holds — F9, N16, N3; R5-6 (no `create_order` before a phone) holds — 0 / 62; R6-4 / R11-4 /
  R13-2 (recap address « …, commune, wilaya ») holds — 34 / 34; R7-2 (no photo said) holds — N9; no invented discount (catalogue old
  prices, Oran free delivery from the shop's rule); N11 tracking from `lookup_order`, no invented number or date; R8-3 (named variant)
  holds — and F1d's wrong model variant was corrected by the server's recap; R9-1 (Latin name in an Arabic chat) holds — N18b; R10-1
  (latency) — max 15.7 s (R13 12.6 s), 0 page re-send (R14-3); R11-5 (no provider error) holds — 0 / 100; R12-1 (no `VALIDATION wilayaId` on
  a wilaya written) holds — 0 refusal in 62 calls.

## Coverage
- Order flows to « oui »: French ×12 (F1, F1c, F1d, P1, P5, F1b, F6, N1, N4, N12, N14, N17; F11 blocked), Arabic-script darija ×9 (A1, A2,
  A3, A3b, A4, N11, N18b, N21, N25), arabizi ×5 (P2 — answered in French, F3, N3 after a switch, N9, N23), English ×1 (P4); no order,
  rightly: N7 (nothing chosen), F9, N16 (delivery questions only), W1 (wholesale → team); N5 stopped at the substitute recap (budget).
- Asked this round: F1 ×3, six new product-request phrasings (fr « je veux », arabizi « nheb », Arabic « بغيت », English « I want », fr « vous
  avez … ? », fr « je cherche »), a wholesale request, A3 ×2, N18b, N5, F1b T2, the sweep F3, F6, F9, F11, N1, N3, N4, N7, N9, N11, N12, N14,
  N16, N17, N21, N23, N25, A1, A2, A4; latency of every turn.
- Also: « oui mais … » in three scripts (N17, N23, N25), a product not sold (N7), « ? » / « ... » (N12), a cancel after the order (N14,
  simulated), a wilaya not served (F9, N16), commune-only address → mode question (F1b), photo request (N9), out-of-stock product with a
  substitute (N5), free delivery threshold (P5, N5, 24 990 DA to Oran), a wrong variant in the model's call (F1d), an English conversation
  (P4), out-of-hours shop (every J03 run).
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout.

## Not tested
- The shared test link (`/agent-test/<token>`) — no flow of this round's list uses it; the R7 links were not probed or renewed.
- N5's final « oui » to the substitute recap (budget: the flow was planned at 3 messages and the model asked once before recapping).
- The « بغيت … » and « je cherche … » phrasings alone in their message (both were sent with other fields: A3b T1 name + phone, F1b T1
  quantity + name + phone); the four other new phrasings were product-only messages.
- F3, N4, A1, A2 with their fields one per message as in R13 (two fields merged to fit the budget); N7's second « oui ».
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`). The live Messenger path (no page
  connected), so W1's hand-off on a real conversation was not seen.
- `cancel_order` / `lookup_order` on a real order with a courier and a tracking number (N11's « نبعثلك الرقم والرابط » promise not checked);
  a product that HAS photos in a photo request; the stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11).
- Playground TEST orders (simulated, nothing written): TEST-6293 (F1, F1b), TEST-6313 (F1c), TEST-1506 (F1d), TEST-5324 (P1), TEST-1158
  (P2), TEST-5126 (A3, A3b), TEST-2029 (P4), TEST-3838 (P5), TEST-6540 (N18b), TEST-5998 (F3), TEST-2340 (F6), TEST-5759 (N1), TEST-7010
  (N3), TEST-1344 (N4), TEST-6890 (N9), TEST-4074 (N11), TEST-9479 (N12), TEST-3146 (N14 — then cancelled, simulated), TEST-8063 (N17),
  TEST-6619 (N21), TEST-4704 (N23), TEST-6971 (N25), TEST-4104 (A1), TEST-9905 (A2), TEST-4053 (A4); F11 refused (`CUSTOMER_BLOCKED`); N5
  recap only (draft faad11…, no order). The same content gives the same simulated number (F1 / F1b, A3 / A3b; R13's TEST-6619, TEST-4074,
  TEST-5759, TEST-3146, TEST-8063, TEST-6971, TEST-4053, TEST-6890 again).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:playground:*` TTL / count, `AiRun` rows since 00:17 UTC
  (out/airun.txt), API « playground turn answered » lines (out/api-lines.txt); nothing written.
- Hour counters (read-only): before the run J04 45 / 60 (TTL 706 s), J03 54 / 60 (TTL 1 073 s) — waited for expiry; after the run J04 46 / 60
  (window from 01:29:58), J03 54 / 60 (window from 01:36:25); no 429. Messages used: 100 / 100.
