# R20 — Twentieth retest of the AI order-taking (after the R19 fixes) — live site, deployed commit b90cdbe — 18/11/2026 08:10–09:06 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at b90cdbe (checked read-only: `git log --oneline -1` = « b90cdbe fix(ai): live retest R19 — a
plain yes to the shown recap is placed with zero model calls, no extra call after an order / recap / not-offered tool, JSON repaired instead
of retried, no hand-off tool on product-less messages, server amounts with formatMoney, facts before questions, wording fixes »;
`djaber-v2-api` / `djaber-v2-worker` online, restarted 08:07:59). Same two own shops as R1–R19: « Boutique de Nassim » (J03 shop, « Agent J03
Vendeur », default language FR, opening hours 09:00–20:00 Sun–Thu + Sat) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur
Pro, no opening hours set). Surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and, for F5 / F5r / F12, the J04 shared
test link (`/agent-test/<token>`, valid until 18/11 18:04, so no new link was made; its tool calls were read server side, read-only, from
`AiToolCall`). One browser at a time, the runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in
place (F11). Hour counters before the run (read-only, Redis `rl:*`, 08:09): none. J04 flows 08:10:16–08:15:24; **the J03 flows were held until
the shop opened and ran 09:00:44–09:05:40, inside its opening hours: 0 « out_of_hours » line in the 14 J03 conversations** (R19: 15 / 15 out of
hours). No 429.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, last change 16/11 — unchanged since R18), used to check every fee:**
Alger 400 home / 250 stop-desk, Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (`freeAbove` 20 000 DA, home only),
Illizi 1 500 / 1 000 inactive (not served). Stock (read-only, `Product` / `ProductVariant`, unchanged since R19): J04 Parfum Oud 50 ml 0,
Montre connectée 0 (`sellOutOfStock` true), Coffret cadeau Aïd 4, Hijab soie 20 (old price 2 000), Djellaba homme 10 (old price 9 000), Robe
kabyle S 5 / M 5 / L 0 / XL 2 (XL 5 200); J03 Parfum Oud 50 ml 0, Montre connectée 0, Coffret cadeau Aïd 4 (24 990), Sac à main cuir Noir 3 /
Marron 3 / Rouge 0, Tapis de prière 15, Djellaba homme 10, Basket Runner 41 0, Robe kabyle L 0. No J04 product has a photo (N9).

**Latency method (as R11–R19).** R19's `conv.mjs` unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. `Server-Timing` still
carries only `queue` and `total` (no model sub-metric), so « no model time » is read from `total` plus the run's `AiRun.meta.steps` (one entry
per model call; `[]` = the server answered without the model). Server side, read-only: the API's « playground turn answered » lines (`runMs`,
`waitMs`, `totalMs`, `replayed`), the `AiRun` rows (`latencyMs`, `status`, `flags`, `meta.guard`, `meta.steps`) + `AiToolCall` rows. No stall /
dup probe.

**99 customer messages** (J04 shop 47 of which 5 on the shared link, J03 shop 52; budget 100), 33 conversations, 30 on the playground and 3 on
the shared link: priority 1 — the 8 yes forms on 8 shown recaps (F1 « oui », PG1 « ih », N11 « ايه », F6 « yes » (NEW wording in F6), P2
« wah », N21 « 👍 », N4 « oui c'est bon », F3 « ih ndirha »), YQ (NEW: « oui, et la livraison c'est quand ? »), the yes-with-a-change flows
N17 / N23 / N25, F11 blocked; priority 2 — N5 ×2 (N5 on J04 full, N5b on J03 T1–T2), F5 ×2 on the shared link (F5 full, F5r = its T1 again),
N11, N3, N4, PG1, PG2, PF1; priority 3 — the sweep F1, F1b, F3, F6, F9, F12 (link), W1, H1, C2, N1 (+ N14 as its 4th message « non annule »),
N7, N9, N16, N17, N18, N21, N23, N25, P2, A1 (run this time), A3. Flows with `untilOrder` stop at the order. No adaptive re-send, no re-send by
the script. Scripts `.local/qa/journeys/R20/scripts/` (R19's conv.mjs, convs.json + YQ, F5r, F6 T3 « yes », N5b cut to 2 messages; render.cjs,
check.cjs, lat-table.cjs, server.sh = read-only `AiRun` query with `meta.steps`, tools.sh = read-only `AiToolCall` query, pre.sh = read-only
settings / stock / link / block / hours query, run.sh, all.sh (J04), all2.sh (J03)), transcripts `.local/qa/journeys/R20/out/transcripts/<id>.json`
(+ `.ui.txt`, `.log.json`), run logs `.local/qa/journeys/R20/out/run1.log` (J04), `run2.log` (J03), `airun.txt`, `steps.txt` (turn ↔ `AiRun` ↔
steps), `toolcalls.txt`, rendered turns `out/render.md`, screenshots `.local/qa/campaign/retest-ai-r20/`.

Cases asked for this round:
- **R19-1 / plain yes**: 8 recaps answered with « oui », « ih », « ايه », « yes », « wah », « 👍 », « oui c'est bon », « ih ndirha » ⇒ exactly one
  order each and no model time in `Server-Timing`; a yes with a question ⇒ one order and the question answered; a yes with a change ⇒ a new
  recap, no order; F11 blocked ⇒ refused.
- **R19-1 latency**: N5 ×2 (out of stock ⇒ substitute), F5 ×2 on the shared link; N11 (two lookups in R19).
- **R19-2**: N3 (delivery question before the recap — both fees still said?), F1b T4 (yes to the recap) ⇒ no `handoff_to_human` call.
- **R19-3**: N4 (name as written), PG1, PG2, PF1 (price / fee order, « noted » lines, amounts with the thousands space).
- The sweep; latency per turn; every R1–R19 guarantee (no order without a server recap — Critical; one order per « oui »; no `create_order`
  before a phone; no confirm question / registered claim without a server recap; no wrong hand-off and every real one accepted; language and
  script kept; no invented discount; tracking real; address street, commune, wilaya; fees and prices match the shop's settings; amounts with the
  thousands space).

**Result: 28 / 33 conversations pass** — priority 1 + 2: 8 / 12 (PG1, N11, N4, PF1, N5b, F5, YQ, F11 pass; **N5 fails — R20-1 (T1 11.5 s
server) and R20-3 (the out-of-stock take never reaches a recap), PG2 fails — R20-1 (T2 13.5 s, a stray call + a guard retry), N3 fails —
R20-2 (the delivery question answered without its fees), F5r fails — R20-2 (server quote run, no fee said)**), sweep 20 / 21 (**F3 fails —
R20-1, « ih ndirha » placed through a model call, 2.8 s**). **R19-1 mostly fixed: 20 / 21 yes-only answers to a shown recap are answered by the
server with 0 model call — 0.26–0.48 s on the page, 0.10–0.23 s server** (« oui » ×5, « ih » ×3, « ih saha », « ايه » ×5, « yes », « wah »,
« 👍 » ×2, « oui c'est bon » ×2, « oui, c'est bien la cité … » — R19: 2–3 model calls, 3.5–8.4 s; + F11's blocked « oui » 0.11 s); « ih ndirha »
is the one form left to the model (2.8 s, R20-1). N5 T2 3.3 s (R19 17.1 s, 0 `VALIDATION`), F5 T1 5.7 s (R19 11.5 s), N11 T3 one lookup (R19
two), 4 `stray` calls in 99 turns (R19 27), 117 model calls (R19 216). Left: N5 T1 11.5 s (two `get_product` after the search), PG2 T2 13.5 s,
A3 T1 8.9 s (a `search_products {«noop»}` run), searches asked on name-only messages (R20-1). **R19-2 fixed: 0 wrong `handoff_to_human` call in
99 turns** (N3 T2, F1b T4 no hand-off tool; the one call, W1's, is right and accepted). **R19-3 mostly fixed**: N4 « Merci سمير ! », F3 « Saha
وليد بوزيد. », F5 T1 one language, F1b T2 no « c'est noté », substitute questions no longer « réserver / je vous confirme », server amounts
« 3 200 DA », « 20 000 DA »; left « je note … » (PF1 T2), « Vos coordonnées sont bien notées » (N5 T2), F5r fr + arabizi, model amounts
« 6900 DA » / « 24990 DA » / « 12500 DA », N16's repeated clause, « Merci Yacine. » placed before the question (R20-4). **Latency: page median
3.1 s, p90 6.3 s, max 13.8 s; server median 2.8 s, p90 6.1 s, max 13.5 s (PG2 T2) — R19 page median 5.1 s, p90 8.0 s; 2 turns ≥ 10 s (PG2 T2,
N5 T1; R19 2), all server time; `Server-Timing` on 99 / 99 answers; page − server median 0.22 s, max 0.31 s; 0 provider error.** **0 order without
a server recap; 22 TEST orders, each from one yes to a server recap; F11 refused as blocked; 0 yes to a recap lost; 3 yes with a change → a new
recap, 0 order; 2 « oui » to no recap (N7 T2, N5 T3 / T4) → no order; 1 cancel after an order (N14) → the right one; 0 `create_order` before a
phone in 51 calls; 0 `VALIDATION`; 0 wrong fee in 99 turns.** Failures — no Critical, no Major: R20-1 latency / model calls left (Minor),
R20-2 fees not said where R15–R19 said them (Minor), R20-3 the out-of-stock take loops on « oui » (Minor), R20-4 wording left (Cosmetic).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| PF1 | J03 · playground (in hours) | fr, place alone then product | T1 Sétif 650 / 350 (server quote); T2 price; recap → « oui » 0.2 s → TEST-6293 | T2 7.6 s / 7.4 s | yes, 1 | PASS (R20-1, R20-4 notes) |
| PG1 | J04 · playground | arabizi, greeting + place | T1 600 (batel men 20 000 DA) / 400; recap → « ih » 0.16 s → TEST-1288 | T2 5.6 s / 5.3 s | yes, 1 | PASS |
| PG2 | J03 · playground (in hours) | Arabic script, greeting + place | T1 450 / 300; **T2 13.8 s, 0 tool**; recap → « ايه » 0.18 s → TEST-1772 | **T2 13.8 s / 13.5 s** (slowest) | yes, 1 | FAIL — R20-1 |
| N3 | J03 · playground (in hours) | fr → arabizi at T2 | T1 price; **T2 « Ih, nwasslou l Constantine, f 2 l 5 ayam. » + recap — no fee in the answer, stop-desk 450 not said**; no hand-off; « ih saha » → TEST-7010 | T1 4.9 s / 4.7 s | yes, 1 | FAIL — R20-2 |
| N5 | J04 · playground | fr, out of stock « c'est combien ? » | **T1 11.9 s, 4 model calls**; T2 3.3 s (R19 17.1 s); **T3 / T4 « oui » → the same two-option question, no recap** | **T1 11.9 s / 11.5 s** | no | FAIL — R20-1, R20-3 |
| N5b | J03 · playground (in hours) | fr, the N5 messages (2) | substitute Coffret 24990 DA; T2 Oran 600 (gratuite dès 20 000 DA), 0 `create_order` | T2 3.8 s / 3.6 s | — (stopped at T2) | PASS (R20-4 note) |
| N11 | J04 · playground | Arabic script, tracking | « ايه » 0.18 s → TEST-4074; T3 **one** `lookup_order`, nothing invented | T3 4.2 s / 4.0 s | yes, 1 | PASS (R19-1 fixed here) |
| N4 | J03 · playground (in hours) | fr, Arabic-script name alone, « oui c'est bon » | **« Merci سمير ! »**; recap « سمير بن علي » → 0.18 s → TEST-8384 | T1 3.7 s / 3.4 s | yes, 1 | PASS (R19-3 fixed) |
| YQ | J04 · playground | fr, **« oui, et la livraison c'est quand ? »** (NEW) | one order TEST-8063 + « Délai de livraison : 2 à 5 jours. » | T2 2.9 s / 2.7 s | yes, 1 | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » 0.11 s → `CUSTOMER_BLOCKED`, team | T1 2.6 s / 2.4 s | no (refused, as expected) | PASS |
| F5 | J04 · shared link | fr / arabizi mixed, « oui c'est bon » | **T1 5.9 s** (R19 11.7 s), arabizi, 4900 DA + 400 / 250; recap → 0.13 s → TEST-6890 | T1 5.9 s / 5.7 s | yes, 1 | PASS (R19-1 fixed here) |
| F5r | J04 · shared link | the F5 T1 message again (1) | quote 400 / 250 run, **no fee in the reply**, fr + arabizi | T1 5.0 s / 4.9 s | — (stopped at T1) | FAIL — R20-2 |
| N16 | J04 · playground | arabizi, Illizi | not served, no offer | T1 3.4 s / 3.2 s | — | PASS (R20-4 note) |
| N9 | J04 · playground | arabizi, photo request | « Ma 3andnach tsawer … » honest; recap → « ih » 0.11 s → TEST-6890 | T1 8.7 s / 8.4 s | yes, 1 | PASS |
| N1 + N14 | J03 · playground (in hours) | fr, product + wilaya change, then « non annule » | new recap Oran → « oui » 0.14 s → TEST-5759 → `cancel_order` TEST-5759 ok | T4 3.7 s / 3.5 s | yes, 1, then cancelled | PASS |
| P2 | J04 · playground | arabizi, « wah » | recap S → 0.19 s → TEST-1158 | T1 6.3 s / 6.1 s | yes, 1 | PASS |
| N21 | J04 · playground | Arabic script, fields one per message, « 👍 » | recap → 0.17 s → TEST-6619 | T3 6.5 s / 6.3 s | yes, 1 | PASS |
| A1 | J04 · playground | Arabic script, fields one per message, « ايه » | recap → 0.23 s → TEST-4104 | T1 5.6 s / 5.4 s | yes, 1 | PASS |
| F9 | J04 · playground | arabizi, 3 wilayas | Sétif 650 / 350, Oran stop-desk 400, Illizi not served | T1 7.0 s / 6.8 s | — | PASS |
| F12 | J04 · shared link | fr | Blida 450 / 300 | T1 2.4 s / 2.2 s | — | PASS |
| W1 | J04 · playground | fr, wholesale | model `handoff_to_human {off_catalogue}` accepted | T1 3.4 s / 3.2 s | — (team) | PASS |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | platform hand-off | T1 1.7 s / 1.5 s | — (team) | PASS |
| C2 | J04 · playground | arabizi, broken order + refund | platform hand-off, arabizi reason sentence | T1 3.5 s / 3.3 s | — (team) | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » 0.13 s → TEST-8063 | T2 3.3 s / 3.1 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » 0.11 s → TEST-6971 | T1 3.3 s / 3.1 s | yes, 1 | PASS |
| F1 | J03 · playground (in hours) | fr, fields one per message | recap → « oui » 0.12 s → TEST-6293 | T2 5.7 s / 5.6 s | yes, 1 | PASS (R20-1 note) |
| F1b | J03 · playground (in hours) | fr, fields over 3 messages | T2 both fees; T4 « oui, c'est bien … » 0.13 s → TEST-6293, **no hand-off call** | T1 5.3 s / 5.0 s | yes, 1 | PASS (R19-2 fixed) |
| F3 | J03 · playground (in hours) | arabizi, fields one per message, **« ih ndirha »** | « Saha وليد بوزيد. »; **« ih ndirha » → TEST-5998 through 1 model call, 2.8 s** | T5 3.1 s / 2.8 s | yes, 1 | FAIL — R20-1 |
| F6 | J03 · playground (in hours) | fr, quantity change, **« yes »** | 2 → 3 new recap → « yes » 0.14 s → TEST-2340 9 100 DA | T1 3.1 s / 2.8 s | yes, 1 | PASS |
| N18 | J03 · playground (in hours) | Arabic script, Latin name alone, « 👍 » | « Samir Benali » kept → 0.23 s → TEST-6540 | T1 7.7 s / 7.5 s | yes, 1 | PASS |
| N23 | J03 · playground (in hours) | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » 0.13 s → TEST-5687 | T2 3.2 s / 3.0 s | yes, 1 | PASS |
| A3 | J03 · playground (in hours) | Arabic script, « ٠٥٥٠… », no separator | T1 price, 8.9 s (a `search_products {«noop»}` run); recap → « ايه » 0.10 s → TEST-5126 | T1 9.1 s / 8.9 s | yes, 1 | PASS (R20-1 note) |
| N7 | J03 · playground (in hours) | fr, product not sold, then « oui » | in-stock items only; « oui » → the question again, no order, no hand-off | T1 6.1 s / 5.9 s | no (right) | PASS (R20-4 note) |

Pass criteria, counted over all flows:
- **The 8 yes forms asked (priority 1), each to a shown server recap → exactly one order: 8 / 8; with no model time: 7 / 8** — F1 T5 « oui »
  0.12 s server, PG1 T4 « ih » 0.16 s, N11 T2 « ايه » 0.18 s, F6 T3 « yes » 0.14 s, P2 T3 « wah » 0.19 s, N21 T5 « 👍 » 0.17 s, N4 T5 « oui
  c'est bon » 0.18 s — each `AiRun.meta.steps` `[]`, `latencyMs` 86–165 ms, `Server-Timing` `total` 121–193 ms; **F3 T5 « ih ndirha »
  2.8 s server, 1 model call (2 689 ms) that sent the confirming `create_order` — R20-1.**
- « oui » to a server recap → exactly one order with the recap's content: **22 / 22** (PG1, F5, N11, YQ, P2, N21, A1, N9, N17, N25, PF1, PG2, N3,
  N4, F1, F1b, F3, F6, N1, N18, N23, A3) + F11 refused as blocked (1 / 1, 0.11 s, 0 model call). **Order without a server recap: 0.** **Yes to a
  correct recap lost: 0.** Yes forms that placed: « oui » ×4, « ih » ×3, « ih saha » ×1, « ih ndirha » ×1, « ايه » ×5, « yes » ×1, « wah » ×1, « 👍 »
  ×2, « oui c'est bon » ×2 (N4 playground, F5 link), « oui, c'est bien la cité … » ×1, « oui, et la livraison c'est quand ? » ×1. **Placed with 0
  model call: 20 / 22** (YQ's question and F3's « ih ndirha » went through the model, 1 call each). One order after a change: **5 / 5** (N1 product
  + wilaya + address, F6 quantity, N17 wilaya, N23 wilaya, N25 quantity).
- **A yes WITH a question (YQ) → one order and the question answered: 1 / 1** — « oui, et la livraison c'est quand ? » → TEST-8063 and the
  confirmation's « Délai de livraison : 2 à 5 jours. » (2.7 s, 1 model call; no second turn needed).
- **« oui » that is not an answer to a server recap → no order: 3 / 3** — N7 T2 (after the not-sold answer → the open question again), N5 T3 and
  T4 (to the model's two-option substitute question → the same question again — R20-3).
- **Yes with a change → a new recap, no order: 3 / 3** — N17 T2 (fr → Alger 400 DA, 1 900 DA, core f4cd80… as R18 / R19), N23 T2 (arabizi →
  Oran 600 DA, 8 100 DA), N25 T2 (Arabic script → 2 ×, 3 450 دج, core 1e692b… as R18 / R19); each next yes → the order with the new recap's
  content, 0 model call.
- **Cancel after an order (N14): 1 / 1** — « non annule » right after TEST-5759 → one `cancel_order {orderNumber TEST-5759, customerConfirmed
  true}` → ok, « Commande TEST-5759 annulée, pas de souci. … »; no hand-off, no other order touched.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **3 / 3** — PG1 (« Cité 1000 logements bloc 4 » /
  « cite 1000 logements bloc 4 »), N3 (« El Khroub, cité 1000 logements bloc 5 » / « cité 1000 logements bloc 5 »), N1 (« Cité 1000 logements bloc
  4, Bir El Djir, Oran » / « Cité 1000 logements bloc 4 »), ; the 20 server-placed orders carry the stored order as it was recapped (no model call).
- **Confirming calls refused: 0** (22 + F11). **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 51 `create_order` calls** (R19: 1).
- Recap complete (catalogue names, variants, mode, fee, total, name, phone, address): **28 / 28**, the named variant every time (PF1, F1, F1b,
  N1 Marron; P2 S, N9 / F5 M); **in the customer's language 28 / 28** — Arabic script 8 (PG2, N11, N21, A1, N25 ×2, N18, A3), arabizi 8
  (PG1, N3, N9, P2, F5 on the link, F3, N23 ×2), French 12.
- **Server recap without a model sentence asking to confirm or describing the order: 28 / 28** — one lead-in left: N3 T2 « Ih, nwasslou l
  Constantine, f 2 l 5 ayam. » (the answer to « twasslou l Constantine ? », without its fees — R20-2). **Outside any recap: 0 model turn asks to
  confirm the order or claims it registered** (N18 T1's confirm sentence was rewritten by the guard before it was sent). Left before a recap:
  « je note le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma » (PF1 T2), « Vos coordonnées sont bien notées » (N5 T2) — R20-4; A1 T1
  « واش سميتك باش نسجلوهولك؟ » (« so that we note it for you ») asks the name, it does not claim an order.
- **Recap address « street, commune, wilaya »: 28 / 28** — A3 no separator, N3 / N1 a commune or wilaya repeated in the call's address and
  shown once, PG2 / N25 / N21 / A1 « ، », N18 Latin name. **Street as the customer wrote it: 28 / 28** (first-letter capitals not counted, as
  R14–R19).
- **Fees never wrong: 99 / 99 turns** — every fee said or recapped matches the shop's rules above (Oran home under 20 000 DA paid — PG1 2 100 DA,
  N1 600 DA, N23 600 DA; Oran stop-desk 400 DA in F9 with no free line; Illizi not served ×2). **Asked / due fee missing: 2** — N3 T2 (delivery
  question: no fee in the answer, stop-desk 450 DA not said) and F5r T1 (server quote 400 / 250 run, no fee said) — R20-2. **Place given with no
  question → both fees: 3 / 3** (PF1 T1, PG1 T1, PG2 T1). **Free-delivery threshold wording: 3 / 3 right and now with the space** — PG1 « 600 DA
  (batel men 20 000 DA) l dar, wela 400 DA f stop-desk », N5 T2 / N5b T2 « Livraison à domicile : 600 DA (gratuite dès 20 000 DA). » (R19
  « 20000 »).
- **Price of the product being sold before the field / mode question: 15 / 15** — PF1 T2, PG1 T2, PG2 T2, N3 T1, N4 T1, F1 T1, F1b T1, F3 T1,
  A3 T1, N18 T1, N21 T1, A1 T1, F5 T1, F5r T1, P2 T1. Fees in the same turn: given when no earlier turn had them (F5 T1, F1b T2), not repeated
  when T1 had already said both (PF1 T2 the stop-desk 350 DA only, PG1 T2, PG2 T2); **missing in F5r T1 (R20-2)**.
- **No repeated or contradictory price / fee line in one reply: 99 / 99.** N5 repeats its out-of-stock sentence across T2–T4 (R20-3).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3.
- **Customer's name as written: 33 / 33 conversations in the recaps and orders; and now in the sentences** — N4 « Merci سمير ! », F3 « Saha
  وليد بوزيد. » (R19 « Merci Samir. » / « Saha Walid. »), N18 « Samir Benali » kept in an Arabic chat; 0 name asked again once given.
- **Delivery question answered with the fee: 4 / 5** — F9 (three wilayas), N16 (not served), F12 on the link (Blida 450 / 300), YQ (« c'est
  quand ? » → the delay); **N3 T2 answered « Ih, nwasslou … f 2 l 5 ayam » with the fee only inside the recap (R20-2)**.
- **`create_order` before a phone is in the customer's messages: 0 / 51 calls.** No `create_order` for an out-of-stock product (N5 T2, N5b T2;
  R19: 1 → `VALIDATION`).
- **Hand-offs: 4 / 4 real ones accepted, 0 wrong** — W1 by the model's own `handoff_to_human {off_catalogue}` (accepted), H1 and C2 decided by the
  platform with 0 tool call, F11's by the server (`CUSTOMER_BLOCKED`). **0 wrong `handoff_to_human` call (R19: 2 refused)** — none on N3 T2's
  delivery question, F1b T4's « oui, c'est bien … », the 3 place-first messages, a product not sold (N7), a tracking question (N11), a photo
  request (N9), a cancel (N14), a yes, an out-of-stock product (N5, N5b). AI sentence for the reason, in the customer's script: 4 / 4.
- **No 503 / provider error: 99 / 99 turns**; `AiRun` 99 rows, 95 `ok` + 4 `handoff` (F11 T2, W1, H1, C2), 0 `error`, 0 fallback, `attempt` 1
  everywhere; 10 runs carry a reply-guard action (`guard_rewritten` 7 — F5 T1 / F5r T1 language_switch, N11 T3 / N9 T1 / F9 T1 moroccan_darija,
  N4 T2 repeat_greeting + language_switch, N18 T1 confirm_without_recap; `guard_enforced` 3 — PG1 T2, PG2 T2 moroccan_darija stripped, P2 T1
  language_switch + moroccan_darija stripped).
- Latency: **page median 3.1 s, p90 6.3 s, max 13.8 s on 99 turns** (PG2 T2 13.8 / 13.5 s, N5 T1 11.9 / 11.5 s, A3 T1 9.1 / 8.9 s, N9 T1 8.7 /
  8.4 s, N18 T1 7.7 / 7.5 s, PF1 T2 7.6 / 7.4 s, F9 T1 7.0 / 6.8 s, N5 T4 6.9 / 6.7 s, N21 T3 6.5 / 6.3 s, P2 T1 6.3 / 6.1 s, N7 T1 6.1 / 5.9 s); page
  median J04 3.1 s, J03 3.1 s; **server (`Server-Timing` total) median 2.8 s, p90 6.1 s, max 13.5 s**; `AiRun` median 2.81 s, p90 6.10 s, max
  13.51 s; **21 turns answered without the model: page 0.26–0.48 s, server 0.10–0.23 s**; the 78 model turns: server median 3.2 s, p90 6.7 s. API
  « playground turn answered » lines since 08:08: `waitMs − runMs` ≤ 105 ms, 0 replay, 0 « did not finish »; 1 POST per turn seen by the page;
  page − server median 0.22 s, max 0.31 s. 4 turns ≥ 8 s on the page (R19 9), **2 ≥ 10 s on the server (PG2 T2, N5 T1)** (R19: N5 T2, F5 T1).
- **Model calls (`AiRun.meta.steps`): 117 in 99 turns (R19 216)** — 0 calls 21 turns, 1 call 49, 2 calls 21, 3 calls 6 (N11 T3, F9 T1, PG2 T2, F1
  T2, F1b T2, N18 T1), 4 calls 2 (N5 T1, A3 T1); the next call came for `tools` 22×, `guard` 10×, `format` 3× (A1 T3, F3 T2, F3 T3), `stray` 4×
  (R19 27×) — N5 T4 « noop », N21 T3 « dummy », PG2 T2 « dummy », F1b T2 « noop » (the model names a tool that does not exist; the call after it
  cost 13.7 s in total) — R20-1. **0 model call after a recap / confirming `create_order`** (R19: 20).
- Quantity never asked again after a product is named: **0 quantity question in 99 turns** (« 2 tapis », « zoudj », « زوج », « 3 tapis au lieu
  de 2 », « ديرلي جوج », « wahed », « واحد » kept).
- Language kept: arabizi **10 / 10** (PG1, F9, N16, N9, C2, F3, P2, N23, N3 after the switch, F5 — one language now), Arabic-script darija **7 / 7**
  (PG2, N21, A1, N11, N25, N18, A3), French **15 / 15**; F5r T1 (customer mixed fr / arabizi, same message as F5) mixes both in one reply (R20-4).
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard rewrote / stripped a Moroccan form in 6 replies (PG1 T2,
  N11 T3, P2 T1, N9 T1, F9 T1, PG2 T2) before they were sent.
- **Out-of-stock product offered: 0** — N5 offers Hijab soie / Robe kabyle (in stock), N5b the Coffret (stock 4), N7 Sac (Noir / Marron) and
  Basket Runner, P2 / N9 « L makach dork » / sizes S, M, XL only. N5 / N5b name the Parfum Oud only because the customer asked for it.
- **Photo request (N9): 1 / 1 honest** — no photo in the J04 shop, « Ma 3andnach tsawer … », the card has no image (check.cjs « PHOTO-CLAIM » 0).
- No Markdown in a reply: **99 / 99**. No invented discount: only the catalogue's old prices (Hijab « بدل 2000 دج », Djellaba « (كانت 9000 دج) » /
  « بدل 9000 دج »); Oran free delivery only from 20 000 DA (not reached in this round).
- Amounts with the thousands space: **server text 99 / 99** (recaps « 6 900 DA », price sentence « 3 200 DA », fee sentence « 20 000 DA »); **model
  text not** — « 6900 DA » (PF1 T2, F1 T1, F1b T1, N7 T1), « 4900 DA » (F5, F5r, P2, N9, N5), « 24990 DA » (N5b), « 12500 DA » (N7), « 7500 دج »,
  « 2800 DA / دج », « 1500 DA / دج » — R20-4.
- Tool calls run in 99 turns (playground 94 turns from the response + shared link 5 turns from `AiToolCall`): `create_order` 51 (28 recaps + 22
  orders + 1 blocked), `quote_delivery` 14 (PG1 T1, PF1 T1, PG2 T1 server quotes, N5 T2, N5b T2, F5 T1, F5r T1, F1b T2, N3 T2, F9 ×3, N16, F12),
  `search_products` 5 (N5 T1, A1 T1, N7 T1, N18 T1, A3 T1 « noop »), `lookup_order` 1 (N11 T3), `cancel_order` 1 (N14, right),
  `handoff_to_human` 1 (W1, accepted), `get_product` 0, `check_availability` 0, `add_faq_candidate` 0. Asked by the model but not run (in
  `meta.steps`, no `AiToolCall` row): `get_product` 2 (N5 T1), `search_products` 6 (PF1 T2, N3 T1, F1 T2 ×2, F1b T1, A3 T1), `check_availability`
  1 (A3 T1), a duplicate `quote_delivery` 2 (N16, N3 T2); **search asked after a recap call: 0 (R19 3)**.

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls run, with their results (draft / core = first 6 characters of the server keys). Calls the model asked but the server did not run are not listed here; they are in `out/steps.txt` and quoted in the verdicts. J03 ran inside its opening hours (no « out_of_hours » line). Shared-link turns (F5, F5r, F12) carry no tool calls, cards or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### PF1 — J03 playground (UI fr)
**Verdict: PASS (place first, fr, J03 now inside its opening hours — no « out_of_hours » line) — T1 the server's `quote_delivery {19}` → « Très bien, Sétif / El Eulma ! Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. … » (both fees, Sétif rule 650 / 350); T2 price « 6900 DA » before the address / stop-desk question, the stop-desk fee repeated (home fee said in T1), but « je note le sac à main cuir Marron … » (R20-4) and 7.4 s server for a `search_products` the step did not run (R20-1); T3 recap 7 550 DA; **T4 « oui » 0.5 s page / 0.2 s server, 0 model call** (`AiRun` 01a1edac-8b06, `meta.steps` []) → TEST-6293.**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 3.2 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Très bien, Sétif / El Eulma ! Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Qu'est-ce qui vous intéresse aujourd'hui ? »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 7.6 s (server 7.4 s)
  - AI: « Merci Karim, je note le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma. Quelle est votre adresse exacte (rue, cité, numéro), ou préférez-vous le stop-desk à 350 DA ? »
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 2.9 s (server 2.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 0.5 s (server 0.2 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### PG1 — J04 playground (UI fr)
**Verdict: PASS (greeting + place, arabizi, J04) — T1 `quote_delivery {31}` → « … Tawsil: 600 DA (batel men 20 000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. … » (both fees, the free-home threshold now written « 20 000 », home only — right); T2 price « Hijab soie 1500 DA, wahed » before the address / stop-desk question (the fees were said in T1); T3 arabizi recap 2 100 DA (threshold not reached, 600 DA paid — right); **T4 « ih » 0.4 s / 0.16 s server, 0 model call** (`AiRun` 01a1ed7e-811c) → TEST-1288 (same simulated number as R18 / R19).**

- **T1** C: « slm, ana f Oran, Bir El Djir » · `arabizi` · 4.7 s (server 4.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ahlan bik! Saha. Tawsil: 600 DA (batel men 20 000 DA) l dar, wela 400 DA f stop-desk ila t7ebb. Wach men produit t7ebb ? »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T2** C: « nheb hijab soie wahed, smiti Nadia Kaci 0661234568 » · `arabizi` · 5.6 s (server 5.3 s)
  - AI: « Saha Nadia. Hijab soie 1500 DA, wahed. Dork, wach l'adresse ta3ek (rue, cité, numéro ta3 dar) wela t7ebb stop-desk ? »
- **T3** C: « cite 1000 logements bloc 4 » · `arabizi` · 3.1 s (server 2.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Smitek: Nadia Kaci ⏎ Numéro: 0661234568 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 062285… core 22b9bb…, recap total 2100`
- **T4** C: « ih » · `arabizi` · 0.4 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-1288 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-1288, total 2100`

### PG2 — J03 playground (UI ar)
**Verdict: FAIL — R20-1 (greeting + place, Arabic script, J03 in hours) — T1 `quote_delivery {9}` → « … التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. … » (both fees right; no « عطور » list this time); **T2 13.8 s page / 13.5 s server with 0 tool run** (`AiRun` 01a1edac-b713: 3.5 s → `stray` « dummy » → 4.9 s → guard `moroccan_darija` stripped → 4.7 s) — slowest turn of the round; its reply gives the price « 7500 دج (كانت 9000 دج) » (catalogue old price) then one question (R19-3 fee sentence between two questions gone); T3 recap 7 950 دج « حي 20 أوت فيلا 3، بوفاريك، البليدة »; **T4 « ايه » 0.4 s / 0.18 s server, 0 model call** → TEST-1772.**

- **T1** C: « السلام عليكم، أنا من البليدة بوفاريك » · `ar` · 2.9 s (server 2.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام، مرحبا بيك! صحيت على البليدة وبوفاريك. التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش راك تقلب عليه اليوم، واش نوريلك من المنتجات تاعنا؟ »
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T2** C: « نحب جلابة رجالي، سمير بن علي 0661234567 » · `ar` · 13.8 s (server 13.5 s)
  - AI: « صحيت سمير! الجلابة الرجالي عندنا بـ 7500 دج (كانت 9000 دج)، من صوف رقيق، بلون بيج ومقاس وحيد. تحب نوصلوها للدار ولا في ستوب ديسك؟ وإذا تحب للدار، عطيني العنوان تاعك (الشارع أو الحي ورقم الدار). »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T3** C: « حي 20 أوت فيلا 3 » · `ar` · 2.7 s (server 2.5 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 20 أوت فيلا 3، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 636105… core 9bff87…, recap total 7950`
- **T4** C: « ايه » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-1772 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → ok TEST-1772, total 7950`

### N3 — J03 playground (UI fr)
**Verdict: FAIL — R20-2 (fr → arabizi at T2, delivery question before the recap; J03 in hours) — T1 « Merci Samira, 2 tapis de prière molletonnés (120 x 70 cm) à 2800 DA l'unité. Dans quelle wilaya … ? » (price before the question, R18-2 holds; one `search_products` asked, not run); **T2 « khouya twasslou l Constantine ? ana f El Khroub, cité … » → « Ih, nwasslou l Constantine, f 2 l 5 ayam. » + the recap — the answer to the delivery question carries no fee any more: the home fee 700 DA appears only inside the recap and the stop-desk fee 450 DA is not said (R19: « Ih, nwasslou l Constantine : 700 DA l dar, wela 450 DA f stop-desk. »)**; the server's `quote_delivery {Constantine}` → 700 / 450 ran; no `handoff_to_human` (R19-2 fixed here), 2 model calls, 4.6 s (R19 8.0 s); recap address « cité 1000 logements bloc 5, El Khroub, Constantine » (the call's « El Khroub, cité … » cleaned); **T3 « ih saha » 0.4 s / 0.14 s, 0 model call** → TEST-7010.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 4.9 s (server 4.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Merci Samira, 2 tapis de prière molletonnés (120 x 70 cm) à 2800 DA l'unité. Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 4.9 s (server 4.6 s)
  - AI: « Ih, nwasslou l Constantine, f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «El Khroub, cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-7010 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-7010, total 6300`

### N5 — J04 playground (UI fr)
**Verdict: FAIL — R20-1, R20-3 (out of stock, price asked, fr, J04; priority latency / substitute) — **T1 « Bonjour, le parfum oud c'est combien ? » 11.9 s page / 11.5 s server** (`AiRun` 01a1ed7e-9db1, 4 model calls: `search_products` 2.8 s (run) → `get_product` 2.4 s → `get_product` 2.2 s (both not run — the search had already returned the product) → reply 3.9 s; R19 T1 6.0 s); reply « Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible … nous avons en stock la Robe kabyle brodée à partir de 4900 DA ou le Hijab soie à 1500 DA. Lequel vous intéresse ? » (two in-stock substitutes, no booking question — R19-3 fixed here); **T2 « Bon finalement je le prends … » 3.5 s / 3.3 s, 1 model call, 0 `create_order` for the out-of-stock product (R19 17.1 s, 4 calls, `VALIDATION`)** → « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Vos coordonnées sont bien notées : voulez-vous plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? » (fee and threshold right; « Vos coordonnées sont bien notées » → R20-4); **T3 « oui » and T4 « oui » get the same two-option question again, the out-of-stock sentence a 2nd and 3rd time, no recap, no order** (T4 6.7 s, a `stray` « noop » model call) — R20-3. No order without a recap (right); 0 order in this flow.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 11.9 s (server 11.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez autre chose, nous avons en stock la Robe kabyle brodée à partir de 4900 DA ou le Hijab soie à 1500 DA. Lequel vous intéresse ? »
  - tools: `search_products {«Parfum Oud 50 ml»} → 1 product(s)`
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.5 s (server 3.3 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Vos coordonnées sont bien notées : voulez-vous plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T3** C: « oui » · `fr` · 3.7 s (server 3.5 s)
  - AI: « Je comprends. Le Parfum Oud 50 ml est en rupture pour le moment, donc je ne peux pas le commander. Vous préférez le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? »
- **T4** C: « oui » · `fr` · 6.9 s (server 6.7 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Vous voulez plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? Dites-moi votre choix et je prépare la commande. »

### N5b — J03 playground (UI fr)
**Verdict: PASS (the N5 messages on J03, stopped after T2 by design; latency) — T1 3.5 s / 3.3 s, 1 model call, 0 tool: « Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible … notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. Souhaitez-vous que je vous en dise plus ? » (in-stock substitute, stock 4; no « réserver » question); T2 3.8 s / 3.6 s, 1 model call + the server's `quote_delivery {31}`: « Désolé, Parfum Oud 50 ml est en rupture de stock … Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA ? » — no `create_order` for the out-of-stock item, no « noted » phrase; « 24990 DA » without the space (R20-4).**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez un cadeau parfumé, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. Souhaitez-vous que je vous en dise plus ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.8 s (server 3.6 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA ? »
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`

### N11 — J04 playground (UI ar)
**Verdict: PASS (Arabic script, order then tracking, J04) — T1 all fields in one message → Arabic recap 8 200 دج (Constantine 700 دج), address « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; **T2 « ايه » 0.4 s / 0.18 s, 0 model call** → TEST-4074; **T3 one `lookup_order {}` (R19: two lookups — fixed)** → « الطلبية تاعك رقم TEST-4074 راهي مسجلة، ومازال ما خرجتش للتوصيل … ما عندناش رقم تتبع … » — status new / not sent, no tracking number, nothing invented; 4.0 s (guard `moroccan_darija` rewrite).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 2.9 s (server 2.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 4.2 s (server 4.0 s)
  - AI: « الطلبية تاعك رقم TEST-4074 راهي مسجلة، ومازال ما خرجتش للتوصيل، درك في طور التحضير. ما عندناش رقم تتبع، وكي تخرج الطلبية نعطوك الرقم. مدة التوصيل من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N4 — J03 playground (UI fr)
**Verdict: PASS (fr, Arabic-script name alone, « oui c'est bon », J03 in hours) — T1 « Le Tapis de prière — 2800 DA est disponible. … quel est votre nom ? »; **T2 « سمير بن علي » → « Merci سمير ! Quel est votre numéro de téléphone ? (ex : 0555123456) » — the first name as written (R19-3 « Merci Samir. » fixed)**, French kept (guard `repeat_greeting` / `language_switch` rewrite); T4 recap « Nom : سمير بن علي » 3 250 DA; **T5 « oui c'est bon » 0.4 s / 0.18 s, 0 model call** → TEST-8384.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 3.7 s (server 3.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le Tapis de prière — 2800 DA est disponible. C'est un tapis molletonné de 120 x 70 cm, très confortable pour la prière. Pour commander, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `fr` · 3.7 s (server 3.4 s)
  - AI: « Merci سمير ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0661234567 » · `fr` · 2.7 s (server 2.5 s)
  - AI: « Merci ! Dans quelle wilaya habitez-vous ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.1 s (server 2.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui c'est bon » · `fr` · 0.4 s (server 0.2 s)
  - AI: « Votre commande TEST-8384 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-8384, total 3250`

### YQ — J04 playground (UI fr)
**Verdict: PASS (NEW in R20 — a yes WITH a question, fr, J04) — T1 all fields → recap 1 900 DA (Alger 400 DA); **T2 « oui, et la livraison c'est quand ? » → exactly one order TEST-8063 and the question answered by the confirmation's « Délai de livraison : 2 à 5 jours. »** (2.9 s / 2.7 s, 1 model call that sent the confirming `create_order`; no second question, no hand-off). The same content as N17's final recap gives the same simulated number.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 2.8 s (server 2.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T2** C: « oui, et la livraison c'est quand ? » · `fr` · 2.9 s (server 2.7 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### F11 — J04 playground (UI fr)
**Verdict: PASS (blocked number « 0550 12 34 56 », fr, J04) — T1 recap 1 900 DA; T2 « oui » → `create_order` → `CUSTOMER_BLOCKED`, 0.3 s / 0.11 s with 0 model call, run status `handoff`, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. » + the platform's hand-off line; no block mentioned, no order.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 2.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 0.3 s (server 0.1 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F5 — J04 shared link (UI fr)
**Verdict: PASS (shared link, fr / arabizi mixed, « oui c'est bon »; tool calls from `AiToolCall`) — **T1 5.9 s / 5.7 s (R19 11.7 / 11.5 s)**, 2 model calls (guard `language_switch` rewrite, no format retry) + the server's `quote_delivery {16}` → 400 / 250: « Ahlan Amina ! Robe kabyle brodée taille M rahi kayna b 4900 DA. L dar: 400 DA, f stop-desk: 250 DA. Bach nwasslouha lik, a3tini l'adresse ta3ek … » — one language (arabizi) this time, price then both fees, no « C'est noté » (R19-3 fixed here); T2 `create_order` → recap 5 300 DA (M); **T3 « oui c'est bon » 0.3 s / 0.13 s, 0 model call** → `create_order` ok TEST-6890 (same number as R19).**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.9 s (server 5.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ahlan Amina ! Robe kabyle brodée taille M rahi kayna b 4900 DA. L dar: 400 DA, f stop-desk: 250 DA. Bach nwasslouha lik, a3tini l'adresse ta3ek (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib), wela t7ebb stop-desk ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « rue des frères Bouadou n 5 » · 3.0 s (server 2.8 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 0.3 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F5r — J04 shared link (UI fr)
**Verdict: FAIL — R20-2 (the F5 first message again on the shared link, stopped after T1 by design) — 5.0 s / 4.9 s, 2 model calls (guard `language_switch` rewrite); the server ran `quote_delivery {16}` → 400 / 250 (`AiRun` 01a1ed7f-4e34, `AiToolCall`), **but the reply says no fee**: « Merci Amina ! Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib) ? Wela t7ebb stop-desk ? » — and it mixes French and arabizi (R20-4); no card.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.0 s (server 4.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Merci Amina ! Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib) ? Wela t7ebb stop-desk ? »

### N16 — J04 playground (UI fr)
**Verdict: PASS (arabizi, wilaya not served) — `quote_delivery {Illizi}` → `WILAYA_NOT_SERVED` → « Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had wilaya, ma l dar wala f stop-desk. » — no offer, no fee invented; the second clause still repeats the first (R20-4); 2 `quote_delivery` asked in one step, 1 run.**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 3.4 s (server 3.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had wilaya, ma l dar wala f stop-desk. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### N9 — J04 playground (UI fr)
**Verdict: PASS (arabizi photo request, J04 — no product photo in the shop) — T1 « … Ma 3andnach tsawer ta3 had la robe f had lwaqt. Robe kabyle brodée bil yed, tissu khfif … S, M w XL. S w M b 4900 DA, XL b 5200 DA. … » (honest, L out of stock not offered, card without image, guard `moroccan_darija` rewrite, 8.4 s server); T2 recap M 5 300 DA; **T3 « ih » 0.4 s / 0.11 s, 0 model call** → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 8.7 s (server 8.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3likoum salam 😊 Ma 3andnach tsawer ta3 had la robe f had lwaqt. Robe kabyle brodée bil yed, tissu khfif, mlih lel a3rass. Lmqasat li kaynin: S, M w XL. S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 3.4 s (server 3.2 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N1 + N14 — J03 playground (UI fr)
**Verdict: PASS (N1 + N14: product and wilaya change, then « non annule », J03 in hours) — T1 recap Djellaba Blida 7 950 DA; T2 « Finalement … le sac à main cuir marron … plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » → new recap Sac Marron + Oran 600 DA = 7 500 DA (the call's address « Cité 1000 logements bloc 4, Bir El Djir, Oran » shown once: « Cité 1000 logements bloc 4, Bir El Djir, Oran »); **T3 « oui » 0.4 s / 0.14 s, 0 model call** → TEST-5759; T4 « non annule » → `cancel_order {TEST-5759, customerConfirmed true}` → ok, « Commande TEST-5759 annulée, pas de souci. … » — the right order, no hand-off.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 2.7 s (server 2.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.5 s (server 3.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`
- **T4** C: « non annule » · `fr` · 3.7 s (server 3.5 s)
  - AI: « Commande TEST-5759 annulée, pas de souci. Si vous voulez un autre article, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-5759","customerConfirmed":true,"reason":"Le client a demandé l'annulation de sa commande"} → ok, cancelled TEST-5759`

### P2 — J04 playground (UI fr)
**Verdict: PASS (arabizi, « wah », J04) — T1 description, sizes S / M 4900 DA and XL 5200 DA, « L makach dork » (out of stock said, not offered; guard stripped a Moroccan form, 6.1 s); T2 all fields → arabizi recap S 5 300 DA; **T3 « wah » 0.4 s / 0.19 s, 0 model call** → TEST-1158.**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 6.3 s (server 6.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam! Robe kabyle brodée, brodée b lyedd, qmach khfif, mliha bezzaf l l3rass w lmounasabat. Kayen f taille S w M b 4900 DA, w XL b 5200 DA. L makach dork. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 2.5 s (server 2.3 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « wah » · `arabizi` · 0.4 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### N21 — J04 playground (UI ar)
**Verdict: PASS (Arabic script, fields one per message, « 👍 », J04) — T1 price 1500 دج; T2 / T3 field questions (T3 6.3 s: a `stray` « dummy » model call — R20-1); T4 recap « حي الورود رقم 12، بوفاريك، البليدة » 1 950 دج; **T5 « 👍 » 0.4 s / 0.17 s, 0 model call** → TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 4.8 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بسعر 1500 دج، حرير ناعم بمقاس 180 × 70 سم، ومتوفر حاليًا. تحب نكمّلو الطلبية ولا تحب تعرف حاجة أخرى؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.4 s (server 2.1 s)
  - AI: « صحيت يا نادية. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0661234568 » · `ar` · 6.5 s (server 6.3 s)
  - AI: « يعطيك الصحة يا نادية. واش من ولاية تحب نوصلوا ليها الطلبية؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.1 s (server 2.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### A1 — J04 playground (UI ar)
**Verdict: PASS (Arabic script, fields one per message, « ايه », J04 — not run in R19) — T1 one `search_products` → « … Hijab soie — 1500 دج (بدل 2000 دج) … واش سميتك باش نسجلوهولك؟ » (catalogue old price); name / phone / place asked one each, none asked twice; T4 recap « شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر » 1 900 دج; **T5 « ايه » 0.4 s / 0.23 s, 0 model call** → TEST-4104.**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 5.6 s (server 5.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! الحجاب الحرير متوفر عندنا: Hijab soie — 1500 دج (بدل 2000 دج)، قماش حرير ناعم بمقاس 180 x 70 سم. واش سميتك باش نسجلوهولك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « أمينة سعدي » · `ar` · 2.0 s (server 1.8 s)
  - AI: « تشرفنا يا أمينة! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكمّلو الطلبية. »
- **T3** C: « 0698765432 » · `ar` · 2.6 s (server 2.4 s)
  - AI: « تمام يا أمينة، صحيت. واش من ولاية؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 2.8 s (server 2.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-4104 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → ok TEST-4104, total 1900`

### F9 — J04 playground (UI fr)
**Verdict: PASS (arabizi, three wilayas) — 3 `quote_delivery` in one step → « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk … Oran stop-desk: 400 DA … Illizi: ma nwasslouch l Illizi f had lwaqt. » — every figure right, no free line on the Oran stop-desk; 6.8 s (guard `moroccan_darija` rewrite).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 7.0 s (server 6.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Illizi: ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link, fr) — `quote_delivery {Blida}` → 450 / 300 (`AiToolCall`): « Bonsoir 😊 Oui, on livre à Blida ! Les frais sont de 450 DA à domicile, ou 300 DA en stop-desk, et la livraison prend 2 à 5 jours. Vous cherchez quel produit ? » — 2.2 s.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.4 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Les frais sont de 450 DA à domicile, ou 300 DA en stop-desk, et la livraison prend 2 à 5 jours. Vous cherchez quel produit ? »

### W1 — J04 playground (UI fr)
**Verdict: PASS (fr, wholesale) — the model's `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie»}` accepted (R19: decided by the platform with 0 call), « Pour le prix de gros, l'équipe de la boutique va vous répondre. » + the hand-off line; 3.2 s.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 3.4 s (server 3.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Pour le prix de gros, l'équipe de la boutique va vous répondre. »
  - tools: `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie»} → ok`

### H1 — J04 playground (UI fr)
**Verdict: PASS (fr « je veux parler à quelqu'un ») — hand-off decided by the platform (0 tool call, run status `handoff`; R19: the model's `handoff_to_human {customer_request}`), « Bien sûr, je vous mets en relation avec l'équipe de la boutique. » + the hand-off line; 1.5 s.**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 1.7 s (server 1.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »

### C2 — J04 playground (UI fr)
**Verdict: PASS (arabizi, broken order + refund) — hand-off decided by the platform (0 tool call, intent complaint, run status `handoff`; R19: the model's `handoff_to_human {refund}`), arabizi reason sentence « Salam. L'équipe ta3 lboutique rah tchouf m3ak le remboursement. »; 3.3 s. The response carries no « handoff » system line, as in R19.**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 3.5 s (server 3.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam. L'équipe ta3 lboutique rah tchouf m3ak le remboursement. »

### N17 — J04 playground (UI fr)
**Verdict: PASS (fr « oui mais livrez à … ») — T1 recap Blida 1 950 DA; T2 « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » → new recap Alger 400 DA, 1 900 DA, core f4cd80… (as R18 / R19), no order; **T3 « oui » 0.4 s / 0.13 s, 0 model call** → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 2.7 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 3.3 s (server 3.1 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N25 — J04 playground (UI ar)
**Verdict: PASS (Arabic script « ايه بصح ديرلي جوج ماشي واحد ») — T1 recap 1 950 دج; T2 new recap 2 × 3 450 دج, core 1e692b… (as R18 / R19), no order; **T3 « ايه » 0.3 s / 0.11 s, 0 model call** → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.3 s (server 3.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 3.1 s (server 3.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### F1 — J03 playground (UI fr)
**Verdict: PASS (fr, fields one per message, J03 in hours) — T1 price « 6900 DA » then the name question; T2 « Karim Haddad » → « Merci Karim ! Quel est votre numéro … ? » took 5.6 s for two `search_products` asked on a name-only message (not run — R20-1); T4 recap 7 550 DA; **T5 « oui » 0.4 s / 0.12 s, 0 model call** → TEST-6293.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6900 DA, en cuir véritable. Pour commencer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 5.7 s (server 5.6 s)
  - AI: « Merci Karim ! Quel est votre numéro de téléphone (ex : 0555123456) ? »
- **T3** C: « 0770112233 » · `fr` · 2.1 s (server 1.9 s)
  - AI: « Merci Karim. Dans quelle wilaya êtes-vous ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 3.0 s (server 2.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS (R19-2 fixed — fr, fields over 3 messages) — T1 price « 6900 DA, 1 pièce » then the wilaya question; T2 the server's `quote_delivery {Sétif}` → « Pour Sétif, la livraison à domicile coûte 650 DA, ou 350 DA en stop-desk … » — no « c'est noté » (R19-3 fixed here), one `stray` « noop » call (4.4 s); T3 recap 7 550 DA; **T4 « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » 0.4 s / 0.13 s, 0 model call → TEST-6293, no `handoff_to_human` (R19: a refused `off_catalogue` call)**.**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 5.3 s (server 5.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Karim, le sac à main cuir en Marron est disponible à 6900 DA, 1 pièce. Dans quelle wilaya habitez-vous pour que je calcule la livraison ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Sétif, El Eulma » · `fr` · 4.7 s (server 4.4 s)
  - AI: « Merci Karim ! Pour Sétif, la livraison à domicile coûte 650 DA, ou 350 DA en stop-desk, et elle prend 2 à 5 jours. Vous préférez quelle option, et pouvez-vous me donner l'adresse exacte (rue, cité ou repère) à El Eulma ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 2.7 s (server 2.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F3 — J03 playground (UI fr)
**Verdict: FAIL — R20-1 (arabizi, fields one per message, « ih ndirha », J03 in hours) — T1 price; **T2 « smiti وليد بوزيد » → « Saha وليد بوزيد. A3tini numéro ta3ek … » (the name as written — R19-3 « Saha Walid. » fixed)**; T4 recap « Smitek: وليد بوزيد » 6 050 DA; **T5 « ih ndirha » → exactly one order TEST-5998, but 3.1 s page / 2.8 s server with 1 model call** (`AiRun` 01a1edae-db15, `meta.steps` [{2 689 ms, create_order}]) — the only one of the 8 yes forms asked this round that is not placed by the server without the model.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Saha, zoudj tapis de prière b 2800 DA l wahed, molletonné 120 x 70 cm, rahom kaynin. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.8 s (server 2.5 s)
  - AI: « Saha وليد بوزيد. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244 » · `arabizi` · 2.3 s (server 2.1 s)
  - AI: « Saha. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 3.0 s (server 2.8 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih ndirha » · `arabizi` · 3.1 s (server 2.8 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F6 — J03 playground (UI fr)
**Verdict: PASS (fr, quantity change, « yes ») — T1 recap 2 × 6 300 DA; T2 « Finalement mettez 3 tapis au lieu de 2 » → new recap 3 × 9 100 DA, no order; **T3 « yes » (English in a French chat) 0.4 s / 0.14 s, 0 model call** → TEST-2340 with the new recap's content.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 3.1 s (server 2.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 2.9 s (server 2.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « yes » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-2340 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### N18 — J03 playground (UI ar)
**Verdict: PASS (Arabic script, Latin name alone, « 👍 », J03 in hours) — T1 price « 7500 دج بدل 9000 دج » (a confirm-without-recap sentence rewritten by the guard before it was sent); « Samir Benali » kept; T4 recap 8 200 دج « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; **T5 « 👍 » 0.4 s / 0.23 s, 0 model call** → TEST-6540.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 7.7 s (server 7.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا Djellaba homme من الصوف الرفيع، لونها بيج، مقاسها وحيد، بسعر 7500 دج بدل 9000 دج. واش سميتك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar` · 3.7 s (server 3.5 s)
  - AI: « صحيت. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0661234567 » · `ar` · 2.1 s (server 1.9 s)
  - AI: « صحيت. واش من ولاية؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 3.7 s (server 3.4 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2ddb8b… core 64b204…, recap total 8200`
- **T5** C: « 👍 » · `ar` · 0.4 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6540 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-6540, total 8200`

### N23 — J03 playground (UI fr)
**Verdict: PASS (arabizi « ih bessah … ») — T1 recap Sétif 8 150 DA; T2 « ih bessah wasslouha l Oran, Bir El Djir, … » → new arabizi recap Oran 600 DA, 8 100 DA, no order (3.0 s, R19 8.2 s); **T3 « ih » 0.4 s / 0.13 s, 0 model call** → TEST-5687.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 2.9 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 3.2 s (server 3.0 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 0.4 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-5687 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → ok TEST-5687, total 8100`

### A3 — J03 playground (UI ar)
**Verdict: PASS (Arabic script, « ٠٥٥٠… » Arabic-Indic digits, no separator) — T1 price « كل واحد بـ 2800 دج » then the wilaya question, but **8.9 s server, 4 model calls**: `check_availability` (not run), `search_products`, then a **`search_products {query «noop»}` the server ran** (→ « No product of the shop matches « noop » … ») — R20-1; T2 recap phone « 0550123456 » (digits read as Latin), « حي 1000 مسكن عمارة 5، الخروب، قسنطينة » 6 300 دج; **T3 « ايه » 0.3 s / 0.10 s, 0 model call** → TEST-5126.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 9.1 s (server 8.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ »
  - AI: « صحيت يا سميرة، زوج سجادات الصلاة متوفرين عندنا، كل واحد بـ 2800 دج. واش من ولاية تحب نوصلوهم لها؟ »
  - tools: `search_products {«noop»} → 0 product(s)`
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 4.2 s (server 4.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### N7 — J03 playground (UI fr)
**Verdict: PASS (fr, product not sold, then « oui », J03 in hours) — T1 one `search_products {«lunettes de soleil»}` → 0 product → « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Nous avons par contre un sac à main en cuir véritable (noir ou marron, 6900 DA) et une Basket Runner (12500 DA). Merci Yacine. Lequel vous intéresse ? » — in-stock items only, no hand-off (5.9 s; « Merci Yacine. » put between the list and the question → R20-4); T2 « oui » → the open question again, no order, no hand-off.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.1 s (server 5.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Nous avons par contre un sac à main en cuir véritable (noir ou marron, 6900 DA) et une Basket Runner (12500 DA). Merci Yacine. Lequel vous intéresse ? »
  - tools: `search_products {«lunettes de soleil»} → 0 product(s)`
- **T2** C: « oui » · `fr` · 3.2 s (server 2.9 s)
  - AI: « Super, merci ! Lequel vous intéresse : le sac à main en cuir (noir ou marron) ou la Basket Runner ? Dites-moi aussi la couleur ou la pointure souhaitée. »

## Bugs

### R20-1 — « ih ndirha » not placed by the server; two server turns ≥ 10 s; stray / redundant model calls left
- Page: playground dialog (owner, fr / ar, 1440) — both shops
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: F3 « nheb nechri zoudj tapis de prière » → « smiti وليد بوزيد » → « 0770112244 » → « Blida, Boufarik,
  cite 20 aout villa 3 » → « ih ndirha »; PG2 « السلام عليكم، أنا من البليدة بوفاريك » → « نحب جلابة رجالي، سمير بن علي 0661234567 »; A3
  « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ »; J04 › « Tester moi-même »: N5 « Bonjour, le parfum oud c'est combien ? »; read
  `Server-Timing`, `AiRun.meta.steps`, `AiToolCall`.
- Expected: a plain yes to the shown recap placed by the server with no model call (R19-1 fix: 0.1–0.2 s); server time under 10 s (R10-1);
  no call for a tool that does not exist or whose result the turn already has (R11-3 … R19-1).
- Actual:
  - **F3 T5 « ih ndirha »** (09:03:41, 3.1 s page / 2.8 s server, `AiRun` 01a1edae-db15, `meta.steps` [{2 689 ms, calls create_order}]) →
    « Commande ta3ek TEST-5998 tsajlet ✅ … » — one order, right content, but through a model call; the other 20 yes-only answers of the round
    (« oui », « ih », « ih saha », « ايه », « yes », « wah », « 👍 », « oui c'est bon », « oui, c'est bien la cité … ») had `meta.steps` [] and
    0.10–0.23 s server. « ih ndirha » (« yes, I'll take it ») is one of the 8 forms asked.
  - **PG2 T2** (09:01:21, **13.8 s page / 13.5 s server**, `AiRun` 01a1edac-b713, 0 tool run) — 3 model calls: 3.5 s → `stray` « dummy » → 4.9 s
    → guard `moroccan_darija` (stripped) → 4.7 s; sent: « صحيت سمير! الجلابة الرجالي عندنا بـ 7500 دج (كانت 9000 دج)، من صوف رقيق، بلون بيج ومقاس وحيد.
    تحب نوصلوها للدار ولا في ستوب ديسك؟ … » (R19 PG2 T2 9.5 s).
  - **N5 T1** (08:11:00, **11.9 s / 11.5 s**, `AiRun` 01a1ed7e-9db1) — 4 model calls: `search_products {«Parfum Oud 50 ml»}` 2.8 s (run, returns
    the product, out of stock) → `get_product` 2.4 s → `get_product` 2.2 s (neither run: the search result already had it) → reply 3.9 s (R19
    N5 T1 6.0 s; N5 T2 is fixed: 3.3 s, R19 17.1 s). The same message on J03 (N5b T1) took 3.3 s with 1 call.
  - **A3 T1** (09:05:25, 9.1 s / 8.9 s, `AiRun` 01a1edb0-6e38) — 4 model calls: `check_availability` (not run), `search_products`, then
    **`search_products {query «noop», limit 1}` that the server ran** (→ « No product of the shop matches « noop » … ») → reply.
  - **4 `stray` model calls** (a tool name that does not exist; the server answers « unavailable » and calls the model again; 13.7 s in total
    for the call after it): N5 T4 « noop » (6.7 s), N21 T3 « dummy » after the phone (6.3 s), PG2 T2 « dummy », F1b T2 « noop » (4.4 s) (R19 27).
  - Searches asked on messages that name no new product (not run, a model step each): F1 T2 « Karim Haddad » ×2 (5.6 s), PF1 T2 (7.4 s), N3 T1,
    F1b T1; two `quote_delivery` for one wilaya asked in N16 and N3 T2.
  - Fixed since R19-1: 20 / 21 yes-only answers with 0 model call, 0 model call after a recap / confirming `create_order` (R19: 20), N5 T2 3.3 s
    with no `create_order` for the out-of-stock product (0 `VALIDATION`), F5 T1 5.7 s, N11 T3 one `lookup_order`, 117 model calls in 99 turns
    (R19 216), page median 3.1 s (R19 5.1 s).
- Evidence: .local/qa/journeys/R20/out/transcripts/F3.json T5, PG2.json T2, N5.json T1, A3.json T1 · out/airun.txt (`meta.steps`) ·
  out/steps.txt · out/toolcalls.txt · .local/qa/campaign/retest-ai-r20/fr-F3-pg.png, ar-PG2-pg.png, fr-N5-pg.png, ar-A3-pg.png
- Likely cause: the server's plain-yes word list does not hold « ih ndirha » (a yes + « I take it »), so the turn goes to the model; the model
  still re-checks a product it has just searched, and writes placeholder tool names (« noop », « dummy ») — one even as a search query the
  server runs.

### R20-2 — Fees not said where R15–R19 said them (delivery question before the recap; a server quote with no fee sentence)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »; shared test page (visitor, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: N3 « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » → « khouya twasslou l Constantine
  ? ana f El Khroub, cité 1000 logements bloc 5 »; J04 shared link: F5r « Salam, je veux la robe kabyle taille M, smiti Amina Saadi
  0698765432, wilaya Alger, Bab Ezzouar ».
- Expected: a delivery question answered with the fee (R5-5 / R7-5) — R19 N3 T2 « Ih, nwasslou l Constantine : 700 DA l dar, wela 450 DA f
  stop-desk. » before the recap; a named place with a product ⇒ the price and both fees before the address question (R15-1, R18-1), as F5 T1
  did with the same message.
- Actual:
  - **N3 T2** (09:01:52, 4.9 s / 4.6 s, `AiRun` 01a1edad-2eca) — the server's `quote_delivery {Constantine}` → 700 / 450 and the recap
    `create_order` ran; sent: « Ih, nwasslou l Constantine, f 2 l 5 ayam. ⏎ ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎
    - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, … » — the answer to the question gives the delay, not the fee; the home
    fee is only inside the recap, **the stop-desk fee 450 DA is not said** (the question was asked before any mode was chosen).
  - **F5r T1** (shared link, 08:11:45, 5.0 s / 4.9 s, `AiRun` 01a1ed7f-4e34, guard `language_switch` rewrite) — `quote_delivery {16}` → 400 /
    250 ran (`AiToolCall`); sent: « Merci Amina ! Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar (rue,
    cité, numéro ta3 dar wela blassa ma3roufa 9rib) ? Wela t7ebb stop-desk ? » — **no fee**, although the same message 14 s earlier (F5 T1)
    got « … b 4900 DA. L dar: 400 DA, f stop-desk: 250 DA. … ».
- Evidence: .local/qa/journeys/R20/out/transcripts/N3.json T2, F5r.json T1, F5.json T1 · out/toolcalls.txt (08:11:45, 09:01:52) ·
  out/steps.txt · .local/qa/campaign/retest-ai-r20/fr-N3-pg.png, fr-F5r-link.png
- Likely cause: R19's « a turn ends with no model call once its reply is the server's (… the recap of a message asking … one delivery question
  to its place) » now writes its own one-line answer without the fee sentence; in F5r the server's fee sentence is not put back after the
  guard's language rewrite.

### R20-3 — An out-of-stock take never reaches a recap: « oui » to a two-option substitute question gets the same question again
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › « Tester moi-même »: N5 « Bonjour, le parfum oud c'est combien ? » → « Bon finalement je le prends. Karim Haddad 0770112233,
  Oran, Bir El Djir, cité 1000 logements bloc 4 » → « oui » → « oui ».
- Expected: the customer is led to a choice and a server recap (R19: one substitute, the « oui » gave the recap at T3 and the order at T4);
  the out-of-stock line said once (R13-5), not one sentence repeated every turn.
- Actual (08:11:12–08:11:28; no order, no recap, rightly no order without one):
  - T2 « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Vos coordonnées
    sont bien notées : voulez-vous plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? »
  - T3 « oui » → « Je comprends. Le Parfum Oud 50 ml est en rupture pour le moment, donc je ne peux pas le commander. Vous préférez le Hijab
    soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? »
  - T4 « oui » (6.7 s, a `stray` « noop » call) → « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Vous voulez plutôt le Hijab
    soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? Dites-moi votre choix et je prépare la commande. »
  - The same messages on J03 (N5b) offered one substitute (Coffret cadeau Aïd) and asked « Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA
    ? » (stopped there by design).
- Evidence: .local/qa/journeys/R20/out/transcripts/N5.json T2–T4, N5b.json · out/steps.txt · .local/qa/campaign/retest-ai-r20/fr-N5-pg.png
- Likely cause: with two substitutes the « oui » is not a choice, and neither the model nor the server reads it as « the first one » or asks
  a narrower question (e.g. « Le Hijab soie (1 500 DA) ou la Robe kabyle (4 900 DA) — lequel ? » once, then the size); the server's
  out-of-stock sentence is prepended on every turn while the out-of-stock product stays « taken ».

### R20-4 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — both shops
- Severity: Cosmetic
- Type: Text
- Steps: run PF1, N5, F5r, N5b, N7, N16, F1, P2.
- Expected: nothing that reads like an order step before the server recap; one language per reply; amounts written « 6 900 DA » (rule 11);
  thanks before the facts, the question last.
- Actual:
  - « Noted » lines before any recap: PF1 T2 « Merci Karim, je note le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma. … », N5 T2 « … Vos
    coordonnées sont bien notées : voulez-vous plutôt … ? » (R19-3's « c'est noté / j'ai bien noté » are gone; these are new forms).
  - French and arabizi in one reply: F5r T1 « Merci Amina ! Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar
    … ? Wela t7ebb stop-desk ? » (guard `language_switch` rewrite kept it mixed; F5 T1 with the same message is arabizi only).
  - Amounts in model sentences without the thousands space: « 6900 DA » (PF1 T2, F1 T1, F1b T1, N7 T1), « 4900 DA » (F5, F5r, P2, N9, N5),
    « 24990 DA » (N5b T1–T2, with the card « 24990 »), « 12500 DA » (N7) — server sentences now write « 3 200 DA », « 20 000 DA » (fixed).
  - N7 T1 « … et une Basket Runner (12500 DA). Merci Yacine. Lequel vous intéresse ? » — the thank-you between the product list and the question.
  - N16 « Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had wilaya, ma l dar wala f stop-desk. » — the second clause repeats the
    first (left from R19-3).
  - N5 T3 « Je comprends. » to a « oui ».
  - The reply guard still rewrites / strips a Moroccan form the model wrote (6 replies: PG1 T2, N11 T3, P2 T1, N9 T1, F9 T1, PG2 T2) — nothing
    Moroccan reached the customer (check.cjs 0 hit).
  - Fixed since R19-3: N4 « Merci سمير ! » (R19 « Merci Samir. »), F3 « Saha وليد بوزيد. » (R19 « Saha Walid. »), F5 T1 one language, F1b T2 « Pour
    Sétif, la livraison à domicile coûte 650 DA, ou 350 DA en stop-desk … » (R19 « c'est noté : Sétif, El Eulma »), substitute questions « Lequel
    vous intéresse ? » / « Souhaitez-vous que je vous en dise plus ? » / « Voulez-vous plutôt … ? » (R19 « Voulez-vous que je vous le réserve ? »,
    « je vous confirme : »), PG2 T2 one question (R19 the fee sentence between two), PG2 T1 no « عطور » list, « batel men 20 000 DA » / « gratuite
    dès 20 000 DA » (R19 « 20000 »).
- Evidence: .local/qa/journeys/R20/out/transcripts/PF1.json T2, N5.json T2–T3, F5r.json T1, N5b.json, N7.json T1, N16.json · `AiRun.meta.guard`
  (out/airun.txt) · .local/qa/campaign/retest-ai-r20/fr-PF1-pg.png, fr-F5r-link.png, fr-N7-pg.png
- Likely cause: free model wording (the R19 « noted » filter matches « c'est noté / j'ai bien noté », not « je note » / « bien notées »); model
  amounts are not passed through `formatMoney`; the server's thank-you is inserted before the trailing question.

## Retest
- RETEST R19-1: partly fixed — **a plain yes to the shown recap is now placed by the server with no model call in 20 / 21 cases** (0.26–0.48 s
  page, 0.10–0.23 s server, `meta.steps` []: « oui » ×4, « ih » ×3, « ih saha », « ايه » ×5, « yes », « wah », « 👍 » ×2, « oui c'est bon » ×2 (one
  on the shared link), « oui, c'est bien la cité … »; F11's blocked « oui » 0.11 s); 0 model call after a recap / confirming `create_order` (R19
  20); N5 T2 3.3 s, no `create_order` for the out-of-stock product, 0 `VALIDATION` (R19 17.1 s); F5 T1 5.7 s (R19 11.5 s); N11 T3 one lookup
  (R19 two); 4 `stray` calls (R19 27); 117 model calls (R19 216); page median 3.1 s (R19 5.1 s). Left: « ih ndirha » through the model (2.8 s),
  PG2 T2 13.5 s, N5 T1 11.5 s (two `get_product` after the search), A3 T1 8.9 s (a `search_products {«noop»}` run), searches asked on name-only
  messages → R20-1.
- RETEST R19-2: fixed — 0 `handoff_to_human` call on a message without a product: N3 T2 « khouya twasslou l Constantine ? ana f El Khroub, … »
  (quote + recap, no hand-off tool), F1b T4 « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » (placed by the server, 0 model
  call), the 3 place-first messages, N7, N9, N11, N14, every yes; the real ones still accepted (W1 model call, H1 / C2 platform, F11 server).
  New in N3 T2: its answer lost the fees → R20-2.
- RETEST R19-3: partly fixed — name as written in the sentence (N4 « Merci سمير ! », F3 « Saha وليد بوزيد. »), F5 T1 one language, the R19
  « c'est noté / j'ai bien noté » lines gone (F5, F1b, N5), substitute questions without « réserver » / « je vous confirme », PG2 T2 one question
  at the end and no « عطور », server amounts « 3 200 DA » / « 20 000 DA ». Left: « je note … » (PF1 T2), « Vos coordonnées sont bien notées »
  (N5 T2), F5r fr + arabizi, model amounts without the space, N16's repeated clause, « Merci Yacine. » before the question → R20-4.
- R1–R18 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 22 orders**; one order per yes: 22 orders, never
  two for one yes, 0 lost; N17 T2 / N23 T2 / N25 T2 yes with a change → new recap; N7 T2, N5 T3 / T4 « oui » to no recap → no order; YQ yes
  with a question → one order + the delay; N14 cancel after an order → the right order; R4-1 / R11-2 / R13-1 (no hand-off on an order / field /
  place / yes message, nor for a product sold or not sold) holds — 0 wrong call; R14-3 (every real hand-off accepted) holds — 4 / 4; R4-2 (a
  name in another script keeps the language) holds — N4, F3, N18; R14-1 (language kept) holds — 32 / 33 conversations (F5r mixed for a mixed
  message → R20-4); R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 28 / 28; R8-2 / R10-2 / R12-2 (no confirm
  request / claim without a recap) holds — 0 in 99 turns (N18 T1 caught by the guard); R4-8 (blocked sentence) holds — F11; R5-1 (in-stock
  alternatives only) holds — N5, N5b, N7, P2, N9; R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×6); R5-4 (no « home or stop-desk ? »
  after a street) holds; **R5-5 / R7-5 (delivery question answered with the fee) — 4 / 5, N3 T2 no fee in the answer → R20-2**; R5-6 (no
  `create_order` before a phone) holds — 0 / 51; R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 28 / 28; R8-3 (named variant)
  holds; R9-1 (Latin name in an Arabic chat) holds — N18; R10-1 (latency) — server max 13.5 s, 2 turns ≥ 10 s (→ R20-1); R11-5 (no provider
  error) holds — 0 / 99; R12-1 (no `VALIDATION wilayaId`) holds — 0 `VALIDATION`; R13-3 (Arabic street kept) holds — PG2, N11, N18, N21, N25,
  A1, A3; R13-5 (substitute line) holds — N5, N5b (repeated in N5 → R20-3); **R15-1 (price and both fees before the address question) — price
  15 / 15, fees missing in F5r T1 → R20-2**; R15 / R16 fees — every fee said matches the shop's settings (99 / 99 turns); R16-1 (every asked fee
  kept) holds — F9; R16-2 (one reason sentence, no refusal) holds — W1, C2; R17 (a plain yes to the recap placed; out-of-stock never offered)
  holds; R18-1 (place first ⇒ both fees) holds — PF1, PG1, PG2; R18-2 (price before the questions) holds; no invented discount (catalogue old
  prices Hijab 2000, Djellaba 9000; Oran free delivery only from 20 000 DA); N11 tracking from `lookup_order` (status new, not sent, no tracking
  number), nothing invented; photo request (N9) honest.

## Coverage
- Order flows to a yes: French ×9 (PF1, YQ, N17, N4, F1, F1b, F6, N1; F11 blocked), Arabic-script darija ×7 (PG2, N11, N21, A1, N25, N18,
  A3), arabizi ×7 (PG1, N3 after a switch, N9, P2, F3, N23, F5 mixed fr / arabizi on the shared link); a cancel after an order (N14 in
  N1); stopped by design: N5b (T2), F5r (T1); no order, rightly: N5 (no choice made), N7 (nothing chosen), F9, N16, F12 (delivery questions
  only), C2, H1, W1 (team).
- Asked this round: the 8 yes forms on 8 recaps (F1, PG1, N11, F6, P2, N21, N4, F3) with `Server-Timing` and `meta.steps`; a yes with a question
  (YQ, NEW); yes with a change (N17, N23, N25); F11 blocked; N5 ×2 (J04, J03), F5 ×2 on the shared link, N11, N3, N4, PG1, PG2, PF1; the sweep
  F1, F1b, F3, F6, F9, F12, W1, H1, C2, N1, N7, N9, N14, N16, N17, N18, N21, N23, N25, P2, A1 (not run in R19), A3; latency of every turn; every fee
  and the Oran free threshold against the shop's settings.
- Also: the J03 shop inside its opening hours for the first time (14 conversations, no « out_of_hours » line); « yes » in English in a French
  chat (F6); two different substitutes for the same out-of-stock message on the two shops (N5 Hijab / Robe, N5b Coffret ≥ 20 000 DA); a wilaya
  not served (F9, N16); the free threshold said (PG1, N5, N5b) and not reached (PG1 / N1 / N23 Oran 600 DA paid); Arabic-Indic digits (A3); a
  product not sold (N7); a product without photo asked in photo (N9).
- Kit: no blocked call, 0 API error, 0 console error (33 / 33 `.log.json` clean), no kit timeout; shared link valid (F5 / F5r / F12 answered).

## Not tested
- N5 with a « oui » that names a substitute (« oui le hijab ») after the two-option question — the scripted « oui » ×2 were kept as written;
  N5b's T3 / T4 (cut to stay within 100 messages) — so the Coffret path (free home delivery from 20 000 DA) was not taken to a recap.
- F5r's T2 / T3 (only its T1 latency / fee was asked); F9b, W1b, H2, C1, PF2, PF1r, PG1b, PG2b, N12 not re-run (passed in R19 or earlier; not in
  this round's list); an `angry` hand-off; a J03 conversation outside opening hours (all 15 of R19 were).
- Other spellings of a yes-with-intent (« ih nchriha », « oui je confirme », « ok », « d'accord », « صحيت ») — only the 8 asked forms, « ih saha »
  and « oui, c'est bien … » were sent.
- A photo request on a product that HAS a photo (the J03 Robe kabyle brodée has one; N9 ran on J04).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`); `cancel_order` on a real order. The live
  Messenger path (no page connected), so the real hand-offs of W1 / H1 / C2 (inbox assignment, AI paused) were not seen.
- The stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-1288 (PG1), TEST-6890 (F5, N9), TEST-4074 (N11), TEST-8063 (YQ, N17),
  TEST-1158 (P2), TEST-6619 (N21), TEST-4104 (A1), TEST-6971 (N25), TEST-6293 (PF1, F1, F1b), TEST-1772 (PG2), TEST-7010 (N3), TEST-8384 (N4),
  TEST-5998 (F3), TEST-2340 (F6), TEST-5759 (N1, then cancelled by N14 — simulated), TEST-6540 (N18), TEST-5687 (N23), TEST-5126 (A3); F11
  refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (R19's TEST-1288, TEST-6890, TEST-4074, TEST-8063, TEST-1158,
  TEST-6619, TEST-6971, TEST-6293, TEST-5998 again; PF1's is TEST-6293 again now that `phoneConfirmed` is not sent); the others got another number than in R19
  (the call's commune / address written differently, e.g. PG2 « بوفاريك » for « Boufarik »; N3, N4, F6, N1, N18, N23, A3).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:*` count / TTL, `DeliveryFeeRule`, `Product`,
  `ProductVariant`, `AgentTestLink` (expiry), `CustomerBlock` and `Agent.businessHours` rows of both shops, `AiRun` rows since 07:08 UTC with
  `meta.guard` / `meta.steps` (out/airun.txt, out/steps.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (99,
  `waitMs − runMs` ≤ 105 ms, 0 replay, 0 « did not finish ») and the API error log date (unchanged since 09/11); nothing written.
- Hour counters (read-only, after the run): J04 47 / 60 (window from 08:10:16; the 5 shared-link turns count in it too; link visitor counter 5),
  J03 52 / 60 (window from 09:00:44); no 429. Messages used: 99 / 100.
