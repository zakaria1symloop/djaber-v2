# R17 — Seventeenth retest of the AI order-taking (after the R16 fixes) — live site, deployed commit 644b299 — 18/11/2026 04:35–04:48 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 644b299 (checked read-only: `git log --oneline -1` = « 644b299 fix(ai): live retest R16 —
every asked fee / price / stock survives the guard, a model hand-off ends with the reason's sentence (wholesale), quotes reused across turns
while the delivery rule is unchanged, booking-like questions become the next field, wording fixes »; `djaber-v2-api` / `djaber-v2-worker`
online, restarted 04:33:46). Same two own shops as R1–R16: « Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR)
and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Surfaces: step 5 › « Tester moi-même » (playground, tool calls
visible) and, for F5 / F12, the J04 shared test link (`/agent-test/<token>`, valid until 18/11 18:04, so no new link was made; its tool
calls were read server side, read-only, from `AiToolCall`). One browser at a time, the runs one after the other. The block « 0550 12 34 56 »
(MANUEL, from R1) on the J04 shop was still in place (F11). Hour counters read before the run (read-only, Redis `rl:playground:*`, 04:35):
J04 no key, J03 49 (TTL 245 s, expired before the J03 run); link IP counter 1 (TTL 18 s). J04 flows 04:35:57–04:41:51, J03 flows
04:41:53–04:48:23. No 429. Both shops were outside their opening hours: the J03 conversations start with the shop's « out_of_hours » system
line (configured text, not an AI reply); the J04 shop shows no such line.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, unchanged since 16/11), used to check every fee:** Alger 400 home
/ 250 stop-desk, Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (home free from 20 000 DA), Illizi 1 500 / 1 000
inactive (not served). Stock (read-only): J04 Parfum Oud 50 ml 0, Montre connectée 0, Coffret cadeau Aïd 4, Hijab soie 20; J03 Montre
connectée 0, Sac à main cuir Noir 3 / Marron 3 / Rouge 0, Tapis de prière 15, Djellaba homme 10.

**Latency method (as R11–R16).** `conv.mjs` of R16 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » lines (`runMs`, `waitMs`, `totalMs`, `replayed`), the `AiRun` rows (`latencyMs`, `status`,
`flags`, `meta.guard`, `meta.turn`) + `AiToolCall` rows. No stall / dup probe.

**96 customer messages** (J04 shop 46 of which 4 on the shared link, J03 shop 50; budget 100), 32 conversations, 30 on the playground and 2
on the shared link: priority 1 — F9 twice (J04, then J03 as F9b, the exact R15 / R16 message), N16 as its own conversation (« slm, tawsil l
Illizi ? »), W1 twice (J04 the R16 message; J03 as W1b « Bonjour, prix de gros pour 50 pièces du tapis de prière ? », out of hours — J03
sells no hijab), PF1, N1, N14, N5 (tool calls counted per turn), the booking-question turns F1b T1 and N21 T1; priority 2 — N7 with its
« oui », N12 with its « ... » turn (the turns R16 shortened); priority 3 — the sweep F1, F3, F5 (shared link), F6, F11, F12 (shared link),
H1, C2, N3, N4, N9, N11, N17, N18, N23, N25, P2, A1, A3. Flows with `untilOrder` stop at the order, so no « oui » was spent after an order.
No adaptive re-send, no re-send by the script. Scripts `.local/qa/journeys/R17/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs,
lat-table.cjs, server.sh = read-only `AiRun` query, tools.sh = read-only `AiToolCall` query, probe-link.mjs, waitkey.sh, run.sh, all.sh),
transcripts `.local/qa/journeys/R17/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs `.local/qa/journeys/R17/out/run1.log`
(J04), `run2.log` (J03), `airun.txt`, `toolcalls.txt`, `api-lines.txt`, rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r17/`.

Cases asked for this round:
- **R16-1**: F9 ×2 and N16 — several wilayas in one message ⇒ every asked fee given, Illizi not served.
- **R16-2**: W1 ×2 — wholesale ⇒ the team will answer, no refusal sentence.
- **R16-3**: PF1, N1, N14, N5 — redundant lookups (tool calls per turn).
- **R16-4**: the booking-question turns (F1b, N21, and F1 / N4 / N18 / A1 T1 in the sweep), C2's double space, F1b's double stop-desk offer.
- The turns R16 shortened (N7 « oui », N12 « ... »); the sweep; latency per turn with `Server-Timing`; every R1–R16 guarantee (no order
  without a server recap — Critical; one order per « oui »; a « oui » with a change gives a new recap; no `create_order` before a phone; no
  confirm question / registered claim without a server recap; no wrong hand-off and every real one accepted; language and script kept; no
  invented discount; tracking real; address street, commune, wilaya; fees match the shop's delivery settings).

**Result: 28 / 32 conversations pass** — priority 1: 9 / 11 (F9, F9b, N16, W1, W1b, N1, N14, F1b, N21 pass; **PF1 fails, R17-1; N5 fails,
R17-2**), priority 2: 1 / 2 (N12 passes; **N7 fails, R17-3**), sweep 18 / 19 (**A3 fails, R17-4**). **R16-1 fixed: F9 twice — « Sétif : 650
DA à domicile, wela 350 DA f stop-desk … Oran stop-desk : 400 DA … Illizi : ma nwasslouch l Illizi f had lwaqt. » / « Tawsil l Sétif: 650 DA
l dar, wela 350 DA f stop-desk … Oran stop-desk: 400 DA … Ma nwasslouch l Illizi f had lwaqt. », the second one after the guard stripped a
Moroccan form (the exact R16-1 path) with every quoted fee kept; N16 Illizi not served; no unrelated search.** **R16-2 fixed: W1 « Pour le
prix de gros, l'équipe de la boutique va vous répondre. », W1b « Pour le prix de gros, l'équipe de la boutique est absente pour le moment,
elle vous répondra dès l'ouverture. » (platform hand-offs, 0 tool call, 2.6 / 2.3 s; R16 6.4 s); C2 through the model's own
`handoff_to_human {refund}` ends with the reason's sentence.** **R16-3 mostly fixed: N1 T2 1 call (R16 3), N14 T1 1 call (R16 2), PF1 T2 no
re-quote, F9 no unrelated search; left: N5 T2 searches the out-of-stock Oud again, PF1 T2 a `create_order` without an address (R17-6).**
**R16-4 partly fixed: F1 / N4 T1 « Pour préparer votre commande, quel est votre nom ? », N18 T1 « واش سميتك باش نسجلوها لك؟ », F1b T2 one
stop-desk offer, C2 no double space; left in Arabic script: N21 T1 « واش تحب نسجلوه ليك؟ », A1 T1 « تحب نجهزلك واحد ؟ », and A3 T1 « تسجلت
الطلب » — an order claimed registered before any recap (R17-4).** New: **a wrong hand-off on a place-only message (PF1 T1, model's
`handoff_to_human {off_catalogue}` accepted — Major, R17-1)**; **a « oui » to a substitute's server recap answered with a new confirm
question, no order (N5 T3 — Major, R17-2)**; an out-of-stock product offered (N7, Minor, R17-3). **Latency: page median 5.0 s, p90 7.4 s;
server median 4.8 s, p90 7.1 s, max 11.9 s (N23 T2); 2 page times ≥ 10 s (N23 T2 12.1 s / 11.9 s, N5 T2 10.2 / 10.0 s) — both server time,
not network; `Server-Timing` on 96 / 96 answers; page − server median 0.22 s, max 0.54 s; 0 provider error.** **0 order without a server
recap; 22 TEST orders, each from a « oui / ih / ايه / 👍 / oui c'est bon / oui, c'est bien … » to a server recap, exactly one each; F11 « oui »
refused as blocked; 1 « oui » to a server recap lost (N5 T3); 3 « yes » with a change (N17 fr, N23 arabizi, N25 Arabic script) → a new recap,
0 order; 0 `create_order` before a phone in 52 calls; 0 wrong fee in 96 turns.** Failures — two Major (R17-1 PF1 wrong hand-off, R17-2 N5 « oui »
lost), two Minor (R17-3 N7 out-of-stock offered, R17-4 A3 registered claim + Arabic-script booking questions). Issues: wording left (R17-5),
redundant lookups and one server turn above 10 s (R17-6).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| F9 | J04 · playground | arabizi, 3 wilayas | Sétif 650 / 350, Oran stop-desk 400, Illizi not served; 3 quotes, nothing else | T1 4.0 s / 3.7 s | — | PASS (R16-1) |
| F9b | J03 · playground | arabizi, 3 wilayas (re-run) | same 3 answers after a guard strip | T1 4.8 s / 4.6 s | — | PASS (R16-1) |
| N16 | J04 · playground | arabizi, Illizi | « ma nwasslouch l Illizi f had lwaqt » | T1 4.3 s / 4.0 s | — | PASS |
| W1 | J04 · playground | fr, wholesale | platform HANDOFF, « Pour le prix de gros, l'équipe … va vous répondre. » | T1 2.6 s / 2.4 s | — (team) | PASS (R16-2) |
| W1b | J03 · playground | fr, wholesale, out of hours | platform HANDOFF, « … est absente pour le moment, elle vous répondra dès l'ouverture. » | T1 2.3 s / 2.0 s | — (team) | PASS (R16-2) |
| PF1 | J03 · playground | fr, place alone then product | **T1 wrong HANDOFF `off_catalogue` (model), no fee**; T2 fees, no price; recap → TEST-6293 | T2 8.6 s / 8.4 s | yes, 1 | FAIL — R17-1 |
| N1 | J03 · playground | fr, product + wilaya change | 1 call per turn; new recap Oran → « oui » → TEST-1605 7 500 DA | T2 6.2 s / 5.9 s | yes, 1 | PASS (R16-3) |
| N14 | J03 · playground | fr, cancel after the order | 1 call per turn; TEST-1692 → « non annule » → cancelled | T2 5.9 s / 5.7 s | yes, 1 (then cancelled) | PASS (R16-3) |
| N5 | J04 · playground | fr, out of stock « c'est combien ? » | Oud 3200 DA + unavailable; Coffret substitute recap; **T3 « oui » → a new confirm question, no order**; T4 → TEST-3157 | T2 10.2 s / 10.0 s | yes, 1 (one « oui » late) | FAIL — R17-2 |
| F1b | J03 · playground | fr, fields over 3 messages | T2 one quote, one stop-desk offer → recap → TEST-6293 | T2 8.1 s / 7.8 s | yes, 1 | PASS (R16-4) |
| N21 | J04 · playground | Arabic script, fields one per message | T1 « واش تحب نسجلوه ليك؟ »; recap → « 👍 » → TEST-6619 | T1 6.8 s / 6.6 s | yes, 1 | PASS (R17-4 wording) |
| N7 | J03 · playground | fr, product not sold, then « oui » | no order, no hand-off; **Montre connectée (stock 0) offered twice** | T1 3.5 s / 3.3 s | no (right) | FAIL — R17-3 |
| N12 | J04 · playground | fr, « ? » and « ... » | the open question repeated twice; recap → « 👍 » → TEST-9479 | T6 6.3 s / 6.0 s | yes, 1 | PASS |
| F1 | J03 · playground | fr, fields one per message | T1 next field; recap « (Marron) » → TEST-6293 7 550 DA | T4 5.7 s / 5.5 s | yes, 1 | PASS (R16-4) |
| F3 | J03 · playground | arabizi, fields one per message | « وليد بوزيد » kept, street as typed → TEST-5998 | T4 5.6 s / 5.4 s | yes, 1 | PASS |
| F5 | J04 · shared link | fr / arabizi mixed | T1 4900 DA + 400 / 250 + address question; arabizi recap → TEST-6890 | T2 6.2 s / 6.0 s | yes, 1 | PASS |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2340 9 100 DA | T3 7.0 s / 6.7 s | yes, 1 | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED` | T2 4.3 s / 4.0 s | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « on livre à Blida ! … 450 DA, ou en stop-desk : 300 DA » | T1 2.6 s / 2.4 s | — | PASS |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | platform HANDOFF, « Bien sûr, je vous mets en relation … » | T1 1.9 s / 1.7 s | — (team) | PASS |
| C2 | J04 · playground | arabizi, broken order + refund | model HANDOFF `refund` accepted, arabizi reason sentence | T1 3.8 s / 3.6 s | — (team) | PASS (R16-4) |
| N3 | J03 · playground | fr → arabizi at T2 | both fees + arabizi recap → « ih saha » → TEST-1310 | T2 6.9 s / 6.7 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script alone | T1 next field, « سمير بن علي » kept → TEST-8384 3 250 DA | T2 6.5 s / 6.3 s | yes, 1 | PASS (R16-4) |
| N9 | J04 · playground | arabizi, photo + details | « Ma 3andnach tsawer »; recap (M) → TEST-6890 | T2 5.7 s / 5.4 s | yes, 1 | PASS |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; T3 `lookup_order` only, nothing invented | T2 5.0 s / 4.8 s | yes, 1 | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 7.9 s / 7.7 s | yes, 1 | PASS |
| N18 | J03 · playground | Arabic script, Latin name alone | T1 name asked; « Samir Benali » kept → TEST-8849 | T1 10.0 s / 9.8 s | yes, 1 | PASS (R16-4) |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-5687 | **T2 12.1 s / 11.9 s** (slowest) | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-7995 | T2 5.7 s / 5.5 s | yes, 1 | PASS |
| P2 | J04 · playground | arabizi « nheb … » | arabizi recap and confirmation → TEST-1158 5 300 DA | T1 8.7 s / 8.5 s | yes, 1 | PASS |
| A1 | J04 · playground | Arabic script, fields one per message | T1 « تحب نجهزلك واحد ؟ »; recap Alger → « ايه » → TEST-7041 | T5 4.7 s / 4.4 s | yes, 1 | PASS (R17-4 wording) |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | **T1 « تسجلت الطلب » before any recap**; recap → « ايه » → TEST-2857 | T2 7.4 s / 7.1 s | yes, 1 | FAIL — R17-4 |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **22 / 23** (PF1, F5, N5 at T4, F3, P2, F1, F1b, F6, N1, N3, N4, N9,
  N11, N12, N14, N17, N18, N21, N23, N25, A1, A3) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.** **« oui » to a correct
  recap lost: 1 — N5 T3 (R17-2)** (R16: 0). One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N23
  wilaya, N25 quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 1 / 1** — N7 T2 (« oui » after the not-sold answer → « Quel article
  souhaitez-vous commander … ? », no order, no hand-off).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr → Alger 400 DA, 1 900 DA, core f4cd80…), N23 T2 (arabizi → Oran
  600 DA, 8 100 DA, core e3d489…), N25 T2 (Arabic script → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new
  recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap (same draft / core): **5 / 5** — N3 (« …, El
  Khroub »), N14 (recap call « Cité 20 août, villa 3 » / confirming « cité 20 août villa 3 »), N25 (confirming whole place), A1 (« …، باب
  الزوار »), A3 (recap call commune « El Khroub » / confirming « الخروب »).
- **Confirming calls refused: 0** (22 + F11). **Recap calls refused: 0.** **`VALIDATION` refusals: 1 in 52 `create_order` calls** — PF1 T2
  (`address` missing, a call made before the address was given — R17-6; R16: 0).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **28 / 28**, the named variant every time
  (PF1, F1, F1b, N1 Marron; P2 S, F5 / N9 M); **in the customer's language 28 / 28** — Arabic script 7 (N11, N21, N25 ×2, A1, N18, A3),
  arabizi 7 (F5, P2, N9, F3, N3, N23 ×2), French 14.
- **Server recap without a model sentence asking to confirm or describing the order: 28 / 28** — lead-ins left: F1 « Merci Karim ! », N3 « Ih,
  nwasslou l Constantine. Tawsil l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. » (the answer to « twasslou l Constantine ? »),
  N5's server substitute line. **Outside any recap: 2 model turns fail the guarantee** — N5 T3 « … confirmez-vous la commande du Coffret
  cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider. » (a confirm question, R17-2) and A3 T1 « تسجلت الطلب »
  (an order claimed registered, R17-4); the guard flagged neither (0 `confirm_without_recap` in 96 runs; R16: 3). Offer questions left (N21 T1
  « واش تحب نسجلوه ليك؟ », A1 T1 « تحب نجهزلك واحد ؟ ») and item-noted lines (A1 T2 « تسجل عندي حجاب الحرير … بكمية 1 », F1b T1 « … et on le
  prépare pour vous ») — a « yes » to them asks the next field (R17-4).
- **Recap address « street, commune, wilaya »: 28 / 28** — A3 no separator, A1 / N21 / N25 « ، », N18 Latin name. **Street as the customer
  wrote it: 28 / 28** (F3 « cite 20 aout villa 3 », N23 « cite 500 … » although the recap call sent « Cité 500 … », N14 / N1 « cité 20 août
  villa 3 » although the call sent « Cité 20 août, villa 3 »; first-letter capitals not counted, as R14–R16).
- **Fees never wrong: 96 / 96 turns** — every fee said or recapped matches the shop's rules above (Oran home under 20 000 DA paid — N1 / N23
  600 DA; from 20 000 DA free — N5 24 990 DA « gratuite »; Illizi not served). **No asked fee missing** (R16: F9 Oran stop-desk).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3 (« ٠٥٥٠١٢٣٤٥٦ » → 0550123456).
- **Customer's name as written: 32 / 32 conversations** — Arabic script kept in French / arabizi chats (N4 « سمير بن علي » alone, F3 « وليد
  بوزيد »), Latin kept in an Arabic chat (N18 « Samir Benali » alone); 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9; photo announced without a photo: 0.
- **Delivery question answered with the fee: 5 / 5** — F9, F9b (three wilayas each), N16 (not served), F12 on the link (Blida 450 / 300), N3
  (Constantine both fees). **Place known, no street → price and both fees before the address / mode question: 2 / 3** — F5 (link), F1b;
  **PF1 no** (T1 hand-off sentence instead of the fees, T2 fees without the price — R17-1) (R16: 6 / 6).
- **`create_order` before a phone is in the customer's messages: 0 / 52 calls.**
- **Hand-offs: 4 / 4 real ones accepted, 1 wrong** — W1, W1b, H1 decided by the platform with 0 tool call, C2 by the model's own
  `handoff_to_human {refund}` (accepted); F11's is the server's (`CUSTOMER_BLOCKED`). **Wrong: PF1 T1 `handoff_to_human {off_catalogue,
  evidence «j'habite à Sétif, El Eulma»}` accepted (R17-1)** (R16: 0 wrong). **AI sentence for the reason, in the customer's script,
  out-of-hours aware: 4 / 4** (W1b out of hours). No hand-off for a product sold, not sold (N7), a photo request (N9), a tracking question
  (N11), a « yes » message.
- **No 503 / provider error: 96 / 96 turns**; `AiRun` 96 rows, 90 `ok` + 6 `handoff` (W1, F11 T2, H1, C2, W1b, PF1 T1), 0 `error`, 0
  fallback, `attempt` 1 everywhere; 5 runs carry a reply-guard retry (`guard_rewritten` 4 — N21 T1 moroccan_darija, F5 T1 / P2 T1
  language_switch, F1b T2 fee_missing; `guard_enforced` 1 — F9b T1 moroccan_darija stripped, every fee kept).
- Latency: **page median 5.0 s, p90 7.4 s, max 12.1 s on 96 turns** (N23 T2 12.1 / 11.9 s, N5 T2 10.2 / 10.0 s, N18 T1 10.0 / 9.8 s, P2 T1
  8.7 / 8.5 s, PF1 T2 8.6 / 8.4 s, F1b T2 8.1 / 7.8 s, PF1 T1 8.0 / 7.8 s); page median J04 4.3 s, J03 5.2 s; **server (`Server-Timing`
  total) median 4.8 s, p90 7.1 s, max 11.9 s**; `AiRun` max 11.89 s (N23 T2, one `create_order`, no guard retry); API « playground turn
  answered » lines: 96 since 04:35:50, `waitMs − runMs` max 75 ms, 0 replay, 0 « did not finish »; 1 POST per turn seen by the page; page −
  server median 0.22 s, max 0.54 s. 7 turns ≥ 8 s on the page, 2 ≥ 10 s, **1 ≥ 10 s on the server (N23 T2)** (R16: 0 on the server; its two
  page times ≥ 10 s were network).
- Quantity never asked again after a product is named: **0 quantity question in 96 turns** (« 2 pièces », « zoudj », « زوج », « 3 tapis au
  lieu de 2 », « ديرلي جوج », « واحد » kept).
- Language kept: arabizi **10 / 10** (F9, F9b, N16, C2, F3, N9, P2, N23, N3 after the switch, F5 mixed), Arabic-script darija **6 / 6** (N21,
  N11, N25, A1, N18, A3), French **16 / 16**; F5 T3 « oui c'est bon » confirmed in arabizi after the arabizi recap.
- **No Tunisian / Moroccan words sent: 32 / 32** — check.cjs word list: 1 hit, F9 « nchouf » in « T7ebb nchouf wach men produit ? » (read by
  hand: also Algerian darija; the sentence is the unrelated closing — R17-5); the guard rewrote / stripped a Moroccan form in 2 replies (N21
  T1, F9b T1) before they were sent (R16: 2).
- **Out-of-stock product offered: 1** — N7 T1 / T2 « Montre connectée » (stock 0, R17-3); N5 names the Parfum Oud only because the customer
  asked for it (and gives its price); P2 / N9 list S, M, XL only.
- No Markdown in a reply: **96 / 96**. No invented discount: only the catalogue's old prices (Hijab « بدل 2000 دج » / « au lieu de 2000 DA »,
  Djellaba « بدل 9000 دج »); Oran free delivery only from 20 000 DA (N5 24 990 DA).
- Tool calls in 96 turns (playground 92 turns from the response + shared link 4 turns from `AiToolCall`): `create_order` 52 (28 recaps + 22
  orders + 1 blocked + 1 `VALIDATION`), `quote_delivery` 12 (F9 ×3, F9b ×3, N16, PF1 T1, F1b T2, N3 T2, F5 T1, F12), `search_products` 6,
  `lookup_order` 1 (N11 tracking), `cancel_order` 1 (N14, asked), `check_availability` 0, **`handoff_to_human` 2 (C2 right, PF1 wrong — both
  accepted)**, `get_product` 0, `add_faq_candidate` 0; **0 search after a recap call in 28 recaps**. Turns with more than one call: F9 / F9b
  (3 quotes, one per asked wilaya), N3 T2 (quote + recap, the wilaya first named there), N5 T2 (2 searches + recap), PF1 T1 (quote + wrong
  hand-off), PF1 T2 (search + `create_order` without address).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line. Shared-link turns (F5, F12) carry no tool calls, cards' photos or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### F9 — J04 playground (UI fr)
**Verdict: PASS (R16-1 fixed, run 1 of 2, three wilayas in one arabizi message) — three `quote_delivery` (Sétif 650 / 350, Oran stop-desk 400, Illizi `WILAYA_NOT_SERVED`), no other tool (R16: an unrelated `search_products {«Retouche couture»}`); the reply gives the three answers: « Sétif : 650 DA à domicile, wela 350 DA f stop-desk … Oran stop-desk : 400 DA … Illizi : ma nwasslouch l Illizi f had lwaqt. » (R16: Oran missing). Left: the unrelated closing « T7ebb nchouf wach men produit ? » and « à domicile » in an arabizi reply (R17-5). No guard action (`AiRun` 01a1ecb9-e4c8…).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 4.0 s (server 3.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif : 650 DA à domicile, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5 ayam. Illizi : ma nwasslouch l Illizi f had lwaqt. T7ebb nchouf wach men produit ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F9b — J03 playground (UI fr)
**Verdict: PASS (R16-1 fixed, run 2 of 2, same message, J03 out of hours) — same three quotes, all three answered: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk … Oran stop-desk: 400 DA … Ma nwasslouch l Illizi f had lwaqt. » — this time the guard stripped a Moroccan form (`AiRun` 01a1ecbf-403e…: `{action stripped, retried true, violations [moroccan_darija], remaining [moroccan_darija]}`) and every quoted fee survived the strip (the exact R16-1 case). Closing « T7ebb nwarrik wach kayen 3andna ? » left (R17-5).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 4.8 s (server 4.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. T7ebb nwarrik wach kayen 3andna ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### N16 — J04 playground (UI fr)
**Verdict: PASS (N16 as its own conversation) — `quote_delivery {Illizi} → WILAYA_NOT_SERVED` → « … ma nwasslouch l Illizi f had lwaqt. », arabizi, no fee invented, no hand-off. The offer « nqder nwarrik lek hadja okhra li twasslek f wilaya ta3ek » makes no sense when nothing reaches Illizi (R17-5).**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 4.3 s (server 4.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3likoum, smah lina, ma nwasslouch l Illizi f had lwaqt. Ila t7ebb, nqder nwarrik lek hadja okhra li twasslek f wilaya ta3ek. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### W1 — J04 playground (UI fr)
**Verdict: PASS (R16-2 fixed, run 1 of 2, wholesale, fr) — HANDOFF from the platform (0 tool call, 2.6 s; R16: the model's `handoff_to_human`, 6.4 s), AI « Pour le prix de gros, l'équipe de la boutique va vous répondre. » — one sentence for the reason, no refusal (R16: « Je ne peux pas vous donner de prix de gros ici. … »). `AiRun` 01a1ecba-3d36… `handoff`.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 2.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Pour le prix de gros, l'équipe de la boutique va vous répondre. »

### W1b — J03 playground (UI fr)
**Verdict: PASS (R16-2 fixed, run 2 of 2, wholesale, fr, J03 out of hours) — HANDOFF from the platform, 0 tool call, 2.3 s; AI « Pour le prix de gros, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture. » — out-of-hours wording, no « très vite » line after the out-of-hours line, no refusal.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du tapis de prière ? » · `fr` · 2.3 s (server 2.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Pour le prix de gros, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture. »

### PF1 — J03 playground (UI fr)
**Verdict: FAIL — R17-1 (place first, fr) — T1 « Bonjour, j'habite à Sétif, El Eulma » → `quote_delivery {Sétif}` (650 / 350) then the model's `handoff_to_human {off_catalogue, evidence «j'habite à Sétif, El Eulma»}` → accepted, status HANDOFF `off_catalogue`, AI « Merci pour votre message : l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture. » — a wrong hand-off on a place message and no fee given (R16: « … 650 DA à domicile, ou 350 DA en stop-desk … Quel article vous intéresse ? »). T2 asks home or stop-desk with both fees but not the price (6 900 DA), after a premature `create_order` without an address → `VALIDATION address`. T3 recap, T4 « oui » → TEST-6293 7 550 DA (the playground keeps answering after a hand-off; on Messenger the conversation would have gone to the team at T1).**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 8.0 s (server 7.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci pour votre message : l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `handoff_to_human {off_catalogue, evidence «j'habite à Sétif, El Eulma»} → ok`
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 8.6 s (server 8.4 s)
  - AI: « Parfait Karim, le sac à main cuir Marron est noté. Souhaitez-vous une livraison à domicile à El Eulma (650 DA) ou en stop-desk (350 DA) ? Si c'est à domicile, indiquez-moi votre rue ou votre cité. »
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», items 1×variant …0eda, customerConfirmed true} → VALIDATION address`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 7.0 s (server 6.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### N1 — J03 playground (UI fr)
**Verdict: PASS (R16-3 item fixed) — product + wilaya + address change → one call, the recap `create_order` (R16: `quote_delivery` + `check_availability` + `create_order`), new recap « (Marron) » Oran 600 DA → « oui » → TEST-1605 7 500 DA.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.5 s (server 4.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 6.2 s (server 5.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.2 s (server 5.0 s)
  - AI: « Votre commande TEST-1605 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-1605, total 7500`

### N14 — J03 playground (UI fr)
**Verdict: PASS (R16-3 item fixed) — T1 one call, the recap `create_order` (R16: a `quote_delivery {Blida}` first); « oui » → TEST-1692; « non annule » → `cancel_order {TEST-1692}` alone (R16: `lookup_order` first) → « La commande TEST-1692 (Djellaba homme) a bien été annulée. … » (simulated).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.9 s (server 5.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr` · 5.9 s (server 5.7 s)
  - AI: « Votre commande TEST-1692 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-1692, total 7950`
- **T3** C: « non annule » · `fr` · 3.8 s (server 3.5 s)
  - AI: « La commande TEST-1692 (Djellaba homme) a bien été annulée. Si vous changez d'avis, dites-le-moi et je vous aide à repasser commande. »
  - tools: `cancel_order {"orderNumber":"TEST-1692","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-1692`

### N5 — J04 playground (UI fr)
**Verdict: FAIL — R17-2 (out of stock, price asked, fr) — T1 « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible … nous avons le Coffret cadeau Aïd à 24990 DA … Ça vous intéresse ? » (price given, R15-4 holds; 0 tool call); T2 « Bon finalement je le prends … » → the substitute's server line + recap Coffret, Oran home « gratuite » (24 990 ≥ 20 000 DA — right), 3 calls, 10.2 s; T3 « oui » to that server recap → no `create_order`, the model asks « … je veux être sûre : confirmez-vous la commande du Coffret cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider. » — a « oui » to a server recap lost and a confirm question outside a recap; T4 « oui » → TEST-3157 24 990 DA from the T2 draft (faad11…).**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 3.8 s (server 3.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Par contre, nous avons le Coffret cadeau Aïd à 24990 DA, avec parfum, chocolat et carte personnalisée. Ça vous intéresse ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 10.2 s (server 10.0 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `search_products {«Parfum Oud 50 ml»} → 1 product(s)` · `search_products {«Coffret cadeau Aïd»} → 1 product(s)` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Merci Karim. Le Parfum Oud 50 ml étant en rupture, je veux être sûre : confirmez-vous la commande du Coffret cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider. »
- **T4** C: « oui » · `fr` · 5.7 s (server 5.4 s)
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### F1b — J03 playground (UI fr)
**Verdict: PASS (booking-question turn, R16-4 item fixed) — T2 « Sétif, El Eulma » → one `quote_delivery` → « … 650 DA à domicile, ou 350 DA en stop-desk … Vous préférez être livré à domicile (donnez-moi la rue ou la cité) ou en stop-desk ? » — the stop-desk offered once (R16: twice); the guard rewrote a `fee_missing` (`AiRun` 01a1ecc0-e629…). T3 recap, T4 « oui, c'est bien … » → TEST-6293 7 550 DA. T1 « … et on le prépare pour vous » reads as an order step before any recap (R17-4).**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 3.0 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en couleur Marron est disponible à 6900 DA, et on le prépare pour vous. Dans quelle wilaya souhaitez-vous être livré ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Sétif, El Eulma » · `fr` · 8.1 s (server 7.8 s)
  - AI: « Merci Karim, c'est noté : El Eulma, Sétif. Pour la livraison à Sétif : 650 DA à domicile, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Vous préférez être livré à domicile (donnez-moi la rue ou la cité) ou en stop-desk ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 6.5 s (server 6.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 7.9 s (server 7.6 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### N21 — J04 playground (UI ar)
**Verdict: PASS (booking-question turn) — fields one per message, Arabic script; recap « حي الورود رقم 12، بوفاريك، البليدة » → « 👍 » → TEST-6619 1 950 دج. T1 (the guard rewrote a Moroccan form, `AiRun` 01a1ecba-e282…) still ends with an offer question « واش تحب نسجلوه ليك؟ » (« shall we register it for you? ») instead of the name question (R16-4 not fixed in Arabic script — R17-4); T2 « نادية قاسي » → the phone is asked, no order.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 6.8 s (server 6.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بـ 1500 دج بدل 2000 دج. واش تحب نسجلوه ليك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 2.5 s (server 2.2 s)
  - AI: « أهلًا نادية! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلب. »
- **T3** C: « 0661234568 » · `ar` · 2.4 s (server 2.2 s)
  - AI: « صحيت نادية، تسجّلت رقم الهاتف. واش من ولاية تحب نوصلوها ليك؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.7 s (server 3.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 6.3 s (server 6.1 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N7 — J03 playground (UI fr)
**Verdict: FAIL — R17-3 (product not sold, then « oui », fr, now with its « oui ») — T1 « Désolé, nous n'avons pas de lunettes de soleil … Nous avons une Montre connectée, un Sac à main en cuir, des Basket Runner ou encore une Robe kabyle brodée. … » — the Montre connectée has stock 0 (J03, read-only); T2 « oui » → « … Quel article souhaitez-vous commander : la Montre connectée, … ? » — no order and no hand-off (right), but the out-of-stock product is offered twice; 0 tool call in both turns (R16: a `search_products` and in-stock products only).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous n'avons pas de lunettes de soleil pour le moment. Nous avons une Montre connectée, un Sac à main en cuir, des Basket Runner ou encore une Robe kabyle brodée. Merci pour vos infos, Yacine : dites-moi ce qui vous intéresse et je continue la commande. »
- **T2** C: « oui » · `fr` · 3.5 s (server 3.3 s)
  - AI: « Parfait Yacine, je note vos coordonnées. Quel article souhaitez-vous commander : la Montre connectée, le Sac à main en cuir, le Basket Runner ou la Robe kabyle brodée ? »

### N12 — J04 playground (UI fr)
**Verdict: PASS (now with its « ... » turn) — « ? » → « Quel est votre nom pour la commande ? », « ... » → « Dans quelle wilaya habitez-vous ? » (the open question repeated each time, 1.7 / 1.8 s, no tool, no hand-off); recap → « 👍 » → TEST-9479 1 950 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr` · 3.2 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait, le Hijab soie est disponible ! Il est en soie douce, 180 x 70 cm, à 1500 DA au lieu de 2000 DA. Quel est votre nom pour la commande ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « ? » · `fr` · 1.7 s (server 1.5 s)
  - AI: « Quel est votre nom pour la commande ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr` · 3.4 s (server 3.1 s)
  - AI: « Merci Nadia, c'est noté ! Pour finaliser la commande du Hijab soie, dans quelle wilaya habitez-vous ? »
- **T4** C: « ... » · `fr` · 1.8 s (server 1.6 s)
  - AI: « Dans quelle wilaya habitez-vous ? »
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.0 s (server 4.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T6** C: « 👍 » · `fr` · 6.3 s (server 6.0 s)
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### F1 — J03 playground (UI fr)
**Verdict: PASS (fields one per message, R16-4 item fixed) — T1 « … Pour préparer votre commande, quel est votre nom ? » (R16: « Souhaitez-vous le commander ? Si oui, dites-moi votre nom … »); T4 recap with a « Merci Karim ! » lead-in (no confirm request in it); « oui » → TEST-6293 7 550 DA. No network stall this round (T2 3.9 s, T3 2.0 s).**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 5.2 s (server 4.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6900 DA, en cuir véritable. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 3.9 s (server 3.7 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233 » · `fr` · 2.0 s (server 1.9 s)
  - AI: « Merci Karim, c'est noté pour le numéro 0770112233 ! Dans quelle wilaya souhaitez-vous recevoir le sac ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 5.7 s (server 5.5 s)
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 5.0 s (server 4.8 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F3 — J03 playground (UI fr)
**Verdict: PASS — arabizi, the Arabic-script name « وليد بوزيد » kept; recap street « cite 20 aout villa 3 » as typed; « ih » → TEST-5998 6 050 DA.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 4.0 s (server 3.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Tapis de prière molletonné, 120 x 70 cm, b 2800 DA l'unité. Zoudj tapis = 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.1 s (server 1.9 s)
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244 » · `arabizi` · 4.0 s (server 3.8 s)
  - AI: « Saha Walid, tsajjel. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 5.6 s (server 5.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih » · `arabizi` · 5.2 s (server 5.0 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F5 — J04 shared link (UI fr)
**Verdict: PASS (shared link, the R15 / R16 messages) — T1 « Robe kabyle brodée taille M, 4900 DA, kayna. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Wach l'adresse ta3ek f Bab Ezzouar … ? » — price and both fees before the address question; T2 arabizi recap; T3 « oui c'est bon » → TEST-6890 in arabizi. Server rows (read-only): T1 `quote_delivery {wilayaId 16} → fee 400, stopdeskFee 250` (guard rewrote a `language_switch`, `AiRun` 01a1ecbb-c94d…) · T2 `create_order` → `CONFIRMATION_REQUIRED` · T3 same call → `ok`.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.3 s (server 5.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Marhba bik ya Amina! Robe kabyle brodée taille M, 4900 DA, kayna. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, bloc wela blassa ma3roufa 9rib) ? »
- **T2** C: « rue des frères Bouadou n 5 » · 6.2 s (server 6.0 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 5.3 s (server 5.2 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — 2 → 3 tapis → new recap 9 100 DA; « oui » → TEST-2340.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 6.2 s (server 6.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 5.8 s (server 5.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 7.0 s (server 6.7 s)
  - AI: « Votre commande TEST-2340 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », HANDOFF (server).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 4.1 s (server 3.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 4.3 s (server 4.0 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link) — « Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. … » — server `quote_delivery {Blida} → fee 450 / stopdeskFee 300` (read-only `AiToolCall`); check.cjs « DELIVERY-Q-NO-FEE » is its known false hit.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. Vous voulez commander quelque chose ? »

### H1 — J04 playground (UI fr)
**Verdict: PASS — HANDOFF from the platform, 0 tool call, 1.9 s; « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 1.9 s (server 1.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »

### C2 — J04 playground (UI fr)
**Verdict: PASS (R16-4 item fixed) — the model's `handoff_to_human {refund}` accepted; AI « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. » — the reason's sentence, arabizi, no double space (R16 « 3lik  3la »), no Arabic-script hand-off line.**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 3.8 s (server 3.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. »
  - tools: `handoff_to_human {refund, evidence «nheb tredouli drahmi»} → ok`

### N3 — J03 playground (UI fr)
**Verdict: PASS — T2 switches to arabizi; « twasslou l Constantine ? » answered with both fees (700 / 450), then the arabizi recap; « ih saha » → TEST-1310 6 300 DA.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 5.0 s (server 4.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci Samira, c'est noté : 2 Tapis de prière à 2800 DA l'unité, soit 5600 DA hors livraison. Dans quelle wilaya souhaitez-vous être livrée ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 6.9 s (server 6.7 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 4.4 s (server 4.2 s)
  - AI: « Commande ta3ek TEST-1310 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1310, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — T1 « … Pour préparer votre commande, quel est votre nom ? » (R16: « Je note 1 tapis pour vous »); the Arabic-script name « سمير بن علي » sent alone kept, French kept; « oui » → TEST-8384 3 250 DA.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 5.6 s (server 5.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Le tapis de prière est disponible : molletonné, 120 x 70 cm, à 2800 DA. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « سمير بن علي » · `fr` · 6.5 s (server 6.3 s)
  - AI: « Merci Samir, c'est noté. Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0661234567 » · `fr` · 2.5 s (server 2.2 s)
  - AI: « Merci, c'est noté. Dans quelle wilaya souhaitez-vous recevoir la commande ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.2 s (server 3.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui » · `fr` · 5.8 s (server 5.6 s)
  - AI: « Votre commande TEST-8384 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-8384, total 3250`

### N9 — J04 playground (UI fr)
**Verdict: PASS — no tool, « Ma 3andnach tsawer ta3 had la robe f had lwaqt. » + S / M / XL only; arabizi recap (M) → « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 4.3 s (server 4.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alikoum salam! Ma 3andnach tsawer ta3 had la robe f had lwaqt. Hiya robe kabyle brodée b lyedd, b tissu khfif, mlih l l3rass w lmounasabat. Lmqasat li kaynin: S w M b 4900 DA, XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.7 s (server 5.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.1 s (server 4.8 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS — recap → « ايه » → TEST-4074; T3 `lookup_order` only → « … ما خرجتش للتوصيل بعد … ما عندناش رقم تتبع دروك … » from the tool result (`not_sent`, tracking null), nothing invented.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.2 s (server 4.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 5.0 s (server 4.8 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 3.6 s (server 3.4 s)
  - AI: « طلبيتك رقم TEST-4074 مازالت جديدة، وما خرجتش للتوصيل بعد، راهي تتجهز. ما عندناش رقم تتبع دروك، وكي تخرج الطلبية نعطيوك الرقم والرابط. مدة التوصيل من 2 إلى 5 أيام من وقت الخروج. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N17 — J04 playground (UI fr)
**Verdict: PASS — « oui mais livrez à Alger … » → new recap Alger 400 DA (1 900 DA), no order; « oui » → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.3 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 7.9 s (server 7.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 5.7 s (server 5.5 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N18 — J03 playground (UI ar)
**Verdict: PASS (R16-4 item fixed) — T1 « … واش سميتك باش نسجلوها لك؟ » (the name asked; R16 « واش تحب نسجلو لك؟ وواش سميتك؟ »), 10.0 s; the Latin name « Samir Benali » sent alone kept; « ايه » → TEST-8849 8 200 دج.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 10.0 s (server 9.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا جلابة رجالي من صوف رفيع، لونها بيج، مقاس واحد، بسعر 7500 دج بدل 9000 دج. واش سميتك باش نسجلوها لك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar` · 2.5 s (server 2.3 s)
  - AI: « صحيت يا سمير، تسجل. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 1.8 s (server 1.6 s)
  - AI: « صحيت، تسجل. واش من ولاية ؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 3.8 s (server 3.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T5** C: « ايه » · `ar` · 5.7 s (server 5.5 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N23 — J03 playground (UI fr)
**Verdict: PASS — « ih bessah wasslouha l Oran … » → new arabizi recap Oran 600 DA (8 100 DA), no order — 12.1 s / server 11.9 s, the slowest turn of the round (one `create_order`, no guard retry); « ih » → TEST-5687; streets as typed.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 3.8 s (server 3.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 12.1 s (server 11.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 6.9 s (server 6.7 s)
  - AI: « Commande ta3ek TEST-5687 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → ok TEST-5687, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS — « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 × (3 450 دج), no order; « ايه » → TEST-7995 (the confirming call sent the whole place as `address`; the order came from the stored draft 480520…, same content).**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.1 s (server 3.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 5.7 s (server 5.5 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 5.1 s (server 4.9 s)
  - AI: « تم تسجيل طلبيتك TEST-7995 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12، بوفاريك، البليدة», items 2×product …450a, customerConfirmed true} → ok TEST-7995, total 3450`

### P2 — J04 playground (UI fr)
**Verdict: PASS — arabizi on every turn, arabizi recap, « ih » → TEST-1158 5 300 DA (T1 the guard rewrote a `language_switch`, 8.7 s).**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 8.7 s (server 8.5 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Robe kabyle brodée b lyedd, qmach khfif, parfaite l l3rass w lmounasabat. Kayna f S (4900 DA), M (4900 DA) w XL (5200 DA). Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
  - tools: `search_products {«Robe kabyle brodée»} → 1 product(s)`
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.6 s (server 5.4 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 4.8 s (server 4.7 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### A1 — J04 playground (UI ar)
**Verdict: PASS — fields one per message, Arabic script; recap Alger 400 دج → « ايه » → TEST-7041 1 900 دج. T1 ends with an offer question « تحب نجهزلك واحد ؟ » and T2 « تسجل عندي حجاب الحرير (Hijab soie) بكمية 1 » (R17-4); a « yes » to them would not be an order (T2's name went to the phone question).**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 3.9 s (server 3.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام 👋 عندنا Hijab soie بـ 1500 دج (بدل 2000 دج)، حرير ناعم وخفيف، مقاسه 180 x 70 سم. تحب نجهزلك واحد ؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « أمينة سعدي » · `ar` · 2.5 s (server 2.3 s)
  - AI: « صحيت أمينة، تسجل عندي حجاب الحرير (Hijab soie) بكمية 1. عطيني رقم الهاتف تاعك (مثال: 0555123456) ؟ »
- **T3** C: « 0698765432 » · `ar` · 3.5 s (server 3.3 s)
  - AI: « صحيت، تسجل. واش من ولاية ؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 3.8 s (server 3.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 4.7 s (server 4.4 s)
  - AI: « تم تسجيل طلبيتك TEST-7041 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5، باب الزوار», items 1×product …450a, customerConfirmed true} → ok TEST-7041, total 1900`

### A3 — J03 playground (UI ar)
**Verdict: FAIL — R17-4 (Arabic script, Arabic-Indic phone) — T1 « أهلا سميرة، تسجلت الطلب: زوج Tapis de prière بـ 2800 دج للقطعة … » — « the order is registered » before any `create_order` (0 tool call, no guard action, `AiRun` 01a1ecc4-cb00…); T2 recap « …، الخروب، قسنطينة » with « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456; « ايه » → TEST-2857 6 300 دج.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 5.1 s (server 4.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « أهلا سميرة، تسجلت الطلب: زوج Tapis de prière بـ 2800 دج للقطعة، يعني 5600 دج قبل التوصيل. واش من ولاية نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 7.4 s (server 7.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «El Khroub», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft c58c18… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 6.9 s (server 6.8 s)
  - AI: « تم تسجيل طلبيتك TEST-2857 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true, phoneConfirmed true} → ok TEST-2857, total 6300`

## Bugs

### R17-1 — A place-only first message gets a model hand-off (`off_catalogue`) instead of the fees (PF1)
- Page: playground dialog (owner, fr UI, 1440) — « Boutique de Nassim » (out of hours)
- Severity: Major
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même »; send « Bonjour, j'habite à Sétif, El Eulma », then « Je voudrais le sac à main cuir marron. Karim
  Haddad 0770112233 ».
- Expected: no hand-off for a field / place message (R4-1 / R11-2 / R13-1); T1 the Sétif fees, as R16 PF1: « Merci pour l'info ! Nous livrons
  à El Eulma (Sétif) : 650 DA à domicile, ou 350 DA en stop-desk, délai de 2 à 5 jours. Quel article vous intéresse ? »; T2 the price and both
  fees before the address / mode question (R15-1): « … disponible, à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. … ».
- Actual (PF1, 04:42:13–04:42:21, 8.0 s / server 7.8 s, `AiRun` 01a1ecbf-9036… status `handoff`, `statusDetail off_catalogue`): tools
  `quote_delivery {wilayaName Sétif} → fee 650 / stop-desk 350` · `handoff_to_human {reason off_catalogue, evidence «j'habite à Sétif, El
  Eulma»} → ok`; AI « Merci pour votre message : l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture. » —
  the turn is a HANDOFF (the dialog shows « AGENT J03 VENDEUR · HANDOFF · OTHER »), the quoted fees are not said. T2 (8.6 s / 8.4 s, `AiRun`
  01a1ecbf-b206…): `search_products {«Sac à main cuir marron»}` · `create_order {…, wilayaId 19, communeName «El Eulma», no address}` →
  `VALIDATION address`; AI « Parfait Karim, le sac à main cuir Marron est noté. Souhaitez-vous une livraison à domicile à El Eulma (650 DA)
  ou en stop-desk (350 DA) ? Si c'est à domicile, indiquez-moi votre rue ou votre cité. » — both fees, no price. The playground went on (T3
  recap, T4 « oui » → TEST-6293 7 550 DA); on a Messenger conversation the hand-off at T1 would have passed it to the (absent) team.
- Evidence: .local/qa/journeys/R17/out/transcripts/PF1.json T1–T2 + PF1.ui.txt · run2.log · .local/qa/campaign/retest-ai-r17/fr-PF1-pg.png ·
  out/airun.txt (01a1ecbf-9036…, 01a1ecbf-b206…) · `AiRun.meta.turn` (toolCalls, statusDetail) · compare R16 PF1
- Likely cause: the model's own `handoff_to_human` is accepted on its evidence alone; the « no hand-off on a field / place / yes message »
  check of the platform path is not applied to a model call, and since R16-2 the accepted call also replaces the reply by the reason's
  sentence, so the quoted fees are dropped. T2: the fee completion added the fees to the mode question but not the price of the product
  found in the same turn; the `create_order` was sent before the address was known.

### R17-2 — A « oui » to a substitute's server recap gets a new confirm question, no order (N5)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Major
- Type: Bug
- Steps: J04 › « Tester moi-même »: « Bonjour, le parfum oud c'est combien ? » → « Bon finalement je le prends. Karim Haddad 0770112233, Oran,
  Bir El Djir, cité 1000 logements bloc 4 » → « oui » → « oui ».
- Expected: the T2 server recap (with the substitute line) answered « oui » → the order at T3 (one order per « oui » to a server recap, R4-3 /
  R13-5); no model question asking to confirm outside a server recap (R8-2 / R10-2 / R12-2).
- Actual (N5): T2 (04:36:44, 10.2 s / server 10.0 s, 3 calls: `search_products {«Parfum Oud 50 ml»}` · `search_products {«Coffret cadeau
  Aïd»}` · `create_order {…, items 1×product …3400}` → `CONFIRMATION_REQUIRED` draft faad11… core 1fbb33…) → « Le produit Parfum Oud 50 ml
  n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre
  commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la
  livraison. ⏎ … Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »; **T3 C « oui » (04:36:55, 4.7 s, `AiRun`
  01a1ecba-9d39…, 0 tool call, no guard action) → AI « Merci Karim. Le Parfum Oud 50 ml étant en rupture, je veux être sûre : confirmez-vous la
  commande du Coffret cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider. »** — no `create_order`, a confirm
  question outside a recap, and the server recap just sent is called unofficial; T4 « oui » → `create_order` → ok TEST-3157 24 990 DA (draft
  faad11…, the T2 content). R16 N5: the substitute was asked first, then its recap, then one « oui » → the order.
- Evidence: .local/qa/journeys/R17/out/transcripts/N5.json T2–T4 + N5.ui.txt · run1.log · fr-N5-pg.png · out/airun.txt (01a1ecba-7327…,
  01a1ecba-9d39…) · out/toolcalls.txt (04:36:44 ×3, 04:37:0x)
- Likely cause: when the recap carries the substitute line, the model reads the next « oui » as consent still owed for the substitute and asks
  again; the bare « oui » after a server recap is left to the model instead of being placed from the stored draft, and the reply guard has no
  rule for a confirm question that follows a recap without a new `create_order`.

### R17-3 — An out-of-stock product offered when the asked product is not sold (N7)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20
  août villa 3 » → « oui ».
- Expected: in-stock products only (R5-1), as R16 N7 (« … sac à main en cuir, disponible en Noir ou Marron à 6900 DA, ou notre robe kabyle
  brodée à 4900 DA »).
- Actual (N7, 04:44:11–04:44:18, 0 tool call each turn, `AiRun` 01a1ecc1-5d12…, 01a1ecc1-6d3e…): T1 « Désolé, nous n'avons pas de lunettes de
  soleil pour le moment. Nous avons une Montre connectée, un Sac à main en cuir, des Basket Runner ou encore une Robe kabyle brodée. Merci
  pour vos infos, Yacine : dites-moi ce qui vous intéresse et je continue la commande. »; T2 « oui » → « Parfait Yacine, je note vos
  coordonnées. Quel article souhaitez-vous commander : la Montre connectée, le Sac à main en cuir, le Basket Runner ou la Robe kabyle
  brodée ? » — the Montre connectée has stock 0 (J03 `Product`, read-only). No order and no hand-off (right).
- Evidence: .local/qa/journeys/R17/out/transcripts/N7.json + N7.ui.txt · run2.log · fr-N7-pg.png · `Product` read-only after the run (Montre connectée stock 0, no variant)
- Likely cause: without a `search_products` call the model lists products from the catalogue summary in its context, which keeps the
  out-of-stock ones; the in-stock filter applies to the search result only.

### R17-4 — An order claimed registered, and booking-like offer questions, before any recap (Arabic script)
- Page: playground dialog (owner, ar / fr, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run A3, N21, A1, F1b.
- Expected: before a server recap, no sentence saying the order is registered and no « shall I reserve / register / prepare it? » question:
  the next missing field is asked (the R16-4 fix — works in French: F1 / N4 T1 « … Pour préparer votre commande, quel est votre nom ? », and in
  N18 T1 « … واش سميتك باش نسجلوها لك؟ »).
- Actual:
  - **A3 T1** (04:47:56, 0 tool call, no guard action, `AiRun` 01a1ecc4-cb00…) C « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » → AI
    « أهلا سميرة، تسجلت الطلب: زوج Tapis de prière بـ 2800 دج للقطعة، يعني 5600 دج قبل التوصيل. واش من ولاية نوصلوهم ليها؟ » — « the order is
    registered » with no `create_order` yet (R16 A3 T1 « سجلت زوج Tapis de prière » — « I noted two »).
  - N21 T1 (`AiRun` 01a1ecba-e282…, the guard rewrote a Moroccan form) « … بـ 1500 دج بدل 2000 دج. واش تحب نسجلوه ليك؟ » (« shall we register
    it for you? »; R16 « تحب نحجزلك واحد؟ »).
  - A1 T1 « … مقاسه 180 x 70 سم. تحب نجهزلك واحد ؟ » (« shall I prepare one for you? »), T2 « صحيت أمينة، تسجل عندي حجاب الحرير (Hijab soie)
    بكمية 1. عطيني رقم الهاتف تاعك … ».
  - F1b T1 « Parfait Karim, le Sac à main cuir en couleur Marron est disponible à 6900 DA, et on le prépare pour vous. Dans quelle wilaya
    souhaitez-vous être livré ? ».
  - A « yes » to these was not sent this round; in R16 such a « yes » asked the next field. The guard flagged none of them (0
    `confirm_without_recap` in 96 runs).
- Evidence: .local/qa/journeys/R17/out/transcripts/A3.json T1, N21.json T1, A1.json T1–T2, F1b.json T1 · ar-A3-pg.png · `AiRun.meta.guard`
  (out/airun.txt)
- Likely cause: the R16-4 rewrite to the next field covers the French offer forms and the `confirm_without_recap` pattern list; the Arabic
  forms « تسجلت الطلب », « نسجلوه ليك », « نجهزلك », « تسجل عندي » are not in it.

### R17-5 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run F9, F9b, N16, N5, N7, P2.
- Expected: plain Algerian darija / arabizi / French, no closing unrelated to the question, no offer that cannot apply.
- Actual:
  - F9 / F9b closings after a delivery-only question: « T7ebb nchouf wach men produit ? » (check.cjs word-list hit « nchouf » — Algerian too)
    / « T7ebb nwarrik wach kayen 3andna ? » (R14-4 / R16-1 family; the unrelated search is gone).
  - N16 « Ila t7ebb, nqder nwarrik lek hadja okhra li twasslek f wilaya ta3ek. » — nothing is delivered to Illizi, whatever the product.
  - French inside arabizi: F9 « Sétif : 650 DA à domicile, wela 350 DA f stop-desk », P2 « … parfaite l l3rass w lmounasabat ».
  - N5 T1 offers the Coffret cadeau Aïd (24 990 DA, in stock) as the alternative to a 3 200 DA perfume, and T2 takes « je le prends » for
    it (the last product offered — readable, but eight times the asked price).
  - N7 T1 « dites-moi ce qui vous intéresse et je continue la commande » and T2 « je note vos coordonnées » — no product, no order yet.
  - The reply guard still rewrites / strips a Moroccan form the model wrote (N21 T1, F9b T1) — nothing Moroccan reached the customer.
  - Fixed since R16-4: C2 double space, F1b double stop-desk offer, F1 / N4 / N18 T1 offer questions.
- Evidence: .local/qa/journeys/R17/out/transcripts/F9.json, F9b.json, N16.json, P2.json T1, N5.json T1–T2, N7.json · `AiRun.meta.guard`
- Likely cause: free model wording.

### R17-6 — Redundant lookups left; one server turn above 10 s
- Page: playground dialog (owner, fr / arabizi, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: run N5, PF1, N23; read the tool calls and `Server-Timing`.
- Expected: no tool call whose result the turn already has (R11-3 … R16-3); no `create_order` before the address is known; server time under
  10 s (R10-1; R16 max 9.4 s).
- Actual:
  - N5 T2 (10.2 s / server 10.0 s): `search_products {«Parfum Oud 50 ml»}` (T1 had already said it is unavailable) + `search_products
    {«Coffret cadeau Aïd»}` (the T1 card already carried its id) + the recap `create_order`.
  - PF1 T2 (8.6 / 8.4 s): `create_order` without an address → `VALIDATION address` (the only refusal of the round, R16: 0), then the mode
    question.
  - N23 T2 (12.1 s / server 11.9 s, `AiRun` 01a1ecc4-63ed… 11 885 ms, one `create_order`, no guard retry, attempt 1) — the only server turn
    ≥ 10 s; N18 T1 9.8 s (one search).
  - Fixed since R16-3: N1 T2 one call (R16: `quote_delivery` + `check_availability` + `create_order`), N14 T1 one call (R16: a quote first),
    N14 T3 `cancel_order` alone, PF1 T2 no re-quote of T1's wilaya, F9 no unrelated search; 0 search after a recap call (0 / 28).
- Evidence: .local/qa/journeys/R17/out/transcripts/N5.json T2, PF1.json T2, N23.json T2 · out/toolcalls.txt · out/airun.txt · out/api-lines.txt
- Likely cause: the cross-turn reuse covers quotes; the stock and product facts said in a previous turn are not treated as known; the model
  call time of N23 T2 (no tool wait) is the provider's.

## Retest
- RETEST R16-1: fixed — F9 twice with the exact R15 / R16 message, three `quote_delivery` each (Sétif, Oran stop-desk, Illizi) and the three
  answers in the reply: « Sétif : 650 DA à domicile, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5
  ayam. Illizi : ma nwasslouch l Illizi f had lwaqt. » / « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, … Oran stop-desk: 400 DA,
  … Ma nwasslouch l Illizi f had lwaqt. » — the second after the guard `stripped` a Moroccan form (`remaining [moroccan_darija]`), the exact
  R16-1 path, with every quoted fee kept; N16 « … ma nwasslouch l Illizi f had lwaqt. »; no unrelated `search_products`. Left: the unrelated
  closing « T7ebb nchouf wach men produit ? » / « T7ebb nwarrik wach kayen 3andna ? » → R17-5.
- RETEST R16-2: fixed — W1 « Pour le prix de gros, l'équipe de la boutique va vous répondre. » (platform hand-off, 0 tool call, 2.6 s; R16 the
  model's refusal « Je ne peux pas vous donner de prix de gros ici. … », 6.4 s); W1b (J03, out of hours) « Pour le prix de gros, l'équipe de la
  boutique est absente pour le moment, elle vous répondra dès l'ouverture. »; C2 through the model's own `handoff_to_human {refund}` → « Sme7li
  3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement. ». New in the family: a wrong model hand-off accepted and given
  the reason's sentence on a place message (PF1) → R17-1.
- RETEST R16-3: mostly fixed — N1 T2 one call (R16 three), N14 T1 one call (R16 two), PF1 T2 no re-quote of T1's Sétif, F9 no unrelated
  search, F1b T2 one quote. Left: N5 T2 two searches before the recap, PF1 T2 a `create_order` without an address → R17-6.
- RETEST R16-4: partly fixed — C2 « Sme7li 3la had lmochkil, … » (no double space); F1b T2 « … Vous préférez être livré à domicile (donnez-moi
  la rue ou la cité) ou en stop-desk ? » (stop-desk once, R16 twice); F1 T1 / N4 T1 « … Pour préparer votre commande, quel est votre nom ? »
  (R16 « Souhaitez-vous le commander ? … » / « Je note 1 tapis pour vous »); N18 T1 « … واش سميتك باش نسجلوها لك؟ » (name asked; R16 « واش تحب
  نسجلو لك؟ وواش سميتك؟ »). Left: N21 T1 « واش تحب نسجلوه ليك؟ », A1 T1 « تحب نجهزلك واحد ؟ », A3 T1 « تسجلت الطلب » (now a registered claim),
  F1b T1 « on le prépare pour vous » → R17-4; French inside arabizi and the guard still stripping Moroccan forms → R17-5.
- R1–R15 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 22 orders**; one order per « oui »: 22 orders,
  never two for one « oui », **one « oui » to a server recap lost (N5 T3 → R17-2)**; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new
  recap; N7 T2 « oui » to no recap → no order; R4-1 / R11-2 / R13-1 (no hand-off on an order / field / yes message, nor for a product sold or
  not sold) **fails once — PF1 T1 (→ R17-1)**; R14-3 (every real hand-off accepted) holds — 4 / 4 + F11 (server); R4-2 (a name in another
  script keeps the language) holds — N4, F3, N18; R14-1 (language kept) holds — 32 / 32; R4-4 / R6-1 (no model sentence asking to confirm in
  front of the recap) holds — 28 / 28; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) **fails twice — N5 T3 (→ R17-2), A3
  T1 (→ R17-4)**; R4-8 (blocked sentence) holds — F11; R5-1 (in-stock alternatives only) **fails once — N7 Montre connectée (→ R17-3)**, holds
  for N5, P2, N9; R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×2); R5-4 (no « home or stop-desk ? » after a street) holds — F1b /
  PF1 asked it before any street; R5-5 / R7-5 (delivery question answered with the fee) holds — F9, F9b, N16, F12, N3; R5-6 (no `create_order`
  before a phone) holds — 0 / 52; R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 28 / 28; R7-2 (no photo said) holds — N9;
  no invented discount (catalogue old prices Hijab 2000, Djellaba 9000; Oran free delivery only from 20 000 DA — N5 24 990 DA free, N1 / N23
  6 900 / 7 500 DA paid); N11 tracking from `lookup_order`, no invented number or date; R8-3 (named variant) holds; R9-1 (Latin name in an
  Arabic chat) holds — N18; R10-1 (latency) — server max 11.9 s, 1 server turn ≥ 10 s (N23 T2 → R17-6); R11-5 (no provider error) holds — 0 /
  96; R12-1 (no `VALIDATION wilayaId`) holds — the one refusal is `address` (PF1 T2); R13-3 (Arabic street kept) holds — N11, N18, N21, N25, A1,
  A3; R13-5 (substitute line) holds — N5 « … à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. »; R15-1 (price and both fees
  before the address question) holds for F5 and F1b, **not for PF1 (→ R17-1)**; R15 fees — every fee said matches the shop's settings (96 / 96
  turns, none missing).

## Coverage
- Order flows to « oui »: French ×10 (PF1, N5, F1, F1b, F6, N1, N4, N12, N14, N17; F11 blocked), Arabic-script darija ×6 (N11, N18, N21,
  N25, A1, A3), arabizi ×6 (P2, N9, F3, N23, N3 after a switch, F5 mixed fr / arabizi on the shared link); no order, rightly: N7 (nothing
  chosen, now with its « oui »), F9, F9b, N16, F12 (delivery questions only), C2, H1, W1, W1b (team).
- Asked this round: F9 ×2 (J04, J03), N16 alone, W1 ×2 (J04, J03 out of hours), PF1, N1, N14, N5 with tool calls per turn, the booking-question
  turns (F1b, N21, and F1 / N4 / N18 / A1 / A3 T1), N7 with its « oui », N12 with « ? » and « ... », the sweep F1, F3, F5, F6, F11, F12, H1,
  C2, N3, N4, N9, N11, N17, N18, N23, N25, P2, A1, A3; latency of every turn; every fee against the shop's delivery settings.
- Also: « oui mais … » in three scripts (N17, N23, N25), a cancel after the order (N14, simulated), a wilaya not served (F9 ×2, N16), the
  free-delivery threshold reached (N5 Oran 24 990 DA → « gratuite ») and not reached (N1, N23 Oran 600 DA), a blocked number (F11), an
  out-of-hours shop (J03: W1b, PF1 wording), photo request (N9), Arabic-Indic digits (A3).
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout; shared link valid (no probe needed: F5 / F12 answered).

## Not tested
- H2 and C1 (Arabic-script person request, French complaint out of hours) and PF2 / F5b were not re-run (passed in R16; not in this round's
  list); an `angry` hand-off; a J04 conversation inside opening hours.
- A « yes » sent to the Arabic-script offer questions of R17-4 (N21 T1, A1 T1) — the flows went on with the field each message carried.
- The shared link beyond F5 / F12 (the visitor response has no tool calls; they were read from `AiToolCall`).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`). The live Messenger path (no page
  connected), so the effect of PF1's wrong hand-off on a real conversation (inbox assignment, AI paused) and the real hand-offs of C2 / H1 / W1
  were not seen.
- F6, N1, N14, N17, N23, N25 with their fields one per message; `cancel_order` / `lookup_order` on a real order with a courier and a tracking
  number; a product that HAS photos in a photo request; the stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-3157 (N5), TEST-6619 (N21), TEST-9479 (N12), TEST-6890 (F5, N9), TEST-4074
  (N11), TEST-8063 (N17), TEST-7995 (N25), TEST-1158 (P2), TEST-7041 (A1), TEST-6293 (PF1, F1, F1b), TEST-1605 (N1), TEST-1692 (N14 — then
  cancelled, simulated), TEST-5998 (F3), TEST-2340 (F6), TEST-1310 (N3), TEST-8384 (N4), TEST-8849 (N18), TEST-5687 (N23), TEST-2857 (A3);
  F11 refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (F5 / N9, PF1 / F1 / F1b; R16's TEST-6890, TEST-9479,
  TEST-4074, TEST-8063, TEST-6619, TEST-1158, TEST-6293, TEST-1692, TEST-5998, TEST-1310, TEST-8849, TEST-5687 again); a confirming call that
  rewords the address gets another number for the same stored draft (N25, A1, A3).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:playground:*` and `rl:agent-test-message:*` count / TTL,
  `DeliveryFeeRule`, `Product` and `ProductVariant` rows of both shops, `AiRun` rows since 03:35 UTC (out/airun.txt), `AiToolCall` rows
  (out/toolcalls.txt), API « playground turn answered » lines (out/api-lines.txt); nothing written.
- Hour counters (read-only): before the run J04 no key, J03 49 / 60 (TTL 245 s, expired before 04:41:53); after the run J04 46 / 60 (window
  from 04:35:57), J03 50 / 60 (window from 04:41:53); no 429. Messages used: 96 / 100.
