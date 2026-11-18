# R19 — Nineteenth retest of the AI order-taking (after the R18 fixes) — live site, deployed commit 3fe9b64 — 18/11/2026 06:50–07:04 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 3fe9b64 (checked read-only: `git log --oneline -1` = « 3fe9b64 fix(ai): live retest R18 —
every newly named served wilaya gets the server's fees whatever the reply asks, the price of the product being sold is always said, fee
sentence written by the server (no corrective turn), stop-word-free catalogue search, per-step timing in AiRun.meta, wording fixes »;
`djaber-v2-api` / `djaber-v2-worker` online, restarted 06:46:30). Same two own shops as R1–R18: « Boutique de Nassim » (J03 shop, « Agent J03
Vendeur », default language FR) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Surfaces: step 5 › « Tester
moi-même » (playground, tool calls visible) and, for F5 / F12, the J04 shared test link (`/agent-test/<token>`, valid until 18/11 18:04, so
no new link was made; its tool calls were read server side, read-only, from `AiToolCall`). One browser at a time, the runs one after the
other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place (F11). Hour counters read before the run (read-only,
Redis `rl:playground:*`, `rl:agent-test*`, 06:48): the J03 key of R18 (53, TTL 37 s, gone before the J03 flows), no J04 key, no link key. J04
flows 06:50:21–06:57:23, J03 flows 06:57:23–07:04:03. No 429. J03 was outside its opening hours: every J03 conversation (15 / 15) starts with
the shop's « out_of_hours » system line (configured text, in Arabic for the Arabic UI), not an AI reply; the J04 shop shows no such line.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, last change 16/11 — unchanged since R18), used to check every fee:**
Alger 400 home / 250 stop-desk, Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (`freeAbove` 20 000 DA, home only),
Illizi 1 500 / 1 000 inactive (not served). Stock (read-only, `Product` / `ProductVariant`, unchanged since R18): J04 Parfum Oud 50 ml 0,
Montre connectée 0 (`sellOutOfStock` true), Coffret cadeau Aïd 4, Hijab soie 20 (old price 2 000), Djellaba homme 10 (old price 9 000), Robe
kabyle S 5 / M 5 / L 0 / XL 2 (XL 5 200); J03 Parfum Oud 50 ml 0, Montre connectée 0, Coffret cadeau Aïd 4, Sac à main cuir Noir 3 / Marron 3
/ Rouge 0, Tapis de prière 15, Djellaba homme 10, Basket Runner 41 0, Robe kabyle L 0. Photos (read-only, `ProductImage`): only the J03 Robe
kabyle brodée has one (1); no J04 product has a photo (N9).

**Latency method (as R11–R18).** `conv.mjs` of R18 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » lines (`runMs`, `waitMs`, `totalMs`, `replayed`), the `AiRun` rows (`latencyMs`, `status`,
`flags`, `meta.guard`, and **new since 3fe9b64 `meta.steps`** — one entry per model call: `ms`, the tools it asked, why the next call came:
`tools`, `guard`, `format`, `stray` = it asked a tool not offered this step and the server answered « unavailable ») + `AiToolCall` rows.
No stall / dup probe.

**99 customer messages** (J04 shop 45 of which 4 on the shared link, J03 shop 54; budget 100), 33 conversations, 31 on the playground and 2
on the shared link: priority 1 — PF1 twice on J03 (PF1 full, PF1r the same two first messages), PF1b (J04), PG1 twice (J04 full, PG1b on
J03 with the tapis, 2 messages), PG2 twice (J03 full, PG2b on J04, 2 messages), N3, N7, N11, N5, N4, N16; priority 2 — N9 (photo request)
and N14 (cancel after an order, run as a 4th message « non annule » after N1's order to stay within budget); priority 3 — the sweep F1,
F1b, F3, F5 (shared link), F6, F9, F11, F12 (shared link), W1, H1, C2, N1, N17, N18, N21, N23, N25, P2, A3. **A1 was not run** (5
messages; N21 is the same Arabic-script fields-one-per-message flow on the same shop). Flows with `untilOrder` stop at the order. No
adaptive re-send, no re-send by the script. Scripts `.local/qa/journeys/R19/scripts/` (R18's conv.mjs, convs.json + PF1r / PG1b / PG2b / N1
with « non annule », render.cjs, check.cjs, lat-table.cjs, server.sh = read-only `AiRun` query with `meta.steps`, tools.sh = read-only
`AiToolCall` query, run.sh, all.sh), transcripts `.local/qa/journeys/R19/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs
`.local/qa/journeys/R19/out/run1.log` (J04), `run2.log` (J03), `airun.txt`, `steps.txt` (turn ↔ `AiRun` ↔ steps), `toolcalls.txt`,
`check.txt`, `lat.txt`, rendered turns `out/render.md`, screenshots `.local/qa/campaign/retest-ai-r19/`.

Cases asked for this round:
- **R18-1**: PF1 ×2, PG1 ×2, PG2 ×2 and PF1b — first message = a place only ⇒ both fees, matching the shop's settings, the free-delivery
  threshold wording right.
- **R18-2**: N3 T1, PG2 T2 ⇒ the price of the product being sold before the field / delivery questions.
- **R18-3**: N7, N11, N5 — latency and tool calls per turn (`Server-Timing`, `AiRun.meta.steps`).
- **R18-4**: N4, N16 wording.
- N9 (photo request) and N14 (cancel after an order), skipped in R18; the sweep; latency per turn; every R1–R18 guarantee (no order without a
  server recap — Critical; one order per « oui »; a « oui » with a change gives a new recap, never an order; no `create_order` before a phone;
  no confirm question / registered claim without a server recap; no wrong hand-off and every real one accepted; language and script kept; no
  invented discount; tracking real; address street, commune, wilaya; fees and prices match the shop's settings; no repeated or contradictory
  price / fee lines in one reply).

**Result: 30 / 33 conversations pass** — priority 1: 13 / 15 (PF1, PF1r, PF1b, PG1, PG1b, PG2, PG2b, N3, N7, N11, N16 pass; **N5 fails —
R19-1 (17.1 s server turn), N4 fails — R19-3 (« Merci Samir. »)**), priority 2: 2 / 2 (N9, N14 inside N1), sweep 18 / 19 (**F5 fails — R19-1,
11.5 s on the link**). **R18-1 fixed: 7 / 7 place-only first messages give both fees from a server `quote_delivery`** (PF1 « … Livraison : 650
DA à domicile, ou 350 DA en stop-desk si vous préférez. … », PF1r, PF1b, PG1 / PG1b « Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f
stop-desk ila t7ebb. », PG2 / PG2b « التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. »), no hand-off, every figure equal
to the shop's rule, the Oran free threshold said for the home fee only. **R18-2 fixed: N3 T1 « 2 tapis de prière à 2800 DA l'unité ! », PG2
T2 « Djellaba homme — 7500 دج », PG2b T2 « … بسعر 7500 دج (بدل 9000 دج) … » — the price before the questions in 15 / 15 turns that named a
product and asked a field / mode.** **R18-3 partly fixed: N7 T1 4.5 s server with 0 search (R18 12.0 s), PG1 T2 6.4 s (R18 10.0 s), PG2 T2
9.5 s (R18 10.4 s), no `fee_missing` corrective turn in 99 turns; but N5 T2 17.1 s (4 model calls and a `VALIDATION`) and F5 T1 11.5 s, and 26
turns pay an extra model call after asking a tool not offered (R19-1).** **R18-4 partly fixed: « tsajjel », « سجلت زوج », « c'est noté ! »
(N3), « ideale l », the N16 offer and « بلدية بوفاريك » are gone; N4 « Merci Samir. », « c'est noté : … » / « j'ai bien noté … » (F5, F1b, PF1,
N5) and the substitute question wording are left (R19-3).** New: two wrong `handoff_to_human {off_catalogue}` calls the platform refused
(N3 T2, F1b T4 — R19-2). **Latency: page median 5.1 s, p90 8.0 s, max 17.3 s; server median 4.8 s, p90 7.7 s, max 17.1 s (N5 T2); 2 page
times ≥ 10 s (N5 T2 17.3 / 17.1 s, F5 T1 11.7 / 11.5 s) — all server time, not network; `Server-Timing` on 99 / 99 answers; page − server
median 0.22 s, max 0.31 s; 0 provider error.** **0 order without a server recap; 22 TEST orders, each from a « oui / oui c'est bon / oui,
c'est bien … / wah / ih / ih saha / ih ndirha / ايه / 👍 » to a server recap, exactly one each; F11 « oui » refused as blocked; 0 « oui » to a
server recap lost; 3 « yes » with a change (N17 fr, N23 arabizi, N25 Arabic script) → a new recap, 0 order; 2 « oui » to no recap (N7 T2, N5
T3) → no order; 1 cancel after an order (N14) → the right order cancelled; 0 `create_order` before a phone in 52 calls; 1 `VALIDATION` (N5
T2); 0 wrong fee in 99 turns.** Failures — no Critical, no Major: R19-1 latency / extra model calls (Minor), R19-2 refused wrong hand-off
calls (Minor), R19-3 wording left (Cosmetic).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| PF1 | J03 · playground | fr, place alone then product | **T1 Sétif 650 / 350 (server quote)**; T2 price + both fees; recap → TEST-6313 | T3 5.6 s / 5.5 s | yes, 1 | PASS (R18-1) |
| PF1r | J03 · playground | fr, the PF1 messages again (2) | T1 650 / 350; T2 price first, then both fees | T1 5.6 s / 5.4 s | — (stopped at T2) | PASS (R18-1) |
| PF1b | J04 · playground | fr, place alone then product | T1 650 / 350; T2 price; recap → TEST-7017 | T2 6.7 s / 6.4 s | yes, 1 | PASS |
| PG1 | J04 · playground | arabizi, greeting + place | **T1 600 (batel men 20000 DA) / 400**; T2 price + fees 6.4 s; recap → « ih » → TEST-1288 | T2 6.6 s / 6.4 s | yes, 1 | PASS (R18-1, R18-3) |
| PG1b | J03 · playground | arabizi, greeting + place (2) | T1 600 (batel men 20000 DA) / 400; T2 price + both fees | T2 7.0 s / 6.8 s | — (stopped at T2) | PASS (R18-1) |
| PG2 | J03 · playground | Arabic script, greeting + place | **T1 450 / 300; T2 « Djellaba homme — 7500 دج »** before the questions; recap → « ايه » → TEST-9566 | T2 9.8 s / 9.5 s | yes, 1 | PASS (R18-1, R18-2; R19-3 wording) |
| PG2b | J04 · playground | Arabic script, greeting + place (2) | T1 450 / 300; T2 price « 7500 دج (بدل 9000 دج) » | T2 6.3 s / 6.1 s | — (stopped at T2) | PASS (R18-1, R18-2) |
| N3 | J03 · playground | fr → arabizi at T2 | **T1 price « 2800 DA l'unité »**; T2 both fees + recap, refused `handoff_to_human` → « ih saha » → TEST-6017 | T2 8.3 s / 8.0 s | yes, 1 | PASS (R18-2; R19-2) |
| N5 | J04 · playground | fr, out of stock « c'est combien ? » | substitute Hijab; **T2 17.3 s, 4 model calls, `VALIDATION`**; « oui » → recap; « oui » → TEST-7864 | **T2 17.3 s / 17.1 s** (slowest) | yes, 1 | FAIL — R19-1 |
| N7 | J03 · playground | fr, product not sold, then « oui » | **4.5 s, 0 search**; in-stock items only + Blida 450; no order, no hand-off | T2 5.4 s / 5.1 s | no (right) | PASS (R18-3) |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; T3 from `lookup_order` ×2 ({} then number), nothing invented | T2 5.1 s / 4.8 s | yes, 1 | PASS (R19-1 note) |
| N4 | J03 · playground | fr, Arabic-script name alone, « oui c'est bon » | **T2 « Merci Samir. »**; recap « سمير بن علي » → TEST-1344 | T3 6.3 s / 6.1 s | yes, 1 | FAIL — R19-3 |
| N16 | J04 · playground | arabizi, Illizi | « Ma nwasslouch l Illizi f had lwaqt, … » — no offer | T1 3.3 s / 3.0 s | — | PASS (R18-4) |
| N9 | J04 · playground | arabizi, photo request (NEW in R19) | « Ma 3andnach tsawer … » (no photo in the shop — right), fabric + sizes; recap → « ih » → TEST-6890 | T1 7.6 s / 7.4 s | yes, 1 | PASS |
| N1 + N14 | J03 · playground | fr, product + wilaya change, then « non annule » | new recap Oran → « oui » → TEST-1605 → **`cancel_order` TEST-1605 ok** | T3 5.2 s / 4.9 s | yes, 1, then cancelled | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED` | T2 6.8 s / 6.6 s | no (refused, as expected) | PASS |
| P2 | J04 · playground | arabizi, « wah » | arabizi recap (S) → TEST-1158 5 300 DA | T1 6.5 s / 6.3 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, « 👍 » | recap → TEST-6619 | T1 5.3 s / 5.1 s | yes, 1 | PASS |
| F9 | J04 · playground | arabizi, 3 wilayas | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 6.6 s / 6.4 s | — | PASS |
| F5 | J04 · shared link | fr / arabizi mixed, « oui c'est bon » | **T1 11.7 s**, fr + arabizi in one reply, 4900 DA + 400 / 250; recap → TEST-6890 | **T1 11.7 s / 11.5 s** | yes, 1 | FAIL — R19-1 (R19-3) |
| F12 | J04 · shared link | fr | « Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. … » | T1 2.8 s / 2.7 s | — | PASS |
| W1 | J04 · playground | fr, wholesale | platform HANDOFF, « Pour le prix de gros, l'équipe … va vous répondre. » | T1 2.6 s / 2.4 s | — (team) | PASS |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | `handoff_to_human {customer_request}` accepted | T1 2.6 s / 2.4 s | — (team) | PASS |
| C2 | J04 · playground | arabizi, broken order + refund | `handoff_to_human {refund}` accepted, arabizi reason sentence | T1 5.8 s / 5.5 s | — (team) | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 8.2 s / 8.1 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-6971 | T3 5.5 s / 5.4 s | yes, 1 | PASS |
| F1 | J03 · playground | fr, fields one per message | recap → TEST-6293 7 550 DA | T1 5.3 s / 5.1 s | yes, 1 | PASS |
| F1b | J03 · playground | fr, fields over 3 messages | T2 both fees; T4 → TEST-6293 + a refused `handoff_to_human` | T2 8.0 s / 7.7 s | yes, 1 | PASS (R19-2) |
| F3 | J03 · playground | arabizi, fields one per message, « ih ndirha » | « وليد بوزيد » kept → TEST-5998 | T4 8.1 s / 7.8 s | yes, 1 | PASS |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2670 9 100 DA | T2 5.4 s / 5.2 s | yes, 1 | PASS |
| N18 | J03 · playground | Arabic script, Latin name alone, « 👍 » | « Samir Benali » kept → TEST-8849 | T4 / T5 6.0 s / 5.8 s | yes, 1 | PASS |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-7072 | T2 8.4 s / 8.2 s | yes, 1 | PASS |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | T1 price, no « سجلت »; recap → TEST-1014 | T3 8.6 s / 8.4 s | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **22 / 22** (PF1, PF1b, PG1, PG2, N3, N5 T4, N11, N4, N9, N1, P2, N21,
  F5, N17, N25, F1, F1b, F3, F6, N18, N23, A3) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.** **« oui » to a correct
  recap lost: 0.** Yes forms that placed: « oui » ×7, « oui c'est bon » ×2 (N4 playground, F5 link), « oui, c'est bien … » ×1, « wah » ×1,
  « ih » ×3, « ih saha » ×1, « ih ndirha » ×1, « ايه » ×4, « 👍 » ×2. One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6
  quantity, N17 wilaya, N23 wilaya, N25 quantity). No second `create_order` after an order in a turn (F1b T4 called `handoff_to_human` after
  its order — refused, R19-2).
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N7 T2 (after the not-sold answer → the open question again), N5 T3
  (to the model's substitute question → the substitute's server recap, no order).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr → Alger 400 DA, 1 900 DA, core f4cd80… as R18), N23 T2 (arabizi → Oran
  600 DA, 8 100 DA), N25 T2 (Arabic script → 2 ×, 3 450 دج, core 1e692b… as R18); each next « oui / ih / ايه » → the order with the new
  recap's content.
- **Cancel after an order (N14): 1 / 1** — « non annule » right after TEST-1605 → one `cancel_order {orderNumber TEST-1605, customerConfirmed
  true}` → ok, « La commande TEST-1605 est bien annulée. … »; no hand-off, no other order touched.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **4 / 4** — PG1 (« Cité 1000 logements bloc 4 » /
  « cite 1000 logements bloc 4 »), N4 (« Cité 20 août, villa 3 » / « cité 20 août villa 3 »), N21 (« البليدة، بوفاريك، حي الورود رقم 12 » / « حي
  الورود رقم 12 »), PF1 T4 (adds `phoneConfirmed true`).
- **Confirming calls refused: 0** (22 + F11). **Recap calls refused: 0.** **`VALIDATION` refusals: 1 in 52 `create_order` calls** — N5 T2, a
  call for the out-of-stock Parfum Oud without `communeName` / `address` although the message carried them (R18: 0) — R19-1.
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **28 / 28**, the named variant every time
  (PF1, F1, F1b, N1 Marron; P2 S, N9 / F5 M); **in the customer's language 28 / 28** — Arabic script 7 (PG2, N11, N21, N25 ×2, N18, A3),
  arabizi 8 (PG1, N3, N9, P2, F5, F3, N23 ×2), French 13.
- **Server recap without a model sentence asking to confirm or describing the order: 28 / 28** — lead-ins left: N3 « Ih, nwasslou l
  Constantine : 700 DA l dar, wela 450 DA f stop-desk. » (the answer to « twasslou l Constantine ? », same fee as the recap), N5 the server's
  substitute line. **Outside any recap: 0 model turn asks to confirm the order or claims it registered.** Left before a recap: the substitute
  question N5 T2 « … je vous confirme : c'est bien le Hijab soie à 1500 DA que vous voulez ? » and N5 T1 « Voulez-vous que je vous le réserve
  ? » (a « oui » to them gives the server recap, not an order — as R16–R18); field-noted lines « C'est noté : robe kabyle brodée taille M … »
  (F5 T1), « c'est noté : Sétif, El Eulma » (F1b T2), « j'ai bien noté votre nom, votre numéro et El Eulma à Sétif » (PF1 T2), « j'ai bien noté
  Oran, Bir El Djir, … » (N5 T2) (R19-3).
- **Recap address « street, commune, wilaya »: 28 / 28** — A3 no separator, N21 whole message as address in the call, PG2 / N25 « ، », N18
  Latin name. **Street as the customer wrote it: 28 / 28** (first-letter capitals not counted, as R14–R18).
- **Fees never wrong: 99 / 99 turns** — every fee said or recapped matches the shop's rules above (Oran home under 20 000 DA paid — PG1 2 100
  DA, N5 2 100 DA, N1 600 DA, N23 600 DA; Oran stop-desk 400 DA in F9 with no free line; Illizi not served). **No asked fee missing.**
  **Place given with no question → both fees: 7 / 7** (PF1, PF1r, PF1b, PG1, PG1b, PG2, PG2b; R18 1 / 4). **Free-delivery threshold wording:
  3 / 3 right** — PG1 / PG1b « Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f stop-desk » (home only, the stop-desk not called
  free), N5 T2 « Livraison à domicile : 600 DA (gratuite dès 20000 DA). » (written « 20000 », not « 20 000 » — R19-3).
- **Price of the product being sold before the field / mode question: 15 / 15** — PF1 T2, PF1r T2, PF1b T2, PG1 T2, PG1b T2, PG2 T2, PG2b T2,
  N3 T1, N4 T1, F1 T1, F1b T1, F3 T1, A3 T1, N18 T1, N21 T1 (R18: PG2 T2 and N3 T1 missing). PF1 T2 writes it after the fees (R19-3).
- **No repeated or contradictory price / fee line in one reply: 99 / 99** (N3 T2 says 700 DA in the lead-in and in the recap — the same fee).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3.
- **Customer's name as written: 33 / 33 conversations in the recaps and orders** — Arabic script kept in French / arabizi chats (N4 « سمير بن
  علي », F3 « وليد بوزيد »), Latin kept in an Arabic chat (N18 « Samir Benali »); N4 T2 « Merci Samir. » and F3 T2 « Saha Walid. » write the
  first name in Latin in the sentence (R19-3); 0 name asked again once given.
- **Delivery question answered with the fee: 4 / 4** — F9 (three wilayas), N16 (not served), F12 on the link (Blida 450 / 300), N3 (Constantine
  both fees).
- **`create_order` before a phone is in the customer's messages: 0 / 52 calls.**
- **Hand-offs: 4 / 4 real ones accepted, 0 wrong accepted** — W1 decided by the platform with 0 tool call, H1 (`customer_request`) and C2
  (`refund`) by the model's own call (accepted), F11's by the server (`CUSTOMER_BLOCKED`). **2 wrong `handoff_to_human {off_catalogue}` calls,
  both refused by the platform (`HANDOFF_NOT_NEEDED`, why `no_product`)** — N3 T2 on « khouya twasslou l Constantine ? », F1b T4 on the « oui,
  c'est bien la cité … » that placed TEST-6293 (R18: 0) — R19-2. No hand-off on the 7 place-first messages, a product not sold (N7), a
  tracking question (N11), a photo request (N9), a cancel (N14), a « yes » message, an out-of-stock product (N5). AI sentence for the reason,
  in the customer's script: 4 / 4.
- **No 503 / provider error: 99 / 99 turns**; `AiRun` 99 rows, 95 `ok` + 4 `handoff` (F11 T2, W1, H1, C2), 0 `error`, 0 fallback, `attempt` 1
  everywhere; 8 runs carry a reply-guard action (`guard_rewritten` 5 — PG2b T2 repeat_greeting, N9 T1 moroccan_darija, F9 T1 moroccan_darija,
  N4 T2 / T3 language_switch; `guard_enforced` 2 — P2 T1, N21 T1 moroccan_darija stripped; `guard_kept` 1 — F5 T1 language_switch left);
  **0 `fee_missing` corrective turn** (R18: F1b T2).
- Latency: **page median 5.1 s, p90 8.0 s, max 17.3 s on 99 turns** (N5 T2 17.3 / 17.1 s, F5 T1 11.7 / 11.5 s, PG2 T2 9.8 / 9.5 s, A3 T3 8.6
  / 8.4 s, N23 T2 8.4 / 8.2 s, N3 T2 8.3 / 8.0 s, N17 T2 8.2 / 8.1 s, F3 T4 8.1 / 7.8 s, A3 T2 8.0 / 7.8 s); page median J04 5.3 s, J03 4.9 s;
  **server (`Server-Timing` total) median 4.8 s, p90 7.7 s, max 17.1 s**; `AiRun` median 4.77 s, p90 7.64 s, max 17.09 s (N5 T2); API
  « playground turn answered » lines: 99 since 06:50, `waitMs − runMs` max 152 ms, 0 replay, 0 « did not finish »; 1 POST per turn seen by the
  page; page − server median 0.22 s, max 0.31 s. 9 turns ≥ 8 s on the page, **2 ≥ 10 s on the server (N5 T2, F5 T1)** (R18: 3 — N7 T1, PG2 T2,
  PG1 T2, all under 10 s now).
- **Model calls (`AiRun.meta.steps`): 216 in 99 turns** — 1 call 21 turns, 2 calls 42, 3 calls 33, 4 calls 3 (N5 T2, N3 T2, N23 T2); the next
  call came for `tools` 78×, `stray` 27× (26 turns), `guard` 8×, `format` 4×. A `stray` step (the model asked a tool not offered, the server
  answered « unavailable ») cost 58.4 s in total, 0.9–5.1 s each — 20 of them right after a recap / confirming `create_order` (N5 T4, F11 T1, P2 T3, N17 T1–T3, PF1 T3, PG2 T3–T4, N3 T3, N4 T5,
  F1b T3, F3 T4, N18 T4–T5, N23 T2 ×2 and T3, A3 T2–T3), 7 in a turn with no tool run (PG2 T2 5.1 s, PG1b T2, N7 T2, N4 T3, F1 T1, F1 T2, F1b T2) — R19-1.
- Quantity never asked again after a product is named: **0 quantity question in 99 turns** (« 2 tapis », « zoudj », « زوج », « 3 tapis au lieu
  de 2 », « ديرلي جوج », « wahed », « واحد » kept).
- Language kept: arabizi **10 / 10** (PG1, PG1b, F9, N16, N9, C2, F3, P2, N23, N3 after the switch), Arabic-script darija **7 / 7** (PG2,
  PG2b, N21, N11, N25, N18, A3), French **15 / 15**; F5 (customer mixed fr / arabizi) T1 mixes both in one French reply (R19-3), T2 / T3
  arabizi.
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard rewrote / stripped a Moroccan form in 4 replies (N9
  T1, F9 T1, P2 T1, N21 T1) before they were sent.
- **Out-of-stock product offered: 0** — N7 lists Sac (Noir / Marron), Basket Runner, Tapis; P2 / N9 « L makach dork » (said unavailable, not
  offered); N5 names the Parfum Oud only because the customer asked for it. PG2 T1's category list « … عطور … » names perfumes, the shop's
  only perfume being out of stock (R19-3).
- **Photo request (N9): 1 / 1 honest** — no photo in the J04 shop, « Ma 3andnach tsawer … », the card has no image, no photo claimed (check.cjs
  « PHOTO-CLAIM » 0).
- No Markdown in a reply: **99 / 99**. No invented discount: only the catalogue's old prices (Hijab « au lieu de 2000 DA », Djellaba « بدل
  9000 دج »); Oran free delivery only from 20 000 DA.
- Tool calls run in 99 turns (playground 95 turns from the response + shared link 4 turns from `AiToolCall`): `create_order` 52 (28 recaps +
  22 orders + 1 blocked + 1 `VALIDATION`), `quote_delivery` 17 (the 7 place-first T1 + N7 T1 server quotes, N5 T2, N3 T2, F1b T2, F9 ×3, N16,
  F5 T1, F12), `lookup_order` 3 (N11 T3 ×2, N5 T3 `{}`), `search_products` 2 (N5 T1, N18 T1), `cancel_order` 1 (N14, right),
  `handoff_to_human` 4 (H1, C2 accepted; N3, F1b refused), `get_product` 0, `check_availability` 0, `add_faq_candidate` 0. Asked by the model
  but not run (in `meta.steps`, no `AiToolCall` row, not in the response): `search_products` 8 (PG1 T2, N5 T2, F5 T2, PF1r T1, PG2 T1, F1b T2, F6 T1, F6 T2), `get_product` 2 (N5 T2, P2 T1); **search asked after a recap call: 3 (F5 T2, F6 T1, F6 T2; R18 0)**.
  Turns with more than one tool run: F9 (3 quotes), N3 T2 (quote + recap + refused hand-off), N5 T2 (`VALIDATION` + quote), N5 T3 (recap +
  `lookup_order {}`), N11 T3 (2 lookups), F1b T4 (order + refused hand-off).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls run, with their results (draft / core = first 6 characters of the server keys). Calls the model asked but the server did not run are not listed here; they are in `out/steps.txt` and quoted in the verdicts. Every J03 conversation has the « out_of_hours » system line. Shared-link turns (F5, F12) carry no tool calls, cards or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### PF1 — J03 playground (UI fr)
**Verdict: PASS (R18-1 fixed, place first, fr, the exact R17-1 / R18-1 message, J03 out of hours) — T1 the server's `quote_delivery {19}` → « … Nous livrons bien à Sétif et El Eulma. Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Qu'est-ce qui vous intéresse aujourd'hui ? » (R18: no fee), no hand-off, 2.7 s; T2 price and both fees before the address / mode question, 0 tool call, but the server's price sentence comes after the fees and the model echoes the fields « j'ai bien noté votre nom, votre numéro et El Eulma à Sétif » (R19-3); T3 recap 7 550 DA, T4 « oui » → TEST-6313. `AiRun` 01a1ed3b-5204… (T1).**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, merci de m'avoir indiqué votre localisation ! Nous livrons bien à Sétif et El Eulma. Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Qu'est-ce qui vous intéresse aujourd'hui ? »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Excellent choix, le sac en cuir véritable Marron est disponible ! Merci Karim, j'ai bien noté votre nom, votre numéro et El Eulma à Sétif. À domicile : 650 DA, en stop-desk : 350 DA. Sac à main cuir (Marron) : 6900 DA. Quelle est votre adresse exacte (rue, cité, numéro de bâtiment) pour la livraison à domicile, ou préférez-vous le stop-desk ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 5.6 s (server 5.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.4 s (server 4.2 s)
  - AI: « Votre commande TEST-6313 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true, phoneConfirmed true} → ok TEST-6313, total 7550`

### PF1r — J03 playground (UI fr)
**Verdict: PASS (R18-1 fixed, run 2 of the same messages on J03, out of hours, stopped after T2) — T1 « Bonne nouvelle, on livre bien à Sétif (et El Eulma) en 2 à 5 jours. Le tarif est de 650 DA à domicile, ou 350 DA en stop-desk. … » (one quote; the model also asked a `search_products` the server answered without running it, 5.4 s); T2 « … disponible à 6900 DA. Merci Karim ! À domicile : 650 DA, en stop-desk : 350 DA. … » — price first this time.**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 5.6 s (server 5.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Bonne nouvelle, on livre bien à Sétif (et El Eulma) en 2 à 5 jours. Le tarif est de 650 DA à domicile, ou 350 DA en stop-desk. Vous cherchez quelque chose en particulier ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 4.0 s (server 3.7 s)
  - AI: « Excellent choix, le sac à main en cuir véritable marron est disponible à 6900 DA. Merci Karim ! À domicile : 650 DA, en stop-desk : 350 DA. Pour la livraison à El Eulma, vous préférez qu'on vous le livre à domicile (dites-moi votre adresse : rue, cité, numéro de bâtiment) ou en stop-desk ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)

### PF1b — J04 playground (UI fr)
**Verdict: PASS (place first, fr, J04, in hours) — T1 `quote_delivery {19}` → « Très bien, merci pour l'info ! Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. … » — both fees, matching the shop's Sétif rule (650 / 350, no free threshold); T2 « Hijab soie : 1500 DA » + the street question with both fees; T3 recap 2 150 DA; « oui » → TEST-7017 (same simulated number as R18, same content).**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 4.3 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Très bien, merci pour l'info ! Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Qu'est-ce qui vous intéresse aujourd'hui ? Dites-moi le produit ou le type d'article que vous cherchez, et je vous présente ce qu'on a. »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais 1 hijab soie. Karim Haddad 0770112233 » · `fr` · 6.7 s (server 6.4 s)
  - AI: « Merci Karim ! Hijab soie : 1500 DA. Pour finaliser, pouvez-vous me donner votre rue, cité ou un repère à El Eulma pour la livraison à domicile (650 DA) ? Sinon, on peut le passer en stop-desk (350 DA). »
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.0 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 2 150 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft eff6e2… core 393f6e…, recap total 2150`
- **T4** C: « oui » · `fr` · 4.9 s (server 4.6 s)
  - AI: « Votre commande TEST-7017 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 650 DA ⏎ Total : 2 150 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …450a, customerConfirmed true} → ok TEST-7017, total 2150`

### PG1 — J04 playground (UI fr)
**Verdict: PASS (R18-1 fixed, greeting + place, arabizi, J04) — T1 the server's `quote_delivery {31}` → « Ahlan bik! Saha. Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. Wach men produit t7ebb ? … » — both fees and the free-home threshold, right for Oran (home 600 DA, free from 20 000 DA, home only; stop-desk 400 DA) and right that the free line is tied to « l dar » (R18: no fee); T2 price + both fees + mode / address question, **6.4 s server (R18 10.0 s)**, no « tsajjel » (R18-4 fixed here); T3 arabizi recap 2 100 DA (threshold not reached, 600 DA paid — right); T4 « ih » → TEST-1288.**

- **T1** C: « slm, ana f Oran, Bir El Djir » · `arabizi` · 3.1 s (server 2.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ahlan bik! Saha. Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. Wach men produit t7ebb ? Ana hna nsa3dek. »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T2** C: « nheb hijab soie wahed, smiti Nadia Kaci 0661234568 » · `arabizi` · 6.6 s (server 6.4 s)
  - AI: « Saha Nadia, Hijab soie wahed, 1500 DA. T7ebb nwasslouha l dar (600 DA) wela f stop-desk (400 DA) ? Ila l dar, a3tini l'adresse ta3ek (rue, cité, numéro ta3 dar). »
- **T3** C: « cite 1000 logements bloc 4 » · `arabizi` · 3.9 s (server 3.7 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Smitek: Nadia Kaci ⏎ Numéro: 0661234568 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 062285… core 22b9bb…, recap total 2100`
- **T4** C: « ih » · `arabizi` · 3.8 s (server 3.6 s)
  - AI: « Commande ta3ek TEST-1288 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-1288, total 2100`

### PG1b — J03 playground (UI fr)
**Verdict: PASS (R18-1 fixed, the PG1 message on the J03 shop, out of hours, stopped after T2) — T1 « Ahlan bik ! Saha, Oran w Bir El Djir. Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. … » (same server sentence); T2 « Saha Nadia. Tapis de prière wahed, 2800 DA. L dar: 600 DA, f stop-desk: 400 DA. … » — price, both fees, then the question (6.8 s, one extra model call after a tool not offered — R19-1).**

- **T1** C: « slm, ana f Oran, Bir El Djir » · `arabizi` · 2.8 s (server 2.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Ahlan bik ! Saha, Oran w Bir El Djir. Tawsil: 600 DA (batel men 20000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. Wach men produit t7ebb tchouf wella tchri ? »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T2** C: « nheb tapis de prière wahed, smiti Nadia Kaci 0661234568 » · `arabizi` · 7.0 s (server 6.8 s)
  - AI: « Saha Nadia. Tapis de prière wahed, 2800 DA. L dar: 600 DA, f stop-desk: 400 DA. T7ebb nwasslouh l dar (a3tini l'adresse ta3ek: rue, cité, numéro ta3 dar) wela f stop-desk ? »

### PG2 — J03 playground (UI ar)
**Verdict: PASS (R18-1 / R18-2 fixed, greeting + place, Arabic script, J03 out of hours) — T1 the server's `quote_delivery {9}` → « … التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. … » (R18: no fee; « بلدية بوفاريك » gone) but « نحبوك تلقى اللي تقلب عليه » and a category list with « عطور » (the shop's only perfume is out of stock) — R19-3; T2 the Djellaba's price « Djellaba homme — 7500 دج » before the questions (R18: missing), but the fee sentence is put between two questions (R19-3) and the turn takes **9.5 s server** with 0 tool call (5.1 s model call, a tool not offered, a second 4.3 s call — R19-1); T3 recap 7 950 دج « حي 20 أوت فيلا 3، بوفاريك، البليدة »; T4 « ايه » → TEST-9566.**

- **T1** C: « السلام عليكم، أنا من البليدة بوفاريك » · `ar` · 5.2 s (server 4.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « أهلا بيك يا خويا! نحبوك تلقى اللي تقلب عليه. التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش تحب تشري؟ عندنا لباس، ساك يد، عطور، سجادات الصلاة وحاجات أخرى. »
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « نحب جلابة رجالي، سمير بن علي 0661234567 » · `ar` · 9.8 s (server 9.5 s)
  - AI: « صحيت يا سمير. Djellaba homme — 7500 دج، بصوف فين وبلون بيج، تايل وحدة. واش العنوان تاعك في بوفاريك؟ للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. عطيني الشارع والحي ورقم الدار، ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T3** C: « حي 20 أوت فيلا 3 » · `ar` · 6.2 s (server 5.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 20 أوت فيلا 3، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7f4e2c… core 9bff87…, recap total 7950`
- **T4** C: « ايه » · `ar` · 5.9 s (server 5.7 s)
  - AI: « تم تسجيل طلبيتك TEST-9566 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → ok TEST-9566, total 7950`

### PG2b — J04 playground (UI ar)
**Verdict: PASS (R18-1 / R18-2 fixed, the PG2 message on the J04 shop, stopped after T2) — T1 « وعليكم السلام ورحمة الله، مرحبا بيك من بوفاريك! التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش تحب تشري اليوم؟ » (2.6 s); T2 « Djellaba homme بسعر 7500 دج (بدل 9000 دج)، بيج، مقاس وحيد، وهي متوفرة. … » — price (catalogue old price, no invented discount) before the address / stop-desk question; the guard rewrote a `repeat_greeting`.**

- **T1** C: « السلام عليكم، أنا من البليدة بوفاريك » · `ar` · 2.9 s (server 2.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام ورحمة الله، مرحبا بيك من بوفاريك! التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش تحب تشري اليوم؟ »
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « نحب جلابة رجالي، سمير بن علي 0661234567 » · `ar` · 6.3 s (server 6.1 s)
  - AI: « Djellaba homme بسعر 7500 دج (بدل 9000 دج)، بيج، مقاس وحيد، وهي متوفرة. باش نكملو الطلب، عطيني العنوان تاعك في بوفاريك (الشارع، الحي، رقم الدار) ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)

### N3 — J03 playground (UI fr)
**Verdict: PASS (R18-2 fixed: T1 « Parfait Samira, 2 tapis de prière à 2800 DA l'unité ! … » — the price before the wilaya question, R18: no price) — T2 arabizi « twasslou l Constantine ? » + street → « Ih, nwasslou l Constantine : 700 DA l dar, wela 450 DA f stop-desk. » + the arabizi recap 6 300 DA (one fee line in the lead-in, the same 700 DA in the recap — not contradictory); but in that turn the model also called `handoff_to_human {off_catalogue, evidence «khouya twasslou l Constantine ?»}` — refused by the platform (`HANDOFF_NOT_NEEDED`, no hand-off) — R19-2; 3 tool calls, 8.0 s server; T3 « ih saha » → TEST-6017.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 3.0 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Samira, 2 tapis de prière à 2800 DA l'unité ! Pour la livraison, dans quelle wilaya êtes-vous ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 8.3 s (server 8.0 s)
  - AI: « Ih, nwasslou l Constantine : 700 DA l dar, wela 450 DA f stop-desk. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300` · `handoff_to_human {off_catalogue, evidence «khouya twasslou l Constantine ?»} → HANDOFF_NOT_NEEDED`
- **T3** C: « ih saha » · `arabizi` · 5.6 s (server 5.4 s)
  - AI: « Commande ta3ek TEST-6017 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-6017, total 6300`

### N5 — J04 playground (UI fr)
**Verdict: FAIL — R19-1 (out of stock, price asked, fr, J04; priority latency / tool calls) — T1 price + unavailable + a substitute (now the Hijab soie, in stock, catalogue old price « au lieu de 2000 DA ») « … Voulez-vous que je vous le réserve ? »; **T2 « Bon finalement je le prends … » took 17.3 s page / 17.1 s server** — 4 model calls (`get_product` 4.1 s, `search_products` 3.4 s, `create_order` for the **out-of-stock Parfum Oud 50 ml without commune and address → `VALIDATION`** 3.6 s, reply 5.8 s; R18 9.7 s with no call); reply « … Livraison à domicile : 600 DA (gratuite dès 20000 DA). Le Parfum Oud étant en rupture, je vous confirme : c'est bien le Hijab soie à 1500 DA que vous voulez ? » (fee and threshold right; wording R19-3); T3 « oui » → server substitute line + recap Hijab 2 100 DA (Oran paid under 20 000 DA — right) plus a stray `lookup_order {}`; T4 « oui » → TEST-7864. One order from the one « oui » to the server recap.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 6.2 s (server 6.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez un cadeau ou une touche d'élégance, notre Hijab soie est en stock à 1500 DA (au lieu de 2000 DA), en soie douce 180 x 70 cm. Voulez-vous que je vous le réserve ? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«parfum»} → 1 product(s)`
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 17.3 s (server 17.1 s)
  - AI: « Merci Karim, j'ai bien noté Oran, Bir El Djir, cité 1000 logements bloc 4. Livraison à domicile : 600 DA (gratuite dès 20000 DA). Le Parfum Oud étant en rupture, je vous confirme : c'est bien le Hijab soie à 1500 DA que vous voulez ? »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, items 1×product …8c00, customerConfirmed true} → VALIDATION communeName` · `quote_delivery {31} → fee 600 / stop-desk 400`
- **T3** C: « oui » · `fr` · 6.9 s (server 6.7 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Hijab soie. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft caa1f7… core 72d9fb…, recap total 2100` · `lookup_order {} → 0 order`
- **T4** C: « oui » · `fr` · 6.8 s (server 6.6 s)
  - AI: « Votre commande TEST-7864 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-7864, total 2100`

### N7 — J03 playground (UI fr)
**Verdict: PASS (R18-3 fixed for this turn) — T1 4.7 s / 4.5 s server (R18 12.3 / 12.0 s), **0 `search_products`** (R18 two), one server quote for the named Blida: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. En revanche, nous avons en stock un sac à main en cuir véritable (Noir ou Marron, 6900 DA), un Basket Runner (12500 DA) ou un tapis de prière (2800 DA). Livraison à domicile : 450 DA. … » — in-stock items only (no Rouge, no Montre); T2 « oui » → the open question again, no order, no hand-off.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.7 s (server 4.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. En revanche, nous avons en stock un sac à main en cuir véritable (Noir ou Marron, 6900 DA), un Basket Runner (12500 DA) ou un tapis de prière (2800 DA). Livraison à domicile : 450 DA. Lequel vous intéresse, Yacine ? »
  - cards: « Sac à main cuir 6900 DA » (no photo) · « Tapis de prière 2800 DA » (no photo)
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « oui » · `fr` · 5.4 s (server 5.1 s)
  - AI: « Parfait Yacine, merci pour vos informations ! Quel article vous intéresse : le sac à main en cuir (Noir ou Marron), le Basket Runner ou le tapis de prière ? »

### N11 — J04 playground (UI ar)
**Verdict: PASS (tracking, Arabic script) — recap 8 200 دج → « ايه » → TEST-4074; T3 from `lookup_order` (status new / not_sent, no tracking number), nothing invented: « … قيد التحضير، ما خرجتش للتوصيل بعد. ما عندناش حتى الآن رقم تتبع … ». T3 still makes two lookups — `lookup_order {}` (already returns TEST-4074) then `lookup_order {orderNumber TEST-4074}` (R18: phone then number) — R19-1; 4.1 s.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.6 s (server 4.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 5.1 s (server 4.8 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 4.3 s (server 4.1 s)
  - AI: « الطلبية تاعك رقمها TEST-4074 وهي راهي قيد التحضير، ما خرجتش للتوصيل بعد. ما عندناش حتى الآن رقم تتبع ولا شركة توصيل مسجلة. التوصيل يدير من 2 إلى 5 أيام كي تخرج الطلبية، وإذا تخرج نبعثلك رقم التتبع. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null` · `lookup_order {"orderNumber":"TEST-4074"} → TEST-4074 new / not_sent, tracking null`

### N4 — J03 playground (UI fr)
**Verdict: FAIL — R19-3 (Cosmetic; wording asked this round, R18-4) — T1 price + next field; T2 « سمير بن علي » → **« Merci Samir. Pouvez-vous me donner votre numéro de téléphone ? … »** — the customer's Arabic-script name still written in Latin letters (R18 « je note le nom : Samir Ben Ali »; the R18-4 fix covers a 2–4-word transliteration, this is one word); the recap and the order keep « سمير بن علي »; guard rewrote a `language_switch` in T2 and T3; T5 « oui c'est bon » → TEST-1344, one order.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 3.3 s (server 3.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Tapis de prière — 2800 DA, molletonné et confortable, format 120 x 70 cm, et il est disponible. Pour commencer la commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `fr` · 3.4 s (server 3.2 s)
  - AI: « Merci Samir. Pouvez-vous me donner votre numéro de téléphone ? (exemple : 0555123456) »
- **T3** C: « 0661234567 » · `fr` · 6.3 s (server 6.1 s)
  - AI: « Parfait. Dans quelle wilaya souhaitez-vous recevoir la commande ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.8 s (server 4.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui c'est bon » · `fr` · 5.8 s (server 5.5 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N16 — J04 playground (UI fr)
**Verdict: PASS (R18-4 offer gone) — `quote_delivery {Illizi}` → `WILAYA_NOT_SERVED`; « Ma nwasslouch l Illizi f had lwaqt, la livraison ma tatwasslch l had la wilaya. » — no « nqder n3awnek … » offer (R18-4 fixed); the second clause repeats the first with French words (R19-3); the model asked 2 quotes, 1 ran; 3.0 s.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 3.3 s (server 3.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma nwasslouch l Illizi f had lwaqt, la livraison ma tatwasslch l had la wilaya. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### N9 — J04 playground (UI fr)
**Verdict: PASS (photo request, arabizi, J04 — not run in R18) — the J04 « Robe kabyle brodée » has no photo (read-only `ProductImage`: 0 rows; only the J03 robe has 1), and the reply says so instead of claiming one: « Ma 3andnach tsawer ta3 la robe kabyle brodée f had lwaqt, bessah hia mtarza b lyedd b qmach khfif, mlih bezzaf l l3rass w lmounasabat. Lmqasat li kaynin: S, M w XL (L makach dork). Taman: 4900 DA l S w M, 5200 DA l XL. … » — fabric, sizes, L said unavailable (stock 0) and not offered, prices per size right; card without photo; guard rewrote a `moroccan_darija` form before sending; T2 size + fields → arabizi recap 5 300 DA; T3 « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 7.6 s (server 7.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma 3andnach tsawer ta3 la robe kabyle brodée f had lwaqt, bessah hia mtarza b lyedd b qmach khfif, mlih bezzaf l l3rass w lmounasabat. Lmqasat li kaynin: S, M w XL (L makach dork). Taman: 4900 DA l S w M, 5200 DA l XL. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.4 s (server 4.2 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 4.8 s (server 4.5 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N1 + N14 — J03 playground (UI fr)
**Verdict: PASS (N1 + N14, fr — N14 not run in R18) — T1 recap Djellaba 7 950 DA; T2 product + wilaya + address change → a new recap Sac Marron, Oran 600 DA, 7 500 DA (no order); T3 « oui » → TEST-1605; **T4 « non annule » → `cancel_order {orderNumber TEST-1605, customerConfirmed true}` → ok, « La commande TEST-1605 est bien annulée. Si vous changez d'avis, je suis là pour vous aider. »** — the right order, one call, no hand-off, 3.6 s.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.5 s (server 4.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.2 s (server 4.9 s)
  - AI: « Votre commande TEST-1605 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-1605, total 7500`
- **T4** C: « non annule » · `fr` · 3.8 s (server 3.6 s)
  - AI: « La commande TEST-1605 est bien annulée. Si vous changez d'avis, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-1605","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-1605`

### F11 — J04 playground (UI fr)
**Verdict: PASS (blocked number) — recap → « oui » → `CUSTOMER_BLOCKED` (server), « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », HANDOFF; no block mentioned, no order.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 6.1 s (server 5.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 6.8 s (server 6.6 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### P2 — J04 playground (UI fr)
**Verdict: PASS (« wah », arabizi) — T1 sizes S / M / XL with their prices, « Taille L makach dork » (L stock 0, not offered), no French inside the arabizi (R18 « ideale l … » gone; the guard stripped a Moroccan form before sending); T2 arabizi recap (S) 5 300 DA; « wah » → TEST-1158.**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 6.5 s (server 6.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykoum salam ! Robe kabyle brodée — 4900 DA (taille S w M), w XL b 5200 DA. Taille L makach dork. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.6 s (server 4.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « wah » · `arabizi` · 6.2 s (server 5.9 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### N21 — J04 playground (UI ar)
**Verdict: PASS (Arabic script, fields one per message) — T1 price; T2 / T3 next field « … واش هو رقم الهاتف تاعك … » / « … واش من ولاية تحبي نوصلوها ليها؟ »; T4 recap « حي الورود رقم 12، بوفاريك، البليدة » 1 950 دج (the recap call sent the whole message as the address, the recap shows street, commune, wilaya); « 👍 » → TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 5.3 s (server 5.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا Hijab soie — 1500 دج، حرير ناعم وخفيف بمقاس 180 x 70 سم، وراهو متوفر درك. تحب نكملو الطلب ولا تحب تشوف حاجة أخرى؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.5 s (server 2.3 s)
  - AI: « تشرفنا يا نادية! واش هو رقم الهاتف تاعك باش نكملو الطلب؟ (مثال: 0555123456) »
- **T3** C: « 0661234568 » · `ar` · 2.4 s (server 2.2 s)
  - AI: « صحيت يا نادية. واش من ولاية تحبي نوصلوها ليها؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.1 s (server 3.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 5.3 s (server 5.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### F9 — J04 playground (UI fr)
**Verdict: PASS (arabizi, 3 wilayas) — 3 quotes in one step: Sétif 650 / 350, Oran stop-desk 400 (no free line for the stop-desk — right, the threshold is home only), Illizi not served; no closing offer; guard rewrote a Moroccan form; 6.4 s.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 6.6 s (server 6.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Illizi, ma nwasslouch hna f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F5 — J04 shared link (UI fr)
**Verdict: FAIL — R19-1 (shared link, fr / arabizi mixed) — **T1 11.7 s page / 11.5 s server** (3 model calls: a format retry 4.8 s, a guard retry 4.3 s for `language_switch` that stayed — `guard_kept` — then 2.2 s); the reply mixes French and arabizi in one sentence and keeps the « noted » form: « Merci Amina ! C'est noté : robe kabyle brodée taille M b 4900 DA, 1 pièce. L dar: 400 DA, f stop-desk: 250 DA. Quelle est votre adresse exacte … ? » (R19-3; price and Alger 400 / 250 right); T2 arabizi recap 5 300 DA (+ a `search_products` asked after the recap call, not run); T3 « oui c'est bon » → TEST-6890. Tool calls from `AiToolCall`: T1 `quote_delivery {16, subtotal 4900}`, T2 / T3 `create_order`.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 11.7 s (server 11.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Merci Amina ! C'est noté : robe kabyle brodée taille M b 4900 DA, 1 pièce. L dar: 400 DA, f stop-desk: 250 DA. Quelle est votre adresse exacte à Bab Ezzouar (rue, cité, numéro de bâtiment) ? Ou préférez-vous la récupérer en stop-desk ? »
- **T2** C: « rue des frères Bouadou n 5 » · 5.9 s (server 5.7 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 5.9 s (server 5.8 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link, fr) — « Bonsoir 😊 Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. … » (one `quote_delivery {Blida}` in `AiToolCall`; check.cjs « DELIVERY-Q-NO-FEE » is a false hit of its regex); 2.7 s.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.8 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. Vous cherchez un produit en particulier ? »

### W1 — J04 playground (UI fr)
**Verdict: PASS (wholesale) — platform HANDOFF, 0 tool call (R18: the model's `off_catalogue`), « Pour le prix de gros, l'équipe de la boutique va vous répondre. »; 2.4 s.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 2.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Pour le prix de gros, l'équipe de la boutique va vous répondre. »

### H1 — J04 playground (UI fr)
**Verdict: PASS — `handoff_to_human {customer_request}` accepted, « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »; 2.4 s.**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 2.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »
  - tools: `handoff_to_human {customer_request, evidence «je veux parler à quelqu'un»} → ok`

### C2 — J04 playground (UI fr)
**Verdict: PASS — `handoff_to_human {refund}` accepted, arabizi reason sentence « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. »; 5.5 s.**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 5.8 s (server 5.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. »
  - tools: `handoff_to_human {refund, evidence «wsaltni la commande mkassra, nheb tredouli drahmi»} → ok`

### N17 — J04 playground (UI fr)
**Verdict: PASS (« oui mais livrez à … », fr) — T2 a new recap Alger 400 DA 1 900 DA, no order; T3 « oui » → TEST-8063. Every turn has an extra model call after a tool not offered (7.0 / 8.1 / 7.1 s — R19-1).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 7.3 s (server 7.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 8.2 s (server 8.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 7.3 s (server 7.1 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N25 — J04 playground (UI ar)
**Verdict: PASS (« ايه بصح ديرلي جوج », Arabic script) — T2 a new recap 2 × 3 450 دج, no order; T3 « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.1 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 4.8 s (server 4.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 5.5 s (server 5.4 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### F1 — J03 playground (UI fr)
**Verdict: PASS (fr, fields one per message) — T1 price + name question; T2 / T3 next field; T4 recap 7 550 DA; T5 « oui » → TEST-6293.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 5.3 s (server 5.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le sac à main cuir en Marron est disponible à 6900 DA. Pour continuer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 3.9 s (server 3.6 s)
  - AI: « Merci Karim ! Pour finaliser votre commande du sac à main cuir Marron, quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233 » · `fr` · 2.0 s (server 1.8 s)
  - AI: « Merci Karim ! Dans quelle wilaya souhaitez-vous recevoir le sac ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 4.3 s (server 4.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS (fr, fields over 3 messages) — T1 price + wilaya question; T2 both fees + the street / stop-desk question (« Merci Karim, c'est noté : Sétif, El Eulma. » — R19-3); T3 recap; **T4 « oui, c'est bien la cité 500 … » → TEST-6293, and in the same turn the model called `handoff_to_human {off_catalogue, evidence «oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif»}` — refused by the platform (`HANDOFF_NOT_NEEDED`), so no hand-off (R19-2).**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 3.3 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en Marron est bien disponible, à 6900 DA. Vous êtes dans quelle wilaya ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Sétif, El Eulma » · `fr` · 8.0 s (server 7.7 s)
  - AI: « Merci Karim, c'est noté : Sétif, El Eulma. À domicile : 650 DA, en stop-desk : 350 DA. Quelle est votre adresse (rue, cité, numéro de bâtiment) pour la livraison à domicile, ou préférez-vous le stop-desk ? »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 6.1 s (server 5.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 5.8 s (server 5.6 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550` · `handoff_to_human {off_catalogue, evidence «oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif»} → HANDOFF_NOT_NEEDED`

### F3 — J03 playground (UI fr)
**Verdict: PASS (« ih ndirha », arabizi, Arabic-script name) — T1 « Zoudj tapis de prière … b 2800 DA l wa7da, yat3ti 5600 DA. Wach smitek ? »; T2 « Saha Walid. … » (the name in Latin in an arabizi sentence; recap / order keep « وليد بوزيد »); recap 6 050 DA → TEST-5998.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Zoudj tapis de prière (120 x 70 cm, molletonné) b 2800 DA l wa7da, yat3ti 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.7 s (server 2.5 s)
  - AI: « Saha Walid. A3tini numéro ta3ek (ex: 0555123456) bach nkamlou la commande. »
- **T3** C: « 0770112244 » · `arabizi` · 2.2 s (server 2.0 s)
  - AI: « Saha Walid. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 8.1 s (server 7.8 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih ndirha » · `arabizi` · 4.9 s (server 4.5 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F6 — J03 playground (UI fr)
**Verdict: PASS (quantity change, fr) — 2 → 3 new recap → « oui » → TEST-2670 9 100 DA. T1 and T2 asked a `search_products` after the recap call (not run — R19-1; R18: 0 search after a recap call).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 4.7 s (server 4.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 4.4 s (server 4.2 s)
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### N18 — J03 playground (UI ar)
**Verdict: PASS (Arabic script, Latin name alone, « 👍 ») — « Samir Benali » kept in the recap and the order → TEST-8849 8 200 دج (Constantine 700 — right).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 5.4 s (server 5.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا Djellaba homme، من صوف رفيع، لونها بيج، مقاس واحد، بسعر 7500 دج بدل 9000 دج. واش سميتك ؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar` · 2.4 s (server 2.1 s)
  - AI: « تشرفنا يا سمير! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكمل الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 1.9 s (server 1.7 s)
  - AI: « صحيت. واش من ولاية تحب نوصلوها ليك ؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 6.0 s (server 5.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T5** C: « 👍 » · `ar` · 6.0 s (server 5.9 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N23 — J03 playground (UI fr)
**Verdict: PASS (« ih bessah … », arabizi) — T2 a new recap Oran 600 DA 8 100 DA, no order (8.2 s, two extra model calls — R19-1); T3 « ih » → TEST-7072.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 3.9 s (server 3.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 8.4 s (server 8.2 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 7.4 s (server 7.2 s)
  - AI: « Commande ta3ek TEST-7072 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true, phoneConfirmed true} → ok TEST-7072, total 8100`

### A3 — J03 playground (UI ar)
**Verdict: PASS (Arabic script, Arabic-Indic digits) — T1 « صحيت. زوج Tapis de prière بـ 2800 دج للواحد، يعني 5600 دج. واش من ولاية ؟ » (R18 « سجلت زوج … » gone); « ٠٥٥٠١٢٣٤٥٦ » → 0550123456; T2 recap 6 300 دج (7.8 s); T3 « ايه » → TEST-1014 in **8.4 s** (create_order, a tool not offered, a third call — R19-1).**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 3.7 s (server 3.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت. زوج Tapis de prière بـ 2800 دج للواحد، يعني 5600 دج. واش من ولاية ؟ 🙏 »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 8.0 s (server 7.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft c58c18… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 8.6 s (server 8.4 s)
  - AI: « تم تسجيل طلبيتك TEST-1014 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-1014, total 6300`

## Bugs

### R19-1 — Two server turns ≥ 10 s; an extra model call in 26 turns; redundant lookups / searches
- Page: playground dialog / shared test page (owner / visitor, fr / ar, 1440) — both shops
- Severity: Minor
- Type: Bug
- Steps: J04 › « Tester moi-même »: N5 « Bonjour, le parfum oud c'est combien ? » → « Bon finalement je le prends. Karim Haddad 0770112233,
  Oran, Bir El Djir, cité 1000 logements bloc 4 »; J04 shared link: F5 « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432,
  wilaya Alger, Bab Ezzouar »; read `Server-Timing`, `AiRun.meta.steps`, the tool calls.
- Expected: server time under 10 s (R10-1); no tool call whose result the turn already has, no call the step does not offer (R11-3 …
  R18-3); no `create_order` without the fields the message gave.
- Actual:
  - **N5 T2** (06:51:49, **17.3 s page / 17.1 s server**, `AiRun` 01a1ed36-21a3…, 17 085 ms) — 4 model calls: `get_product` (4.1 s, not run),
    `search_products` (3.4 s, not run), `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, items 1 × Parfum Oud 50 ml (stock 0)}`
    with no `communeName` / `address` → `VALIDATION` « Not done: the customer has not given communeName, address yet … » (3.6 s), reply (5.8 s)
    → « Merci Karim, j'ai bien noté Oran, Bir El Djir, cité 1000 logements bloc 4. Livraison à domicile : 600 DA (gratuite dès 20000 DA). Le
    Parfum Oud étant en rupture, je vous confirme : c'est bien le Hijab soie à 1500 DA que vous voulez ? » (R18 N5 T2 9.7 s, 0 call).
  - **F5 T1** (shared link, 06:54:50, **11.7 s / 11.5 s**, `AiRun` 01a1ed38-e3e5…) — 3 model calls: 4.8 s → `format` retry, 4.3 s → guard retry
    (`language_switch`, kept: `guard_kept`), 2.2 s → « Merci Amina ! C'est noté : robe kabyle brodée taille M b 4900 DA, 1 pièce. L dar: 400
    DA, f stop-desk: 250 DA. Quelle est votre adresse exacte à Bab Ezzouar (rue, cité, numéro de bâtiment) ? Ou préférez-vous la récupérer en
    stop-desk ? » (the server's `quote_delivery {16}` 400 / 250 right).
  - **27 `stray` model calls in 26 turns** (the model asked a tool the step does not offer, the server answered « unavailable » and called
    the model again; 58.4 s in total): PG2 T2 9.5 s with 0 tool (`AiRun` 01a1ed3c-12c4…: 5.1 s → stray → 4.3 s); A3 T3 « ايه » 8.4 s
    (01a1ed41-2e00…: `create_order` 2.6 s → stray 2.3 s → 3.5 s); N23 T2 8.2 s (two strays); N17 T1–T3 7.0 / 8.1 / 7.1 s; F3 T4 7.8 s; A3 T2
    7.8 s; also N5 T4, F11 T1, P2 T3, PF1 T3, PG2 T3–T4, PG1b T2, N3 T3, N7 T2, N4 T3, N4 T5, F1 T1–T2, F1b T2–T3, N18 T4–T5, N23 T3. 20 of the
    27 follow a recap / confirming `create_order`, so a plain « oui » to a shown recap still costs 2–3 model calls (3.5–8.4 s).
  - Redundant calls: **N11 T3** `lookup_order {}` (already returns TEST-4074) then `lookup_order {orderNumber TEST-4074}` (`AiRun`
    01a1ed36-e49c…; R18: phone then number); **N5 T3** a `lookup_order {}` in the recap turn (→ `{orders: []}`); `search_products` asked after
    the recap call in F5 T2, F6 T1, F6 T2 (not run; R18: 0); 8 `search_products` / 2 `get_product` asked and not run (PG1 T2, N5 T2, F5 T2,
    PF1r T1, PG2 T1, F1b T2, F6 T1, F6 T2 / N5 T2, P2 T1), each a model step.
  - Fixed since R18-3: N7 T1 4.5 s with 0 search (R18 12.0 s, two searches), PG1 T2 6.4 s (R18 10.0 s), PG2 T2 9.5 s (R18 10.4 s), no
    `fee_missing` corrective turn (R18 F1b T2), 0 provider error, `waitMs − runMs` ≤ 152 ms (the time is in the run).
- Evidence: .local/qa/journeys/R19/out/transcripts/N5.json T2, F5.json T1, PG2.json T2, A3.json T3, N11.json T3 · out/airun.txt (`meta.steps`)
  · out/steps.txt · out/toolcalls.txt · .local/qa/campaign/retest-ai-r19/fr-N5-pg.png, fr-F5-link.png
- Likely cause: the model's own loop — it re-checks the product (`get_product`, `search_products`) when the customer takes a substitute, then
  tries `create_order` for the out-of-stock item named first; after a recap `create_order` it asks another tool the recap step does not offer
  (the « unavailable » answer costs a full model call); the F5 French / arabizi message triggers a format and a language retry.

### R19-2 — Wrong `handoff_to_human {off_catalogue}` calls on messages that name no product (refused by the platform)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim » (out of hours)
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: N3 « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » → « khouya twasslou l
  Constantine ? ana f El Khroub, cité 1000 logements bloc 5 »; F1b « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » →
  « Sétif, El Eulma » → « Cité 500 logements bloc 12 » → « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif ».
- Expected: no `handoff_to_human` for a delivery question or a « yes » to a recap (R4-1 / R11-2 / R13-1 / R17-1); R18: 0 such call.
- Actual (the platform refused both, so no hand-off happened and the turns went on):
  - **N3 T2** (06:59:10, 8.3 s / 8.0 s, `AiRun` 01a1ed3c-d978…, 4 model calls) — `quote_delivery {Constantine}` → 700 / 450, `create_order` →
    recap, then `handoff_to_human {reason off_catalogue, evidence «khouya twasslou l Constantine ?»}` → `HANDOFF_NOT_NEEDED` (why `no_product`,
    « HANDOFF REFUSED BY THE PLATFORM: the customer's message names no product at all … »); sent: « Ih, nwasslou l Constantine : 700 DA l dar,
    wela 450 DA f stop-desk. ⏎ Hada récap ta3 la commande: … Total: 6 300 DA … ».
  - **F1b T4** (07:01:37, 5.8 s / 5.6 s, `AiRun` 01a1ed3f-16bb…) — `create_order` → ok TEST-6293, then in the same turn `handoff_to_human
    {reason off_catalogue, evidence «oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif»}` → `HANDOFF_NOT_NEEDED`; sent: « Votre
    commande TEST-6293 est bien enregistrée ✅ … ».
- Evidence: .local/qa/journeys/R19/out/transcripts/N3.json T2, F1b.json T4 · out/check.txt (« HANDOFF off_catalogue → HANDOFF_NOT_NEEDED » ×2)
  · out/toolcalls.txt · out/steps.txt · .local/qa/campaign/retest-ai-r19/fr-N3-pg.png, fr-F1b-pg.png
- Likely cause: the model still reaches for `off_catalogue` on a message with a place / address and no product (the R17-1 family); the
  platform's `no_product` refusal holds, but each call costs a model step and, had it been accepted after an order (F1b), would have paused
  the AI on a finished sale.

### R19-3 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — both shops
- Severity: Cosmetic
- Type: Text
- Steps: run N4, F3, F5, F1b, PF1, N5, PG2, N16.
- Expected: the customer's name as written; nothing that reads like an order step before the server recap; one language per reply; the
  price before the fees and one question at the end; amounts written « 20 000 DA » (rule 11).
- Actual:
  - Name transliterated in the sentence: **N4 T2** (06:59:52, `AiRun` 01a1ed3d-7f26…, guard `language_switch` rewrite) « سمير بن علي » →
    « Merci Samir. Pouvez-vous me donner votre numéro de téléphone ? (exemple : 0555123456) » (R18 « je note le nom : Samir Ben Ali »; the R18-4
    fix handles 2–4 words, this is one); F3 T2 « smiti وليد بوزيد » → « Saha Walid. A3tini numéro ta3ek … » (arabizi). Recaps and orders keep
    the script (N4 « Nom : سمير بن علي », F3 « Smitek: وليد بوزيد »).
  - Field-noted lines before any recap: F5 T1 « Merci Amina ! C'est noté : robe kabyle brodée taille M b 4900 DA, 1 pièce. … », F1b T2 « Merci
    Karim, c'est noté : Sétif, El Eulma. … », PF1 T2 « … Merci Karim, j'ai bien noté votre nom, votre numéro et El Eulma à Sétif. … », N5 T2
    « Merci Karim, j'ai bien noté Oran, Bir El Djir, cité 1000 logements bloc 4. … ».
  - Substitute questions worded as an order step: N5 T1 « … Voulez-vous que je vous le réserve ? », N5 T2 « … je vous confirme : c'est bien le
    Hijab soie à 1500 DA que vous voulez ? » (their « oui » gives the server recap, not an order — right).
  - French and arabizi in one reply: F5 T1 (quoted above: « … taille M b 4900 DA … L dar: 400 DA, f stop-desk: 250 DA. Quelle est votre adresse
    … ? »), the guard's `language_switch` kept.
  - Order of the server's lines: PF1 T2 « Excellent choix, le sac en cuir véritable Marron est disponible ! … À domicile : 650 DA, en stop-desk
    : 350 DA. Sac à main cuir (Marron) : 6900 DA. Quelle est votre adresse … » (price after the fees); PG2 T2 « … واش العنوان تاعك في بوفاريك؟
    للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. عطيني الشارع والحي ورقم الدار، ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟ » (the fee
    sentence between two questions).
  - PG2 T1 « أهلا بيك يا خويا! نحبوك تلقى اللي تقلب عليه. … عندنا لباس، ساك يد، عطور، سجادات الصلاة وحاجات أخرى. » — an odd sentence and « عطور »
    (the J03 Parfum Oud is out of stock).
  - N16 « Ma nwasslouch l Illizi f had lwaqt, la livraison ma tatwasslch l had la wilaya. » — the second clause repeats the first with French
    words.
  - Amounts in model sentences without the thousands space: « gratuite dès 20000 DA » (N5 T2), « batel men 20000 DA » (PG1 / PG1b T1), « 6900
    DA », « 12500 DA »(the server recaps write « 6 900 DA »).
  - The reply guard still rewrites / strips a Moroccan form the model wrote (N9 T1, F9 T1, P2 T1, N21 T1) — nothing Moroccan reached the
    customer (check.cjs 0 hit).
  - Fixed since R18-4: « tsajjel » (PG1 T2 « Saha Nadia, Hijab soie wahed, 1500 DA. … »), « سجلت زوج » (A3 T1 « صحيت. زوج Tapis de prière بـ 2800
    دج للواحد … »), N3 T1 « c'est noté ! » (« Parfait Samira, 2 tapis de prière à 2800 DA l'unité ! »), the N16 offer, P2 « ideale l » (N9 « mlih
    bezzaf l l3rass »), PG2 « بلدية بوفاريك » (PG2b « مرحبا بيك من بوفاريك! »).
- Evidence: .local/qa/journeys/R19/out/transcripts/N4.json T2, F3.json T2, F5.json T1, F1b.json T2, PF1.json T2, N5.json T1–T2, PG2.json
  T1–T2, N16.json, PG1.json T1 · `AiRun.meta.guard` (out/airun.txt) · .local/qa/campaign/retest-ai-r19/fr-N4-pg.png, ar-PG2-pg.png
- Likely cause: free model wording; the server's fee / price sentences are inserted at a fixed place before the last question.

## Retest
- RETEST R18-1: fixed — 7 place-only first messages (PF1 and PF1r « Bonjour, j'habite à Sétif, El Eulma » on J03 out of hours, PF1b the same
  on J04, PG1 « slm, ana f Oran, Bir El Djir » on J04 and PG1b on J03, PG2 « السلام عليكم، أنا من البليدة بوفاريك » on J03 and PG2b on J04): each
  T1 has a `quote_delivery` and both fees, 0 hand-off, every figure equal to the shop's `DeliveryFeeRule` (Sétif 650 / 350, Oran 600 / 400,
  Blida 450 / 300): PF1 « … Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. … », PG1 « Tawsil: 600 DA (batel men 20000
  DA) l dar, wela 400 DA f stop-desk ila t7ebb. … », PG2 « … التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. … » (R18: 1 /
  4). Free-threshold wording right (home only, 20 000 DA; « 20000 » written without the space → R19-3). T1 2.5–5.4 s server.
- RETEST R18-2: fixed — N3 T1 « Parfait Samira, 2 tapis de prière à 2800 DA l'unité ! Pour la livraison, dans quelle wilaya êtes-vous ? »
  (R18: no price); PG2 T2 « صحيت يا سمير. Djellaba homme — 7500 دج، … » (R18: fees without the price); PG2b T2 « Djellaba homme بسعر 7500 دج (بدل
  9000 دج) … »; the price before the field / mode question in 15 / 15 turns. Placement after the fees in PF1 T2 → R19-3.
- RETEST R18-3: partly fixed — N7 T1 4.5 s server, 0 search (R18 12.0 s, two searches); PG1 T2 6.4 s (R18 10.0 s); PG2 T2 9.5 s (R18 10.4 s);
  0 `fee_missing` corrective turn; `AiRun.meta.steps` present on 99 / 99 runs. Left: N5 T2 17.1 s (4 model calls, `VALIDATION`), F5 T1 11.5 s,
  27 `stray` model calls, N11 T3 still two lookups (`{}` then the number), N5 T3 `lookup_order {}`, searches asked after a recap call → R19-1.
- RETEST R18-4: partly fixed — « tsajjel », « سجلت زوج », N3 « c'est noté ! », the N16 offer, « ideale l », « بلدية بوفاريك » gone. Left: N4 « Merci
  Samir. » for « سمير بن علي », « C'est noté : … » (F5, F1b), « j'ai bien noté … » (PF1, N5), the N5 substitute question wording → R19-3.
- R1–R17 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 22 orders**; one order per « oui »: 22 orders,
  never two for one « oui », 0 lost; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; N7 T2, N5 T3 « oui » to no recap → no order;
  N14 cancel after an order → the right order; R4-1 / R11-2 / R13-1 (no hand-off on an order / field / place / yes message, nor for a product
  sold or not sold) holds — 0 wrong hand-off accepted, 2 wrong calls refused by the platform (→ R19-2); R14-3 (every real hand-off accepted)
  holds — 4 / 4 (W1 platform, H1 / C2 model, F11 server); R4-2 (a name in another script keeps the language) holds — N4, F3, N18; R14-1
  (language kept) holds — 33 / 33 (F5 T1 mixed for a mixed message → R19-3); R4-4 / R6-1 (no model sentence asking to confirm in front of the
  recap) holds — 28 / 28; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) holds — 0 in 99 turns; R4-8 (blocked sentence)
  holds — F11; R5-1 (in-stock alternatives only) holds — N7, P2, N9, N5; R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×4); R5-4 (no
  « home or stop-desk ? » after a street) holds; R5-5 / R7-5 (delivery question answered with the fee) holds — F9, N16, F12, N3; R5-6 (no
  `create_order` before a phone) holds — 0 / 52; R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 28 / 28; R8-3 (named
  variant) holds; R9-1 (Latin name in an Arabic chat) holds — N18; R10-1 (latency) — server max 17.1 s, 2 turns ≥ 10 s (→ R19-1); R11-5 (no
  provider error) holds — 0 / 99; R12-1 (no `VALIDATION wilayaId`) holds — the one `VALIDATION` is `communeName` / `address` (N5 T2 → R19-1);
  R13-3 (Arabic street kept) holds — PG2, N11, N18, N21, N25, A3; R13-5 (substitute line) holds — N5; R15-1 (price and both fees before the
  address question) holds — 15 / 15; R15 / R16 fees — every fee said matches the shop's settings (99 / 99 turns, none asked missing); no
  invented discount (catalogue old prices Hijab 2000, Djellaba 9000; Oran free delivery only from 20 000 DA, not reached in this round); N11
  tracking from `lookup_order` (status new, not sent, no tracking number), nothing invented; R16-1 (every asked fee kept) holds — F9; R16-2
  (one reason sentence, no refusal) holds — W1, C2; R17 (a plain yes to the recap placed; out-of-stock never offered) holds; photo request
  (N9) honest — no photo claimed for a product without one.

## Coverage
- Order flows to « oui »: French ×9 (PF1, PF1b, N5, N4, N1, N17, F1, F1b, F6; F11 blocked), Arabic-script darija ×6 (PG2, N11, N21, N25,
  N18, A3), arabizi ×7 (PG1, N3 after a switch, N9, P2, F3, N23, F5 mixed fr / arabizi on the shared link); a cancel after an order (N14 in N1);
  stopped after T2 by design: PF1r, PG1b, PG2b; no order, rightly: N7 (nothing chosen, with its « oui »), F9, N16, F12 (delivery questions
  only), C2, H1, W1 (team).
- Asked this round: PF1 ×2 (PF1, PF1r) + PF1b, PG1 ×2 (J04, J03), PG2 ×2 (J03, J04), N3, PG2 T2 / PG2b T2 price, N7, N11, N5 (latency, tool
  calls per turn from `AiRun.meta.steps`), N4, N16 (wording); N9 (photo request), N14 (cancel); the sweep F1, F1b, F3, F5, F6, F9, F11, F12, W1,
  H1, C2, N1, N17, N18, N21, N23, N25, P2, A3; latency of every turn; every fee and the Oran free threshold against the shop's settings.
- Also: « oui mais … » in three scripts (N17, N23, N25), a wilaya not served (F9, N16), the free threshold said (PG1, PG1b, N5) and not
  reached (PG1 / N1 / N23 / N5 Oran 600 DA paid), a blocked number (F11), an out-of-hours shop in French and in Arabic (J03: every J03 flow), the
  same place-first messages on an in-hours shop (PF1b, PG1, PG2b on J04), Arabic-Indic digits (A3), a product not sold (N7), a product without
  photo asked in photo (N9).
- Kit: no blocked call, 0 API error, 0 console error (33 / 33 `.log.json` clean), no kit timeout; shared link valid (F5 / F12 answered).

## Not tested
- A1 — left out to stay within 100 messages (99 used; A1 needs 5); N21 ran the same Arabic-script fields-one-per-message flow on the same
  shop. N14 ran as the 4th message of N1 (an order then « non annule »), not as its own 3-message flow. F9b, W1b, H2, C1, PF2, F5b, N5b, N12
  not re-run (passed in R18 or earlier; not in this round's list); an `angry` hand-off; a J04 conversation outside opening hours / a J03 one
  inside.
- The free-delivery threshold reached (an Oran order ≥ 20 000 DA — N5's substitute is now the 1 500 DA Hijab, not the 24 990 DA Coffret);
  a photo request on a product that HAS a photo (the J03 Robe kabyle brodée has one; N9 ran on J04).
- A « yes » sent to a field-noted line (F5 T1 « C'est noté … », F1b T2) — the flows went on with the field each message carried.
- The shared link beyond F5 / F12 (the visitor response has no tool calls; they were read from `AiToolCall`).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`); `cancel_order` on a real order. The live
  Messenger path (no page connected), so the real hand-offs of W1 / H1 / C2 (inbox assignment, AI paused) were not seen.
- F6, N1, N17, N23, N25 with their fields one per message; the stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-6313 (PF1), TEST-7017 (PF1b), TEST-1288 (PG1), TEST-9566 (PG2), TEST-6017
  (N3), TEST-7864 (N5), TEST-4074 (N11), TEST-1344 (N4), TEST-6890 (N9, F5), TEST-1605 (N1, then cancelled by N14 — simulated), TEST-1158
  (P2), TEST-6619 (N21), TEST-8063 (N17), TEST-6971 (N25), TEST-6293 (F1, F1b), TEST-5998 (F3), TEST-2670 (F6), TEST-8849 (N18), TEST-7072
  (N23), TEST-1014 (A3); F11 refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (R18's TEST-7017, TEST-1288,
  TEST-4074, TEST-1344, TEST-1158, TEST-6619, TEST-8063, TEST-6971, TEST-6293, TEST-5998, TEST-8849, TEST-6890 again; N9's M robe for Amina
  Saadi = F5's); a changed draft gets another number (PF1 TEST-6313 vs R18 TEST-6293 — `phoneConfirmed` added, PG2, N3, N5, N1, F6, N23, A3).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:*` count / TTL, `DeliveryFeeRule`, `Product`,
  `ProductVariant` and `ProductImage` rows of both shops, `AiRun` rows since 05:50 UTC with `meta.guard` / `meta.steps` (out/airun.txt,
  out/steps.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (99, `waitMs − runMs` ≤ 152 ms, 0 replay) and
  the API error log date (unchanged since 09/11); nothing written.
- Hour counters (read-only): before the run the J03 R18 key expiring (TTL 37 s), no J04 key; after the run J04 45 / 60 (window from 06:50:21,
  the 4 shared-link turns count in it too; link visitor counter 4), J03 54 / 60 (window from 06:57:23); no 429. Messages used: 99 / 100.
