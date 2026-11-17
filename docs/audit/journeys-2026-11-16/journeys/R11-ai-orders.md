# R11 — Eleventh retest of the AI order-taking (after the R10 fixes) — live site, deployed commit 7a72e24 — 17/11/2026 22:29–22:47 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 7a72e24 (checked read-only: `git log --oneline -1` = « 7a72e24 fix(ai): live retest R10 —
playground re-sends a slow turn with a turnKey (one job, counted once) + Server-Timing, no confirm question without a server recap on any
turn, no « bien noté » for an unavailable product, fewer probe tools, narrow wording fixes »; `djaber-v2-api` / `djaber-v2-worker` online,
restarted 22:21:47). The web build on Vercel carries the R10-1 change: every turn request of the run had a `turnKey` in its body and every
200 answer a `Server-Timing` header. Same two own shops as R1–R10: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language
FR) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Same surfaces: step 5 › « Tester moi-même » (playground, tool
calls visible) and the shared test link (`/agent-test/<token>`, no tool calls in the visitor response). The R7 links were still valid — «
Lien valable jusqu'au 18 nov. 2026 18:04 » on both shops (probe without a message, 22:28), no new link. One browser at a time, the runs one
after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place. The 60 / h counters were read before the
run (read-only, Redis `SCAN` `rl:playground:*`): no key on either shop (the R10 windows had expired). J04 flows 22:29:21–22:34:37, J03 flows
22:34:42–22:40:56, the two R10-1 probes 22:42:38–22:44:07 (J04), three re-runs 22:44:36–22:46:40 (J03, J04). No 429. The J03 shop was outside
its opening hours: every J03 conversation starts with the shop's « out_of_hours » system line — configured text, not an AI reply.

**Latency method (R10-1).** The R10 script was extended (`conv.mjs`): every POST of a turn is recorded from the page (`turnKey` of the body,
sent / ended time, `requestfinished` or `requestfailed` (abort), status, the `Server-Timing` header, the browser timing `responseStart` /
`responseEnd`), and the turn time is taken **when the answer block appears on the page** (a new `playground-turn` / `playground-error` in
the thread), not when the response arrives. Server side, read-only: the API's « playground turn answered » log line per turn (`runMs`,
`waitMs`, `totalMs`, `replayed`) and the `AiRun` rows (`startedAt`, `finishedAt`, `latencyMs`, `status`, `error`). Two probes force the
R10-1 situation from the browser (`lat.mjs`, Playwright `page.route`): **stall** — the turn's first request reaches the server but its
answer is held back 40 s, so the page must re-send; **dup** — the same request (same `turnKey`) is sent a second time 1.5 s later while the
first runs, and a third time once both are done.

**96 customer messages** (J04 shop 43, J03 shop 53; 1 re-send after a 503 in F8; 4 budget left), 29 conversations: N5 first; the 10 R9 flows
R10 skipped — F1b, F3b (link), F5 (link), F8, F8b, N3, N5b, N7, N10, N13 — each to its final « oui » (F8b and N13 with the « oui » R9 left
out, N7 with a second « oui »); N4, N11, N18, N21, N9, F11; the three R10-1 slow flows N1, F1, F6 and N5c, N17 again; new N25 (Arabic-script
« ايه بصح … » with a change — R10's « Not tested »); the two R10-1 probes L1 (playground: dup on the recap turn, stall on the « oui ») and L2
(shared link: stall); re-runs F1b ×2, N7, N21 to see whether their first-run findings come back. Scripts
`.local/qa/journeys/R11/scripts/` (conv.mjs = the R10 script + request / page timing; lat.mjs = conv.mjs + the stall / dup probes; convs.json;
render.cjs; check.cjs; lat-table.cjs; probe-link.mjs; run.sh), transcripts with every attempt, tool call and result
`.local/qa/journeys/R11/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen, `.log.json` = kit log), run logs
`.local/qa/journeys/R11/out/run1.log` (J04), `run2.log` (J03), `run3.log` (L1, L2), `run4.log` (F1b2, N7b, N21b), `run5.log` (F1b3), rendered
turns `out/render.md`, screenshots `.local/qa/campaign/retest-ai-r11/`.

Cases asked for this round:
- **R10-1 latency** — the time of every turn from send to the answer on the page, the `Server-Timing` header, any re-send of the page (same
  `turnKey` ⇒ one AI run, counted once in the 60 / h, never two answers).
- **N5** — out-of-stock « je le prends » ⇒ no « bien noté », no confirm question without a recap, an in-stock alternative offered.
- **F1b, F3b, F5, F8, F8b, N3, N5b, N7, N10, N13** complete with their final « oui »; **N4, N11, N18, N21, N9** (probe / wording fixes),
  **F11** (blocked phone).
- Every R1–R10 guarantee: no order without a server recap (Critical), one order per « oui », a « oui » with a change gives a new recap, no
  `create_order` before a phone, language kept, no hand-off on a field / yes message, no invented discount, tracking from the tool, no model
  sentence asking to confirm before the recap.

**Result: 27 / 29 conversations pass** — R9 / R10 flows 23 / 25 (F1b and N7 fail on their first run, pass on the re-run), new flows 4 / 4
(N25, L1, L2 and the N21b re-run). **Latency: median 5.4 s, p90 8.5 s, slowest natural turn 14.3 s (N17 T2, server 11.9 s); 0 turn above
15 s, 0 page re-send in the 93 turns that were not probes; every 200 answer carried `Server-Timing`; page − server total median 0.25 s, max
4.2 s.** The two stall probes were answered at 20.2–20.3 s by the page's re-send with the same `turnKey` (server `replay`, 5–8 ms), one AI
run, counted once, one answer, one order (L1 TEST-2029); the dup probe gave one AI run and the same turn three times. R10-1's 1–4 minute
waits did not come back. **0 order without a server recap; 24 TEST orders, each from a « oui / ih / ايه / 👍 / oui c'est bon » to a server
recap, exactly one each, with the recap's items, fee and total; 0 « oui » to a server recap lost; F11 « oui » refused as blocked; 2 « yes »
with a change (N17 fr, N25 Arabic script — new) → a new recap, 0 order; 0 `create_order` before a phone in 52 calls; 30 server recaps, all in
the customer's language; 0 Markdown; 0 invented discount (N10), tracking from `lookup_order` (N11).** Failures: F1b — a malformed
`create_order` → `VALIDATION items` → the model asks « Pouvez-vous confirmer pour que je passe la commande ? » without a recap, the « oui »
gets the recap only (R11-1, Major — R10-2's class through another door); N7 — an accepted `handoff_to_human {off_catalogue}` on « vous avez
des lunettes de soleil ? » with full order details: visible hand-off (R11-2, Major). Issues: `handoff_to_human` probes back (5 refused) +
`lookup_order {}` on a name message (R11-3); one recap address in the wrong order (R11-4); the first provider error since R1 (F8 T1 503,
`malformed_output:schema:reply`, R11-5); wording left (R11-6).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| N5 | J04 · playground | fr, out of stock « je le prends » | T2 « … en rupture de stock …, donc je ne peux pas le commander » + Coffret offered, no tool; « oui » → recap; « oui » → TEST-3157 24 990 DA | T3 10.6 s / 8.7 s | yes, 1 | PASS (R10-2 fixed here) |
| F1b | J03 · playground | fr, fields over 3 messages | T3 `create_order {items: a code string}` → `VALIDATION items` → « Pouvez-vous confirmer pour que je passe la commande ? » (no recap); T4 « oui, c'est bien … » → recap, no order | T3 10.8 s / 10.5 s | no (flow ended at the recap) | FAIL — R11-1 |
| F1b2 | J03 · playground | fr (re-run of F1b) | street asked; recap at T3 → « oui, c'est bien … » → TEST-6293 7 550 DA; T2 `handoff_to_human` probe refused | T2 7.3 s / 7.0 s | yes, 1 | PASS (R11-3) |
| F1b3 | J03 · playground | fr (re-run of F1b) | same path as F1b2 → TEST-6293; T2 `handoff_to_human` probe refused | T1 7.3 s / 7.1 s | yes, 1 | PASS (R11-3) |
| F3b | J03 · shared link | arabizi, photo + 2 tapis | « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt »; arabizi recap → « ih » → TEST-1493 6 050 DA | T2 7.6 s / 7.5 s | yes, 1 | PASS |
| F5 | J04 · shared link | mixed fr / arabizi | street asked (stop-desk offered); recap → « oui c'est bon » → TEST-6890 5 300 DA | T1 5.6 s / 5.3 s | yes, 1 | PASS |
| F8 | J03 · playground | fr, 8-digit phone | T1 503 (R11-5), re-sent → answer; « 05559876 » → 10 digits asked; recap → « oui » → TEST-3146 7 950 DA | T4 5.6 s / 5.4 s | yes, 1 | PASS (R11-5, R11-3) |
| F8b | J03 · playground | fr, 8-digit phone in the first message | phone re-asked; recap → « oui » (left out in R9) → TEST-2192 7 950 DA | T2 7.2 s / 3.7 s | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | « Ih, nwasslou l Constantine, f 2 l 5 ayam. » + arabizi recap → « ih saha » → TEST-7010 6 300 DA; T1 `lookup_order {}` probe | T2 9.2 s / 8.9 s | yes, 1 | PASS (R11-3) |
| N5b | J04 · playground | fr, in-stock product, back later | « je la prends » = Djellaba → recap → « oui » → TEST-8008 8 100 DA | T3 4.3 s / 4.2 s | yes, 1 | PASS |
| N7 | J03 · playground | fr, product not sold + details | `handoff_to_human {off_catalogue}` **accepted** → « Je transmets à un membre de l'équipe … »; « oui » ×2 → « Quel article vous intéresse … ? », no order | T1 9.5 s / 8.0 s | no (right: nothing chosen) | FAIL — R11-2 |
| N7b | J03 · playground | fr (re-run of N7) | no hand-off; Sac à main cuir offered; « oui » ×2 → « noir ou marron ? », no order | T1 5.9 s / 5.7 s | no (right) | PASS |
| N10 | J03 · playground | fr — « trop cher » / « quand même » | no discount, no free delivery; « Merci Karim ! » + recap → « oui » → TEST-9004 16 550 DA | T4 8.5 s / 5.7 s | yes, 1 | PASS |
| N13 | J04 · playground | fr — two questions | 12 500 DA + Oran 600 / 400 DA in one reply; « en 42 » → recap → « oui » (left out in R9) → TEST-2203 13 100 DA | T1 6.4 s / 6.1 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script | « سمير بن علي » kept, French kept; **no tool on the name turn**; recap → « oui » → TEST-1344 3 250 DA | T4 8.5 s / 6.5 s | yes, 1 | PASS (R10-3 fixed here) |
| N11 | J04 · playground | darija, Arabic script — tracking | TEST-4074; `lookup_order {}` only (no `cancel_order` probe) → « ما خرجتش للتوصيل بعد … ما عندهاش رقم تتبع درك » | T1 6.3 s / 6.0 s | yes, 1 | PASS (R10-3 fixed here, R11-6) |
| N18 | J03 · playground | Arabic script — Latin name | Arabic recap « الاسم: Samir Benali » → « ايه » → TEST-8849 | T1 7.0 s / 6.8 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, 👍 | T1 price fixed; T2 `handoff_to_human` probe refused; recap address « البليدة، بوفاريك، حي الورود رقم 12 » (R11-4) → « 👍 » → TEST-6619 | T5 6.0 s / 5.8 s | yes, 1 | PASS (R11-3, R11-4) |
| N21b | J04 · playground | Arabic script (re-run of N21) | recap « حي الورود رقم 12، بوفاريك، البليدة » → « 👍 » → TEST-6619; no probe | T4 5.3 s / 5.0 s | yes, 1 | PASS |
| N9 | J04 · playground | arabizi — photo + details | « Ma 3andnach tsawer ta3 la robe f had lwa9t » + fabric, sizes; recap (M) → « ih » → TEST-6890 5 300 DA | T1 8.5 s / 8.2 s | yes, 1 | PASS (R11-6) |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici … », no TEST-n | T2 7.7 s / 7.5 s | no (refused, as expected) | PASS |
| N1 | J03 · playground | fr, change after the recap (R10-1 slow flow) | sac « (Marron) », Oran → new recap → « oui » → TEST-3924 7 500 DA | T2 7.2 s / 6.9 s (R10: 223.6 s) | yes, 1 | PASS (R10-1) |
| F1 | J03 · playground | fr (R10-1 slow flow) | name → phone + address → recap « (Marron) » → « oui » → TEST-6313 7 550 DA; one search only | T4 4.8 s / 4.6 s (R10 T3: 104.7 s) | yes, 1 | PASS (R10-1, R10-3) |
| F6 | J03 · playground | fr (R10-1 slow flow) | recap; 2 → 3 tapis → new recap → « oui » → TEST-2340 9 100 DA | T3 6.1 s / 5.8 s (R10: 71.0 s) | yes, 1 | PASS (R10-1) |
| N5c | J04 · playground | fr, « oui » to a suggestion | Oud out of stock → Coffret « Voulez-vous que je le commande ? » → « oui » → recap → « oui » → TEST-1709 24 990 DA | T2 8.8 s / 8.6 s | yes, 1 — after the recap | PASS |
| N17 | J04 · playground | fr — « oui mais livrez à … » | recap Blida → « oui mais livrez à Alger … » → **new recap, no order** → « oui » → TEST-8063 (Alger) | **T2 14.3 s / 11.9 s** (slowest) | yes, 1 — after the new recap | PASS |
| N25 | J04 · playground | Arabic script — NEW « ايه بصح ديرلي جوج » | recap 1 × → **new recap 2 ×, 3 450 دج, no order** → « ايه » → TEST-6971 | T2 6.6 s / 6.4 s | yes, 1 — after the new recap | PASS |
| L1 | J04 · playground | fr — NEW R10-1 probes | T1 dup (same `turnKey` ×3): one AI run, same turn, counted once; T2 « oui » stalled 40 s: page re-sent at 20.0 s, `replay` 8 ms → TEST-2029, one order | T2 20.3 s / 0.0 s (replay) | yes, 1 | PASS (R10-1) |
| L2 | J04 · shared link | fr — NEW R10-1 stall on the link | answer held 40 s: page re-sent at 20.1 s, `replay` 5 ms, « Oui, on livre à Blida … 450 DA … 300 DA … » | T1 20.2 s / 0.0 s (replay) | — | PASS (R10-1) |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **24 / 24** (F1, F1b2, F1b3, F3b, F5, F6, F8, F8b, L1, N1, N3,
  N4, N5, N5b, N5c, N9, N10, N11, N13, N17, N18, N21, N21b, N25) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.**
  **« oui » to a correct recap lost: 0.** One « oui » after a change: **4 / 4** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N25
  quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 7 / 7** — F1b T4 (after a model question, R11-1 → the recap), N5 T3 (« oui »
  to « je peux préparer la commande … » → the recap), N5c T2 (« oui » to « Voulez-vous que je le commande ? » → the recap), N7 T2 / T3, N7b
  T2 / T3 (« oui » to « which one? » → the question again).
- **« yes » with a change → a new recap, no order: 2 / 2** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…) and **N25 T2 (Arabic script « ايه بصح ديرلي جوج ماشي واحد » → 2 × Hijab soie, 3 450 دج, core 1e692b…)**; each next « oui » / « ايه »
  → the order with the new recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **3 / 3** — N1 « Cité 1000 logements bloc 4, Bir
  El Djir, Oran », F8b « Cité 20 août, villa 3 », N21 « حي الورود رقم 12 » (recap call « البليدة، بوفاريك، حي الورود رقم 12 », R11-4).
- **Confirming calls refused: 0** — the 22 playground confirming calls + F11 all carried name, phone, wilaya, commune, address, items and
  `customerConfirmed true`; the one `VALIDATION` of the run (F1b T3) was a recap call with `items` sent as a string (R11-1).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **30 / 30**, the named variant every
  time (F1, F1b2, F1b3, N1 Marron; N9, F5 M; N13 42); **in the customer's language 30 / 30** — Arabic script N11, N18 (Latin name), N21,
  N21b, N25 ×2; arabizi F3b, N3, N9; French 21.
- **Server recap without a model sentence asking to confirm or describing the order: 30 / 30** — lead-ins left: « Merci Karim ! » (N10),
  « Ih, nwasslou l Constantine, f 2 l 5 ayam. » (N3, the answer to « twasslou l Constantine ? »). **Outside any recap: 1** model request to
  confirm — F1b T3 « Pouvez-vous confirmer pour que je passe la commande ? » (R11-1); 0 « problème technique », 0 « le récapitulatif va
  venir ».
- **Recap address « …, commune, wilaya »: 29 / 30** — N21 T4 « البليدة، بوفاريك، حي الورود رقم 12 » (R11-4); N21b (same messages) right.
- **Customer's name as written: 29 / 29 conversations** — Arabic script kept in a French chat (N4 « سمير بن علي »), Latin kept in an Arabic
  chat (N18 « Samir Benali »), 0 name asked again once given.
- **Photo request answered « no photo »: 2 / 2** — F3b (link), N9; **photo announced without a photo: 0**.
- **Delivery question answered with the fee: 3 / 3** — N13 (Oran 600 / 400 DA, with the price), L2 (link, Blida 450 / 300 DA), N3 (« Ih,
  nwasslou l Constantine » + the recap's 700 DA); commune only → street asked 3 / 3 (F1b2, F1b3, F5).
- **`create_order` before a phone is in the customer's messages: 0 / 52 calls.**
- No hand-off on a field / order / yes message: **broken once — N7 T1 (R11-2)**; besides it only F11 (blocked, expected). Refused
  `handoff_to_human` probes: 5 (R11-3), none visible.
- No 503 / provider error: **1 / 96 turns** — F8 T1 (R11-5), the turn given back to the hour's budget, the re-send answered.
- Latency: **median 5.4 s, p90 8.5 s, max 14.3 s on the 92 answered turns that were not probes** (N17 T2 14.3 s, F1b T3 10.8 s, N5 T3 10.6 s, N5 T4 10.3 s, N17 T1
  9.8 s); `AiRun` of the run: 96 rows, median 4.7 s, max 11.9 s; API « playground turn answered » lines: 99 (95 turns + 4 replays), 0 « did
  not finish ».
- Quantity never asked again after a product is named: **0 quantity question in 96 turns** (« jouj », « 2 tapis », « 1 seul », « ديرلي
  جوج » kept).
- Language kept: arabizi **3 / 3** (F3b, N9, N3 after the switch), Arabic-script darija **5 / 5** (N11, N18, N21, N21b, N25), French **20 /
  20**, mixed fr / arabizi F5 as in R9.
- **No Tunisian / Moroccan words: 29 / 29** — check.cjs word list: 0 hit.
- Out-of-stock product offered: **0** — N5 / N5c name the Parfum Oud only because the customer asked for it; alternatives in stock
  (Coffret); N13 « la 41 est en rupture » named, not offered.
- No Markdown in a reply: **96 / 96**.
- Tool calls in 96 turns (link turns carry none): `create_order` 52 (28 recaps + 22 orders + F11 blocked +
  F1b T3 `VALIDATION`; the 2 link recaps and 2 link orders carry no tool calls), `search_products` 11, `quote_delivery` 9, `handoff_to_human` 6 (N7 accepted, 5 refused), `lookup_order` 2 (N11
  asked; N3 probe), `get_product` 1; **0 `cancel_order`, 0 `add_faq_candidate`** (R10-3's forms gone).

## Conversations
Format: customer message · detected language (playground only) · time from send to the answer on the page (server `total` from `Server-Timing`; « N attempts » = the page re-sent the same turnKey) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Shared-link turns carry no tool calls (visitor response). Every J03 conversation has the « out_of_hours » system line.

### N5 — J04 playground (UI fr)
**Verdict: PASS (R10-2 fixed here) — Oud out of stock → Coffret offered; T2 « je le prends » + details → « … en rupture de stock …, donc je ne peux pas le commander » + the Coffret offered, no tool (no `create_order` on the Oud); « oui » → server recap (gratuite, 24 990 DA); « oui » → TEST-3157. T3 / T4 10.6 / 10.3 s (server 8.7 / 7.5 s).**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 6.7 s (server 3.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonjour 👋 Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. Voulez-vous que je vous donne plus de détails ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 5.3 s (server 3.4 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment, donc je ne peux pas le commander. Merci Karim, j'ai bien noté vos coordonnées. Si le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) à 24990 DA vous intéresse, je peux préparer la commande avec ces mêmes informations. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T3** C: « oui » · `fr` · 10.6 s (server 8.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T4** C: « oui » · `fr` · 10.3 s (server 7.5 s)
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### F1b — J03 playground (UI fr)
**Verdict: FAIL — R11-1 — T2 `handoff_to_human` probe refused (R11-3); T3 the street → `create_order` with `items` sent as a code string → `VALIDATION items` → « … Pouvez-vous confirmer pour que je passe la commande ? » without a recap; T4 « oui, c'est bien … » → the server recap, no order; the flow (4 messages) ended at the recap.**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 3.2 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en marron (6900 DA) est bien noté, c'est du cuir véritable. Dans quelle wilaya habitez-vous ? »
- **T2** C: « Sétif, El Eulma » · `fr` · 8.7 s (server 8.4 s)
  - AI: « Parfait, El Eulma à Sétif est bien noté. La livraison à domicile coûte 650 DA, et en stop-desk 350 DA, avec un délai de 2 à 5 jours. Vous préférez être livré à domicile (donnez-moi la rue, la cité ou un repère) ou en stop-desk ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350` · `handoff_to_human {unclear_streak, evidence «Sétif, El Eulma»} → HANDOFF_NOT_NEEDED`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 10.8 s (server 10.5 s)
  - AI: « Parfait Karim, j'ai noté : Sac à main cuir Marron, 1 pièce, livraison à domicile à Cité 500 logements bloc 12, El Eulma (650 DA). Pouvez-vous confirmer pour que je passe la commande ? »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items (a string) «[{"productId": "01a1e54f-9efa-72b8-8949-a68fb6dca3f6".replace("01a1e54f-9efa-72b8-8949-a68fb6dca3f6","01a1e54f-a0b9-7ae5-8971-96c0cc39d155"), "variantId": "01a1…», customerConfirmed true} → VALIDATION items`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.7 s (server 4.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`

### F1b2 — J03 playground (UI fr)
**Verdict: PASS (R11-3) — re-run of F1b: T2 fee 650 / 350 DA and « domicile ou stop-desk ? » (no street yet); T3 the street → server recap « (Marron) » → T4 « oui, c'est bien … » → TEST-6293 7 550 DA. T2 `handoff_to_human {customer_request, evidence «unused»}` refused.**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 2.8 s (server 2.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Très bon choix, le sac à main cuir en marron est disponible à 6900 DA. Merci Karim ! Dans quelle wilaya habitez-vous ? »
- **T2** C: « Sétif, El Eulma » · `fr` · 7.3 s (server 7.0 s)
  - AI: « Parfait Karim, on livre à El Eulma (Sétif) : 650 DA à domicile ou 350 DA en stop-desk, en 2 à 5 jours. Vous préférez être livré à domicile ou en stop-desk ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«sac à main cuir marron»} → 1 product(s)` · `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `handoff_to_human {customer_request, evidence «unused»} → HANDOFF_NOT_NEEDED`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.2 s (server 3.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.6 s (server 4.3 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F3b — J03 shared link (UI fr)
**Verdict: PASS — shared link: « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt » + « tsajjel jouj (2) tapis » (quantity kept), wilaya asked; arabizi recap → « ih » → TEST-1493 6 050 DA.**

- **T1** C: « sifetli tsawer ta3 tapis de prière, nheb nechri jouj, smiti Walid Bouzid 0770112244 » · 4.2 s (server 3.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Ma 3andnach tsawer ta3 tapis de prière f had lwaqt, bessah howa tapis molletonné 120 x 70 cm à 2800 DA. Saha Walid, tsajjel jouj (2) tapis. Wach men wilaya ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « Blida, Boufarik, cite 20 aout villa 3 » · 7.6 s (server 7.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « ih » · 5.0 s (server 4.8 s)
  - AI: « Commande ta3ek TEST-1493 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F5 — J04 shared link (UI fr)
**Verdict: PASS — shared link, mixed fr / arabizi as the customer wrote: street asked after « Bab Ezzouar » (stop-desk offered, no street given yet); street → server recap alone → « oui c'est bon » → TEST-6890 (as R8 / R9).**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.6 s (server 5.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Parfait Amina, la robe kabyle brodée taille M kayna f stock b 4900 DA. Wach men adresse exacte f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ? Wela t7ebb nwasslouha f stop-desk ? »
- **T2** C: « rue des frères Bouadou n 5 » · 4.3 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T3** C: « oui c'est bon » · 3.8 s (server 3.5 s)
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F8 — J03 playground (UI fr)
**Verdict: PASS (R11-5, R11-3) — T1 503 `AI_PROVIDER_ERROR` (`malformed_output:schema:reply`), « L'IA n'a pas répondu … Réessayez. », not counted; the same message re-sent (T2) → answer; « 05559876 » → « Il manque un chiffre … » (+ a refused `handoff_to_human` probe); corrected phone + address → recap → « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux la djellaba. Yacine Mansouri » · 5.2 s
  - **503 AI_PROVIDER_ERROR** ref `f269ee75-100b-4da4-9b76-225c39300662` (5222 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »
- **T2** C: « Bonjour, je veux la djellaba. Yacine Mansouri » · `fr` · 3.2 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Yacine ! La djellaba homme en laine fine, beige, taille unique, est à 7500 DA (au lieu de 9000 DA). Pour continuer la commande, quel est votre numéro de téléphone ? (ex : 0555123456) »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T3** C: « 05559876 » · `fr` · 3.2 s (server 2.9 s)
  - AI: « Il manque un chiffre : le numéro doit avoir 10 chiffres, par exemple 0555123456. Pouvez-vous me le redonner complet ? »
  - tools: `handoff_to_human {customer_request, evidence «05559876»} → HANDOFF_NOT_NEEDED`
- **T4** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T5** C: « oui » · `fr` · 5.8 s (server 5.5 s)
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F8b — J03 playground (UI fr)
**Verdict: PASS — 8-digit phone in the first message → « Le numéro donné semble incomplet … »; corrected phone + address → recap « Cité 20 août, villa 3, Boufarik, Blida » → « oui » (left out in R9) → TEST-2192 (confirming call address reworded, order from the stored recap).**

- **T1** C: « Bonjour, je veux 1 djellaba homme. Yacine Mansouri 05559876 » · `fr` · 5.5 s (server 3.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Très bien Yacine ! La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine beige, taille unique. Le numéro donné semble incomplet : pouvez-vous me renvoyer votre numéro à 10 chiffres (ex : 0555123456) ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 7.2 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août, villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3, Blida», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 61a7e3… core daf70b…, recap total 7950`
- **T3** C: « oui » · `fr` · 7.0 s (server 3.8 s)
  - AI: « Votre commande TEST-2192 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true, phoneConfirmed true} → ok TEST-2192, total 7950`

### N3 — J03 playground (UI fr)
**Verdict: PASS (R11-3) — fr → arabizi kept at T2: « Ih, nwasslou l Constantine, f 2 l 5 ayam. » + arabizi recap → « ih saha » → TEST-7010; T1 `lookup_order {}` probe on the name + phone message.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 7.8 s (server 7.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci Samira, c'est bien noté. Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `lookup_order {} → 0 order`
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 9.2 s (server 8.9 s)
  - AI: « Ih, nwasslou l Constantine, f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `quote_delivery {Constantine, stop-desk} → fee 450 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 4.2 s (server 4.0 s)
  - AI: « Commande ta3ek TEST-7010 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-7010, total 6300`

### N5b — J04 playground (UI fr)
**Verdict: PASS — « je la prends » = the Djellaba → recap → « oui » → TEST-8008 8 100 DA.**

- **T1** C: « Bonjour, la djellaba homme c'est combien ? » · `fr` · 1.5 s (server 1.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme en laine fine, couleur beige, taille unique, est à 7500 DA (au lieu de 9000 DA). Voulez-vous la commander ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Bon finalement je la prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.9 s (server 3.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft c87d7b… core ca7b5f…, recap total 8100`
- **T3** C: « oui » · `fr` · 4.3 s (server 4.2 s)
  - AI: « Votre commande TEST-8008 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → ok TEST-8008, total 8100`

### N7 — J03 playground (UI fr)
**Verdict: FAIL — R11-2 — « vous avez des lunettes de soleil ? » + name, phone, address → `handoff_to_human {off_catalogue}` accepted, status HANDOFF, « Je transmets à un membre de l'équipe … » (shop out of hours); « oui » ×2 → « Quel article vous intéresse … ? », no order (right — nothing chosen).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 9.5 s (server 8.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Désolé, nous n'avons pas de lunettes de soleil pour le moment. Par contre, nous avons un sac à main en cuir véritable (noir ou marron), des baskets Runner légères, et des tapis de prière molletonnés. Qu'est-ce qui vous intéresse ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)` · `handoff_to_human {off_catalogue, evidence «vous avez des lunettes de soleil ?»} → ok`
- **T2** C: « oui » · `fr` · 6.9 s (server 5.8 s)
  - AI: « Merci Yacine, j'ai bien noté vos coordonnées. Quel article vous intéresse : le sac à main en cuir (noir ou marron), la Basket Runner (pointure 40, 42 ou 43) ou le tapis de prière ? »
- **T3** C: « oui » · `fr` · 6.0 s (server 4.6 s)
  - AI: « Merci, c'est noté. Pour que je puisse avancer, quel article vous intéresse : le sac à main en cuir (noir ou marron), la Basket Runner (pointure 40, 42 ou 43) ou le tapis de prière ? »

### N7b — J03 playground (UI fr)
**Verdict: PASS — re-run of N7: no hand-off; « Je peux vous proposer notre Sac à main cuir … » → « oui » → « noir ou marron ? » → « oui » → the same question, no order (right).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.9 s (server 5.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre Sac à main cuir, disponible en noir ou marron, à 6900 DA. Est-ce que ça vous intéresse, ou souhaitez-vous voir autre chose ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)`
- **T2** C: « oui » · `fr` · 3.0 s (server 2.8 s)
  - AI: « Super, merci ! Lequel préférez-vous pour le Sac à main cuir : noir ou marron ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T3** C: « oui » · `fr` · 5.0 s (server 4.8 s)
  - AI: « Parfait, je note vos coordonnées. Pour le Sac à main cuir, vous le voulez en noir ou en marron ? »

### N10 — J03 playground (UI fr)
**Verdict: PASS — « trop cher … 12 000 DA ou la livraison gratuite » → « je ne peux pas modifier le prix … ni offrir la livraison gratuite »; « je la prends quand même » + details → « Merci Karim ! » + recap (« peut prendre un peu plus de temps ») → « oui » → TEST-9004 16 550 DA.**

- **T1** C: « Bonjour, la montre connectée c'est combien ? » · `fr` · 5.0 s (server 3.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « La montre connectée est à 15900 DA. Elle a un écran couleur et une autonomie de 5 jours. Elle est disponible à la commande, mais la livraison peut prendre un peu plus de temps. Souhaitez-vous la commander ? »
  - cards: « Montre connectée 15900 DA » (no photo)
  - tools: `get_product {…3123} → Montre connectée, orderable (delivery may take longer)`
- **T2** C: « Ah c'est trop cher… Faites-moi 12 000 DA, ou au moins la livraison gratuite, et je la prends » · `fr` · 3.8 s (server 2.1 s)
  - AI: « Je comprends que le prix vous semble élevé. Malheureusement, je ne peux pas modifier le prix de la montre connectée, qui reste à 15900 DA, ni offrir la livraison gratuite. Si vous voulez, je peux vous calculer les frais de livraison pour votre wilaya. »
- **T3** C: « Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr` · 6.5 s (server 5.5 s)
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Montre connectée : 15 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …3123, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59f104… core 091af2…, recap total 16550`
- **T4** C: « oui » · `fr` · 8.5 s (server 5.7 s)
  - AI: « Votre commande TEST-9004 est bien enregistrée ✅ ⏎ - 1 × Montre connectée : 15 900 DA ⏎ Livraison : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …3123, customerConfirmed true} → ok TEST-9004, total 16550`

### N13 — J04 playground (UI fr)
**Verdict: PASS — price 12 500 DA, sizes, Oran 600 / 400 DA in one reply; « en 42 » + details → recap (42) 13 100 DA → « oui » (left out in R9) → TEST-2203.**

- **T1** C: « Bonjour, la basket sport Runner c'est combien ? Et la livraison à Oran, ça coûte combien ? » · `fr` · 6.4 s (server 6.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La basket sport Runner est à 12500 DA. Les pointures 40, 42 et 43 sont disponibles, et la 41 est en rupture pour le moment. ⏎ Pour Oran, la livraison à domicile coûte 600 DA, ou 400 DA en stop-desk, avec un délai de 2 à 5 jours. Quelle pointure vous intéresse ? »
  - cards: « Basket sport Runner 12500 DA » (no photo)
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `search_products {«Basket sport Runner»} → 1 product(s)`
- **T2** C: « Je la prends en 42. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.1 s (server 3.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 13 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft fde1b2… core 278a27…, recap total 13100`
- **T3** C: « oui » · `fr` · 5.1 s (server 4.9 s)
  - AI: « Votre commande TEST-2203 est bien enregistrée ✅ ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 600 DA ⏎ Total : 13 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …f843, customerConfirmed true} → ok TEST-2203, total 13100`

### N4 — J03 playground (UI fr)
**Verdict: PASS (R10-3 fixed here) — « سمير بن علي » accepted once, French kept, no tool on the name turn; « Nom : سمير بن علي » recap → « oui » → TEST-1344 3 250 DA.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 4.0 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le tapis de prière molletonné (120 x 70 cm) est à 2800 DA et disponible. Pour commander, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `fr` · 4.2 s (server 3.5 s)
  - AI: « Merci Samir, c'est noté. Quel est votre numéro de téléphone ? (exemple : 0555123456) »
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 7.3 s (server 5.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T4** C: « oui » · `fr` · 8.5 s (server 6.5 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N11 — J04 playground (UI ar)
**Verdict: PASS (R10-3 fixed here, R11-6) — Arabic recap → « ايه » → TEST-4074; tracking question → `lookup_order {}` only (no `cancel_order` probe) → « ما خرجتش للتوصيل بعد … ما عندهاش رقم تتبع درك » — no invented number; two « درك » (R11-6).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 6.3 s (server 6.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 6.0 s (server 5.8 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 5.1 s (server 4.8 s)
  - AI: « طلبيتك رقم TEST-4074 درك عند الشركة وما خرجتش للتوصيل بعد، راهي تتجهز. ما عندهاش رقم تتبع درك، وكي تخرج نقدر نعطيك رقم التتبع. مدة التوصيل من 2 إلى 5 أيام من وقت الخروج. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N18 — J03 playground (UI ar)
**Verdict: PASS — R9-1 holds: Arabic server recap « الاسم: Samir Benali » → « ايه » → TEST-8849; R10-4: « من صوف رقيق » (no « في لاين فين »).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 7.0 s (server 6.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا Djellaba homme بسعر 7500 دج (كانت 9000 دج)، من صوف رقيق، لونها بيج، ومقاسها واحد. تحب نسجلهالك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 5.8 s (server 5.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T3** C: « ايه » · `ar` · 6.1 s (server 5.9 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N21 — J04 playground (UI ar)
**Verdict: PASS (R11-3, R11-4) — T1 « بسعر 1500 دج بدل 2000 دج » (R10-4 fixed); T2 `handoff_to_human {unclear_streak}` probe refused + a search on the name and the phone turns; recap address « البليدة، بوفاريك، حي الورود رقم 12 » (wilaya first, R11-4) → « 👍 » → TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 3.6 s (server 3.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا! عندنا Hijab soie، حرير ناعم ومريح، بمقاس 180 x 70 سم، بسعر 1500 دج بدل 2000 دج. تحب نسجلولك واحد؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 4.4 s (server 4.2 s)
  - AI: « أهلًا نادية! تسجلت الاسم. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
  - tools: `search_products {«Hijab soie»} → 1 product(s)` · `handoff_to_human {unclear_streak, evidence «نادية قاسي»} → HANDOFF_NOT_NEEDED`
- **T3** C: « 0661234568 » · `ar` · 4.1 s (server 3.9 s)
  - AI: « صحيت، سجلت رقم الهاتف تاعك. واش من ولاية تحب نوصلولك الحجاب؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.3 s (server 4.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: البليدة، بوفاريك، حي الورود رقم 12 ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 944655… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 6.0 s (server 5.8 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N21b — J04 playground (UI ar)
**Verdict: PASS — re-run of N21: no probe after T1, recap « حي الورود رقم 12، بوفاريك، البليدة » → « 👍 » → TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 5.0 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بسعر 1500 دج (كان 2000 دج)، حرير ناعم بمقاس 180 x 70 سم، مريح وخفيف للبس اليومي. تحب نسجلولك واحد؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « نادية قاسي » · `ar` · 2.8 s (server 2.6 s)
  - AI: « صحيت نادية. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234568 » · `ar` · 2.1 s (server 1.9 s)
  - AI: « صحيت، تسجل الرقم. واش من ولاية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 5.3 s (server 5.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 4.1 s (server 3.9 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N9 — J04 playground (UI fr)
**Verdict: PASS (R11-6) — « Ma 3andnach tsawer ta3 la robe f had lwa9t » + fabric and sizes (French words left: « b la main », « tissu léger », « les fêtes »); recap (M) → « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 8.5 s (server 8.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma 3andnach tsawer ta3 la robe f had lwa9t, bessah nqolek 3lihha: Robe kabyle brodée, brodée b la main w b tissu léger, zina l les fêtes. Tailles li kaynin: S w M b 4900 DA, w XL b 5200 DA (L makach f had lwa9t). Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.7 s (server 4.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 4.7 s (server 4.4 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », no TEST-n.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 5.6 s (server 5.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900` · `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « oui » · `fr` · 7.7 s (server 7.5 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### N1 — J03 playground (UI fr)
**Verdict: PASS (R10-1) — R10's slowest flow: recap → « le sac à main cuir marron à la place … Oran » → new recap « (Marron) », 600 DA, 7 500 DA → « oui » → TEST-3924; T2 7.2 s on the page, server 6.9 s (R10: 223.6 s).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.3 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 7.2 s (server 6.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 4.9 s (server 4.7 s)
  - AI: « Votre commande TEST-3924 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×variant …0eda, customerConfirmed true} → ok TEST-3924, total 7500`

### F1 — J03 playground (UI fr)
**Verdict: PASS (R10-1, R10-3) — one search (R10: two); name → phone + address → recap « (Marron) » → « oui » → TEST-6313; slowest turn 4.8 s (R10 T3: 104.7 s).**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 3.0 s (server 2.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le sac à main en cuir véritable en couleur Marron est disponible, au prix de 6900 DA. Pour continuer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 2.1 s (server 1.9 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone (par exemple 0555123456) ? »
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 3.8 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.8 s (server 4.6 s)
  - AI: « Votre commande TEST-6313 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-6313, total 7550`

### F6 — J03 playground (UI fr)
**Verdict: PASS (R10-1) — recap at T1; 2 → 3 tapis → new recap → « oui » → TEST-2340 9 100 DA; T3 6.1 s (R10: 71.0 s).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 5.7 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 5.7 s (server 5.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 6.1 s (server 5.8 s)
  - AI: « Votre commande TEST-2340 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### N5c — J04 playground (UI fr)
**Verdict: PASS — Oud out of stock → « … le Coffret cadeau Aïd (24990 DA) est disponible … Voulez-vous que je le commande pour vous ? » → « oui » → recap, no order → « oui » → TEST-1709 24 990 DA.**

- **T1** C: « Bonjour, je veux le parfum oud. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.6 s (server 4.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous voulez, notre Coffret cadeau Aïd (24990 DA) est disponible : il contient un parfum, du chocolat et une carte personnalisée. Voulez-vous que je le commande pour vous ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « oui » · `fr` · 8.8 s (server 8.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr` · 5.3 s (server 4.9 s)
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N17 — J04 playground (UI fr)
**Verdict: PASS — recap Blida → « oui mais livrez à Alger … » → new recap Alger, no order → « oui » → TEST-8063 (Alger, 1 900 DA). T2 the slowest turn of the run: 14.3 s on the page, server 11.9 s (`AiRun` 11.9 s); T1 9.8 s with 3.9 s to download the answer.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 9.8 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950` · `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 14.3 s (server 11.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 6.4 s (server 5.2 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N25 — J04 playground (UI ar)
**Verdict: PASS — NEW (R10 « Not tested »): Arabic recap 1 × → « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 × Hijab soie, 3 450 دج, no order → « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.4 s (server 4.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 6.6 s (server 6.4 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 5.4 s (server 5.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### L1 — J04 playground (UI fr)
**Verdict: PASS (R10-1) — NEW probe. T1 « dup »: the page's request (turnKey 81e2b261) sent three times — A at +0.0 s (« queue;dur=6884, total;dur=6891 », hourlyUsed 36), B at +1.5 s while A ran (« queue;dur=6550, total;dur=6554, replay », hourlyUsed 36), C after both (« queue;dur=3, total;dur=5, replay », hourlyUsed 36) — one turnId 01a1eb76-6a2a… and one `AiRun` (22:42:48.6–22:42:55.5, 6 863 ms), the recap shown once. T2 « oui » « stall »: the first request reached the server (order TEST-2029, 4.5 s) and its answer was held 40 s; the page aborted it at 20.0 s and re-sent the same turnKey 349e3c1f, answered `replay` in 8 ms (hourlyUsed 37 on both) → one order, one answer in the thread, 20.3 s on the page.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 10.1 s (server 6.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui » · `fr` · 20.3 s (server 0.0 s) · 2 attempts, same turnKey
  - AI: « Votre commande TEST-2029 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-2029, total 1950`

### L2 — J04 shared link (UI fr)
**Verdict: PASS (R10-1) — NEW probe on the shared link: answer held 40 s; the page re-sent the same turnKey b31af3be at 20.1 s, `replay` 5 ms; one `AiRun` (2 335 ms); « Bonsoir 😊 Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk … », 20.2 s on the page.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 20.2 s (server 0.0 s) · 2 attempts, same turnKey
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous cherchez quel produit ? »

### F1b3 — J03 playground (UI fr)
**Verdict: PASS (R11-3) — second re-run of F1b: street asked, recap at T3 → TEST-6293 at T4. T2 `handoff_to_human {customer_request, evidence «ignore»}` refused.**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 7.3 s (server 7.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le sac à main cuir Marron (1 pièce) à 6900 DA est noté pour vous. Dans quelle wilaya souhaitez-vous être livré ? »
- **T2** C: « Sétif, El Eulma » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Merci Karim, c'est noté pour El Eulma (Sétif). Pouvez-vous me donner votre adresse de livraison (rue, cité ou bâtiment), ou préférez-vous le stop-desk ? »
  - tools: `handoff_to_human {customer_request, evidence «ignore»} → HANDOFF_NOT_NEEDED`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 3.9 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.0 s (server 3.9 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

## Bugs

### R11-1 — A refused `create_order` (VALIDATION) lets the model ask « Pouvez-vous confirmer pour que je passe la commande ? » without a recap — R10-2's class through another door
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même » (UI fr): « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 », « Sétif,
  El Eulma », « Cité 500 logements bloc 12 », « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif ».
- Expected: T3 (the street, every field now given) → the server recap; never a model request to confirm the order when no recap is shown
  (R8-2, R10-2: « no confirm question without a server recap on any turn »); the « oui » of T4 → the order (as in R9 F1b, R11 F1b2 / F1b3).
- Actual (first run, 22:36): T3 `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500
  logements bloc 12», items: the string «[{"productId": "01a1e54f-9efa-72b8-8949-a68fb6dca3f6".replace("01a1e54f-9efa-72b8-8949-a68fb6dca3f6",
  "01a1e54f-a0b9-7ae5-8971-96c0cc39d155"), "variantId": "01a1e54f-a0e1-7b60-8974-d647387f0eda", "quantity": 1}]», customerConfirmed true}`
  (a code expression instead of an array) → `VALIDATION {field items, missing true}` with the `say` « Not done: **the customer has not given
  items yet**. Ask for items in one short question … » → the reply « **Parfait Karim, j'ai noté : Sac à main cuir Marron, 1 pièce,
  livraison à domicile à Cité 500 logements bloc 12, El Eulma (650 DA). Pouvez-vous confirmer pour que je passe la commande ?** » (10.8 s,
  server 10.5 s) — the model's own summary (no total, no name / phone line) and a request to confirm. T4 « oui, c'est bien la cité 500
  logements bloc 12 à El Eulma, Sétif » → the server recap (7 550 DA, draft d44c54… core f3d302…), no order — the customer said « oui » and
  still has no order; the flow (4 messages) ended at the recap. No order without a recap. The two re-runs of the same messages (F1b2 22:44,
  F1b3 22:46) sent a correct `items` array and gave the recap at T3 and TEST-6293 at T4: 1 run in 3.
- Evidence: .local/qa/journeys/R11/out/transcripts/F1b.json T3–T4 (+ F1b.ui.txt) · run2.log · .local/qa/campaign/retest-ai-r11/fr-F1b-pg.png ·
  F1b2.json, F1b3.json (same messages, passed)
- Likely cause: in `checkReply` (reply-guard.ts) a turn with a refused `create_order` (`orderRefused`) is only checked with `recapClaim`,
  and the R10-2 check `confirmRequest` sits in the `else if (facts.noRecapPending)` branch, so it is never run on a refused turn; neither
  pattern matches « confirmer pour que je passe la commande » (`CONFIRM_ASK` has « pour confirmer » / « confirmer la commande »,
  `CONFIRM_ORDER` allows at most 3 words between « confirmer » and « commande » — here 5). The ai-run re-ask on a confirm request (line ≈ 600)
  also skips turns with `refusedOrder(executed)`. Separately, a malformed `items` value is answered « the customer has not given items
  yet » although the product was named at T1 — a « items malformed, send an array » answer would let the model re-call at once.

### R11-2 — Accepted `handoff_to_human {off_catalogue}` on « vous avez des lunettes de soleil ? » with full order details: visible hand-off
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même » (UI fr): « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654,
  Blida, Boufarik, cité 20 août villa 3 », « oui », « oui ».
- Expected: « we do not sell that » + in-stock products, no hand-off (R4-1: no hand-off on an order message; the prompt's own rule:
  `off_catalogue` is « a request only the team can handle … A simple question you have no answer to is NOT a handoff »); R9 N7 and the
  re-run N7b (22:45) did exactly that.
- Actual (first run, 22:38): T1 `search_products {«lunettes de soleil», limit 5}` → 5 other products, then **`handoff_to_human {reason
  off_catalogue, evidence «vous avez des lunettes de soleil ?»} → ok`**; the turn ends `status HANDOFF` with the system line « **handoff: Je
  transmets à un membre de l'équipe qui vous répondra très vite.** » after the reply « Désolé, nous n'avons pas de lunettes de soleil pour le
  moment. Par contre, nous avons un sac à main en cuir véritable (noir ou marron), des baskets Runner légères, et des tapis de prière
  molletonnés. Qu'est-ce qui vous intéresse ? » — the shop is closed (« out_of_hours » line of the same turn), the customer gave name, phone
  and address. `AiRun` 22:38:52 `status handoff`. In the playground the next turns were still answered (T2 « oui » → « Merci Yacine, j'ai
  bien noté vos coordonnées. Quel article vous intéresse : … ? », T3 the same question); on a live chat the conversation would go to the
  (absent) team. 1 run in 2.
- Evidence: .local/qa/journeys/R11/out/transcripts/N7.json T1 (+ N7.ui.txt) · run2.log · .local/qa/campaign/retest-ai-r11/fr-N7-pg.png · N7b.json
  (same messages, no hand-off)
- Likely cause: `handoff-judge.ts` accepts `off_catalogue` whenever the evidence is in the message and is not a price claim; nothing checks
  that the message asks for something only the team can do (wholesale, custom order, partnership) — a product the shop does not sell passes.

### R11-3 — `handoff_to_human` probes back on field messages, `lookup_order {}` on a name message, searches on field turns (R10-3 partly fixed)
- Page: playground dialog (owner, fr / ar, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run F1b (×3), F8, N21, N3; read the tool calls.
- Expected: no hand-off call on a name / place / phone message; no `lookup_order` on a name message (the R10-3 fix); one search per
  product (R10: 0 `handoff_to_human` call in 100 turns).
- Actual (none reached the customer):
  - F1b T2 (« Sétif, El Eulma ») `handoff_to_human {unclear_streak, evidence «Sétif, El Eulma»}` → `HANDOFF_NOT_NEEDED not_unclear`; F1b2 T2
    the same message `{customer_request, evidence «unused»}` → `evidence_not_in_message`; F1b3 T2 `{customer_request, evidence «ignore»}` →
    `evidence_not_in_message` — on that message in 3 runs out of 3.
  - F8 T3 (« 05559876 ») `{customer_request, evidence «05559876»}` → `reason_mismatch`; N21 T2 (« نادية قاسي ») `{unclear_streak, evidence
    «نادية قاسي»}` → `not_unclear`.
  - N3 T1 (« Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 ») `lookup_order {}` → 0 order.
  - N21 T2 (the name) and T3 (the phone) each `search_products {«Hijab soie», limit 1}` (the product was found at T1); F1b2 T2 (« Sétif, El
    Eulma ») `search_products {«sac à main cuir marron»}`.
  - Gone since R10: `cancel_order {}` on a tracking question (N11 only `lookup_order`), `add_faq_candidate` (0 in 96 turns), the N4 name-turn
    probes (no tool), F1's two searches (one).
- Evidence: .local/qa/journeys/R11/out/transcripts/F1b.json T2, F1b2.json T2, F1b3.json T2, F8.json T3, N21.json T2–T3, N3.json T1
- Likely cause: the R10-3 change narrowed `cancel_order` / `lookup_order` / `add_faq_candidate`; `handoff_to_human` is still offered on
  every turn and the model now uses it as the probe (the judge refuses it, so nothing shows); `lookup_order`'s « name / place message »
  test misses a message that also names a product and a quantity.

### R11-4 — Recap address in the wrong order when the model puts the whole place into `address`
- Page: playground dialog (owner, ar, 1440) — « Boutique de Karima »
- Severity: Cosmetic
- Type: Bug
- Steps: J04 › « Tester moi-même » (UI ar): « سلام، نحب حجاب حرير », « نادية قاسي », « 0661234568 », « البليدة، بوفاريك، حي الورود رقم 12 », « 👍 ».
- Expected: « العنوان: حي الورود رقم 12، بوفاريك، البليدة » (« …, commune, wilaya », R6-4 — as in R10 N21 and the re-run N21b).
- Actual: T4 `create_order {…, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12»}` → recap « العنوان: **البليدة، بوفاريك،
  حي الورود رقم 12** » (wilaya first, the server added nothing since both were already in it). T5 « 👍 » → the confirming call sent address «
  حي الورود رقم 12 », the order TEST-6619 was placed from the stored recap (draft 944655…), so the stored address is the reversed one. 1 run in
  2.
- Evidence: .local/qa/journeys/R11/out/transcripts/N21.json T4–T5 · .local/qa/campaign/retest-ai-r11/ar-N21-pg.png · N21b.json T4 (right)
- Likely cause: the recap's address line keeps a model `address` that already contains the commune and the wilaya as is; it is not reduced to
  the street part before « , commune, wilaya » is added.

### R11-5 — One turn not answered: `malformed_output:schema:reply` → 503 AI_PROVIDER_ERROR (first provider error since R1)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: « Bonjour, je veux la djellaba. Yacine Mansouri » (first message of F8, 22:37:06).
- Expected: an answer (0 provider error in R2–R10, 900+ turns).
- Actual: after 5.2 s `POST /agents/…/test` → **503 `AI_PROVIDER_ERROR`** « L'IA ne répond pas ; la conversation passe en file. » (ref
  f269ee75-100b-4da4-9b76-225c39300662, no `Server-Timing`); the thread shows « L'IA n'a pas répondu à ce message (rien n'est envoyé dans
  une simulation). Réessayez. ». `AiRun` 22:37:07.845 → 22:37:12.875, 5 030 ms, `status error`, `error malformed_output:schema:reply`, attempt
  1, `usedFallback false`. The turn was given back to the hour (J03 counter 52 for 53 messages). The same message re-sent → answered (3.2 s).
  On a live chat the message goes to the queue (the error text says so).
- Evidence: .local/qa/journeys/R11/out/transcripts/F8.json T1–T2 (+ F8.ui.txt, F8.log.json) · run2.log · `AiRun` row of workspace 01a1e54f-…
  started 21:37:07 UTC
- Likely cause: the model's output did not match the reply schema and the run is not retried once (nor sent to the fallback model) before
  failing the turn.

### R11-6 — Wording left (two « درك », French inside arabizi)
- Page: playground dialog (owner, ar / fr, 1440) — « Boutique de Karima »
- Severity: Cosmetic
- Type: Text
- Steps: run N11, N9.
- Expected: plain Algerian darija / arabizi.
- Actual:
  - N11 T3 « طلبيتك رقم TEST-4074 **درك** عند الشركة وما خرجتش للتوصيل بعد، راهي تتجهز. ما عندهاش رقم تتبع **درك** … » — two « درك » again (the
    R10 fix keeps one), « عند الشركة » is odd for an order being prepared.
  - N9 T1 « … Robe kabyle brodée, brodée **b la main** w b **tissu léger**, zina l **les fêtes**. Tailles li kaynin: … » — less French than
    R10 (« mais », « Les tailles disponibles » gone), still French words.
  - N5 T2 « … donc je ne peux pas le commander. Merci Karim, **j'ai bien noté vos coordonnées**. » — the refusal is now explicit before it
    (R10-2), the « noté » is about the details: accepted, noted here only.
- Evidence: .local/qa/journeys/R11/out/transcripts/N11.json T3, N9.json T1, N5.json T2
- Likely cause: free model wording; the one-« درك » fix does not cover « درك … درك » across two sentences.

## Retest
- RETEST R10-1: fixed as far as this run can show — in 92 answered turns that were not probes the slowest answer on the page took 14.3 s
  (N17 T2, server `total` 11.9 s), median 5.4 s, p90 8.5 s; the three R10 slow flows N1 / F1 / F6 took at most 7.2 / 4.8 / 6.1 s (R10:
  223.6 / 104.7 / 71.0 s); **every 200 answer carried `Server-Timing`** (« queue;dur=…, total;dur=… »), the page − server gap was median 0.25
  s, max 4.2 s (N17 T1: headers 0.2 s after the server's 5.5 s, then 3.9 s to download the ≈ 33 KB body; F8b T2 3.5 s, N5 T1 3.1 s — the
  tester's connection, not a stall); **0 page re-send** (no turn reached the 20 s mark). The stall itself did not come back, so its cause is
  still not known. The re-send was checked by forcing it: **L1 T2** (« oui », answer held 40 s): the page aborted at 20.0 s and re-sent the
  same `turnKey` 349e3c1f; the server answered `replay` in 8 ms; one `AiRun`, `hourlyUsed` 37 on both, **one order TEST-2029**, one answer in
  the thread, 20.3 s on the page. **L2** (shared link, the same): re-sent at 20.1 s, `replay` 5 ms, one answer, 20.2 s. **L1 T1** (the same
  request sent 3 times — A, B 1.5 s later while A ran, C after both): one `AiRun`, the same `turnId` 01a1eb76-6a2a… on A / B / C,
  `hourlyUsed` 36 on all three, B « queue;dur=6550, total;dur=6554, **replay** », C « queue;dur=3, total;dur=5, replay ». J04 counter 38 after
  the 3 probe turns (35 before): each counted once. A stalled answer now costs about 20 s, not minutes.
- RETEST R10-2: fixed on its own flow — N5 (same messages + « oui ») T2 « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment,
  donc je ne peux pas le commander … Si le Coffret cadeau Aïd … à 24990 DA vous intéresse, je peux préparer la commande avec ces mêmes
  informations. » (no « Je vous ai bien noté » alone, no `create_order` on the Oud); T3 « oui » → the server recap; T4 « oui » → TEST-3157 —
  no « Pour confirmer … ? » without a recap; N5c « Voulez-vous que je le commande pour vous ? » → recap → order. But the same class (a model
  request to confirm with no recap) came back on a turn whose `create_order` was refused (F1b T3) → R11-1.
- RETEST R10-3: partly fixed — no `cancel_order` probe (N11 asks for tracking: `lookup_order {}` only), 0 `add_faq_candidate`, N4's name
  turn without a tool, F1 one search; left: `lookup_order {}` on N3's name message, searches repeated on field turns, and refused
  `handoff_to_human` probes on field messages (5, none in R10) → R11-3.
- RETEST R10-4: fixed for the cited forms — N18 T1 « من صوف رقيق، لونها بيج » (no « في لاين فين »), N21 / N21b T1 « Hijab soie … بسعر 1500 دج
  بدل 2000 دج » / « عندنا Hijab soie بسعر 1500 دج » (no name in the price slot), the playground language tag is `ar` on every Arabic-script turn
  (N11, N18, N21, N21b, N25); N9 still has French words, N11 two « درك » → R11-6.
- RETEST R8-1: holds — 0 « oui » to a server recap lost in 24 + 1, 0 « problème technique », 0 « répondez « oui » une nouvelle fois » in 96
  replies; fields one per message (N21, N21b, F1b2, F1b3), a « yes » restating the address (F1b2, F1b3, F5 « oui c'est bon ») → one order.
- R1–R9 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 24 orders**, F1b T4 / N5 T3 / N5c T2 / N7 /
  N7b « oui » to something else → no order, N17 T2 / N25 T2 « yes » with a change → new recap; **R4-1 (no hand-off on order messages)
  broken once — N7 T1 (R11-2)**; R4-2 (a name in another script keeps the language) holds — N4, N18; R4-4 / R6-1 (no model sentence asking
  to confirm in front of the recap) holds — 30 / 30 recaps; **R8-2 (no confirm request without a recap) broken once — F1b T3 (R11-1)**; R4-8
  (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5, N5c, N7, N7b; R5-2 (no Tunisian forms) holds — 0 hit; R5-4
  (no « home or stop-desk ? » after a street) holds; R5-5 / R7-5 (delivery question answered with the fee) holds — N13, L2, N3; R5-6 (no
  `create_order` before a phone) holds — 0 / 52; **R6-4 (recap address « …, commune, wilaya ») broken once — N21 (R11-4)**; R7-2 (no photo
  said) holds — F3b, N9; F8 / F8b 8-digit phone re-asked; N10 no invented discount nor free delivery; N11 tracking from `lookup_order`, no
  invented number or date; R8-3 (named variant) holds — F1, F1b2, F1b3, N1 Marron, N9 / F5 M, N13 42; R9-1 (Latin name in an Arabic chat)
  holds — N18; one order per « oui »: 24 orders, never two for one « oui » (also when the « oui » was sent twice, L1 T2), none lost.

## Coverage
- Order flows to « oui »: fr ×17 (F1, F1b2, F1b3, F6, F8, F8b, L1, N1, N4, N5, N5b, N5c, N10, N13, N17; F11 blocked; F5 mixed on the link),
  Arabic-script darija ×5 (N11, N18, N21, N21b, N25), arabizi ×3 (F3b link, N3 after a switch, N9); flows ended at the recap: F1b (R11-1);
  no order, rightly: N7, N7b (nothing chosen), L2 (a delivery question).
- Asked this round: R10-1 latency on every turn + forced stalls / duplicates (L1, L2), N5, the 10 R9 flows R10 skipped (F1b, F3b, F5, F8,
  F8b, N3, N5b, N7, N10, N13 — every one to its « oui »), N4, N11, N18, N21, N9, F11; new: a « yes » with a change in Arabic script (N25).
- Also: the three R10-1 slow flows (N1, F1, F6), « oui » to a suggestion (N5c), « oui mais … » (N17), a product not sold (N7), « trop cher »
  (N10), two questions in one message (N13), commune-only address → street asked (F1b2, F1b3, F5), photo requests (F3b, N9), 8-digit phones
  (F8, F8b), out-of-hours shop (every J03 run), the shared link (F3b, F5, L2).
- Kit: no blocked call; API errors only the F8 503; no console error besides it; no kit timeout.

## Not tested
- The original R10-1 stall (an answer lost for minutes on one connection) did not happen in this run, so the re-send was only seen with a
  forced stall; nginx still logs no `$request_time` (combined format, read-only check).
- The R8-1 path itself (a confirming call that drops fields, completed from the stored recap): every confirming call was complete again.
- A malformed `items` on a confirming call (R11-1 was on a recap call); a hand-off on a live chat with an absent team (playground only).
- Live Messenger path (no page connected); a product that HAS photos asked for in a photo request; a mistyped wilaya; `cancel_order` on a
  real order; `lookup_order` on a real order with a courier and a tracking number.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place. Shared test links from R7 reused
  (valid until 18/11 18:04); no new link.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-3157 (N5), TEST-6293 (F1b2, F1b3), TEST-1493 (F3b), TEST-6890 (F5,
  N9), TEST-3146 (F8), TEST-2192 (F8b), TEST-7010 (N3), TEST-8008 (N5b), TEST-9004 (N10), TEST-2203 (N13), TEST-1344 (N4), TEST-4074 (N11),
  TEST-8849 (N18), TEST-6619 (N21, N21b), TEST-3924 (N1), TEST-6313 (F1), TEST-2340 (F6), TEST-1709 (N5c), TEST-8063 (N17), TEST-6971 (N25),
  TEST-2029 (L1) — the same draft no longer always gives the same number (F1 / F1b2 draft d44c54… → TEST-6313 / TEST-6293; N5 / N5c draft
  faad11… → TEST-3157 / TEST-1709).
- Hour counters (read-only, 22:48): J04 43 / 60 (window from 22:29:29), J03 52 / 60 for 53 messages (the F8 T1 503 given back; window from
  22:34:50); no 429. Messages used: 96 / 100.
