# R15 — Fifteenth retest of the AI order-taking (after the R14 fixes) — live site, deployed commit c65255d — 18/11/2026 02:30–02:43 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at c65255d (checked read-only: `git log --oneline -1` = « c65255d fix(ai): live retest R14 —
address / field words and a bare yes keep the conversation language, the mode question carries both fees, complaint / angry hand-offs need
real words, redundant lookups answered from the search, wording fixes »; `djaber-v2-api` / `djaber-v2-worker` online, restarted ~02:16).
Same two own shops as R1–R14: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR) and « Boutique de Karima » (J04
shop, « Agent J04 », preset Vendeur Pro). Surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and, for F5 / F12, the
J04 shared test link (`/agent-test/<token>`, no tool calls in the visitor response — the tool calls were read server side, read-only, from
`AiToolCall`). The R7 links were still valid — probe without a message at 02:19: « Lien valable jusqu'au 18 nov. 2026 18:04 », so no new link
was made. One browser at a time, the runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in
place (F11). The 60 / h counters (the shared link counts in the same budget) were read before the run (read-only, Redis
`rl:playground:*`, 02:18): the R14 windows were still open (J04 46, TTL 699 s; J03 54, TTL 1 082 s), so each shop's run waited until its key
had expired (J04 02:30:16, J03 02:36:37). J04 flows 02:30:16–02:36:36, J03 flows 02:36:37–02:42:55. No 429. Both shops were outside their
opening hours: the J03 conversations start with the shop's « out_of_hours » system line — configured text, not an AI reply.

**Latency method (as R11–R14).** `conv.mjs` of R14 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » log lines (`runMs`, `waitMs`, `totalMs`, `replayed`) and the `AiRun` rows (`latencyMs`,
`status`, `flags`, `meta.guard`, `meta.language`, `meta.turn.statusDetail`) + `AiToolCall` rows. No stall / dup probe. (The VPS clock runs
~2 s ahead of the test PC: `AiRun` times read 2 s after the page's send time.)

**99 customer messages** (J04 shop 49, J03 shop 50; budget 100, one left), 33 conversations, 31 on the playground and 2 on the shared link:
priority 1 — P2 ×2 (the exact R14 messages), F1b ×2 (F1b = R14 messages, F1b2 = T1 « Je voudrais … »), N9, N11, two real complaints (C1 fr
« Bonjour, j'ai reçu ma commande cassée, je veux un remboursement » on J03, C2 arabizi « salam, wsaltni la commande mkassra, nheb tredouli
drahmi » on J04), two real requests for a person (H1 fr « Bonjour, je veux parler à quelqu'un » on J04, H2 Arabic script « السلام، نحب نهدر مع
واحد من الفريق تاعكم » on J03), W1; priority 2 — N5 taken to its final « oui » (4 messages), F5 and F12 on the shared link; priority 3 — the
sweep F1, F3, F6, F9, F11, N1, N3, N4, N7, N12, N14, N16, N17, N18, N21, N23, N25, A1, A3, with each field in its own message where the
flow allows it (F1 name / phone / address, F3 name / phone / address, N4 name / phone / address, N18 Latin name / phone / address, A1 name /
phone / address, N12 and N21 as before). Flows stop at the order (`untilOrder`), so no « oui » was spent after an order. No guarded extra
message, no re-send. Scripts `.local/qa/journeys/R15/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs, lat-table.cjs, server.sh =
read-only `AiRun` query, tools.sh = read-only `AiToolCall` query, probe-link.mjs, waitkey.sh, run.sh, all.sh), transcripts
`.local/qa/journeys/R15/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs `.local/qa/journeys/R15/out/run1.log` (J04),
`run2.log` (J03), `airun.txt`, `toolcalls.txt`, `api-lines.txt`, rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r15/`.

Cases asked for this round:
- **R14-1**: P2 ×2 — arabizi conversation, field message with French address words ⇒ recap and confirmation in arabizi.
- **R14-2**: F1b ×2 — the home / stop-desk question carries both fees.
- **R14-3**: N9 / N11 — no hand-off probe; a REAL complaint and a REAL request for a person ⇒ hand-off accepted; W1 wholesale ⇒ team.
- **R14-4**: W1 with one AI sentence; the wording items (F9 closing, N5 server line, N21 ending, Arabic forms).
- N5 to its final order, F5 / F12 on the shared link, the sweep with fields one per message.
- Latency per turn with `Server-Timing`; every R1–R14 guarantee (no order without a server recap — Critical; one order per « oui »; a « oui »
  with a change gives a new recap; no `create_order` before a phone; no confirm question / registered claim without a server recap; no wrong
  hand-off; language kept; no invented discount; tracking real; address street, commune, wilaya).

**Result: 32 / 33 conversations pass** — priority 1: 11 / 11 (P2 ×2, F1b ×2, N9, N11, C1, C2, H1, H2, W1), priority
2: N5 and F12 pass, **F5 fails (R15-1)**, sweep 19 / 19. **R14-1 fixed: P2 twice with the exact R14 messages — T2 detected `arabizi`, arabizi
recap « Hada récap ta3 la commande … », « ih » → « Commande ta3ek TEST-1158 tsajlet ✅ »** (and F5 T2, a French-worded street, kept the
arabizi). **R14-2 fixed on its flow: F1b ×2 « Sétif, El Eulma » → « 650 DA à domicile ou 350 DA en stop-desk » before the mode question**
(F1b by two quote calls, F1b2 by a reply-guard `fee_missing` rewrite). **R14-3 fixed: 0 `handoff_to_human` call in 99 turns, 0 refused
probe (N9 T1 no tool at all, N11 T3 `lookup_order` only); the two real complaints (fr, arabizi) and the two real requests for a person (fr,
Arabic script) and the wholesale request are hand-offs (status HANDOFF, `refund` ×2, `customer_request` ×2, `off_catalogue`); repeated
lookups mostly gone (N5 T1, A3 T1, N25 T2 no extra call).** **R14-4 mostly fixed: W1 has one AI sentence, F9 closing gone, N5 server line with
the article, N21 T1 ends on the next step; left: the hand-offs for a person have an empty AI text, Moroccan forms still written (stripped).**
**Latency: median 4.9 s, p90 7.4 s, slowest 9.8 s (F6 T2, server 9.5 s); 0 turn above 10 s (R14: 3, max 15.7 s); 0 page re-send;
`Server-Timing` on 99 / 99 answers; page − server median 0.21 s, max 0.34 s; 0 provider error.** **0 order without a server recap; 23 TEST
orders, each from a « oui / ih / ايه / 👍 / oui c'est bon / oui, c'est bien … » to a server recap, exactly one each; F11 « oui » refused as
blocked; 3 « yes » with a change (N17 fr, N23 arabizi, N25 Arabic script) → a new recap, 0 order; 0 `create_order` before a phone in 53
calls.** Failure — one Minor: on the shared link, a first message with the wilaya and commune got the street question with no price, no fee
and no stop-desk choice (F5 T1, R15-1). Issues: hand-off wording (empty AI text for a person request, a generic sentence for a broken order —
R15-2), small redundant lookups (R15-3), wording left (R15-4).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| P2 | J04 · playground | arabizi « nheb … », French-worded fields | arabizi recap and confirmation → TEST-1158 5 300 DA | T1 6.0 s / 5.7 s | yes, 1 | PASS (R14-1) |
| P2b | J04 · playground | arabizi (re-run) | same, arabizi every turn → TEST-1158 | T1 6.6 s / 6.4 s | yes, 1 | PASS (R14-1) |
| F1b | J03 · playground | fr « je cherche … », fields over 3 messages | T2 both fees + mode question → recap → TEST-6313 7 550 DA | T1 6.0 s / 5.8 s | yes, 1 | PASS (R14-2) |
| F1b2 | J03 · playground | fr « je voudrais … » | T2 both fees (guard `fee_missing` rewrite) → TEST-1506 | T2 9.7 s / 9.4 s | yes, 1 | PASS (R14-2) |
| N9 | J04 · playground | arabizi, photo + details | no tool, no probe; « Ma 3andnach tsawer »; recap (M) → TEST-6890 | T1 9.3 s / 9.1 s | yes, 1 | PASS (R14-3) |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; T3 `lookup_order` only, no tracking, none invented | T2 7.6 s / 7.5 s | yes, 1 | PASS (R14-3) |
| C1 | J03 · playground | fr, broken order + refund | HANDOFF `refund`, generic AI sentence | T1 2.5 s / 2.2 s | — (team) | PASS (R15-2) |
| C2 | J04 · playground | arabizi, broken order + refund | HANDOFF `refund`, « sme7li 3la had lmochkil » | T1 3.5 s / 3.3 s | — (team) | PASS (R15-2) |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | HANDOFF `customer_request`, empty AI text | T1 1.5 s / 1.3 s | — (team) | PASS (R15-2) |
| H2 | J03 · playground | Arabic script, a person asked | HANDOFF `customer_request`, empty AI text | T1 1.9 s / 1.7 s | — (team) | PASS (R15-2) |
| W1 | J04 · playground | fr, wholesale | HANDOFF `off_catalogue` + « Merci pour votre message : l'équipe … » | T1 2.5 s / 2.2 s | — (team) | PASS (R14-4) |
| N5 | J04 · playground | fr, out of stock « je le prends » | substitute asked → server line + Coffret recap → « oui » → TEST-3157 24 990 DA | T4 6.9 s / 6.7 s | yes, 1 | PASS (R13-5) |
| F5 | J04 · shared link | fr / arabizi mixed | T1 street asked, no price / fee / stop-desk; recap → TEST-6890 (confirmed in French) | T1 6.4 s / 6.3 s | yes, 1 | FAIL — R15-1 |
| F12 | J04 · shared link | fr | « on livre à Blida … 450 DA à domicile, ou 300 DA en stop-desk » | T1 2.5 s / 2.3 s | — | PASS |
| F1 | J03 · playground | fr, fields one per message | recap « (Marron) » → « oui » → TEST-1918 7 550 DA | T1 5.5 s / 5.2 s | yes, 1 | PASS |
| F3 | J03 · playground | arabizi, fields one per message | « وليد بوزيد » kept → « ih » → TEST-1845 6 050 DA | T5 5.8 s / 5.6 s | yes, 1 | PASS (R15-4) |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2670 9 100 DA | **T2 9.8 s / 9.5 s** (slowest) | yes, 1 | PASS |
| F9 | J04 · playground | arabizi, 3 delivery questions | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 3.7 s / 3.4 s | — | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider … » | T1 7.3 s / 7.1 s | no (refused, as expected) | PASS |
| N1 | J03 · playground | fr, product + wilaya change | new recap « (Marron) » Oran → « oui » → TEST-5759 7 500 DA | T2 7.4 s / 7.2 s | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | both fees + arabizi recap → « ih saha » → TEST-1619 6 300 DA | T1 8.2 s / 8.0 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script alone | French kept, « سمير بن علي » kept → « oui » → TEST-1344 3 250 DA | T5 6.3 s / 6.0 s | yes, 1 | PASS (R15-3) |
| N7 | J03 · playground | fr, product not sold + details | « nous ne vendons pas de lunettes … » + 3 products; « oui » → « Quel article … ? » | T1 7.8 s / 7.6 s | no (right: nothing chosen) | PASS |
| N12 | J04 · playground | fr, « ? » / « ... » | question repeated; recap → « 👍 » → TEST-9479 1 950 DA | T6 4.4 s / 4.3 s | yes, 1 | PASS |
| N14 | J03 · playground | fr, cancel after the order | TEST-3146 → « non annule » → « … a bien été annulée » | T2 6.3 s / 6.1 s | yes, 1 | PASS |
| N16 | J04 · playground | arabizi, wilaya not served | « Ma nwasslouch l Illizi … » | T1 4.1 s / 3.9 s | — | PASS (R15-3) |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T1 8.9 s / 8.6 s | yes, 1 | PASS |
| N18 | J03 · playground | Arabic script, Latin name alone | « Samir Benali » + Arabic street kept → « ايه » → TEST-2274 8 200 دج | T1 4.6 s / 4.4 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, 👍 | T1 ends « واش سميتك ؟ »; recap → « 👍 » → TEST-6619 1 950 دج | T5 6.1 s / 5.9 s | yes, 1 | PASS (R14-4) |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-4704 | T2 7.2 s / 7.0 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-6971 | T2 7.0 s / 6.8 s | yes, 1 | PASS |
| A1 | J04 · playground | Arabic script, fields one per message | recap Alger → « ايه » → TEST-4104 1 900 دج | T1 7.7 s / 7.5 s | yes, 1 | PASS |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | recap « …، الخروب، قسنطينة » → « ايه » → TEST-5126 6 300 دج | T2 7.2 s / 7.0 s | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **23 / 23** (P2, P2b, F1b, F1b2, N9, N11, N5, F5, F1, F3, F6, N1,
  N3, N4, N12, N14, N17, N18, N21, N23, N25, A1, A3) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.** **« oui » to a
  correct recap lost: 0.** One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N23 wilaya, N25
  quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N7 T2 (« which one? » again), N5 T3 (a « oui » to « Ça vous
  tente ? » → the substitute's recap, no order; T4 « oui » → TEST-3157).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…), N23 T2 (arabizi « ih bessah wasslouha l Oran … » → Oran 600 DA, 8 100 DA, core e3d489…), N25 T2 (Arabic script « ايه بصح ديرلي
  جوج ماشي واحد » → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **6 / 6** — F3 (« Cité 20 Août, villa 3 » / « Cité 20 Août villa 3 »), N21 (« حي الورود رقم 12، بوفاريك » / street only), F1b2 (confirming call street « …, El
  Eulma, Sétif »), F1 (« …, El Eulma »), N3 (« …, El Khroub »), A3 (recap call commune « El Khroub » / confirming « الخروب »); recap calls
  carrying the place inside the street (F6 T1 « …, El Khroub », N21 T4 « …، بوفاريك », N23 « …, El Eulma, Sétif » / « …, Bir El Djir, Oran »)
  still gave recaps « street, commune, wilaya ».
- **Confirming calls refused: 0** — the 23 confirming calls + F11 carried name, phone, wilaya, commune, address, items and
  `customerConfirmed true`. **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 53 `create_order` calls.**
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **29 / 29**, the named variant every
  time (F1, F1b ×2, N1 Marron; P2 ×2 S, N9 / F5 M); **in the customer's language 29 / 29** — Arabic script 7 (N11, N21, N25 ×2, A1, N18, A3),
  arabizi 8 (P2, P2b, N9, F5, F3, N3, N23 ×2), French 14 (R14: P2 in French — fixed).
- **Server recap without a model sentence asking to confirm or describing the order: 29 / 29** — lead-ins left: N3 « Ih, nwasslou l
  Constantine. Tawsil l dar 700 DA, wela stop-desk 450 DA, ywasel f 2 l 5 ayam. » (the answer to « twasslou l Constantine ? ») and N5's
  server line. **Outside any recap: 0** model turn asking to confirm or claiming the order — the guard stripped / rewrote
  `confirm_without_recap` twice before sending (N21 T1, N18 T1, product offer turns); item-noted lines left (« on a bien noté 1 sac à main
  cuir Marron », F1b2 T1; « je note 2 tapis de prière », N3 T1; « صحيت، تسجل: زوج Tapis de prière », A3 T1; F5 T1 « rani ndir lek la robe »)
  name a product, not an order.
- **Recap address « street, commune, wilaya »: 29 / 29** — A3 no separator, A1 / N21 / N25 « ، », N18 Latin name, and the model's whole-place
  `address` (F6, N21, N23) → commune and wilaya once, at the end. **Street as the customer wrote it: 28 / 29** (F3 « Cité 20 Août, villa 3 »
  for « cite 20 aout villa 3 » — a comma and accents added; first-letter capitals not counted, as R14).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3 (« الهاتف: 0550123456 »).
- **Customer's name as written: 33 / 33 conversations** — Arabic script kept in French / arabizi chats (N4 « سمير بن علي » sent alone, F3
  « وليد بوزيد »), Latin kept in an Arabic chat (N18 « Samir Benali » sent alone); 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9; photo announced without a photo: 0.
- **Delivery question answered with the fee: 4 / 4** — F9 (three wilayas), F12 on the link (Blida 450 / 300), N16 (not served), N3 (both
  fees); **wilaya + commune with no street → both fees before the street / mode question: 2 / 3** — F1b, F1b2 yes; **F5 T1 no fee at all,
  no stop-desk choice (R15-1)**.
- **`create_order` before a phone is in the customer's messages: 0 / 53 calls.**
- **Hand-offs: 5 / 5 real ones accepted, 0 wrong** — C1 / C2 (`refund`, intent complaint), H1 / H2 (`customer_request`), W1 (`off_catalogue`)
  — all decided by the platform with 0 tool call; F11's is the server's (`CUSTOMER_BLOCKED`). **0 `handoff_to_human` call, 0 refused probe
  in 99 turns** (R14: 3, of which 2 refused probes); no hand-off for a product sold (P2, F1, F1b …), not sold (N7), a photo request (N9), a
  tracking question (N11), a field or yes message.
- **No 503 / provider error: 99 / 99 turns**; `AiRun` 99 rows, 93 `ok` + 6 `handoff` (C1, C2, H1, H2, W1, F11 T2), 0 `error`, 0 fallback,
  `attempt` 1 everywhere; 8 runs carry a reply-guard retry (`guard_enforced` 3 — P2 T1 / P2b T1 language_switch + moroccan_darija
  stripped, N21 T1 moroccan_darija + confirm_without_recap stripped; `guard_rewritten` 5 — N9 T1 language_switch + moroccan_darija, F5 T1
  language_switch, F1b2 T2 fee_missing, N4 T2 language_switch, N18 T1 confirm_without_recap).
- Latency: **median 4.9 s, p90 7.4 s, max 9.8 s on 99 turns** (F6 T2 9.8 s / server 9.5 s, F1b2 T2 9.7 / 9.4 s, N9 T1 9.3 / 9.1 s, N17 T1
  8.9 / 8.6 s, N3 T1 8.2 / 8.0 s); page median J04 4.9 s, J03 4.9 s; `AiRun` median 4.7 s, max 9.5 s; API « playground turn answered »
  lines: 99 (playground and shared link), 0 replay, `waitMs − runMs` max 105 ms, 0 « did not finish »; 1 POST per turn, 0 re-send; 5 turns
  ≥ 8 s, 0 ≥ 10 s (R14: 3 ≥ 10 s, max 15.7 s).
- Quantity never asked again after a product is named: **0 quantity question in 99 turns** (« 1 seul », « 2 pièces », « zoudj », « زوج »,
  « 3 tapis au lieu de 2 », « ديرلي جوج », « واحد » kept).
- Language kept: arabizi **10 / 10** (P2, P2b, N9, C2, F9, N16, F3, N23, F5 to the recap, N3 after the switch), Arabic-script darija **7 / 7**
  (N11, N21, N25, A1, H2, N18, A3), French **16 / 16**; F5 T3 « oui c'est bon » (French words) was confirmed in French after an arabizi
  recap (R15-4).
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard stripped / rewrote a Moroccan form in 4 replies (P2 T1, P2b T1, N9 T1, N21 T1)
  before they were sent (R14: 6).
- Out-of-stock product offered: **0** — N5 names the Parfum Oud only because the customer asked for it; P2 / P2b / N9 list S, M, XL only (L
  out of stock said in P2 / N9); N7 lists in-stock products.
- No Markdown in a reply: **99 / 99**. No invented discount: only the catalogue's old prices (N18 « 9000 », N12 / N21 / A1 « 2000 »); N5
  « Livraison … gratuite » is the shop's rule (Oran home delivery free from 20 000 DA — `quote_delivery` of F9: `freeFrom 20000, freeFor
  home`).
- Tool calls in 99 turns (`AiToolCall`, playground and link): `create_order` 53 (29 recaps + 23 orders + 1 blocked), `quote_delivery` 10,
  `search_products` 4, `get_product` 1, `lookup_order` 1 (N11 tracking), `cancel_order` 1 (N14, asked), **`handoff_to_human` 0**,
  `check_availability` 0, `add_faq_candidate` 0; **0 search after a recap call in 29 recaps**.

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line. Shared-link turns (F5, F12) carry no tool calls, cards or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### P2 — J04 playground (UI fr)
**Verdict: PASS (R14-1, run 1 of 2, the exact R14 messages) — T1 arabizi (the guard retried a language switch and stripped a Moroccan form before sending, `AiRun` 01a1ec46-d9c9…); T2 the field message with French address words detected `arabizi` → the arabizi server recap « Hada récap ta3 la commande … Ktebli « ih » bach nconfirmi … »; T3 « ih » → « Commande ta3ek TEST-1158 tsajlet ✅ … » — same order content as R14 (S, Alger 400 DA, 5 300 DA, one order).**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 6.0 s (server 5.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykom salam! Robe kabyle brodée b lyedd, qmach khfif, parfaite pour l3rass w lmounasabat. Lmqasat li kaynin sont S et M a 4900 DA, et XL a 5200 DA (la L makach dork). Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.7 s (server 4.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.3 s (server 5.1 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### P2b — J04 playground (UI fr)
**Verdict: PASS (R14-1, run 2 of 2, same messages) — arabizi on every turn (T1 guard retry, `language_switch` → stripped), arabizi recap, « ih » → TEST-1158 in arabizi.**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 6.6 s (server 6.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3likoum salam 😊 Robe kabyle brodée bel yed, tissu khfif, mliha l lfar7a. Kayna f S w M b 4900 DA, w f XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.7 s (server 4.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 4.9 s (server 4.8 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### F1b — J03 playground (UI fr)
**Verdict: PASS (R14-2, run 1 of 2, same messages as R14) — T2 « Sétif, El Eulma » → `quote_delivery` (home) + `quote_delivery` (stop-desk) → « Les frais sont de 650 DA à domicile ou 350 DA en stop-desk … Vous préférez être livré à domicile ou en stop-desk ? »; T3 recap; T4 « oui, c'est bien … » → TEST-6313 7 550 DA (confirming call `phoneConfirmed true`). The second quote call is redundant: the first already returns `stopdeskFee 350` (R15-3).**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 6.0 s (server 5.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en couleur Marron est disponible à 6900 DA, en cuir véritable. Dans quelle wilaya habitez-vous pour que je calcule la livraison ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)`
- **T2** C: « Sétif, El Eulma » · `fr` · 5.2 s (server 5.0 s)
  - AI: « Merci Karim, nous livrons bien à El Eulma (Sétif). Les frais sont de 650 DA à domicile ou 350 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous préférez être livré à domicile ou en stop-desk ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Votre commande TEST-6313 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-6313, total 7550`

### F1b2 — J03 playground (UI fr)
**Verdict: PASS (R14-2, run 2 of 2, T1 « Je voudrais … ») — T1 no tool, product and price noted, wilaya asked; T2 one `quote_delivery`, the model's reply was rewritten by the reply guard (`fee_missing`, `AiRun` 01a1ec4d-18f3…, 9.4 s server) → « … 650 DA à domicile, ou 350 DA en stop-desk … (donnez-moi la rue ou la cité) ou en stop-desk ? »; T4 → TEST-1506.**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 3.4 s (server 3.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, on a bien noté 1 sac à main cuir Marron à 6900 DA. Dans quelle wilaya habitez-vous ? »
- **T2** C: « Sétif, El Eulma » · `fr` · 9.7 s (server 9.4 s)
  - AI: « Merci Karim, c'est noté. Pour Sétif (El Eulma), la livraison coûte 650 DA à domicile, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Vous préférez qu'on vous livre à domicile (donnez-moi la rue ou la cité) ou en stop-desk ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.8 s (server 4.6 s)
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### N9 — J04 playground (UI fr)
**Verdict: PASS (R14-3) — T1 no tool call at all, no hand-off probe (R14: search + get_product + refused `handoff_to_human {complaint}`, 15.7 s); 9.3 s / server 9.1 s, the time of a reply-guard rewrite (`language_switch` + `moroccan_darija`, `AiRun` 01a1ec47-96d3…); « Ma 3andnach tsawer … » with the in-stock sizes and L said out of stock; T2 arabizi recap (M); T3 « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 9.3 s (server 9.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam! Ma 3andnach tsawer ta3 had la robe f had lwaqt, bessah hiya robe kabyle brodée b lyedd, b tissu khfif, zina l lfar7a. Kayen S w M b 4900 DA, w XL b 5200 DA ; taille L makanch disponible lwaqt. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.0 s (server 4.8 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.4 s (server 5.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS (R14-3) — T1 recap, T2 « ايه » → TEST-4074; T3 tracking question → `lookup_order` only, no `handoff_to_human` (R14: refused `customer_request` probe) → « … ما خرجتش للتوصيل حتى الآن، ومازال ما عندهاش رقم تتبع … » — from the tool result (`not_sent`, tracking null), nothing invented.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 5.7 s (server 5.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 7.6 s (server 7.5 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 4.2 s (server 3.9 s)
  - AI: « طلبيتك رقم TEST-4074 مازالت درك في التحضير، ما خرجتش للتوصيل حتى الآن، ومازال ما عندهاش رقم تتبع. كي تخرج الطلبية نعطوك رقم التتبع. مدة التوصيل من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### C1 — J03 playground (UI fr)
**Verdict: PASS (real complaint, fr) — « j'ai reçu ma commande cassée, je veux un remboursement » → turn status HANDOFF (`statusDetail refund`, intent complaint, 0 tool call — the platform's hand-off), system line « Je transmets … ». The AI sentence is the generic « Merci pour votre message : l'équipe de la boutique va vous répondre. » — no word on the broken order, after an « out_of_hours » line saying the team is away (R15-2).**

- **T1** C: « Bonjour, j'ai reçu ma commande cassée, je veux un remboursement » · `fr` · 2.5 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Merci pour votre message : l'équipe de la boutique va vous répondre. »

### C2 — J04 playground (UI fr)
**Verdict: PASS (real complaint, arabizi) — « wsaltni la commande mkassra, nheb tredouli drahmi » → HANDOFF (`statusDetail refund`, intent complaint, 0 tool call); AI « Wa 3alaykom salam, sme7li 3la had lmochkil. » in arabizi; the hand-off system line is in Arabic script (R15-2).**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 3.5 s (server 3.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ » · « handoff: سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. »
  - AI: « Wa 3alaykom salam, sme7li 3la had lmochkil. »

### H1 — J04 playground (UI fr)
**Verdict: PASS (real request for a person, fr) — « je veux parler à quelqu'un » → HANDOFF (`statusDetail customer_request`, 0 tool call, 1.5 s); the AI text is empty, the customer gets only the system line (R15-2).**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 1.5 s (server 1.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: «  »

### H2 — J03 playground (UI ar)
**Verdict: PASS (real request for a person, Arabic script) — « نحب نهدر مع واحد من الفريق تاعكم » → HANDOFF (`customer_request`); empty AI text, the « out_of_hours » line then « سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا » (R15-2).**

- **T1** C: « السلام، نحب نهدر مع واحد من الفريق تاعكم » · `ar` · 1.9 s (server 1.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. » · « handoff: سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. »
  - AI: «  »

### W1 — J04 playground (UI fr)
**Verdict: PASS (R14-4, wholesale → team with one AI sentence) — « prix de gros pour 50 pièces du hijab soie ? » → HANDOFF (`statusDetail off_catalogue`, 0 tool call); AI « Merci pour votre message : l'équipe de la boutique va vous répondre. » (R14: empty AI text).**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 2.5 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Merci pour votre message : l'équipe de la boutique va vous répondre. »

### N5 — J04 playground (UI fr)
**Verdict: PASS (R13-5, now taken to the order) — T1 Oud out of stock + the in-stock Coffret offered, no tool call (R14: search + get_product ×2, 10.5 s) — but the Oud's price, asked « c'est combien ? », is no longer given (R14 « Son prix est de 3200 DA ») (R15-4); T2 « je le prends » → the substitute named and asked first, no recap; T3 « oui » → the server line « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. » + the Coffret recap (Oran home delivery gratuite — shop rule); T4 « oui » → TEST-3157 24 990 DA, one order.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 3.4 s (server 3.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 5.1 s (server 4.9 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Je garde bien vos coordonnées (Karim Haddad, 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4). Si vous voulez un cadeau avec du parfum, le Coffret cadeau Aïd est en stock à 24990 DA, avec parfum, chocolat et carte personnalisée. Ça vous tente ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T3** C: « oui » · `fr` · 6.3 s (server 6.2 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T4** C: « oui » · `fr` · 6.9 s (server 6.7 s)
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### F5 — J04 shared link (UI fr)
**Verdict: FAIL — R15-1 (shared link, mixed fr / arabizi) — T1 product, name, phone, wilaya and commune → the street asked with no price, no fee and no stop-desk choice (no tool call; the reply guard rewrote a language switch, `AiRun` 01a1ec49-3f52…; R12 « … rahi disponible b 4900 DA … Wela t7ebb nwasslouha f stop-desk ? »); T2 street → server recap in arabizi; T3 « oui c'est bon » → TEST-6890 5 300 DA confirmed in French (the customer's words; R15-4). The order is right. Shared-link turns carry no tool calls or language in the visitor response — server rows (read-only `AiToolCall`): T1 none · T2 `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED` · T3 same call → `ok TEST-6890, total 5300` (core 39a4a2…); `AiRun.meta.language` arabizi / arabizi / fr.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 6.4 s (server 6.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam Amina, rani ndir lek la robe kabyle brodée taille M. Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ? »
- **T2** C: « rue des frères Bouadou n 5 » · 4.7 s (server 4.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 6.2 s (server 6.1 s)
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link) — « Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk … » — server `quote_delivery {Blida} → fee 450 / stop-desk 300` (`AiToolCall`, read-only); check.cjs « DELIVERY-Q-NO-FEE » is the known false hit of its fee regex.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.5 s (server 2.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk, et la livraison prend 2 à 5 jours. Vous cherchez quelque chose en particulier ? »

### F1 — J03 playground (UI fr)
**Verdict: PASS (each field in its own message, phone alone this time) — T1 no tool, no hand-off; name, phone, wilaya asked in turn; T4 recap « (Marron) »; T5 « oui » → TEST-1918 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 5.5 s (server 5.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir — 6900 DA est disponible en Marron, en cuir véritable. Pour commander, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 2.3 s (server 2.0 s)
  - AI: « Merci Karim, c'est noté ! Pour la suite, quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233 » · `fr` · 2.6 s (server 2.4 s)
  - AI: « Merci Karim, votre numéro est noté ! Dans quelle wilaya souhaitez-vous recevoir le sac ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 3.9 s (server 3.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 5.2 s (server 5.1 s)
  - AI: « Votre commande TEST-1918 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×variant …0eda, customerConfirmed true} → ok TEST-1918, total 7550`

### F3 — J03 playground (UI fr)
**Verdict: PASS (fields one per message, as R13) — arabizi kept, the Arabic-script name « وليد بوزيد » kept in the recap; T5 « ih » → TEST-1845 6 050 DA. The recap street reads « Cité 20 Août, villa 3 » for « cite 20 aout villa 3 » (comma and accents added by the model — R15-4).**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 5.7 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Tapis de prière — 2800 DA, zoudj (2) ykounou 5600 DA. Wach smitek ? Bach ngoulou commande bsmek. »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.3 s (server 2.1 s)
  - AI: « Saha Walid Bouzid, tsajjel. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244 » · `arabizi` · 2.1 s (server 1.8 s)
  - AI: « Saha, tsajjel. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 5.8 s (server 5.6 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih » · `arabizi` · 5.8 s (server 5.6 s)
  - AI: « Commande ta3ek TEST-1845 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-1845, total 6050`

### F6 — J03 playground (UI fr)
**Verdict: PASS — 2 → 3 tapis → new recap 9 100 DA (T2 9.8 s / server 9.5 s, one `create_order` call, the slowest turn of the round); « oui » → TEST-2670.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 4.8 s (server 4.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 9.8 s (server 9.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 4.7 s (server 4.6 s)
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F9 — J04 playground (UI fr)
**Verdict: PASS (R14-4) — three `quote_delivery` calls, Sétif 650 / 350, Oran stop-desk 400, Illizi not served; the odd closing « T7ebb nwarrik produit ? » is gone.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 3.7 s (server 3.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider cette commande ici : l'équipe de la boutique va s'en occuper. », status HANDOFF (server reason).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 7.3 s (server 7.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 4.1 s (server 3.9 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya + address change → new recap « (Marron) » Oran 600 DA; « oui » → TEST-5759 7 500 DA.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.4 s (server 5.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 7.4 s (server 7.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.7 s (server 5.5 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N3 — J03 playground (UI fr)
**Verdict: PASS — fr → arabizi at T2: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela stop-desk 450 DA … » (both fees now) + arabizi recap; « ih saha » → TEST-1619 6 300 DA.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 8.2 s (server 8.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Samira, je note 2 tapis de prière (2800 DA chacun). Dans quelle wilaya souhaitez-vous être livrée ? »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 6.6 s (server 6.4 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela stop-desk 450 DA, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 4.7 s (server 4.5 s)
  - AI: « Commande ta3ek TEST-1619 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1619, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS (fields one per message, as R13) — « سمير بن علي » alone in a French chat: French kept (the guard rewrote a language switch on T2, `AiRun` 01a1ec50-0558…), name kept in Arabic script; T5 « oui » → TEST-1344 3 250 DA. T1 `get_product` for the product the turn already named (R15-3).**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 4.5 s (server 4.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, le Tapis de prière — 2800 DA est disponible pour vous. Il est molletonné et mesure 120 x 70 cm. Pour commander, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `get_product {…a750} → Tapis de prière, in stock`
- **T2** C: « سمير بن علي » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Merci Samir ! Quel est votre numéro de téléphone pour la commande ? (ex : 0555123456) »
- **T3** C: « 0661234567 » · `fr` · 2.4 s (server 2.2 s)
  - AI: « Merci, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir le tapis de prière ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.1 s (server 3.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui » · `fr` · 6.3 s (server 6.0 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N7 — J03 playground (UI fr)
**Verdict: PASS — « Désolé, nous ne vendons pas de lunettes de soleil … » + 3 in-stock products, no hand-off; « oui » → « Quel article vous intéresse … ? », no order.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 7.8 s (server 7.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Nous avons notamment le sac à main cuir (noir ou marron, 6900 DA), la djellaba homme (7500 DA) et le tapis de prière (2800 DA). Merci Yacine, j'ai bien noté vos coordonnées : quel article vous intéresse ? »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)`
- **T2** C: « oui » · `fr` · 3.1 s (server 2.9 s)
  - AI: « Parfait, Yacine ! Quel article vous intéresse parmi ceux proposés : le sac à main cuir, la djellaba homme ou le tapis de prière ? »

### N12 — J04 playground (UI fr)
**Verdict: PASS — « ? » / « ... » → the question repeated; recap → « 👍 » → TEST-9479 1 950 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr` · 3.1 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait, le Hijab soie est en stock. Il coûte 1500 DA au lieu de 2000 DA, en soie douce, 180 x 70 cm. ⏎ Pour commander, à quel nom dois-je enregistrer la commande ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « ? » · `fr` · 1.9 s (server 1.7 s)
  - AI: « À quel nom dois-je enregistrer la commande ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr` · 1.9 s (server 1.7 s)
  - AI: « Merci Nadia, c'est noté. Dans quelle wilaya habitez-vous ? »
- **T4** C: « ... » · `fr` · 1.9 s (server 1.7 s)
  - AI: « Dans quelle wilaya habitez-vous, Nadia ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.0 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T6** C: « 👍 » · `fr` · 4.4 s (server 4.3 s)
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N14 — J03 playground (UI fr)
**Verdict: PASS — TEST-3146 → « non annule » → `cancel_order` → « Votre commande TEST-3146 a bien été annulée. » (simulated).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.9 s (server 4.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr` · 6.3 s (server 6.1 s)
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`
- **T3** C: « non annule » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Votre commande TEST-3146 a bien été annulée. Si vous souhaitez commander autre chose, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-3146","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-3146`

### N16 — J04 playground (UI fr)
**Verdict: PASS — « Ma nwasslouch l Illizi f had lwaqt … »; two `quote_delivery` calls for Illizi (home, then stop-desk — both `WILAYA_NOT_SERVED`, the first already says `stopdeskAvailable false`) (R15-3).**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 4.1 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma nwasslouch l Illizi f had lwaqt, ma 3andnach livraison l had wilaya. Wach men wilaya okhra t7ebb nwasslouk fiha ? »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED`

### N17 — J04 playground (UI fr)
**Verdict: PASS — « oui mais livrez à Alger … » → new recap Alger 400 DA, no order; « oui » → TEST-8063 1 900 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 8.9 s (server 8.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 7.9 s (server 7.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 6.2 s (server 6.0 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N18 — J03 playground (UI ar)
**Verdict: PASS (fields one per message: the Latin name alone in an Arabic chat) — Arabic kept, « Samir Benali » kept in Latin, street kept in Arabic; T1 the guard rewrote a confirm question before sending (`confirm_without_recap`, `AiRun` 01a1ec51-1a55…); T5 « ايه » → TEST-2274 8 200 دج.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 4.6 s (server 4.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام 👋 عندنا جلابة رجالي من صوف ناعم، لونها بيج ومقاسها واحد، بسعر 7500 دج بدل 9000 دج. تحب تشري هاد الجلابة ؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Samir Benali » · `ar` · 2.1 s (server 1.9 s)
  - AI: « صحيت يا سمير، تسجل. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 4.3 s (server 4.1 s)
  - AI: « صحيت، سجلت الرقم تاعك. واش من ولاية تحب نوصلوا لها الطلبية ؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.1 s (server 3.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T5** C: « ايه » · `ar` · 4.5 s (server 4.2 s)
  - AI: « تم تسجيل طلبيتك TEST-2274 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true, phoneConfirmed true} → ok TEST-2274, total 8200`

### N21 — J04 playground (UI ar)
**Verdict: PASS (R14-4) — fields one per message; T1 now ends on the next step (« … واش سميتك ؟ »; the guard stripped a Moroccan form and a confirm question); T4 recap; « 👍 » → TEST-6619 1 950 دج.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 5.9 s (server 5.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بسعر 1500 دج (بدل 2000 دج)، حرير ناعم ومريح، مقاسه 180 x 70 سم، وهو متوفر درك. واش سميتك ؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.3 s (server 2.1 s)
  - AI: « تشرفنا يا نادية! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية تاع الحجاب. »
- **T3** C: « 0661234568 » · `ar` · 1.9 s (server 1.6 s)
  - AI: « صحيت، تسجل. واش من ولاية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 5.4 s (server 5.2 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12، بوفاريك», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 6.1 s (server 5.9 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N23 — J03 playground (UI fr)
**Verdict: PASS — « ih bessah wasslouha l Oran … » → new arabizi recap Oran 600 DA, no order; « ih » → TEST-4704 8 100 DA.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 5.8 s (server 5.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 7.2 s (server 7.0 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 6.8 s (server 6.7 s)
  - AI: « Commande ta3ek TEST-4704 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …efdc, customerConfirmed true} → ok TEST-4704, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS — « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 × 3 450 دج, no order, no `check_availability` (R14-3); « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.9 s (server 3.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 7.0 s (server 6.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 6.4 s (server 6.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### A1 — J04 playground (UI ar)
**Verdict: PASS (fields one per message, as R13) — name, phone, wilaya asked one by one in darija; recap « شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر »; « ايه » → TEST-4104 1 900 دج.**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 7.7 s (server 7.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام، عندنا Hijab soie بسعر 1500 دج بدل 2000 دج، حرير ناعم بمقاس 180 x 70 سم، وهو متوفر. واش سميتك باش نسجلوه لك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « أمينة سعدي » · `ar` · 2.1 s (server 1.8 s)
  - AI: « صحيت أمينة، تسجل. واش هو رقم الهاتف تاعك؟ (مثال: 0555123456) »
- **T3** C: « 0698765432 » · `ar` · 2.0 s (server 1.8 s)
  - AI: « صحيت، تسجل. واش من ولاية تحب نوصلوهالك؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 4.2 s (server 4.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 5.5 s (server 5.2 s)
  - AI: « تم تسجيل طلبيتك TEST-4104 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → ok TEST-4104, total 1900`

### A3 — J03 playground (UI ar)
**Verdict: PASS (R13-2 again) — T1 no `check_availability` (R14-3), « زوج » kept, phone « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456; T2 no separator → recap « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; « ايه » → TEST-5126 6 300 دج.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 4.1 s (server 4.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت، تسجل: زوج Tapis de prière بسعر 2800 دج للقطعة. واش من ولاية تحب توصلك فيها الطلبية؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 7.2 s (server 7.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft c58c18… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 5.9 s (server 5.7 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

## Bugs

### R15-1 — Wilaya and commune given with the product: the street is asked with no price, no fee and no stop-desk choice (F5 T1, shared link)
- Page: shared test page `/fr/agent-test/<token>` (signed out, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: open the J04 shared test link (valid until 18/11 18:04); send « Salam, je veux la robe kabyle taille M, smiti Amina Saadi
  0698765432, wilaya Alger, Bab Ezzouar », then « rue des frères Bouadou n 5 », then « oui c'est bon ».
- Expected: once the wilaya is known and no street is given, the street asked with both fees and the stop-desk choice (« … 400 DA à
  domicile, ou … DA en stop-desk »), as the R14-2 fix does for the mode question (F1b / F1b2 this round) — and the product's price, as R12
  F5 T1 « Robe kabyle brodée taille M rahi disponible b 4900 DA. Wach howa l'adresse ta3ek f Bab Ezzouar … ? Wela t7ebb nwasslouha f
  stop-desk ? ».
- Actual (F5, 02:33:01–02:33:07): T1 no tool call (`AiRun` 01a1ec49-3f52…, `toolCallCount 0`, `guard_rewritten` `language_switch` — the
  model's first reply was rewritten into arabizi), reply « Salam Amina, rani ndir lek la robe kabyle brodée taille M. Wach howa l'adresse
  ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ? » (6.4 s / server 6.3 s) — **no price, no delivery fee, no
  stop-desk choice**. T2 the street → server recap (home 400 DA, 5 300 DA); T3 « oui c'est bon » → TEST-6890. The order is right; the
  customer committed to home delivery without being told the fee or offered the stop-desk.
- Evidence: .local/qa/journeys/R15/out/transcripts/F5.json T1 + F5.ui.txt · run1.log · .local/qa/campaign/retest-ai-r15/fr-F5-link.png ·
  `AiRun` 01a1ec49-3f52…, `AiToolCall` (out/toolcalls.txt: none at 02:33:05) · compare F1b2 T2 (`AiRun` 01a1ec4d-18f3…, `fee_missing`
  rewrite after a `quote_delivery`)
- Likely cause: `withBothFees` and the guard's `fee_missing` rule work from a `quote_delivery` made in the same turn; when the model asks the
  street without quoting (T1 here), there is no quote to complete and nothing flags the missing fee / stop-desk choice; the language
  rewrite then kept only the street question.

### R15-2 — Hand-off turns: no AI sentence for a person request, a generic sentence for a broken order
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: J04 › « Tester moi-même »: « Bonjour, je veux parler à quelqu'un » (H1), « salam, wsaltni la commande mkassra, nheb tredouli
  drahmi » (C2); J03 › « Tester moi-même »: « Bonjour, j'ai reçu ma commande cassée, je veux un remboursement » (C1), « السلام، نحب نهدر مع
  واحد من الفريق تاعكم » (H2).
- Expected: each hand-off turn carries one AI sentence in the customer's language that answers what they said (W1 now does), e.g. « Bien
  sûr, je vous mets en relation avec l'équipe » / « Désolé pour la commande abîmée, l'équipe va s'occuper du remboursement ».
- Actual:
  - H1 (02:32:10, `customer_request`, `AiRun` 01a1ec48-6755…) and H2 (02:37:53, `AiRun` 01a1ec4d-a54d…): AI text « » — the customer gets
    only the system line « Je transmets à un membre de l'équipe qui vous répondra très vite. » / « سأحوّلك إلى أحد أفراد الفريق ليرد عليك
    قريبًا. ».
  - C1 (02:37:44, `refund`, intent complaint, `AiRun` 01a1ec4d-8223…): « Merci pour votre message : l'équipe de la boutique va vous
    répondre. » — the same sentence as the wholesale request W1, no word on the broken order or the refund (C2 in arabizi says « sme7li 3la
    had lmochkil »).
  - On the J03 shop (out of hours), C1 / H2 show « Notre équipe est absente pour le moment … nous vous rappelons dès l'ouverture » then
    « … qui vous répondra très vite » in the same turn.
  - C2: an arabizi customer gets the hand-off system line in Arabic script (« سأحوّلك إلى أحد أفراد الفريق … ») — as the welcome line,
    configured texts have no arabizi version.
- Evidence: .local/qa/journeys/R15/out/transcripts/H1.json, H2.json, C1.json, C2.json (+ `.ui.txt`) · `AiRun.meta.turn` (reply,
  statusDetail) · screenshots fr-H1-pg.png, ar-H2-pg.png, fr-C1-pg.png, fr-C2-pg.png
- Likely cause: the platform-decided hand-off sends the model's text as is (empty on a bare request for a person) or a fixed fallback
  sentence; the system line is the shop's configured text, chosen without the opening-hours state.

### R15-3 — Small redundant lookups left
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run F1b, N16, N4; read the tool calls.
- Expected: no tool call whose result is already in the turn (R11-3 … R14-3).
- Actual (none changed the answer):
  - F1b T2 « Sétif, El Eulma » → `quote_delivery {Sétif}` → `fee 650, stopdeskFee 350`, then `quote_delivery {Sétif, isStopdesk true}` →
    the same 350 (`AiRun` 01a1ec4c-b2b2…, 2 calls).
  - N16 T1 « slm, tawsil l Illizi ? » → `quote_delivery {Illizi}` → `WILAYA_NOT_SERVED, stopdeskAvailable false`, then `quote_delivery
    {Illizi, stop-desk}` → the same refusal.
  - N4 T1 « Bonjour, je veux le tapis de prière » → `get_product` (the catalogue in the prompt already has it).
  - Gone since R14: the probe hand-offs (0 `handoff_to_human` in 99 turns), N5 T1 search + `get_product` ×2, F1d / A3 / N25
    `check_availability` (0 this round), search after a recap call (0 / 29).
- Evidence: .local/qa/journeys/R15/out/transcripts/F1b.json T2, N16.json T1, N4.json T1 · out/toolcalls.txt
- Likely cause: the quote's own `stopdeskFee` / `stopdeskAvailable` fields are not read as the stop-desk answer; `get_product` stays offered
  for a product named in the catalogue block.

### R15-4 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run N5, F5, F3, P2, N9, N18.
- Expected: plain Algerian darija / arabizi / French; a question answered; the customer's street as written.
- Actual:
  - N5 T1 « Bonjour, le parfum oud c'est combien ? » → « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez
    un cadeau avec du parfum, notre Coffret cadeau Aïd … est disponible à 24990 DA. » — the asked price (3 200 DA) is no longer given (R14
    « Son prix est de 3200 DA »), and the reply ends with no question.
  - F5 T3 « oui c'est bon » → « Votre commande TEST-6890 est bien enregistrée ✅ … » in French right after the arabizi recap « … Ktebli
    « ih » bach nconfirmi … » (`AiRun.meta.language` arabizi / arabizi / fr) — the customer's French words, but the order's two last
    messages are in two languages.
  - F3 T4 recap street « Cité 20 Août, villa 3 » for the customer's « cite 20 aout villa 3 » (comma and accents added; the order keeps
    « Cité 20 Août villa 3 »).
  - French inside arabizi: P2 T1 « Lmqasat li kaynin **sont S et M a** 4900 DA, **et** XL a 5200 DA », « **parfaite pour** l3rass »; F5 T1
    « rani ndir lek » (« I am making it for you ») for a product not yet ordered; F3 T1 « Bach ngoulou commande bsmek ».
  - The reply guard still strips / rewrites a Moroccan form the model wrote (P2 T1, P2b T1 in its retry, N9 T1, N21 T1) —
    nothing Moroccan reached the customer (R14: 6).
  - Fixed since R14-4: F9 closing « T7ebb nwarrik produit ? » (now ends on the facts), N5 server line now « … à la place, ce récapitulatif
    est pour le produit Coffret cadeau Aïd. », W1 AI sentence, N21 T1 ends with « واش سميتك ؟ », A3 T1 « الكمية 2 من … والمنتج متوفر » now
    « صحيت، تسجل: زوج Tapis de prière بسعر 2800 دج للقطعة », « تابيس » gone, N3 « 2 à 5 jours » now « ywasel f 2 l 5 ayam ».
- Evidence: .local/qa/journeys/R15/out/transcripts/N5.json T1, F5.json T3, F3.json T4–T5, P2.json T1, F3.json T1 · `AiRun.meta.guard`
  (out/airun.txt)
- Likely cause: free model wording; the confirmation template follows the last message's language.

## Retest
- RETEST R14-1: fixed — P2 ×2 with the exact R14 messages: T2 « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères
  Bouadou n 5 » detected `arabizi` (R14 `fr`) → « Hada récap ta3 la commande … Ktebli « ih » bach nconfirmi la commande … »; T3 « ih »
  detected `arabizi` → « Commande ta3ek TEST-1158 tsajlet ✅ … Saha, merci 3la thiqa ta3ek! » (both runs). Same family: F5 T2 on the link (a
  French-worded street alone) kept arabizi; N4 T2 (a name in Arabic script alone in a French chat) kept French; N18 T2 (a Latin name alone
  in an Arabic chat) kept Arabic. Left: F5 T3 « oui c'est bon » (French words) → French confirmation → R15-4.
- RETEST R14-2: fixed on its flow — F1b (R14 messages) T2 « Sétif, El Eulma » → « Les frais sont de 650 DA à domicile ou 350 DA en stop-desk,
  … Vous préférez être livré à domicile ou en stop-desk ? »; F1b2 (T1 « Je voudrais … ») T2 the model's reply rewritten by the guard
  (`fee_missing`) → « … 650 DA à domicile, ou 350 DA en stop-desk … (donnez-moi la rue ou la cité) ou en stop-desk ? » (9.7 s, the turn pays
  a retry). N3 T2 now gives both fees too. Left in the family: a plain street question with no quote this turn (F5 T1 on the shared link) →
  R15-1.
- RETEST R14-3: fixed — **0 `handoff_to_human` call in 99 turns, 0 refused probe**: N9 T1 (same message) no tool call at all, 9.3 s (R14
  15.7 s, 3 calls + a refused `complaint`); N11 T3 (same message) `lookup_order` only (R14 + a refused `customer_request`). The real cases
  are hand-offs: C1 fr « commande cassée … remboursement » and C2 arabizi « la commande mkassra, nheb tredouli drahmi » (`refund`, intent
  complaint), H1 fr « je veux parler à quelqu'un » and H2 « نحب نهدر مع واحد من الفريق » (`customer_request`), W1 wholesale (`off_catalogue`)
  — status HANDOFF each. Repeated lookups: N5 T1 no tool (R14 search + `get_product` ×2, 10.5 s → 3.4 s), A3 T1 and N25 T2 no
  `check_availability`, F1b T1 one search; left: F1b T2 / N16 T1 second `quote_delivery`, N4 T1 `get_product` → R15-3. Slowest turn of the
  round 9.8 s (R14 15.7 s).
- RETEST R14-4: mostly fixed — F9 closing gone, N5 server line with the article, W1 one AI sentence (« Merci pour votre message : l'équipe
  de la boutique va vous répondre. »), N21 T1 ends on the next step, A3 T1 / A3b « الكمية 2 من » / « تابيس » gone. Left: the hand-off turns
  for a person have an empty AI text, C1's sentence is generic → R15-2; French inside arabizi, Moroccan forms still stripped by the guard
  (4 replies), N5 T1 price no longer given → R15-4.
- R1–R13 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 23 orders**; N7 « oui » and N5 T3 « oui » to
  a question → no order; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; one order per « oui »: 23 orders, never two for one
  « oui », none lost after a recap; **R4-1 / R11-2 / R13-1 (no hand-off on an order / field / yes message, nor for a product sold or not
  sold) holds — 0 hand-off outside the 5 real requests and F11 (blocked, server)**; R4-2 (a name in another script keeps the language)
  holds — N4, F3, N18 (names sent alone this time); language kept holds (R14-1 fixed); R4-4 / R6-1 (no model sentence asking to confirm in
  front of the recap) holds — 29 / 29; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) holds — 0 in 99 turns (2 stripped
  by the guard); R4-8 (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5, N7, P2, N9; R5-2 (no Tunisian /
  Moroccan forms sent) holds (guard ×4); R5-4 (no « home or stop-desk ? » after a street) holds — F1b / F1b2 asked it before any street;
  R5-5 / R7-5 (delivery question answered with the fee) holds — F9, F12, N16, N3; R5-6 (no `create_order` before a phone) holds — 0 / 53;
  R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 29 / 29; R7-2 (no photo said) holds — N9; no invented discount
  (catalogue old prices, Oran free delivery from the shop's rule); N11 tracking from `lookup_order`, no invented number or date; R8-3
  (named variant) holds; R9-1 (Latin name in an Arabic chat) holds — N18; R10-1 (latency) — max 9.8 s, 0 turn ≥ 10 s, 0 page re-send;
  R11-5 (no provider error) holds — 0 / 99; R12-1 (no `VALIDATION wilayaId`) holds — 0 refusal in 53 calls; R13-3 (Arabic street kept)
  holds — N11, N18, N21, N25, A1, A3; R13-5 (substitute line) holds and N5 now reaches its order (TEST-3157).

## Coverage
- Order flows to « oui »: French ×10 (F1b, F1b2, N5, F1, F6, N1, N4, N12, N14, N17; F11 blocked), Arabic-script darija ×6 (N11, N18, N21,
  N25, A1, A3), arabizi ×7 (P2, P2b, N9, F3, N23, N3 after a switch, F5 mixed fr / arabizi on the shared link); no order, rightly: N7
  (nothing chosen), F9, N16, F12 (delivery questions only), C1, C2, H1, H2, W1 (team).
- Asked this round: P2 ×2, F1b ×2, N9, N11, two real complaints (fr, arabizi), two real requests for a person (fr, Arabic script), W1, N5 to
  its order, F5 and F12 on the shared link, the sweep F1, F3, F6, F9, F11, N1, N3, N4, N7, N12, N14, N16, N17, N18, N21, N23, N25, A1, A3
  (F1, F3, N4, N18, A1 with each field in its own message); latency of every turn.
- Also: « oui mais … » in three scripts (N17, N23, N25), a product not sold (N7), « ? » / « ... » (N12), a cancel after the order (N14,
  simulated), a wilaya not served (F9, N16), commune-only address → mode question with both fees (F1b ×2), photo request (N9), out-of-stock
  product with a substitute to the order (N5), free delivery threshold (N5, 24 990 DA to Oran), a blocked number (F11), out-of-hours shop.
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout; shared link valid (probe 02:19).

## Not tested
- The shared link beyond F5 / F12 (the visitor response has no tool calls; they were read from `AiToolCall`).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`). The live Messenger path (no page
  connected), so the hand-offs of C1 / C2 / H1 / H2 / W1 on a real conversation (inbox assignment, notification) were not seen.
- F6, N1, N14, N17, N23, N25 with their fields one per message (they test a change or a cancel; one message carries all fields as in R14);
  N7's second « oui »; an angry message (`angry` reason) — not in the list.
- `cancel_order` / `lookup_order` on a real order with a courier and a tracking number; a product that HAS photos in a photo request; the
  stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-1158 (P2, P2b), TEST-6890 (N9, F5), TEST-4074 (N11), TEST-3157 (N5),
  TEST-9479 (N12), TEST-8063 (N17), TEST-6619 (N21), TEST-6971 (N25), TEST-4104 (A1), TEST-6313 (F1b), TEST-1506 (F1b2), TEST-1918 (F1),
  TEST-1845 (F3), TEST-2670 (F6), TEST-5759 (N1), TEST-1619 (N3), TEST-1344 (N4), TEST-3146 (N14 — then cancelled, simulated), TEST-2274
  (N18), TEST-4704 (N23), TEST-5126 (A3); F11 refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (P2 / P2b, N9 /
  F5; R14's TEST-1158, TEST-6890, TEST-4074, TEST-9479, TEST-8063, TEST-6619, TEST-6971, TEST-4104, TEST-6313, TEST-1506, TEST-5759, TEST-1344,
  TEST-3146, TEST-4704, TEST-5126 again).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:playground:*` TTL / count, `AiRun` rows since 01:25 UTC
  (out/airun.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (out/api-lines.txt); nothing written.
- Hour counters (read-only): before the run J04 46 / 60 (TTL 699 s), J03 54 / 60 (TTL 1 082 s) — waited for expiry; after the run J04 49 / 60
  (window from 02:30:16), J03 50 / 60 (window from 02:36:37); no 429. Messages used: 99 / 100.
