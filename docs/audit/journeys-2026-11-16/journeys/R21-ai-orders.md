# R21 — Twenty-first retest of the AI order-taking (after the R20 fixes) — live site, deployed commit 70cb699 — 18/11/2026 10:01–10:11 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 70cb699 (checked read-only: `git log --oneline -1` = « 70cb699 fix(ai): live retest R20 —
delivery answers always carry both fees, every quote run reaches the reply, more zero-call yes forms, server « which one? » for a yes to an
either/or, lookups withheld once answered, unknown tools answered server-side, every amount formatted »; `djaber-v2-api` / `djaber-v2-worker`
online, restarted 09:58:09). Same two own shops as R1–R20: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR,
opening hours 09:00–20:00 Sun–Thu + Sat — Wednesday, all J03 flows inside them) and « Boutique de Karima » (J04 shop, « Agent J04 », preset
Vendeur Pro, no opening hours set). Surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and, for F5 / F5b / F5r / F12, the
J04 shared test link (`/agent-test/<token>`, valid until 18/11 18:04, so no new link was made; its tool calls were read server side, read-only,
from `AiToolCall`). One browser at a time, the runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was
still in place (F11). Hour counters before the run (read-only, Redis `rl:*`, 10:01): none (the J03 key of R20 expired at 10:00:51). J04 flows
10:01:30–10:07:25, J03 flows 10:07:36–10:11:13; 0 « out_of_hours » line, no 429.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, last change 16/11 — unchanged since R18), used to check every fee:**
Alger 400 home / 250 stop-desk, Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (`freeAbove` 20 000 DA, home only),
Illizi 1 500 / 1 000 inactive (not served). Stock (read-only, `Product` / `ProductVariant`, unchanged since R19): J04 Parfum Oud 50 ml 0 (3 200),
Montre connectée 0 (`sellOutOfStock` true), Coffret cadeau Aïd 4 (24 990), Hijab soie 20 (1 500, old price 2 000), Djellaba homme 10 (7 500, old
price 9 000), Robe kabyle S 5 / M 5 / L 0 / XL 2 (4 900, XL 5 200); J03 the same + Sac à main cuir Noir 3 / Marron 3 / Rouge 0 (6 900), Tapis de
prière 15 (2 800), Basket Runner 41 0. No J04 product has a photo (N9).

**Latency method (as R11–R20).** R20's `conv.mjs` unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. `Server-Timing` carries
`queue` and `total`; « no model time » is read from `total` plus the run's `AiRun.meta.steps` (one entry per model call; `[]` = the server
answered without the model). Server side, read-only: the API's « playground turn answered » lines (`runMs`, `waitMs`, `replayed`), the `AiRun`
rows (`latencyMs`, `status`, `meta.guard`, `meta.steps`) + `AiToolCall` rows. No stall / dup probe.

**99 customer messages** (J04 shop 58 of which 8 on the shared link, J03 shop 41; budget 100), 33 conversations, 29 on the playground and 4 on
the shared link: priority 1 — N3 ×2 (N3 on J03, NEW N3b on J04 with the hijab), the 2 NEW delivery questions before the recap in other
languages (DQ1 fr « vous livrez à Oran ? », DQ2 Arabic script « توصلو لوهران؟ »), F5 ×2 (F5, F5b) and F5r on the shared link, N5 ×2 (N5 fr and
NEW N5c arabizi, both on J04 — the shop that gave the either/or in R20 — each with a « oui » after the substitute question, then a choice, then
a yes), the 5 new yes forms each on a shown recap (F3 « ih ndirha », P2 « wah ndirha », NEW Y2 « ايه نديرها », N7 « oui je prends », F6 « yes I
take it »), NEW YC « oui je prends 2 » (a yes with a number), PG2, A3; the sweep F3, F6, F9, F11, F12, W1, H1, C2, N1 (+ N14 as its 4th message
« non annule »), N4, N7 (extended to 4 messages: « oui » to its product list, a choice, « oui je prends »), N9, N11, N16, N17, N18, N21, N25, P2,
PG1. **Not run, to stay within 100 messages: F1, F1b, N23, PF1, A1** (see « Not tested »). Flows with `untilOrder` stop at the order. No
adaptive re-send, no re-send by the script. Scripts `.local/qa/journeys/R21/scripts/` (R20's conv.mjs, convs.json built by mkconvs.cjs, check.cjs
+ amount / number-format checks, render.cjs, lat-table.cjs, join.cjs = turn ↔ `AiRun` ↔ steps, server.sh / tools.sh / pre.sh read-only queries,
run.sh, all.sh (J04), all2.sh (J03)), transcripts `.local/qa/journeys/R21/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs
`out/run1.log` (J04), `out/run2.log` (J03), `out/airun.txt`, `out/steps.txt`, `out/toolcalls.txt`, rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r21/`.

Cases asked for this round:
- **R20-2**: N3 ×2 and two new delivery questions before the recap (fr, Arabic script) ⇒ the delay and both fees matching the shop's settings;
  F5 ×2 and F5r on the shared link ⇒ fees always said.
- **R20-3**: N5 ×2 (out of stock ⇒ either/or ⇒ « oui » ⇒ one short « which one? », a choice ⇒ recap ⇒ one order).
- **R20-1**: the new yes forms « ih ndirha », « wah ndirha », « ايه نديرها », « oui je prends », « yes I take it » ⇒ one order each with no model
  time; « oui je prends 2 » ⇒ a change, new recap, no order; PG2 and A3 latency.
- **R20-4**: every amount of every reply with the thousands space; no phone / order / street number reformatted.
- The sweep; latency per turn; every R1–R20 guarantee.

**Result: 32 / 33 conversations pass** — priority 1: 16 / 17 (N3, N3b, DQ1, DQ2, F5, F5b, F5r, N5, F3, P2, Y2, N7, F6, YC, PG2, A3 pass; **N5c
fails — R21-1, three turns of 8.1–10.6 s on the server, T3 « ih » 10.6 s; and R21-2, the out-of-stock sentence in three turns in a row**), sweep
16 / 16. **R20-2 fixed: every delivery question asked before the recap is answered with the delay and both fees, 4 / 4** (N3 « Ih, nwasslou l
Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. », N3b the same on J04, DQ1 « Oui, on livre à Oran, en 2 à 5 jours. À domicile :
600 DA, en stop-desk : 400 DA. », DQ2 « إيه، نوصلو لـوهران، من 2 إلى 5 أيام. للدار: 600 دج، لنقطة الاستلام (stop-desk): 400 دج. ») **and the
product + place message on the shared link says the price and both fees 3 / 3** (F5, F5b, F5r « … 4 900 DA. L dar: 400 DA, f stop-desk: 250 DA. »,
one language each). **R20-1 mostly fixed: the 5 new yes forms each placed one order with 0 model call, 0.08–0.19 s server** (« ih ndirha »,
« wah ndirha », « ايه نديرها », « oui je prends », « yes I take it »); **« oui je prends 2 » gave a new recap 2 × and no order**; PG2 T2 4.7 s (R20
13.5 s), A3 T1 3.2 s (R20 8.9 s); 1 `stray` call in 99 turns (R20 4), 105 model calls (R20 117). **25 / 25 orders placed with 0 model call,
0.08–0.26 s server.** Left: N5c T1–T3 8.4 / 8.1 / 10.6 s, N18 T1 8.1 s, N7's « oui » to a product list answered by the model, N4's lookups on a
name / phone message (R21-1). **R20-3 partly verified**: no loop — N5 T3 « oui » to the one substitute → its recap (Coffret, home delivery free
from 20 000 DA — right), N5c's « ih » → the two in-stock options, each next choice → a recap → one order; the server's « which one? » was not
seen (the model never wrote an either/or before a bare yes in N5 / N5c; N7's yes to a three-product list got a right « Lequel vous intéresse :
… ? » from the model, 3.2 s). **R20-4 mostly fixed: every amount in the 99 replies has the thousands space** (model sentences « 4 900 DA »,
« 2 800 دج », « 24 990 DA », « 1 500 DA (au lieu de 2 000 DA) »; recaps as before), **0 phone / order / street number reformatted** (« 0661234567 »,
« TEST-7864 », « cité 1000 logements », « حي 1000 مسكن », « 120 x 70 », « n 5 », « رقم 12 » kept); N16's repeated clause and N7's misplaced thanks gone,
F5r one language; left « je les garde » / « tsajjelou » / « bien noté » lines (R21-3). **Latency: page median 3.2 s, p90 5.8 s, max 10.8 s; server
median 3.0 s, p90 5.7 s, max 10.6 s (N5c T3) — R20 page median 3.1 s, p90 6.3 s, max 13.8 s; 1 turn ≥ 10 s (R20 2); `Server-Timing` on 99 / 99
answers; page − server median 0.22 s, max 0.38 s; 0 provider error.** **0 order without a server recap; 25 TEST orders, each from one yes to a
server recap; F11 refused as blocked; 0 yes to a recap lost; 6 changes after a recap (3 of them a yes with a change) → a new recap, 0 order;
1 cancel after an order (N14) → the right one; 0 `create_order` before a phone in 58 calls; 0 `VALIDATION` on `create_order`; 0 wrong fee in
99 turns.** Failures — no Critical, no Major: R21-1 latency / model calls left (Minor), R21-2 the out-of-stock line repeated and « details
recorded » in N5c (Minor), R21-3 wording left (Cosmetic).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| N3 | J03 · playground | fr → arabizi at T2 | T1 price 5 600 DA; **T2 « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. » + recap**; « ih saha » 0.20 s → TEST-6017 | T2 5.1 s / 4.9 s | yes, 1 | PASS (R20-2 fixed) |
| N3b | J04 · playground | fr → arabizi at T2 (NEW, hijab) | T1 price 3 000 DA; **T2 delay + 700 / 450 + recap 3 700 DA**; « ih saha » 0.13 s → TEST-9385 | T2 4.6 s / 4.5 s | yes, 1 | PASS |
| DQ1 | J04 · playground | fr « vous livrez à Oran ? » (NEW) | T1 price; **T2 « Oui, on livre à Oran, en 2 à 5 jours. À domicile : 600 DA, en stop-desk : 400 DA. » + recap 2 100 DA**; « oui » 0.26 s → TEST-7471 | T1 3.5 s / 3.3 s | yes, 1 | PASS |
| DQ2 | J03 · playground | Arabic script « توصلو لوهران؟ » (NEW) | T1 price 2 800 دج; **T2 delay + 600 / 400 دج + recap 3 400 دج**; « ايه » 0.12 s → TEST-2971 | T2 5.7 s / 5.4 s | yes, 1 | PASS |
| F5 | J04 · shared link | fr / arabizi mixed, « oui c'est bon » | T1 4 900 DA + 400 / 250, arabizi; recap → 0.14 s → TEST-6890 | T1 6.6 s / 6.3 s | yes, 1 | PASS |
| F5b | J04 · shared link | the F5 messages again | T1 4 900 DA + 400 / 250; recap → 0.10 s → TEST-6890 | T1 5.8 s / 5.7 s | yes, 1 | PASS |
| F5r | J04 · shared link | the F5 T1 message again (1) | **4 900 DA + 400 / 250, arabizi only** (R20: no fee, fr + arabizi) | T1 7.1 s / 7.0 s | — (stopped at T1) | PASS (R20-2 fixed) |
| N5 | J04 · playground | fr, out of stock, « oui », choice, « oui » | one substitute (Coffret 24 990 DA); « oui » → its recap (home free from 20 000 DA); « le hijab soie » → new recap 2 100 DA; « oui » 0.15 s → TEST-7864 | T1 5.3 s / 5.0 s | yes, 1 | PASS (R21-3 note) |
| N5c | J04 · playground | arabizi, out of stock, « ih », choice, « ih » (NEW) | **T1 8.4 s, T2 8.1 s, T3 « ih » 10.6 s**; out-of-stock sentence T1–T3; T2 « les détails ta3ek tsajjelou »; T3 Hijab / Djellaba offered; « la robe kabyle taille M » → recap 5 500 DA; « ih » 0.15 s → TEST-9746 | **T3 10.8 s / 10.6 s** (slowest) | yes, 1 | FAIL — R21-1, R21-2 |
| F3 | J03 · playground | arabizi, fields one per message, **« ih ndirha »** | « Saha وليد بوزيد. »; recap → **« ih ndirha » 0.19 s, 0 model call** → TEST-5998 | T1 6.7 s / 6.5 s | yes, 1 | PASS (R20-1 fixed) |
| P2 | J04 · playground | arabizi, **« wah ndirha »** | recap S → **0.10 s, 0 model call** → TEST-1158 | T1 4.8 s / 4.6 s | yes, 1 | PASS |
| Y2 | J03 · playground | Arabic script, **« ايه نديرها »** (NEW) | recap → **0.10 s, 0 model call** → TEST-4429 | T1 3.3 s / 3.0 s | yes, 1 | PASS |
| N7 | J03 · playground | fr, product not sold, « oui », choice, **« oui je prends »** | in-stock list + 450 DA; « oui » → « Lequel vous intéresse : … ? » (model, 3.2 s); « le sac noir » → recap 7 350 DA; **« oui je prends » 0.12 s** → TEST-3496 | T1 4.2 s / 4.0 s | yes, 1 | PASS (R21-1, R21-3 notes) |
| F6 | J03 · playground | fr, quantity change, **« yes I take it »** | 2 → 3 new recap → **0.16 s, 0 model call** → TEST-2340 9 100 DA (confirmation in English) | T2 3.7 s / 3.5 s | yes, 1 | PASS (R21-3 note) |
| YC | J04 · playground | fr, **« oui je prends 2 »** (NEW) | **new recap 2 × 3 400 DA, no order**; « oui » 0.24 s → TEST-3844 | T2 5.6 s / 5.4 s | yes, 1 | PASS |
| PG2 | J03 · playground | Arabic script, greeting + place | T1 450 / 300; **T2 4.9 s** (R20 13.8 s) price + both fees; recap → « ايه » 0.14 s → TEST-1772 | T2 4.9 s / 4.7 s | yes, 1 | PASS (R21-3 note) |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | **T1 3.5 s** (R20 9.1 s), 1 call; recap 0550123456 → « ايه » 0.22 s → TEST-5126 | T1 3.5 s / 3.2 s | yes, 1 | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » 0.08 s → `CUSTOMER_BLOCKED`, team | T1 2.4 s / 2.2 s | no (refused, as expected) | PASS |
| PG1 | J04 · playground | arabizi, greeting + place | T1 600 (batel men 20 000 DA) / 400; T2 price + both fees; recap → « ih » 0.13 s → TEST-1288 | T1 4.3 s / 4.1 s | yes, 1 | PASS (R21-3 note) |
| N9 | J04 · playground | arabizi, photo request | « Ma 3andnach tsawer … » honest; recap → « ih » 0.11 s → TEST-6890 | T1 7.0 s / 6.8 s | yes, 1 | PASS |
| N11 | J04 · playground | Arabic script, tracking | « ايه » 0.10 s → TEST-4074; T3 one `lookup_order`, nothing invented | T3 4.8 s / 4.6 s | yes, 1 | PASS |
| N16 | J04 · playground | arabizi, Illizi | not served, one clause, no offer | T1 4.3 s / 4.1 s | — | PASS (R20-4 fixed here) |
| F9 | J04 · playground | arabizi, 3 wilayas | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 3.8 s / 3.5 s | — | PASS |
| F12 | J04 · shared link | fr | Blida 450 / 300 + delay | T1 2.8 s / 2.6 s | — | PASS |
| W1 | J04 · playground | fr, wholesale | platform hand-off, 0 tool | T1 2.8 s / 2.6 s | — (team) | PASS |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | platform hand-off | T1 1.9 s / 1.7 s | — (team) | PASS |
| C2 | J04 · playground | arabizi, broken order + refund | model `handoff_to_human {refund}` accepted, arabizi reason sentence | T1 4.2 s / 4.0 s | — (team) | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » 0.13 s → TEST-8063 | T2 3.5 s / 3.3 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » 0.18 s → TEST-6971 | T2 3.2 s / 3.0 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, « 👍 » | recap → 0.13 s → TEST-6619 | T1 6.2 s / 5.9 s | yes, 1 | PASS (R21-3 note) |
| N1 + N14 | J03 · playground | fr, product + wilaya change, then « non annule » | new recap Oran → « oui » 0.16 s → TEST-1605 → `cancel_order` TEST-1605 ok | T4 3.8 s / 3.5 s | yes, 1, then cancelled | PASS |
| N4 | J03 · playground | fr, Arabic-script name alone, « oui c'est bon » | « Merci سمير. »; T3 « votre numéro est bien noté »; recap « سمير بن علي » → 0.19 s → TEST-1344 | T1 5.4 s / 5.2 s | yes, 1 | PASS (R21-1, R21-3 notes) |
| N18 | J03 · playground | Arabic script, Latin name alone, « 👍 » | T1 8.3 s (a confirm sentence caught by the guard); « Samir Benali » kept in the recap → 0.11 s → TEST-6540 | **T1 8.3 s / 8.1 s** | yes, 1 | PASS (R21-1 note) |

Pass criteria, counted over all flows:
- **The 5 new yes forms (priority 1), each to a shown server recap → exactly one order with no model time: 5 / 5** — F3 T5 « ih ndirha » 0.19 s
  server, P2 T3 « wah ndirha » 0.10 s, Y2 T2 « ايه نديرها » 0.10 s, N7 T4 « oui je prends » 0.12 s, F6 T3 « yes I take it » 0.16 s — each
  `AiRun.meta.steps` `[]`, `latencyMs` 75–141 ms (R20: « ih ndirha » 1 model call, 2.8 s).
- « oui » (any yes form) to a server recap → exactly one order with the recap's content: **25 / 25** (playground 23 + shared link F5, F5b) + F11
  refused as blocked (1 / 1, 0.08 s, 0 model call). **Order without a server recap: 0.** **Yes to a correct recap lost: 0.** Yes forms that
  placed: « oui » ×5, « ih » ×3, « ih saha » ×2, « ih ndirha », « wah ndirha », « ايه » ×5, « ايه نديرها », « 👍 » ×2, « oui c'est bon » ×3 (N4, F5,
  F5b on the link), « oui je prends », « yes I take it ». **Placed with 0 model call: 25 / 25** (R20 20 / 22), page 0.26–0.51 s, server
  0.08–0.26 s. One order after a change: **6 / 6** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N25 quantity, YC quantity, N5 product).
- **A yes WITH a number (YC « oui je prends 2 ») → a new recap, no order: 1 / 1** — 2 × Hijab soie 3 000 DA + 400 DA = 3 400 DA (5.4 s, 2 model
  calls: a `check_availability` the server did not run, then the recap call); the next « oui » → TEST-3844 with the 2 ×, 0 model call.
- **Yes with a change → a new recap, no order: 3 / 3** — N17 T2 (fr → Alger 400 DA, 1 900 DA, core f4cd80… as R18–R20), N25 T2 (Arabic script →
  2 ×, 3 450 دج, core 1e692b… as R18–R20), YC T2; plus changes without a yes (N1 T2, F6 T2, N5 T4) → new recap; each next yes → the order with
  the new recap's content, 0 model call.
- **« oui » that is not an answer to a server recap → no order: 3 / 3** — N5 T3 (to « Voulez-vous plutôt le Coffret cadeau Aïd … ? » → the
  Coffret's recap, server lead-in « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le
  produit Coffret cadeau Aïd. »), N5c T3 « ih » (to « Wach t7ebb nwarrik wach kayen 3andna ? » → two in-stock options), N7 T2 (to the product
  list → « Lequel vous intéresse : … ? »).
- **Cancel after an order (N14): 1 / 1** — « non annule » right after TEST-1605 → one `cancel_order {orderNumber TEST-1605, customerConfirmed
  true}` → ok, « Commande TEST-1605 annulée, pas de souci. … »; no hand-off, no other order touched.
- Confirming call reworded vs the recap call, order still placed from the stored recap: N3 / N3b (« Cité 1000 logements bloc 5, El Khroub » /
  « Cité 1000 logements bloc 5 »), DQ2 (« بئر الجير، حي 1000 مسكن، عمارة 4 » / « حي 1000 مسكن عمارة 4 »), N7 / N17 (« Cité 20 août, villa 3 » /
  « cité 20 août villa 3 »), PG1 (« Cité 1000 … » / « cite 1000 … »); the 25 orders carry the stored order as it was recapped (no model call).
- **Confirming calls refused: 0** (25 + F11). **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 58 `create_order` calls.** One
  `quote_delivery {}` with no wilaya ran (N4 T3 → `VALIDATION wilayaName missing`, nothing shown to the customer — R21-1).
- Recap complete (catalogue names, variants, mode, fee, total, name, phone, address): **32 / 32**, the named variant every time (N7 Noir, N1
  Marron, P2 S, N9 / F5 / F5b / N5c M); **in the customer's language 32 / 32** — Arabic script 9 (N11, N25 ×2, N21, PG2, A3, DQ2, Y2,
  N18), arabizi 9 (N3, N3b, N5c, F5, F5b, P2, PG1, N9, F3), French 14.
- **Server recap without a model sentence asking to confirm or describing the order: 32 / 32** — the lead-ins in front of a recap are the
  server's (N3 / N3b / DQ1 / DQ2 delivery answers, N5 T3 the substitute sentence). **Outside any recap: 0 model turn asks to confirm the order or
  claims it registered** (N18 T1's `confirm_without_recap` was stripped by the guard before it was sent). Left before a recap: « Merci pour vos
  coordonnées, je les garde. » (N5 T2), « Saha, les détails ta3ek tsajjelou (…) » (N5c T2), « votre numéro est bien noté » (N4 T3) — they note
  the customer's details, not an order (R21-2, R21-3).
- **Recap address « street, commune, wilaya »: 32 / 32** — A3 no separator, N3 / N3b / DQ2 a commune repeated in the call's address and shown
  once, PG2 / N25 / N21 / Y2 / N11 « ، », N18 Latin name. **Street as the customer wrote it: 32 / 32** (first-letter capitals not counted).
- **Fees never wrong: 99 / 99 turns** — every fee said or recapped matches the shop's rules above (Oran home under 20 000 DA paid — DQ1, DQ2, PG1,
  N5 T4, N5c, N1 600 DA; Oran home free for the Coffret 24 990 DA — N5 T3 « gratuite », total 24 990 DA; Oran stop-desk 400 DA in F9 with no free
  line; Illizi not served ×2). **Asked / due fee missing: 0** (R20: 2). **Delivery question answered with the delay and both fees: 7 / 7** — N3,
  N3b, DQ1, DQ2 (before the recap, in the same reply), F9 (three wilayas), F12 on the link (Blida 450 / 300 + delay), N16 (not served). **Place
  given with no product → both fees: 2 / 2** (PG1 T1, PG2 T1). Where a full address came with the place, the home fee only was said (N5 T2, N5c
  T2, N7 T1 — R21-3 note); the Oran free-home threshold said in PG1 T1, N5 T2, N5c T2, not in DQ1 / DQ2's delivery answers (R21-3 note).
- **Price of the product being sold before the field / mode question: 18 / 18** — N3 T1, N3b T1, DQ1 T1, DQ2 T1, A3 T1, F3 T1, N4 T1, N18 T1,
  N21 T1, PG1 T2, PG2 T2, P2 T1, N9 T1, F5 T1, F5b T1, F5r T1, N5 T1, N5c T1. **Fees in the same turn when a place is known: 5 / 5** — F5, F5b, F5r
  T1 (400 / 250, R20 F5r none), PG1 T2 and PG2 T2 (both fees again, matching T1).
- **No repeated or contradictory price / fee line in one reply: 99 / 99.** The out-of-stock sentence repeats across N5c T1–T3 (R21-2).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3.
- **Customer's name as written: 33 / 33 conversations in the recaps and orders** — N4 « Merci سمير. », F3 « Saha وليد بوزيد. », N18 « Samir Benali »
  in the Arabic recap; N18's sentences write « يا سمير » (R21-3 note); 0 name asked again once given.
- **`create_order` before a phone is in the customer's messages: 0 / 58 calls.** No `create_order` for an out-of-stock product (N5, N5c).
- **Hand-offs: 4 / 4 real ones accepted, 0 wrong** — W1 (wholesale) and H1 decided by the platform with 0 tool call, C2 by the model's own
  `handoff_to_human {refund}` (accepted), F11's by the server (`CUSTOMER_BLOCKED`). **0 wrong `handoff_to_human` call** — none on the 4 delivery
  questions, a yes, a yes with a change, a product not sold (N7), a tracking question (N11), a photo request (N9), a cancel (N14), an
  out-of-stock product (N5, N5c). AI sentence for the reason, in the customer's script: 4 / 4.
- **No 503 / provider error: 99 / 99 turns**; `AiRun` 99 rows, 95 `ok` + 4 `handoff` (F11 T2, W1, H1, C2), 0 `error`, 0 fallback, `attempt` 1
  everywhere; 14 runs carry a reply-guard action (`guard_rewritten` 9 — F5 / F5b / F5r T1 language_switch, N5c T2 / T3, N11 T3, N16, F3 T1
  moroccan_darija, N4 T2 language_switch; `guard_enforced` 4 — N5c T1 language_switch, N9 T1 moroccan_darija stripped, N18 T1 moroccan_darija +
  confirm_without_recap stripped, N18 T3 script_mix stripped; `guard_kept` 1 — P2 T1 language_switch).
- Latency: **page median 3.2 s, p90 5.8 s, max 10.8 s on 99 turns** (N5c T3 10.8 / 10.6 s, N5c T1 8.6 / 8.4 s, N18 T1 8.3 / 8.1 s, N5c T2 8.3 /
  8.1 s, F5r T1 7.1 / 7.0 s, N9 T1 7.0 / 6.8 s, F3 T1 6.7 / 6.5 s, F5 T1 6.6 / 6.3 s, N21 T1 6.2 / 5.9 s, F5b T1 5.8 / 5.7 s, DQ2 T2 5.7 / 5.4 s, YC
  T2 5.6 / 5.4 s); page median J04 3.2 s, J03 3.3 s; **server (`Server-Timing` total) median 3.0 s, p90 5.7 s, max 10.6 s**; **26 turns answered
  without the model (25 orders + F11): page 0.26–0.51 s, server 0.08–0.26 s**; the 73 model turns: server median 3.3 s, p90 6.3 s. API
  « playground turn answered » lines 10:01–10:11: 99, `waitMs − runMs` ≤ 100 ms, 0 replay, 0 « did not finish »; 1 POST per turn seen by the page;
  page − server median 0.22 s, max 0.38 s. 4 turns ≥ 8 s on the page (R20 4), **1 ≥ 10 s on the server (N5c T3)** (R20 2: PG2 T2, N5 T1).
- **Model calls (`AiRun.meta.steps`): 105 in 99 turns (R20 117)** — 0 calls 26 turns, 1 call 49, 2 calls 16, 3 calls 8 (N5c T1, N5c T3, N11 T3,
  N16, N4 T1, N4 T2, N4 T3, N18 T1), 4 calls 0 (R20 2); the next call came for `tools` 17×, `guard` 13×, `format` 1× (N5c T1), `stray` 1× (N4 T2
  « none »; R20 4×). **0 model call after a recap / confirming `create_order`.**
- Quantity never asked again after a product is named: **0 quantity question in 99 turns** (« 2 tapis », « 2 hijabs », « zoudj », « زوج », « 3
  tapis au lieu de 2 », « ديرلي جوج », « oui je prends 2 », « wahed », « وحدة », « واحد » kept).
- Language kept: arabizi **10 / 10** (PG1, F9, N16, N9, C2, F3, P2, N5c, N3 / N3b after the switch), arabizi on the link for a mixed fr / arabizi
  message 3 / 3 (F5, F5b, F5r — one language now), Arabic-script darija **8 / 8** (PG2, N21, N11, N25, N18, A3, DQ2, Y2), French **12 / 12**; F6 T3 « yes I take it » in a French chat → the confirmation in English (R21-3 note).
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard rewrote / stripped a Moroccan form in 8 replies before
  they were sent.
- **Out-of-stock product offered: 0** — N5 offers the Coffret (stock 4), N5c Hijab soie / Djellaba homme, N7 Sac (Noir / Marron), Tapis, Robe;
  P2 / N9 sizes S, M, XL only (« L makach dork »). N5 / N5c name the Parfum Oud only because the customer asked for it. PG2 T1 lists « عطور »
  (perfumes) among the shop's goods (R21-3 note).
- **Photo request (N9): 1 / 1 honest** — no photo in the J04 shop, « Ma 3andnach tsawer ta3 had robe dork. », the card has no image.
- No Markdown in a reply: **99 / 99**. No invented discount: only the catalogue's old prices (Hijab « au lieu de 2 000 DA » / « بدل 2 000 دج »,
  Djellaba « بدل 9 000 دج »); Oran free delivery only from 20 000 DA (reached once: the Coffret 24 990 DA, home free — right).
- **Amounts with the thousands space: 99 / 99 replies, server and model text** (check.cjs + a scan of every number in every reply: 151 amounts
  of 4 digits or more, 0 written without the space — recaps with a plain space, model sentences now with a no-break space: « 4 900 DA », « 2 800 دج
  للوحدة », « 24 990 DA », « 1 500 DA (au lieu de 2 000 DA) », « 7 500 دج بدل 9 000 دج »; R20: « 6900 DA », « 4900 DA », « 24990 DA », « 12500 DA »,
  « 7500 دج »). **Numbers that are not amounts left as written: 99 / 99** — phones (« 0661234567 », « 0550123456 » from A3's Arabic-Indic
  digits, « 0555123456 » in the examples), order numbers (« TEST-7864 » …), « cité 1000 logements », « حي 1000 مسكن », « 120 x 70 », « 180 x 70 »,
  « n 5 », « رقم 12 », « bloc 4 » — 0 got a space. Product cards still show the raw price (« Coffret cadeau Aïd 24990 », as R20).
- Tool calls run in 99 turns (playground 91 turns from the response + shared link 8 turns from `AiToolCall`): `create_order` 58 (32 recaps + 25
  orders + 1 blocked), `quote_delivery` 18 (N5 T2, N5c T2, F5 / F5b / F5r T1 server quotes, N3 T2, N3b T2, DQ1 T2, DQ2 T2, PG1 T1, PG2 T1, N7 T1,
  N16, F9 ×3, F12, N4 T3 `{}` → VALIDATION), `search_products` 3 (N21 T1, N4 T1, N18 T1), `lookup_order` 1 (N11 T3), `cancel_order` 1 (N14,
  right), `handoff_to_human` 1 (C2, accepted), `get_product` 0, `check_availability` 0, `add_faq_candidate` 0. Asked by the model but not run (in
  `meta.steps`, no `AiToolCall` row): `search_products` 3 (N5c T3, N4 T1 a second one, N4 T3), `check_availability` 1 (YC T2), a duplicate
  `quote_delivery` 2 (N3 T2, DQ2 T2), « none » 1 (N4 T2).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls run, with their results (draft / core = first 6 characters of the server keys). Calls the model asked but the server did not run are not listed here; they are in `out/steps.txt` and quoted in the verdicts. J03 ran inside its opening hours (no « out_of_hours » line). Shared-link turns (F5, F5b, F5r, F12) carry no tool calls, cards or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### N5 — J04 playground (UI fr)
**Verdict: PASS (out of stock, fr, J04) — T1 « … 3 200 DA, mais ce produit n'est pas disponible … notre Coffret cadeau Aïd … est disponible à 24 990 DA. Ça vous intéresse ? » (one in-stock substitute, amounts with the space — R20 « 4900 DA »); T2 the server's `quote_delivery {31}` → « Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous plutôt le Coffret … à 24 990 DA ? », 0 `create_order` for the out-of-stock product, but « Merci pour vos coordonnées, je les garde. » (R21-3) and the home fee only (the address was given); **T3 « oui » to the one substitute → the Coffret's server recap** (1 model call 2.4 s, as R20-3's fix says: the model is told the substitute is the order's product), home delivery « gratuite », total 24 990 DA (Oran free from 20 000 DA — right); T4 « le hijab soie » → new recap 2 100 DA, no order; **T5 « oui » 0.4 s page / 0.15 s server, 0 model call** → TEST-7864. The two-option question of R20 did not come back here (the model offered one product), so the server's « which one? » was not used.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 5.3 s (server 5.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24 990 DA. Ça vous intéresse ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.5 s (server 3.3 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Merci pour vos coordonnées, je les garde. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous plutôt le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) à 24 990 DA ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T3** C: « oui » · `fr` · 2.7 s (server 2.5 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T4** C: « le hijab soie » · `fr` · 4.0 s (server 3.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft caa1f7… core 72d9fb…, recap total 2100`
- **T5** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-7864 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-7864, total 2100`

### N5c — J04 playground (UI fr)
**Verdict: FAIL (out of stock, arabizi, J04, NEW) — R21-1 and R21-2. T1 8.4 s server (3 model calls: `format`, then `guard` language_switch / moroccan_darija stripped); T2 8.1 s (2 calls, guard rewrite) « Smah lia, Parfum Oud makach f stock dork. Saha, les détails ta3ek tsajjelou (…). Tawsil l dar: 600 DA (batel men 20 000 DA). Wach t7ebb nwarrik wach kayen 3andna ? »; **T3 « ih » 10.8 s page / 10.6 s server** (3 calls: a `search_products` the server withheld 4.7 s, the reply 4.5 s, a guard retry 1.3 s) → the out-of-stock sentence a third time + « … bhal Hijab soie (1 500 DA) wella Djellaba homme (7 500 DA) ? »; T4 « la robe kabyle taille M » → recap 5 500 DA (M, Oran 600 DA), no order; **T5 « ih » 0.15 s, 0 model call** → TEST-9746. Outcome right (no order for the out-of-stock product, in-stock options only, one order), but the slowest turn of the round and the same apology three turns in a row.**

- **T1** C: « slm, l parfum oud ch7al ? » · `arabizi` · 8.6 s (server 8.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam! Parfum Oud 50 ml, 3 200 DA. Malheureusement, rah ghir f rupture de stock dork. T7ebb nwarrik wach kayen 3andna ? »
- **T2** C: « khlas nediha. Karim Haddad 0770112233, Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 8.3 s (server 8.1 s)
  - AI: « Smah lia, Parfum Oud makach f stock dork. Saha, les détails ta3ek tsajjelou (Karim Haddad, Oran, Bir El Djir, cité 1000 logements bloc 4). Tawsil l dar: 600 DA (batel men 20 000 DA). Wach t7ebb nwarrik wach kayen 3andna ? »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T3** C: « ih » · `arabizi` · 10.8 s (server 10.6 s)
  - AI: « Smah lia, Parfum Oud makach f stock dork, ma nqderch nsajjel commande lih. T7ebb nwarrik produit okhor kayen 3andna, bhal Hijab soie (1 500 DA) wella Djellaba homme (7 500 DA) ? »
- **T4** C: « la robe kabyle taille M » · `arabizi` · 3.6 s (server 3.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 5 500 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 770bff… core ce9891…, recap total 5500`
- **T5** C: « ih » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-9746 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 600 DA ⏎ Total: 5 500 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×variant …21d1, customerConfirmed true} → ok TEST-9746, total 5500`

### F5 — J04 shared link (UI fr)
**Verdict: PASS (shared link, mixed fr / arabizi) — T1 the server's `quote_delivery {16}` (`AiToolCall` 10:02:45) → « Wa alaykum salam Amina ! Robe kabyle brodée taille M rahi kayna b 4 900 DA. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. … » (price + both fees, arabizi only; 6.3 s, 2 model calls with a guard language_switch rewrite); T2 recap 5 300 DA; **T3 « oui c'est bon » 0.14 s server, 0 model call** → TEST-6890 (same simulated number as R19 / R20).**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 6.6 s (server 6.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa alaykum salam Amina ! Robe kabyle brodée taille M rahi kayna b 4 900 DA. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « rue des frères Bouadou n 5 » · 3.2 s (server 3.1 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 0.3 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F5b — J04 shared link (UI fr)
**Verdict: PASS (the F5 messages again on the link) — T1 « … kayen b 4 900 DA. … L dar: 400 DA, f stop-desk: 250 DA. Wela t7ebb nwasslouha f stop-desk ? » (5.7 s, guard rewrite); T2 recap; T3 « oui c'est bon » 0.10 s, 0 model call → TEST-6890.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.8 s (server 5.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam Amina ! Robe kabyle brodée taille M kayen b 4 900 DA. Bach nkammlou la commande, 3tini l'adresse ta3ek (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib). L dar: 400 DA, f stop-desk: 250 DA. Wela t7ebb nwasslouha f stop-desk ? »
- **T2** C: « rue des frères Bouadou n 5 » · 3.1 s (server 2.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 0.3 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F5r — J04 shared link (UI fr)
**Verdict: PASS (R20-2 fixed here) — the F5 T1 message a third time: server `quote_delivery {16}` → « Wa 3likoum salam Amina ! Robe kabyle brodée taille M rahi kayna b 4 900 DA. L dar: 400 DA, f stop-desk: 250 DA. A3tini l'adresse ta3ek … ? » — both fees said (R20: none) and one language (R20: fr + arabizi); 7.0 s server (2 calls, guard language_switch rewrite 3.0 s — R21-1 note).**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 7.1 s (server 7.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3likoum salam Amina ! Robe kabyle brodée taille M rahi kayna b 4 900 DA. L dar: 400 DA, f stop-desk: 250 DA. A3tini l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib), wela t7ebb nwasslouha f stop-desk ? »

### N3 — J03 playground (UI fr)
**Verdict: PASS (R20-2 fixed) — T1 « … 2 x 2 800 DA, soit 5 600 DA au total (hors livraison). Dans quelle wilaya … ? »; T2 « khouya twasslou l Constantine ? … » → the server's answer « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. » then the arabizi recap 6 300 DA (Constantine 700 / 450 — right; R20: the delay only, 450 DA never said); no hand-off tool; the model asked `quote_delivery` twice, one ran; **T3 « ih saha » 0.20 s, 0 model call** → TEST-6017.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Samira, nous avons bien les tapis de prière disponibles : 2 x 2 800 DA, soit 5 600 DA au total (hors livraison). Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 5.1 s (server 4.9 s)
  - AI: « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 0.5 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-6017 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-6017, total 6300`

### N3b — J04 playground (UI fr)
**Verdict: PASS (N3 on J04 with the hijab, NEW) — T1 « Le Hijab soie est à 1 500 DA (au lieu de 2 000 DA) … 2 pièces font 3 000 DA. »; T2 « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. » + recap 3 700 DA; **T3 « ih saha » 0.13 s, 0 model call** → TEST-9385.**

- **T1** C: « Bonjour, je voudrais 2 hijabs soie. Samira Benali, 0661234567 » · `fr` · 3.3 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Merci Samira ! Le Hijab soie est à 1 500 DA (au lieu de 2 000 DA) et il est en stock, donc 2 pièces font 3 000 DA. Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 4.6 s (server 4.5 s)
  - AI: « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 3 700 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft b80cf8… core d118dd…, recap total 3700`
- **T3** C: « ih saha » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-9385 tsajlet ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Livraison: 700 DA ⏎ Total: 3 700 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …450a, customerConfirmed true} → ok TEST-9385, total 3700`

### DQ1 — J04 playground (UI fr)
**Verdict: PASS (delivery question before the recap, fr, NEW) — T1 price « 1 500 DA (au lieu de 2 000 DA) » then the wilaya question; T2 « vous livrez à Oran ? je suis à Bir El Djir, … » → « Oui, on livre à Oran, en 2 à 5 jours. À domicile : 600 DA, en stop-desk : 400 DA. » + recap 2 100 DA (Oran 600 / 400 — right; the free-home threshold 20 000 DA not said here, R21-3 note); **T3 « oui » 0.26 s, 0 model call** → TEST-7471.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568 » · `fr` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Merci Nadia, 1 Hijab soie à 1 500 DA (au lieu de 2 000 DA), en soie douce 180 x 70 cm. Dans quelle wilaya êtes-vous ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « vous livrez à Oran ? je suis à Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.3 s (server 3.1 s)
  - AI: « Oui, on livre à Oran, en 2 à 5 jours. À domicile : 600 DA, en stop-desk : 400 DA. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 062285… core 22b9bb…, recap total 2100`
- **T3** C: « oui » · `fr` · 0.5 s (server 0.3 s)
  - AI: « Votre commande TEST-7471 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-7471, total 2100`

### DQ2 — J03 playground (UI ar)
**Verdict: PASS (delivery question before the recap, Arabic script, NEW) — T1 « … Tapis de prière بـ 2 800 دج … واش من ولاية تحب نوصلوها ليها؟ »; T2 « توصلو لوهران؟ أنا في بئر الجير، … » → « إيه، نوصلو لـوهران، من 2 إلى 5 أيام. للدار: 600 دج، لنقطة الاستلام (stop-desk): 400 دج. » + Arabic recap 3 400 دج, address « حي 1000 مسكن عمارة 4، بئر الجير، وهران »; **T3 « ايه » 0.12 s, 0 model call** → TEST-2971.**

- **T1** C: « سلام، نحب سجادة صلاة وحدة، سميرة بن علي 0661234567 » · `ar` · 4.6 s (server 4.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت يا سميرة. Tapis de prière بـ 2 800 دج، سجادة ناعمة ومريحة بمقاس 120 x 70 سم. واش من ولاية تحب نوصلوها ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « توصلو لوهران؟ أنا في بئر الجير، حي 1000 مسكن عمارة 4 » · `ar` · 5.7 s (server 5.4 s)
  - AI: « إيه، نوصلو لـوهران، من 2 إلى 5 أيام. للدار: 600 دج، لنقطة الاستلام (stop-desk): 400 دج. ⏎ هذا ملخص الطلبية: ⏎ - 1 × Tapis de prière : 2 800 دج ⏎ - التوصيل للدار (بئر الجير، وهران): 600 دج ⏎ المجموع: 3 400 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، بئر الجير، وهران ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `create_order {name «سميرة بن علي», phone 0661234567, wilaya 31, commune «بئر الجير», address «بئر الجير، حي 1000 مسكن، عمارة 4», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 29c729… core f9cfca…, recap total 3400`
- **T3** C: « ايه » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-2971 ✅ ⏎ - 1 × Tapis de prière : 2 800 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 3 400 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0661234567, wilaya 31, commune «بئر الجير», address «حي 1000 مسكن عمارة 4», items 1×product …a750, customerConfirmed true} → ok TEST-2971, total 3400`

### P2 — J04 playground (UI fr)
**Verdict: PASS — T1 sizes S / M 4 900 DA, XL 5 200 DA (L not offered); T2 recap S 5 300 DA; **T3 « wah ndirha » 0.38 s page / 0.10 s server, 0 model call** (NEW yes form) → TEST-1158.**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 4.8 s (server 4.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam! Robe kabyle brodée b lyedd, qmach khfif, mliha l l3rass w lmounasabat. Kayen f taille S w M b 4 900 DA, w XL b 5 200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 3.3 s (server 3.1 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « wah ndirha » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### Y2 — J03 playground (UI ar)
**Verdict: PASS (NEW yes form, Arabic script) — T1 everything in one message → the Arabic recap 8 200 دج; **T2 « ايه نديرها » 0.29 s page / 0.10 s server, 0 model call** → TEST-4429.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 3.3 s (server 3.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft b95605… core 64b204…, recap total 8200`
- **T2** C: « ايه نديرها » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-4429 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-4429, total 8200`

### F6 — J03 playground (UI fr)
**Verdict: PASS — T1 recap 2 × 6 300 DA; T2 « Finalement mettez 3 tapis au lieu de 2 » → new recap 9 100 DA, no order; **T3 « yes I take it » 0.16 s, 0 model call** → TEST-2340 (same simulated number as R20), but the confirmation is written in English (« Your order TEST-2340 is confirmed ✅ … cash on delivery. ») in a French chat — R20's « yes » kept French (R21-3 note).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 3.1 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 3.7 s (server 3.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « yes I take it » · `en` · 0.4 s (server 0.2 s)
  - AI: « Your order TEST-2340 is confirmed ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Delivery: 700 DA ⏎ Total: 9 100 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### F3 — J03 playground (UI fr)
**Verdict: PASS (R20-1 fixed here) — T1 « Zoudj tapis de prière … Kol wahed b 2 800 DA …, yani 5 600 DA ga3. Wach smitek ? » (6.5 s, guard moroccan_darija rewrite); « Saha وليد بوزيد. » (name as written); T4 recap 6 050 DA; **T5 « ih ndirha » 0.37 s page / 0.19 s server, 0 model call** → TEST-5998 (R20: 1 model call, 2.8 s).**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 6.7 s (server 6.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Zoudj tapis de prière ta3na disponibles ! Kol wahed b 2 800 DA (molletonné, 120 x 70 cm), yani 5 600 DA ga3. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.2 s (server 2.1 s)
  - AI: « Saha وليد بوزيد. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244 » · `arabizi` · 2.2 s (server 2.1 s)
  - AI: « Saha. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 3.7 s (server 3.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih ndirha » · `arabizi` · 0.4 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### YC — J04 playground (UI fr)
**Verdict: PASS (a yes with a number, NEW) — T1 recap 1 × 1 900 DA; **T2 « oui je prends 2 » → a new recap 2 × Hijab soie 3 000 DA + 400 DA = 3 400 DA, no order** (5.4 s, 2 model calls: `check_availability` not run, then the recap call); T3 « oui » 0.24 s, 0 model call → TEST-3844 with 2 ×.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 3.0 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T2** C: « oui je prends 2 » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 3 400 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5c4540… core 219b40…, recap total 3400`
- **T3** C: « oui » · `fr` · 0.5 s (server 0.2 s)
  - AI: « Votre commande TEST-3844 est bien enregistrée ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Livraison : 400 DA ⏎ Total : 3 400 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …450a, customerConfirmed true} → ok TEST-3844, total 3400`

### PG2 — J03 playground (UI ar)
**Verdict: PASS (R20-1 latency fixed here) — T1 the server's `quote_delivery {9}` → « … التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. … » (both fees) but « عندنا بزاف حوايج: جلابات، روب قبايلية، أكياس، عطور وغيرها » lists perfumes, of which the shop has none in stock (R21-3); **T2 4.9 s page / 4.7 s server, 1 model call** (R20 13.5 s, 3 calls) « صحيت، الجلابة الرجالي (7 500 دج) باسم سمير بن علي. للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. … »; T3 recap 7 950 دج; T4 « ايه » 0.14 s → TEST-1772.**

- **T1** C: « السلام عليكم، أنا من البليدة بوفاريك » · `ar` · 3.0 s (server 2.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام، مرحبًا بيك! التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش تحب تشري اليوم؟ عندنا بزاف حوايج: جلابات، روب قبايلية، أكياس، عطور وغيرها. »
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « نحب جلابة رجالي، سمير بن علي 0661234567 » · `ar` · 4.9 s (server 4.7 s)
  - AI: « صحيت، الجلابة الرجالي (7 500 دج) باسم سمير بن علي. للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. عطيني العنوان تاعك في بوفاريك (الشارع، الحي، رقم الدار)، ولا تحب نوصلوها لنقطة الاستلام؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T3** C: « حي 20 أوت فيلا 3 » · `ar` · 3.4 s (server 3.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 20 أوت فيلا 3، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 636105… core 9bff87…, recap total 7950`
- **T4** C: « ايه » · `ar` · 0.4 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-1772 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → ok TEST-1772, total 7950`

### A3 — J03 playground (UI ar)
**Verdict: PASS (R20-1 latency fixed here) — T1 « ٠٥٥٠١٢٣٤٥٦ » → **3.5 s page / 3.2 s server, 1 model call** (R20 8.9 s, 4 calls with a `search_products {«noop»}` run) « صحيت يا سميرة، زوج سجادات الصلاة (2 800 دج للوحدة). واش من ولاية … ؟ »; T2 « قسنطينة الخروب حي 1000 مسكن عمارة 5 » (no separator) → recap « حي 1000 مسكن عمارة 5، الخروب، قسنطينة », phone 0550123456; T3 « ايه » 0.22 s → TEST-5126.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 3.5 s (server 3.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت يا سميرة، زوج سجادات الصلاة (2 800 دج للوحدة). واش من ولاية تحب نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 3.4 s (server 3.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 0.5 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### F11 — J04 playground (UI fr)
**Verdict: PASS (blocked phone) — recap 1 900 DA; « oui » 0.08 s server, 0 model call → `CUSTOMER_BLOCKED` → « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. » + the hand-off line; no block mentioned, no « try later ».**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 2.4 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 0.3 s (server 0.1 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### PG1 — J04 playground (UI fr)
**Verdict: PASS — T1 the server's `quote_delivery {31}` → « Tawsil: 600 DA (batel men 20 000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. » (both fees, threshold with the space) after « Ahla bik ya Oran! » (R21-3); T2 « Hijab soie wahed b 1 500 DA. L dar: 600 DA, f stop-desk: 400 DA. … » (price, the fees again, matching T1); T3 recap 2 100 DA (threshold not reached, 600 DA paid — right); **T4 « ih » 0.13 s, 0 model call** → TEST-1288.**

- **T1** C: « slm, ana f Oran, Bir El Djir » · `arabizi` · 4.3 s (server 4.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ahla bik ya Oran! Tawsil: 600 DA (batel men 20 000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. Wach men produit t7ebb ? Goulili ech t7ebb tchouf w n3awnek nkmlo m3ak. »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T2** C: « nheb hijab soie wahed, smiti Nadia Kaci 0661234568 » · `arabizi` · 3.9 s (server 3.7 s)
  - AI: « Saha Nadia. Hijab soie wahed b 1 500 DA. L dar: 600 DA, f stop-desk: 400 DA. T7ebb nwasslouha l dar wela f stop-desk ? Ila l dar, a3tini l'adresse ta3ek (rue, cité, numéro ta3 dar). »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T3** C: « cite 1000 logements bloc 4 » · `arabizi` · 3.4 s (server 3.2 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Smitek: Nadia Kaci ⏎ Numéro: 0661234568 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 062285… core 22b9bb…, recap total 2100`
- **T4** C: « ih » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-1288 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-1288, total 2100`

### N9 — J04 playground (UI fr)
**Verdict: PASS (photo request) — T1 « Ma 3andnach tsawer ta3 had robe dork. … Tailles li kayen: S, M w XL (L makach dork). Taman: 4 900 DA (XL 5 200 DA). … » (honest, no photo in the J04 shop, the card has none); T2 recap M 5 300 DA; T3 « ih » 0.11 s → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 7.0 s (server 6.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam ! Ma 3andnach tsawer ta3 had robe dork. Hiya robe kabyle matrouza bel yed, b tissu khfif, mliha l les a3yad. Tailles li kayen: S, M w XL (L makach dork). Taman: 4 900 DA (XL 5 200 DA). Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 2.7 s (server 2.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS (tracking) — T1 recap 8 200 دج; « ايه » 0.10 s → TEST-4074; T3 one `lookup_order` → « الطلبية تاعك رقم TEST-4074 مازالت جديدة، ومازالتش خرجت للتوصيل. ما عندناش رقم تتبع درك … مدة التوصيل من 2 إلى 5 أيام. » — real status, no tracking number invented.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 2.5 s (server 2.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 4.8 s (server 4.6 s)
  - AI: « الطلبية تاعك رقم TEST-4074 مازالت جديدة، ومازالتش خرجت للتوصيل. ما عندناش رقم تتبع درك، ومجرد ما تخرج الطلبية راح نعطيوك رقم التتبع. مدة التوصيل من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N16 — J04 playground (UI fr)
**Verdict: PASS (R20-4 fixed here) — « Wa 3alaykoum slam 👋 Ma nwasslouch l Illizi f had lwaqt, smahli. » — not served, one clause (R20: the clause repeated), no stop-desk offered.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 4.3 s (server 4.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykoum slam 👋 Ma nwasslouch l Illizi f had lwaqt, smahli. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F9 — J04 playground (UI fr)
**Verdict: PASS — three `quote_delivery` in one step → « Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. » (each asked fee, no free line on the stop-desk).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 3.8 s (server 3.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link) — `quote_delivery {Blida}` (`AiToolCall` 10:06:00) → « Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. … ».**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.8 s (server 2.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 👋 Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. Vous cherchez quelque chose en particulier ? »

### W1 — J04 playground (UI fr)
**Verdict: PASS (wholesale) — platform hand-off with 0 tool call (R20: the model's `handoff_to_human {off_catalogue}`), « Pour le prix de gros, l'équipe de la boutique va vous répondre. ».**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 2.8 s (server 2.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Pour le prix de gros, l'équipe de la boutique va vous répondre. »

### H1 — J04 playground (UI fr)
**Verdict: PASS — platform hand-off, « Bien sûr, je vous mets en relation avec l'équipe de la boutique. ».**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 1.9 s (server 1.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »

### C2 — J04 playground (UI fr)
**Verdict: PASS (complaint + refund, arabizi) — the model's `handoff_to_human {refund, evidence «nheb tredouli drahmi»}` accepted, « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. ».**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 4.2 s (server 4.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. »
  - tools: `handoff_to_human {refund, evidence «nheb tredouli drahmi»} → ok`

### N17 — J04 playground (UI fr)
**Verdict: PASS (yes with a change) — T1 recap Blida 1 950 DA; T2 « oui mais livrez à Alger, … » → new recap Alger 400 DA, 1 900 DA, no order; T3 « oui » 0.13 s, 0 model call → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 2.4 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 3.5 s (server 3.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N25 — J04 playground (UI ar)
**Verdict: PASS (yes with a change, Arabic script) — T1 recap 1 950 دج; T2 « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 × 3 450 دج, no order; T3 « ايه » 0.18 s → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 2.8 s (server 2.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 3.2 s (server 3.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### N21 — J04 playground (UI ar)
**Verdict: PASS — T1 one `search_products` → « عندنا Hijab soie بسعر 1 500 دج (بدل 2 000 دج)، … ما عندناش صور لهذا المنتج حاليًا. تحب تديه ؟ » (a photo sentence nobody asked for — R21-3); T2–T3 one field question each; T4 recap 1 950 دج; T5 « 👍 » 0.13 s → TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 6.2 s (server 5.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بسعر 1 500 دج (بدل 2 000 دج)، حرير ناعم بمقاس 180 x 70 سم. ما عندناش صور لهذا المنتج حاليًا. تحب تديه ؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«hijab soie»} → 1 product(s)`
- **T2** C: « نادية قاسي » · `ar` · 2.8 s (server 2.5 s)
  - AI: « صحيت. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0661234568 » · `ar` · 2.4 s (server 2.3 s)
  - AI: « صحيت. واش من ولاية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.0 s (server 2.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N1 — J03 playground (UI fr)
**Verdict: PASS (change of product + wilaya, then cancel) — T1 recap djellaba Blida 7 950 DA; T2 → new recap Sac Marron, Oran 600 DA, 7 500 DA, no order; T3 « oui » 0.16 s → TEST-1605; **T4 « non annule » → `cancel_order {TEST-1605, customerConfirmed true}` ok**, « Commande TEST-1605 annulée, pas de souci. … » (N14).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.3 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.4 s (server 3.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 0.4 s (server 0.2 s)
  - AI: « Votre commande TEST-1605 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-1605, total 7500`
- **T4** C: « non annule » · `fr` · 3.8 s (server 3.5 s)
  - AI: « Commande TEST-1605 annulée, pas de souci. Si vous voulez reprendre un autre article plus tard, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-1605","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-1605`

### N4 — J03 playground (UI fr)
**Verdict: PASS (Arabic-script name in a French chat) — T1 price 2 800 DA (5.2 s, 2 `search_products` asked, one ran); T2 « Merci سمير. Pouvez-vous me donner votre numéro … ? » (name as written; a `stray` « none » call + a guard language_switch rewrite, 5.0 s); T3 « Merci سمير, votre numéro est bien noté. Dans quelle wilaya habitez-vous ? » (a `search_products` asked and a `quote_delivery {}` run with no wilaya → `VALIDATION`, 4.3 s — R21-1; « bien noté » — R21-3); T4 recap « Nom : سمير بن علي » 3 250 DA; T5 « oui c'est bon » 0.19 s → TEST-1344.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 5.4 s (server 5.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le tapis de prière est disponible à 2 800 DA. Il est molletonné, 120 x 70 cm, pour un confort agréable pendant la prière. ⏎ Pour préparer votre commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « سمير بن علي » · `fr` · 5.2 s (server 5.0 s)
  - AI: « Merci سمير. Pouvez-vous me donner votre numéro de téléphone (ex: 0555123456) pour continuer la commande ? »
- **T3** C: « 0661234567 » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Merci سمير, votre numéro est bien noté. Dans quelle wilaya habitez-vous ? »
  - tools: `quote_delivery {} → VALIDATION wilayaName missing`
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.1 s (server 2.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui c'est bon » · `fr` · 0.4 s (server 0.2 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N18 — J03 playground (UI ar)
**Verdict: PASS (Latin name in an Arabic chat) — T1 8.3 s page / 8.1 s server (a `search_products`, then a reply the guard stripped for a Moroccan form and a confirm sentence without a recap, then a retry — R21-1) « أهلا بيك! عندنا Djellaba homme … بسعر 7 500 دج بدل 9 000 دج. واش سميتك؟ »; T2 « تشرفنا يا سمير! … » (the Latin name written in Arabic letters in the sentence — R21-3), T3 guard `script_mix` stripped; T4 recap « الاسم: Samir Benali »; T5 « 👍 » 0.11 s → TEST-6540.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 8.3 s (server 8.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « أهلا بيك! عندنا Djellaba homme بصوف رقيق ولونها بيج، مقاس واحد، بسعر 7 500 دج بدل 9 000 دج. واش سميتك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar` · 2.9 s (server 2.7 s)
  - AI: « تشرفنا يا سمير! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 2.0 s (server 1.8 s)
  - AI: « صحيت يا سمير. واش من ولاية تحب نوصلوك فيها؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 3.0 s (server 2.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2ddb8b… core 64b204…, recap total 8200`
- **T5** C: « 👍 » · `ar` · 0.4 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6540 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-6540, total 8200`

### N7 — J03 playground (UI fr)
**Verdict: PASS (product not sold, then a yes to the list, NEW extension) — T1 « Désolé, nous ne vendons pas de lunettes de soleil … le sac à main en cuir véritable (6 900 DA, en noir ou marron), le tapis de prière molletonné (2 800 DA) ou la robe kabyle brodée à la main (4 900 DA). Livraison à domicile : 450 DA. Qu'est-ce qui vous plairait, Yacine ? » (in-stock items only, amounts with the space, the thanks now with the question — R20-4 fixed; home fee only, stop-desk 300 DA not said — R21-3 note); **T2 « oui » → « Super, merci Yacine ! Lequel vous intéresse : le sac à main en cuir (noir ou marron), le tapis de prière ou la robe kabyle brodée ? »** — the right short « which one? », no order, no hand-off, but written by the model (3.2 s, 1 call), not by the server (R21-1); T3 « le sac noir » → recap Noir 7 350 DA; **T4 « oui je prends » 0.12 s, 0 model call** → TEST-3496.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.2 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Parmi nos articles disponibles, je vous propose le sac à main en cuir véritable (6 900 DA, en noir ou marron), le tapis de prière molletonné (2 800 DA) ou la robe kabyle brodée à la main (4 900 DA). Livraison à domicile : 450 DA. Qu'est-ce qui vous plairait, Yacine ? »
  - cards: « Sac à main cuir 6900 DA » (no photo) · « Tapis de prière 2800 DA » (no photo)
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « oui » · `fr` · 3.5 s (server 3.2 s)
  - AI: « Super, merci Yacine ! Lequel vous intéresse : le sac à main en cuir (noir ou marron), le tapis de prière ou la robe kabyle brodée ? »
- **T3** C: « le sac noir » · `fr` · 2.9 s (server 2.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Noir) : 6 900 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 350 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×variant …5b35, customerConfirmed true} → CONFIRMATION_REQUIRED draft 1db6c2… core 688eb6…, recap total 7350`
- **T4** C: « oui je prends » · `fr` · 0.3 s (server 0.1 s)
  - AI: « Votre commande TEST-3496 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Noir) : 6 900 DA ⏎ Livraison : 450 DA ⏎ Total : 7 350 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×variant …5b35, customerConfirmed true} → ok TEST-3496, total 7350`

## Bugs

### R21-1 — Model time left on out-of-stock and field-only turns (one server turn ≥ 10 s); a yes to a product list still answered by the model
- Page: playground dialog (owner, fr / ar, 1440) — both shops
- Severity: Minor
- Type: Bug
- Steps: J04 › « Tester moi-même »: N5c « slm, l parfum oud ch7al ? » → « khlas nediha. Karim Haddad 0770112233, Oran, Bir El Djir, cite 1000
  logements bloc 4 » → « ih »; J03 › « Tester moi-même »: N18 « السلام عليكم، نحب نشري جلابة رجالي »; N4 « Bonjour, je veux le tapis de prière »
  → « سمير بن علي » → « 0661234567 »; N7 « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20
  août villa 3 » → « oui »; read `Server-Timing`, `AiRun.meta.steps`, `AiToolCall`.
- Expected: server time under 10 s (R10-1); no lookup asked on a message that names no new product (R11-3 … R20-1); a plain yes to a question
  offering two in-stock catalogue products or more answered by the server's one short « which one? » with no model call (R20-3 fix).
- Actual:
  - **N5c T3 « ih »** (10:02:25, **10.8 s page / 10.6 s server**, `AiRun` 01a1ede4-a093) — 3 model calls: `search_products` asked (4.7 s, not
    run: withheld), the reply (4.5 s), guard `moroccan_darija` rewrite (1.3 s) → « Smah lia, Parfum Oud makach f stock dork, ma nqderch nsajjel
    commande lih. T7ebb nwarrik produit okhor kayen 3andna, bhal Hijab soie (1 500 DA) wella Djellaba homme (7 500 DA) ? ». The same flow's T1
    took 8.4 s (`AiRun` 01a1ede4-59e3: reply 5.4 s → `format` 1.3 s → guard 1.3 s) and T2 8.1 s (01a1ede4-7dbf: 4.9 s → guard rewrite 3.1 s). The
    fr flow on the same shop (N5) took 5.0 / 3.3 / 2.5 s.
  - **N18 T1** (10:10:54, 8.3 s / 8.1 s, `AiRun` 01a1edec-642b) — `search_products` 3.5 s → a reply the guard stripped (`moroccan_darija` +
    `confirm_without_recap`) 2.5 s → retry 1.3 s.
  - **N4** (J03, fr) — T1 two `search_products` asked for one product (one ran), 5.2 s; **T2 « سمير بن علي »** a `stray` call to a tool named
    « none » then a guard language_switch rewrite (3 calls, 5.0 s); **T3 « 0661234567 »** a `search_products` asked (not run) then a
    `quote_delivery {}` the server ran with no wilaya (→ `VALIDATION wilayaName missing`), 3 calls, 4.3 s.
  - **N7 T2 « oui »** to T1's « … le sac …, le tapis de prière … ou la robe kabyle brodée … Qu'est-ce qui vous plairait, Yacine ? » (10:09:12,
    3.5 s / 3.2 s, `AiRun` 01a1edea-d33f, 1 model call) → « Super, merci Yacine ! Lequel vous intéresse : … ? » — the right answer, but by the
    model; the server's « which one? » of R20-3 did not take this list (three products, an open « Qu'est-ce qui vous plairait ? » at the end).
  - A guard language_switch retry on each product + place message of the shared link (F5 1.7 s, F5b 1.6 s, F5r 3.0 s extra) and duplicate
    `quote_delivery` asks (N3 T2, DQ2 T2, one ran each).
  - Fixed since R20-1: « ih ndirha » / « wah ndirha » / « ايه نديرها » / « oui je prends » / « yes I take it » with 0 model call (0.08–0.19 s
    server), 25 / 25 orders with 0 model call, PG2 T2 4.7 s (R20 13.5 s), A3 T1 3.2 s (R20 8.9 s, a `search_products {«noop»}` run), no
    `get_product` after a search (R20 N5 T1 two), 1 `stray` call (R20 4), 105 model calls in 99 turns (R20 117), 1 turn ≥ 10 s (R20 2).
- Evidence: .local/qa/journeys/R21/out/transcripts/N5c.json T1–T3, N18.json T1, N4.json T1–T3, N7.json T2 · out/airun.txt (`meta.steps`) ·
  out/steps.txt · out/toolcalls.txt · .local/qa/campaign/retest-ai-r21/fr-N5c-pg.png, ar-N18-pg.png, fr-N4-pg.png, fr-N7-pg.png
- Likely cause: in arabizi the model's first draft keeps a Moroccan form or a French sentence, so the guard costs a second (and on N5c T1 a
  third) call; after an out-of-stock answer a bare « ih » to « do you want to see what we have? » is read by the model as a new search; on
  field-only messages (a name, a phone) the model still asks lookups; the server's either/or detector looks for « X ou Y ? » and not for a
  list ending with an open question.

### R21-2 — Out-of-stock take in arabizi: the out-of-stock apology in three turns in a row and « your details are recorded »
- Page: playground dialog (owner, fr UI, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › « Tester moi-même »: N5c « slm, l parfum oud ch7al ? » → « khlas nediha. Karim Haddad 0770112233, Oran, Bir El Djir, cite 1000
  logements bloc 4 » → « ih ».
- Expected: the out-of-stock line said once (R13-5, R20-3), then the in-stock options offered as a choice; nothing that reads like an order
  step before the server recap (R19-3, R20-4).
- Actual (10:02:00–10:02:36; no order for the out-of-stock product, rightly):
  - T1 « Salam! Parfum Oud 50 ml, 3 200 DA. Malheureusement, rah ghir f rupture de stock dork. T7ebb nwarrik wach kayen 3andna ? »
  - T2 « Smah lia, Parfum Oud makach f stock dork. Saha, les détails ta3ek tsajjelou (Karim Haddad, Oran, Bir El Djir, cité 1000 logements
    bloc 4). Tawsil l dar: 600 DA (batel men 20 000 DA). Wach t7ebb nwarrik wach kayen 3andna ? » — the same open question as T1, no product
    named, and « tsajjelou » (« are recorded »).
  - T3 « ih » → « Smah lia, Parfum Oud makach f stock dork, ma nqderch nsajjel commande lih. T7ebb nwarrik produit okhor kayen 3andna, bhal
    Hijab soie (1 500 DA) wella Djellaba homme (7 500 DA) ? » — the apology a third time; the options come only now (10.6 s, R21-1).
  - The fr flow (N5) said the out-of-stock line in T1, T2 and in the server's lead-in of T3's recap (« Le produit Parfum Oud 50 ml n'est pas
    disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ») — there each turn moved the order on.
- Evidence: .local/qa/journeys/R21/out/transcripts/N5c.json T1–T3, N5.json T1–T3 · out/steps.txt · .local/qa/campaign/retest-ai-r21/fr-N5c-pg.png
- Likely cause: in arabizi the model asks « shall I show you what we have? » instead of naming the substitute, so the « take » message and the
  « ih » both come back to an out-of-stock product the server still holds as taken, and its out-of-stock sentence is put in front each time;
  the R20-4 « noted » filter does not hold « tsajjelou ».

### R21-3 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — both shops
- Severity: Cosmetic
- Type: Text
- Steps: run N5, N4, PG2, PG1, N21, N18, F6, N7, DQ1, DQ2.
- Expected: nothing that reads like an order step before the server recap; one language per conversation; only in-stock goods named; the
  customer's name as written.
- Actual:
  - « Noted » lines before a recap (customer details, not an order): N5 T2 « Merci pour vos coordonnées, je les garde. », N4 T3 « Merci سمير,
    votre numéro est bien noté. », N5c T2 « les détails ta3ek tsajjelou » (R21-2).
  - PG2 T1 « … واش تحب تشري اليوم؟ عندنا بزاف حوايج: جلابات، روب قبايلية، أكياس، عطور وغيرها. » — « عطور » (perfumes) listed; the J03 shop's only
    perfume, Parfum Oud, is out of stock (R20 had removed this list).
  - N21 T1 « … ما عندناش صور لهذا المنتج حاليًا. تحب تديه ؟ » — a « we have no photos » sentence nobody asked for.
  - PG1 T1 « Ahla bik ya Oran! » (« welcome, Oran! »).
  - N18 T2 / T3 « تشرفنا يا سمير! » / « صحيت يا سمير. » — the Latin name « Samir Benali » written in Arabic letters in the sentences (the recap keeps
    « Samir Benali »).
  - F6 T3 « yes I take it » in a French chat → the confirmation in English (« Your order TEST-2340 is confirmed ✅ … cash on delivery. … Thank
    you for your trust! »); R20's « yes » in the same chat kept French. The customer's last message is English, so this is a choice to make, not
    a broken rule.
  - One fee only where a full address came with the place: N5 T2 « Livraison à domicile : 600 DA (gratuite dès 20 000 DA). », N5c T2 « Tawsil
    l dar: 600 DA (…) », N7 T1 « Livraison à domicile : 450 DA. » (stop-desk 400 / 300 DA not said; nothing asked the mode). The Oran free-home
    threshold is said in PG1 T1, N5 T2, N5c T2, but not in DQ1 / DQ2's delivery answers (« À domicile : 600 DA, en stop-desk : 400 DA. »).
  - DQ2 T2 « نوصلو لـوهران » (a tatweel joins « لـ » to the place name).
  - Fixed since R20-4: every amount with the thousands space (« 4 900 DA », « 24 990 DA », « 2 800 دج », « 7 500 دج بدل 9 000 دج »), N16 one
    clause, N7 « … Qu'est-ce qui vous plairait, Yacine ? » (no thanks between the list and the question), F5r one language, « je note … » and
    « Vos coordonnées sont bien notées » gone.
- Evidence: .local/qa/journeys/R21/out/transcripts/N5.json T2, N4.json T3, PG2.json T1, N21.json T1, PG1.json T1, N18.json T2–T3, F6.json T3,
  N7.json T1, DQ1.json T2, DQ2.json T2 · .local/qa/campaign/retest-ai-r21/ar-PG2-pg.png, fr-F6-pg.png, fr-N4-pg.png
- Likely cause: free model wording (the « noted » filter matches « je note » / « bien notées », not « je les garde » / « bien noté » /
  « tsajjelou »); the server's plain-yes confirmation takes the language detected on the yes itself; the R20-2 fee rule adds the quote's fees
  only to a reply that states none of them.

## Retest
- RETEST R20-1: mostly fixed — the 5 forms « ih ndirha » (F3), « wah ndirha » (P2), « ايه نديرها » (Y2), « oui je prends » (N7), « yes I take it »
  (F6) each placed one order with 0 model call, 0.26–0.38 s page / 0.08–0.19 s server; « oui je prends 2 » (YC) → a new recap, no order;
  **25 / 25 orders with 0 model call**; PG2 T2 4.7 s (R20 13.5 s), A3 T1 3.2 s with 1 call (R20 8.9 s, 4 calls, a « noop » search run), no
  `get_product` after a search; 1 `stray` call (R20 4); 105 model calls (R20 117); server max 10.6 s (R20 13.5 s). Left: N5c T1–T3 8.4 / 8.1 /
  10.6 s, N18 T1 8.1 s, N4's lookups on a name / phone message with a `quote_delivery {}` run, N7's yes to a product list through the model →
  R21-1.
- RETEST R20-2: fixed — a delivery question asked before the recap is answered with the delay and both fees in the customer's language, 4 / 4:
  N3 and N3b « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. », DQ1 « Oui, on livre à Oran, en 2 à 5 jours. À
  domicile : 600 DA, en stop-desk : 400 DA. », DQ2 « إيه، نوصلو لـوهران، من 2 إلى 5 أيام. للدار: 600 دج، لنقطة الاستلام (stop-desk): 400 دج. »;
  the shared link's product + place message says the price and both fees 3 / 3 (F5, F5b, F5r « … 4 900 DA. L dar: 400 DA, f stop-desk: 250 DA. »,
  R20 F5r none); F12 / F9 / N16 as before; 0 asked fee missing in 99 turns (R20 2).
- RETEST R20-3: partly verified — no loop: N5 T3 « oui » to the one substitute → its server recap (the model told it is the order's product),
  N5 T4 / N5c T4 a choice → a recap, each next yes → one order; the out-of-stock product never ordered or recapped. The server's « which one? »
  after a two-option question was not seen: the model offered one substitute (N5) or an open « T7ebb nwarrik … ? » (N5c) before the bare yes,
  and N7's yes to a three-product list got a right « Lequel vous intéresse : … ? » from the model (3.2 s) → R21-1. N5c repeats the out-of-stock
  apology in T1–T3 → R21-2.
- RETEST R20-4: mostly fixed — every amount of the 99 replies with the thousands space (151 amounts ≥ 1 000; model sentences « 4 900 DA », « 2 800
  دج للوحدة », « 24 990 DA »; R20 « 6900 DA », « 4900 DA », « 24990 DA », « 12500 DA », « 7500 دج »); 0 phone, order number or street number
  reformatted; N16's repeated clause gone; N7's thanks before the question gone; F5r one language; « je note » / « bien notées » gone. Left: « je
  les garde », « bien noté », « tsajjelou », PG2's « عطور », N21's photo sentence, N18's name in Arabic letters, F6's English confirmation, one fee
  where an address was given → R21-2, R21-3.
- R1–R19 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 25 orders**; one order per yes: 25 orders, never
  two for one yes, 0 lost; N17 T2 / N25 T2 / YC T2 yes with a change → new recap; N5 T3, N5c T3, N7 T2 yes to no recap → no order; N14 cancel
  after an order → the right order; R4-1 / R11-2 / R13-1 (no hand-off on an order / field / place / yes / delivery message, nor for a product
  sold or not sold) holds — 0 wrong call; R14-3 (every real hand-off accepted) holds — 4 / 4; R4-2 / R9-1 (a name in another script keeps the
  language) holds — N4, F3, N18; R14-1 (language kept) holds — 33 / 33 conversations (F6's last reply follows its English yes → R21-3); R4-4 /
  R6-1 (no model sentence asking to confirm in front of the recap) holds — 32 / 32; R8-2 / R10-2 / R12-2 (no confirm request / claim without a
  recap) holds — 0 in 99 turns (N18 T1 caught by the guard); R4-8 (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5,
  N5c, N7, P2, N9 (PG2's « عطور » category → R21-3); R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×8); R5-4 (no « home or stop-desk ? »
  after a street) holds; **R5-5 / R7-5 (delivery question answered with the fee) holds — 7 / 7**; R5-6 (no `create_order` before a phone) holds
  — 0 / 58; R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 32 / 32; R8-3 (named variant) holds; R10-1 (latency) — server max
  10.6 s, 1 turn ≥ 10 s (→ R21-1); R11-5 (no provider error) holds — 0 / 99; R12-1 (no `VALIDATION wilayaId`) holds — 0 on `create_order`;
  R13-3 (Arabic street kept) holds — PG2, N11, N18, N21, N25, DQ2, Y2, A3; R13-5 (substitute line) holds in N5, repeated in N5c (→ R21-2);
  **R15-1 (price and both fees before the address question) holds — price 18 / 18, fees 5 / 5 where a place was known**; R15 / R16 fees — every
  fee said matches the shop's settings (99 / 99 turns), the Oran free-home rule applied once (Coffret 24 990 DA, « gratuite »); R16-1 (every
  asked fee kept) holds — F9; R16-2 (one reason sentence, no refusal) holds — W1, C2; R17 (a plain yes to the recap placed; out-of-stock never
  offered) holds; R18-1 (place first ⇒ both fees) holds — PG1, PG2; R18-2 (price before the questions) holds; R19-1 / R19-2 hold (0 model call
  on a yes to a recap; 0 hand-off tool on a product-less message); no invented discount (catalogue old prices Hijab 2 000, Djellaba 9 000); N11
  tracking from `lookup_order` (status new, not sent, no tracking number), nothing invented; photo request (N9) honest.

## Coverage
- Order flows to a yes: French ×9 (N5, DQ1, YC, N17, N7, F6, N1, N4; F11 blocked), Arabic-script darija ×8 (N11, N25, N21, PG2, A3, DQ2, Y2,
  N18), arabizi ×9 (N3 and N3b after a switch, N5c, P2, PG1, N9, F3; F5 and F5b mixed fr / arabizi on the shared link); a cancel after an
  order (N14 in N1); stopped by design: F5r (T1); no order, rightly: F9, N16, F12 (delivery questions only), C2, H1, W1 (team).
- Asked this round: N3 ×2 (J03, J04), the two new delivery questions before the recap (fr, Arabic script), F5 ×2 + F5r on the shared link, N5
  ×2 (fr, arabizi — the either/or path, a « oui » after the substitute question, a choice, a yes), the 5 new yes forms with `Server-Timing` and
  `meta.steps`, a yes with a number (YC), PG2, A3; the amounts and every number of every reply; the sweep F3, F6, F9, F11, F12, W1, H1, C2, N1, N4,
  N7, N9, N11, N14, N16, N17, N18, N21, N25, P2, PG1; latency of every turn; every fee and the Oran free threshold against the shop's settings.
- Also: the Oran free-home rule reached for the first time (N5 T3, Coffret 24 990 DA → « gratuite », total 24 990 DA); N7 taken past the
  not-sold answer to an order; « yes I take it » in English in a French chat (F6); a third product chosen after a two-option offer (N5c T4 Robe
  kabyle M); the J03 shop inside its opening hours (11 conversations, no « out_of_hours » line); Arabic-Indic digits (A3); a wilaya not served
  (F9, N16).
- Kit: no blocked call, 0 API error, 0 console error (33 / 33 `.log.json` clean), no kit timeout; shared link valid (F5 / F5b / F5r / F12 answered).

## Not tested
- F1 (fields one per message, fr), F1b (fields over 3 messages, « oui, c'est bien … »), N23 (arabizi yes with a change), PF1 (place first, fr) and
  A1 (Arabic fields one per message) — in the sweep list, left out to stay within 100 messages (they passed in R20; the same paths ran in F3, N4,
  N18, N21 (one field per message), N17 / N25 / YC (yes with a change), PG1 / PG2 (place first)).
- The server's « which one? » after a bare yes to a two-option question: no flow produced a two-option question before a bare yes (N5's model
  offered one substitute, N5c's an open « shall I show you? »); a « oui le hijab » that names a substitute.
- F5r's T2 / T3; F9b, W1b, H2, C1, PF2, PF1r, PG1b, PG2b, N12 not re-run (passed in R19 or earlier; not in this round's list); an `angry`
  hand-off; a J03 conversation outside opening hours.
- Other spellings of a yes-with-intent (« ih nchriha », « oui je confirme », « ok », « d'accord », « صحيت », « ok ndirha ») — only the 5 asked forms
  and the R20 forms were sent.
- A photo request on a product that HAS a photo (the J03 Robe kabyle brodée has one; N9 ran on J04).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`); `cancel_order` on a real order. The live
  Messenger path (no page connected), so the real hand-offs of W1 / H1 / C2 (inbox assignment, AI paused) were not seen.
- The stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04; J04 link `usedCount` 48 → 56), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-7864 (N5), TEST-9746 (N5c), TEST-6890 (F5, F5b, N9), TEST-9385 (N3b),
  TEST-7471 (DQ1), TEST-3844 (YC), TEST-1158 (P2), TEST-1288 (PG1), TEST-4074 (N11), TEST-8063 (N17), TEST-6971 (N25), TEST-6619 (N21),
  TEST-1772 (PG2), TEST-5126 (A3), TEST-6017 (N3), TEST-2971 (DQ2), TEST-4429 (Y2), TEST-3496 (N7), TEST-2340 (F6), TEST-5998 (F3), TEST-1605
  (N1, then cancelled by N14 — simulated), TEST-1344 (N4), TEST-6540 (N18); F11 refused (`CUSTOMER_BLOCKED`). The same content gives the same
  simulated number (R20's TEST-6890, TEST-1158, TEST-1288, TEST-4074, TEST-8063, TEST-6971, TEST-6619, TEST-1772, TEST-5126, TEST-2340, TEST-5998,
  TEST-6540 again); the others are new flows or a call written differently (N3, N1, N4).
- Server reads (read-only): `git log` on the VPS, pm2 status, Redis `rl:*` count / TTL, `DeliveryFeeRule`, `Product`, `ProductVariant`,
  `AgentTestLink` (expiry, use count), `CustomerBlock` and `Agent.businessHours` rows, `AiRun` rows since 09:00 UTC with `meta.guard` /
  `meta.steps` (out/airun.txt, out/steps.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (99, `waitMs −
  runMs` ≤ 100 ms, 0 replay, 0 « did not finish »); nothing written.
- Hour counters (read-only, after the run): J04 58 / 60 (window from 10:01:30; the 8 shared-link turns count in it; link visitor counter 8),
  J03 41 / 60 (window from 10:07:36); no 429. Messages used: 99 / 100.
