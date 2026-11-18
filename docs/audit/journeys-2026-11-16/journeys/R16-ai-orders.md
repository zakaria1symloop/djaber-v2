# R16 — Sixteenth retest of the AI order-taking (after the R15 fixes) — live site, deployed commit 8a1fade — 18/11/2026 03:32–03:46 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 8a1fade (checked read-only: `git log --oneline -1` = « 8a1fade fix(ai): live retest R15 — a
first place gets price and both fees before the address question, one hand-off sentence per reason in the customer's script, out-of-hours
wording, more lookup dedupe, wording fixes »; `djaber-v2-api` / `djaber-v2-worker` online, restarted 03:29). Same two own shops as R1–R15:
« Boutique de Nassim » (J03 shop, « Agent J03 Vendeur », default language FR) and « Boutique de Karima » (J04 shop, « Agent J04 », preset
Vendeur Pro). Surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and, for F5 ×2 / F12, the J04 shared test link
(`/agent-test/<token>`, no tool calls in the visitor response — the tool calls were read server side, read-only, from `AiToolCall`). The R7
links were still valid — probe without a message at 03:31: « Lien valable jusqu'au 18 nov. 2026 18:04 », so no new link was made. One
browser at a time, the runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place (F11). The
60 / h counters (the shared link counts in the same budget) were read before the run (read-only, Redis `rl:playground:*`, 03:30): J04 49
(TTL 5 s), J03 50 (TTL 382 s), so each shop's run started once its key had expired (J04 03:32:26, J03 03:39:03). J04 flows
03:32:26–03:39:02, J03 flows 03:39:03–03:45:42. No 429. Both shops were outside their opening hours: the J03 conversations start with the
shop's « out_of_hours » system line (configured text, not an AI reply); the J04 shop shows no such line.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops), used to check every fee:** Alger 400 home / 250 stop-desk,
Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (home free from 20 000 DA), Illizi 1 500 / 1 000 inactive (not
served). J04 stock (read-only): Parfum Oud 50 ml 0, Coffret cadeau Aïd 4, Hijab soie 20.

**Latency method (as R11–R15).** `conv.mjs` of R15 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » log lines (`runMs`, `waitMs`, `totalMs`, `replayed`), the nginx access lines for the two
slow F1 turns, and the `AiRun` rows (`latencyMs`, `status`, `flags`, `meta.guard`, `meta.language`, `meta.turn`) + `AiToolCall` rows. No
stall / dup probe. (The VPS clock runs ~2 s ahead of the test PC.)

**100 customer messages** (J04 shop 51, J03 shop 49; budget 100), 33 conversations, 30 on the playground and 3 on the shared link: priority
1 — F5 ×2 on the shared link (the exact R15 messages), two place-first flows (PF1 fr: the wilaya + commune alone, then the product; PF2
arabizi: the place then the product in one first message), H1, H2, C1, C2, W1, N5 (price asked), F3 (street as typed), P2; priority 2 — the
sweep F1, F1b, F6, F9, F11, F12, N1, N3, N4, N7, N9, N11, N12, N14, N17, N18, N21, N23, N25, A1, A3, with each field in its own message where
the flow allows it (F1, F3, N4, N18, N21, A1 name / phone / address; PF1, PF2, N12 place or name apart). To stay in the budget: N16
(« tawsil l Illizi ? ») is folded into F9 (same Illizi question, arabizi), N7 stops after its first message (no « oui »), N12 has no « ... »
turn. Flows stop at the order (`untilOrder`), so no « oui » was spent after an order. No guarded extra message, no re-send by the script.
Scripts `.local/qa/journeys/R16/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs, lat-table.cjs, server.sh = read-only `AiRun` query,
tools.sh = read-only `AiToolCall` query, probe-link.mjs, waitkey.sh, run.sh, all.sh), transcripts
`.local/qa/journeys/R16/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs `.local/qa/journeys/R16/out/run1.log` (J04),
`run2.log` (J03), `airun.txt`, `toolcalls.txt`, `api-lines.txt`, `join.txt` (turn ↔ `AiRun`), rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r16/`.

Cases asked for this round:
- **R15-1**: F5 ×2 on the shared link and two place-first playground flows ⇒ price and both fees before the address question.
- **R15-2**: H1, H2, C1, C2, W1 — one sentence per reason, in the customer's script, out-of-hours wording (no « très vite » after « absente »).
- **R15-3 / R15-4**: N5 (the asked price of the unavailable product), F3 (street as typed), P2; redundant lookups in the sweep.
- The sweep with fields one per message; latency per turn with `Server-Timing`; every R1–R15 guarantee (no order without a server recap —
  Critical; one order per « oui »; a « oui » with a change gives a new recap; no `create_order` before a phone; no confirm question /
  registered claim without a server recap; no wrong hand-off and every real one accepted; language and script kept; no invented discount;
  tracking real; address street, commune, wilaya; fees never wrong).

**Result: 31 / 33 conversations pass** — priority 1: 11 / 12 (F5 ×2, PF1, PF2, H1, H2, C1, C2, N5, F3, P2 pass; **W1 fails, R16-2**), sweep
20 / 21 (**F9 fails, R16-1**). **R15-1 fixed: F5 twice on the shared link with the exact R15 messages — T1 « … b 4900 DA. Tawsil: 400 DA l
dar, wela 250 DA f stop-desk … a3tini l'adresse … » (R15: street asked with no price, fee or stop-desk), each time from a `quote_delivery`;
PF1 « j'habite à Sétif, El Eulma » → 650 / 350 at once, then price + both fees before the address question; PF2 « ana men Blida, Boufarik.
nheb hijab soie » → 1500 DA + 450 / 300 before the name.** **R15-2 fixed on four of five: H1 « Bien sûr, je vous mets en relation avec
l'équipe de la boutique. », H2 « أكيد، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو. », C1 « Désolé pour ce problème : l'équipe de la
boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture. », C2 arabizi « … L'équipe ta3 lboutique rah
tchouf m3ak le remboursement. »; no « très vite » / « قريبًا » line after an out-of-hours line, no Arabic-script hand-off line for the arabizi
customer. Left: W1 went through the model's own `handoff_to_human`, and its text is the model's refusal with no word on the team (R16-2).**
**R15-4 items fixed: N5 gives the Oud's price (3 200 DA), F5 T3 « oui c'est bon » confirmed in arabizi, F3 / PF2 / N23 street exactly as
typed.** **R15-3 partly fixed: F1b T2 one quote (R15 two), N4 T1 no `get_product`; left: re-quotes and an availability check before a recap
call, a second search (R16-3).** **Latency: median 5.2 s, p90 7.6 s; server median 4.9 s, p90 7.2 s, max 9.4 s (A3 T2); 2 page times above
10 s, both F1 (T2 12.8 s / server 3.7 s, T3 19.5 s / server replay) — a network stall between the VPS and the test PC, the turn key replay
held (one run, no duplicate); `Server-Timing` on 100 / 100 answers; page − server median 0.21 s, max 0.30 s outside F1 T2; 0 provider
error.** **0 order without a server recap; 24 TEST orders, each from a « oui / ih / ايه / 👍 / oui c'est bon / oui, c'est bien … » to a server
recap, exactly one each; F11 « oui » refused as blocked; 3 « yes » with a change (N17 fr, N23 arabizi, N25 Arabic script) → a new recap, 0
order; 0 `create_order` before a phone in 55 calls; 0 wrong fee in 100 turns.** Failures — one Minor: a three-wilaya delivery question lost
its Oran answer when the guard stripped a Moroccan sentence (F9, R16-1); one Cosmetic: W1 (R16-2). Issues: redundant lookups (R16-3),
wording left (R16-4).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| PF1 | J03 · playground | fr, place alone then product | T1 650 / 350; T2 6900 DA + both fees + address or stop-desk → recap → TEST-6293 7 550 DA | T2 6.6 s / 6.3 s | yes, 1 | PASS (R15-1) |
| PF2 | J04 · playground | arabizi, place then product in T1 | T1 1500 DA + 450 / 300 → name, street → recap « cite 20 aout villa 3 » → TEST-9884 | T1 6.7 s / 6.4 s | yes, 1 | PASS (R15-1) |
| F5 | J04 · shared link | fr / arabizi mixed | T1 4900 DA + 400 / 250 + address question; arabizi recap → arabizi confirmation TEST-6890 | T1 6.6 s / 6.3 s | yes, 1 | PASS (R15-1) |
| F5b | J04 · shared link | fr / arabizi mixed (re-run) | same, T1 asks home or stop-desk too → TEST-6890 in arabizi | T1 5.4 s / 5.2 s | yes, 1 | PASS (R15-1) |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | HANDOFF `customer_request`, « Bien sûr, je vous mets en relation … » | T1 1.7 s / 1.5 s | — (team) | PASS (R15-2) |
| H2 | J03 · playground | Arabic script, a person asked, out of hours | HANDOFF `customer_request`, « … ماهوش متوفر درك، راح يجاوبك كي نفتحو » | T1 2.4 s / 2.1 s | — (team) | PASS (R15-2) |
| C1 | J03 · playground | fr, broken order + refund, out of hours | HANDOFF `refund`, « Désolé … absente … dès l'ouverture » | T1 3.3 s / 3.0 s | — (team) | PASS (R15-2) |
| C2 | J04 · playground | arabizi, broken order + refund | HANDOFF `refund`, arabizi sentence, no Arabic-script line | T1 3.2 s / 3.0 s | — (team) | PASS (R15-2) |
| W1 | J04 · playground | fr, wholesale | HANDOFF `off_catalogue` by the model; « Je ne peux pas vous donner de prix de gros ici. Pour info … » | T1 6.4 s / 6.2 s | — (team) | FAIL — R16-2 |
| N5 | J04 · playground | fr, out of stock « c'est combien ? » | Oud 3200 DA said + unavailable; Hijab substitute → server line + recap → TEST-7864 2 100 DA | T1 7.7 s / 7.5 s | yes, 1 | PASS (R15-4) |
| F3 | J03 · playground | arabizi, fields one per message | « وليد بوزيد » kept, street « cite 20 aout villa 3 » as typed → TEST-5998 6 050 DA | T4 6.6 s / 6.5 s | yes, 1 | PASS (R15-4) |
| P2 | J04 · playground | arabizi « nheb … » | arabizi recap and confirmation → TEST-1158 5 300 DA | T3 5.9 s / 5.7 s | yes, 1 | PASS |
| F1 | J03 · playground | fr, fields one per message | recap « (Marron) » → « oui » → TEST-1506 7 550 DA | **T3 19.5 s / replay** (T2 12.8 s / 3.7 s) — network | yes, 1 | PASS |
| F1b | J03 · playground | fr, fields over 3 messages | T2 one quote, both fees + address / stop-desk → recap → TEST-6293 | T1 7.8 s / 7.6 s | yes, 1 | PASS (R15-3) |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2670 9 100 DA | T2 6.7 s / 6.4 s | yes, 1 | PASS |
| F9 | J04 · playground | arabizi, 3 delivery questions (+ N16) | Sétif 650 / 350, Illizi not served; **Oran stop-desk not answered**; « T7ebb nwarrik produit … ? » | T1 7.2 s / 7.0 s | — | FAIL — R16-1 |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider … » | T2 6.4 s / 6.2 s | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « on livre à Blida ! … 450 DA, ou en stop-desk : 300 DA » | T1 2.5 s / 2.3 s | — | PASS |
| N1 | J03 · playground | fr, product + wilaya change | new recap « (Marron) » Oran → « oui » → TEST-5759 7 500 DA | T2 7.8 s / 7.6 s | yes, 1 | PASS (R16-3) |
| N3 | J03 · playground | fr → arabizi at T2 | both fees + arabizi recap → « ih saha » → TEST-1310 6 300 DA | T2 6.2 s / 6.0 s | yes, 1 | PASS |
| N4 | J03 · playground | fr, name in Arabic script alone | French kept, « سمير بن علي » kept, no `get_product` → TEST-1344 3 250 DA | T5 5.1 s / 4.9 s | yes, 1 | PASS (R15-3) |
| N7 | J03 · playground | fr, product not sold + details | « nous n'avons pas de lunettes … » + 2 in-stock products | T1 6.6 s / 6.3 s | no (right: nothing chosen) | PASS |
| N9 | J04 · playground | arabizi, photo + details | no tool, « Ma 3andnach tsawer »; recap (M) → TEST-6890 | T3 6.8 s / 6.6 s | yes, 1 | PASS |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; T3 `lookup_order` only, no tracking, none invented | T2 6.4 s / 6.2 s | yes, 1 | PASS |
| N12 | J04 · playground | fr, « ? » | question repeated; recap → « 👍 » → TEST-9479 1 950 DA | T4 5.6 s / 5.4 s | yes, 1 | PASS |
| N14 | J03 · playground | fr, cancel after the order | TEST-1692 → « non annule » → « … a bien été annulée » | T1 6.8 s / 6.5 s | yes, 1 (then cancelled) | PASS (R16-3) |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 8.2 s / 8.0 s | yes, 1 | PASS |
| N18 | J03 · playground | Arabic script, Latin name alone | « Samir Benali » kept → « ايه » → TEST-8849 8 200 دج | T1 8.4 s / 8.1 s | yes, 1 | PASS (R16-4) |
| N21 | J04 · playground | Arabic script, fields one per message, 👍 | recap → « 👍 » → TEST-6619 1 950 دج | T1 6.5 s / 6.2 s | yes, 1 | PASS (R16-4) |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-5687 | T2 8.0 s / 7.9 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-6971 | T2 7.5 s / 7.2 s | yes, 1 | PASS |
| A1 | J04 · playground | Arabic script, fields one per message | recap Alger → « ايه » → TEST-4104 1 900 دج | T5 5.0 s / 4.8 s | yes, 1 | PASS |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | recap « …، الخروب، قسنطينة » → « ايه » → TEST-5126 6 300 دج | **T2 9.6 s / 9.4 s** (slowest server) | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **24 / 24** (PF1, PF2, F5, F5b, N5, F3, P2, F1, F1b, F6, N1, N3,
  N4, N9, N11, N12, N14, N17, N18, N21, N23, N25, A1, A3) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.** **« oui » to
  a correct recap lost: 0.** One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N23 wilaya, N25
  quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 1 / 1** — N5 T3 (a « oui » to « Voulez-vous le prendre ? » → the
  substitute's recap, no order; T4 « oui » → TEST-7864). (N7's « oui » not sent this round.)
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr « oui mais livrez à Alger … » → Alger 400 DA, 1 900 DA, core
  f4cd80…), N23 T2 (arabizi « ih bessah wasslouha l Oran … » → Oran 600 DA, 8 100 DA, core e3d489…), N25 T2 (Arabic script « ايه بصح ديرلي
  جوج ماشي واحد » → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new recap's content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **5 / 5** — F1 (confirming street « …, El Eulma,
  Sétif »), F1b (recap call « …, El Eulma » / confirming street only), N3 (« …, El Khroub »), N14 (recap call « Cité 20 août, villa 3 » /
  confirming « cité 20 août villa 3 »), N21 (recap call the whole place / confirming street only).
- **Confirming calls refused: 0** — the 24 confirming calls + F11 carried name, phone, wilaya, commune, address, items and
  `customerConfirmed true`. **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 55 `create_order` calls.**
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **30 / 30**, the named variant every
  time (PF1, F1, F1b, N1 Marron; P2 S, F5 ×2 / N9 M); **in the customer's language 30 / 30** — Arabic script 7 (N11, N21, N25 ×2, A1, N18,
  A3), arabizi 9 (PF2, F5, F5b, P2, N9, F3, N3, N23 ×2), French 14.
- **Server recap without a model sentence asking to confirm or describing the order: 30 / 30** — lead-ins left: N3 « Ih, nwasslou l
  Constantine. Tawsil l dar 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. » (the answer to « twasslou l Constantine ? ») and N5's
  server line. **Outside any recap: 0** model turn claiming an order; the guard rewrote / stripped `confirm_without_recap` three times
  before sending (N21 T1, A1 T1, N18 T1); offer questions left (« Souhaitez-vous le commander ? Si oui, dites-moi votre nom », F1 T1;
  « تحب نحجزلك واحد؟ », N21 T1; « واش تحب نسجلو لك؟ », N18 T1 — R16-4) and item-noted lines (« Je note 1 tapis pour vous », N4 T1;
  « سجلت زوج Tapis de prière », A3 T1) name a product, not an order — a « yes » to them asks the next field.
- **Recap address « street, commune, wilaya »: 30 / 30** — A3 no separator, A1 / N21 / N25 « ، », N18 Latin name, the model's whole-place
  `address` (F1b, N21, N23 T1) → commune and wilaya once, at the end. **Street as the customer wrote it: 30 / 30** (PF2 / F3 « cite 20 aout
  villa 3 », N23 « cite 500 logements bloc 12 » although the recap call sent « Cité 500 … », N14 « cité 20 août villa 3 » although the call
  sent « Cité 20 août, villa 3 »; first-letter capitals not counted, as R14 / R15). R15: 28 / 29.
- **Fees never wrong: 100 / 100 turns** — every fee said or recapped matches the shop's rules above (Alger 400 / 250, Blida 450 / 300,
  Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400, Oran home under 20 000 DA paid — N5 2 100 DA, Illizi not served); one fee missing
  (F9 Oran stop-desk — R16-1).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3 (« الهاتف: 0550123456 »).
- **Customer's name as written: 33 / 33 conversations** — Arabic script kept in French / arabizi chats (N4 « سمير بن علي » sent alone, F3
  « وليد بوزيد »), Latin kept in an Arabic chat (N18 « Samir Benali » sent alone); 0 name asked again once given.
- **Photo request answered « no photo »: 1 / 1** — N9; photo announced without a photo: 0.
- **Delivery question answered with the fee: 3 / 4** — F12 on the link (Blida 450 / 300), N3 (Constantine both fees), PF1 T1 (Sétif
  both fees, no product yet); **F9: Sétif and Illizi answered, Oran stop-desk not (R16-1)**. **Place known, no street → price and both fees
  before the address / mode question: 6 / 6** — F5, F5b (shared link), PF1, PF2, F1b, N3 (R15: 2 / 3).
- **`create_order` before a phone is in the customer's messages: 0 / 55 calls.**
- **Hand-offs: 5 / 5 real ones accepted, 0 wrong** — C1 / C2 (`refund`), H1 / H2 (`customer_request`), W1 (`off_catalogue`); H1, H2, C2
  decided by the platform with 0 tool call, C1 and W1 by the model's own `handoff_to_human` (2 calls, both accepted, 0 refused); F11's is the
  server's (`CUSTOMER_BLOCKED`). **AI sentence for the reason, in the customer's script, out-of-hours aware: 4 / 5** (W1 no — R16-2). No
  hand-off for a product sold (P2, F1, PF1 …), not sold (N7), a photo request (N9), a tracking question (N11), a field or yes message.
- **No 503 / provider error: 100 / 100 turns**; `AiRun` 100 rows, 94 `ok` + 6 `handoff` (H1, C2, W1, F11 T2, H2, C1), 0 `error`, 0 fallback,
  `attempt` 1 everywhere; 11 runs carry a reply-guard retry (`guard_rewritten` 5 — F5 T1 language_switch, N21 T1 / N18 T1
  confirm_without_recap, A1 T2 / N4 T2 repeat_greeting; `guard_kept` 3 — F5b T1, P2 T1, F3 T1 language_switch kept; `guard_enforced` 3 —
  F9 T1 moroccan_darija + fee_missing stripped, N9 T1 moroccan_darija stripped, A1 T1 confirm_without_recap stripped).
- Latency: **median 5.2 s, p90 7.6 s, max 19.5 s on 100 turns** (F1 T3 19.5 s / server replay 8 ms, F1 T2 12.8 s / 3.7 s, A3 T2 9.6 / 9.4 s,
  N18 T1 8.4 / 8.1 s, N17 T2 8.2 / 8.0 s, N23 T2 8.0 / 7.9 s); page median J04 5.3 s, J03 5.1 s; **server (`Server-Timing` total) median
  4.9 s, p90 7.2 s, max 9.4 s**; `AiRun` max 9.35 s; API « playground turn answered » lines: 101 since 03:32 (100 turns + the F1 T3 replay),
  `waitMs − runMs` max 101 ms, 0 « did not finish »; 1 POST per turn seen by the page (F1 T3's first send was retried by the browser on its
  own — the request started 19.3 s after the click and got the server's `replay`); page − server median 0.21 s, max 0.30 s outside F1 T2
  (8.8 s: the response left nginx at ~02:40:40 VPS − 2 s and reached the page at 02:40:50). 6 turns ≥ 8 s on the page, 2 ≥ 10 s (both F1,
  network); 0 turn ≥ 10 s on the server (R15: page max 9.8 s).
- Quantity never asked again after a product is named: **0 quantity question in 100 turns** (« 1 seul », « 2 pièces », « zoudj », « زوج »,
  « 3 tapis au lieu de 2 », « ديرلي جوج », « واحد » kept).
- Language kept: arabizi **10 / 10** (PF2, F5, F5b, P2, N9, C2, F9, F3, N23, N3 after the switch), Arabic-script darija **7 / 7** (N11,
  N21, N25, A1, H2, N18, A3), French **16 / 16**; F5 / F5b T3 « oui c'est bon » (French words) confirmed in arabizi after the arabizi recap
  (R15: French).
- **No Tunisian / Moroccan words sent: 33 / 33** — check.cjs word list: 0 hit; the guard stripped a Moroccan form in 2 replies (F9 T1, N9
  T1) before they were sent (R15: 4).
- Out-of-stock product offered: **0** — N5 names the Parfum Oud only because the customer asked for it (and gives its price); P2 / N9 list
  S, M, XL only; N7 lists in-stock products.
- No Markdown in a reply: **100 / 100**. No invented discount: only the catalogue's old prices (Hijab « kan 2000 DA » / « au lieu de
  2000 DA », N18 « بدل 9000 دج »).
- Tool calls in 100 turns (`AiToolCall`, playground and link): `create_order` 55 (30 recaps + 24 orders + 1 blocked), `quote_delivery` 13,
  `search_products` 9, `lookup_order` 2 (N11 tracking, N14 before the cancel), `cancel_order` 1 (N14, asked), `check_availability` 1 (N1),
  **`handoff_to_human` 2 (C1, W1 — both accepted)**, `get_product` 0, `add_faq_candidate` 0; **0 search after a recap call in 30 recaps**.

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line. Shared-link turns (F5, F5b, F12) carry no tool calls, cards' photos or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### PF1 — J03 playground (UI fr)
**Verdict: PASS (R15-1, place first, playground, fr) — T1 « j'habite à Sétif, El Eulma » alone → `quote_delivery {Sétif}` → « 650 DA à domicile, ou 350 DA en stop-desk … Quel article vous intéresse ? »; T2 product + name + phone → « … disponible, à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. … quelle est votre adresse à El Eulma …, ou préférez-vous le stop-desk ? » — price and both fees before the address question; T3 recap; T4 « oui » → TEST-6293 7 550 DA. T2 quotes Sétif again (already quoted in T1 — R16-3).**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 5.8 s (server 5.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci pour l'info ! Nous livrons à El Eulma (Sétif) : 650 DA à domicile, ou 350 DA en stop-desk, délai de 2 à 5 jours. Quel article vous intéresse ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 6.6 s (server 6.3 s)
  - AI: « Merci Karim, c'est noté ! Le sac à main cuir Marron est disponible, à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. Pour la livraison, quelle est votre adresse à El Eulma (rue, cité ou repère), ou préférez-vous le stop-desk ? »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 4.3 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.5 s (server 4.2 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### PF2 — J04 playground (UI fr)
**Verdict: PASS (R15-1, place first in the first message, playground, arabizi) — T1 « ana men Blida, Boufarik. nheb hijab soie » → `quote_delivery {Blida}` + search → « Hijab soie … b 1500 DA (kan 2000 DA). Tawsil l Blida: 450 DA l dar, wela 300 DA f stop-desk … Wach smitek ? »; T2 street asked; T3 recap with the street as typed « cite 20 aout villa 3 »; T4 « ih » → TEST-9884 1 950 DA, arabizi on every turn.**

- **T1** C: « salam, ana men Blida, Boufarik. nheb hijab soie » · `arabizi` · 6.7 s (server 6.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hijab soie 180 x 70 cm, disponible b 1500 DA (kan 2000 DA). Tawsil l Blida: 450 DA l dar, wela 300 DA f stop-desk, ywasel f 2 l 5 ayam. Wach smitek ? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « Nadia Kaci 0661234568 » · `arabizi` · 3.9 s (server 3.6 s)
  - AI: « Saha Nadia, tsajjel. A3tini l'adresse ta3ek f Boufarik (rue, cité, numéro ta3 dar, wela blassa ma3roufa 9rib). »
- **T3** C: « cite 20 aout villa 3 » · `arabizi` · 5.9 s (server 5.7 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 1 950 DA, tkhalles ki tewsel. ⏎ Smitek: Nadia Kaci ⏎ Numéro: 0661234568 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T4** C: « ih » · `arabizi` · 5.8 s (server 5.5 s)
  - AI: « Commande ta3ek TEST-9884 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 450 DA ⏎ Total: 1 950 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9884, total 1950`

### F5 — J04 shared link (UI fr)
**Verdict: PASS (R15-1 fixed, shared link, run 1 of 2, the exact R15 messages) — T1 « Robe kabyle brodée taille M kayna, b 4900 DA. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. … a3tini l'adresse ta3ek … ? » (R15: street asked with no price / fee / stop-desk); T2 arabizi recap; T3 « oui c'est bon » → « Commande ta3ek TEST-6890 tsajlet ✅ … » in arabizi (R15: French — the R15-4 item is fixed). Server rows (read-only `AiToolCall`): T1 `quote_delivery {wilayaId 16} → fee 400, stopdeskFee 250` (the guard rewrote a language switch, `AiRun` 01a1ec7f-a5d9…) · T2 `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1} → CONFIRMATION_REQUIRED` · T3 same call → `ok`, core 39a4a2….**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 6.6 s (server 6.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykoum salam Amina ! Robe kabyle brodée taille M kayna, b 4900 DA. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Bach nwasslou l commande l Bab Ezzouar, a3tini l'adresse ta3ek (rue, cité, bâtiment wela blassa ma3roufa 9rib) ? »
- **T2** C: « rue des frères Bouadou n 5 » · 4.4 s (server 4.3 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 6.3 s (server 6.1 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F5b — J04 shared link (UI fr)
**Verdict: PASS (R15-1 fixed, shared link, run 2 of 2, same messages) — T1 « … est disponible b 4900 DA. L dar: 400 DA, f stop-desk: 250 DA. Wach t7ebb nwasslouha l dar wela f stop-desk ? A3tini ghir l'adresse … » (`quote_delivery {16}`; the guard kept a French / arabizi mix, `language_switch` remaining, close to the customer's own mixed message); T2 recap; T3 « oui c'est bon » → TEST-6890 in arabizi. Server rows as F5 (`AiRun` 01a1ec7f-fc8f…, 01a1ec80-13f8…, 01a1ec80-2a50…).**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 5.4 s (server 5.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Merci Amina, tsajjel! La robe kabyle brodée taille M est disponible b 4900 DA. L dar: 400 DA, f stop-desk: 250 DA. Wach t7ebb nwasslouha l dar wela f stop-desk ? A3tini ghir l'adresse ta3ek (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib). »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « rue des frères Bouadou n 5 » · 5.1 s (server 4.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 4.6 s (server 4.4 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### H1 — J04 playground (UI fr)
**Verdict: PASS (R15-2 fixed, real request for a person, fr) — HANDOFF `customer_request`, 0 tool call, 1.7 s; AI « Bien sûr, je vous mets en relation avec l'équipe de la boutique. » (R15: empty). J04 shows no out-of-hours line, so « … très vite » stands alone.**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 1.7 s (server 1.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »

### H2 — J03 playground (UI ar)
**Verdict: PASS (R15-2 fixed, real request for a person, Arabic script, J03 out of hours) — HANDOFF `customer_request`, 0 tool call; AI « أكيد، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو. » (R15: empty, then « … ليرد عليك قريبًا » after the out-of-hours line); the « قريبًا » hand-off line is no longer sent after « فريقنا غير متاح حاليًا ».**

- **T1** C: « السلام، نحب نهدر مع واحد من الفريق تاعكم » · `ar` · 2.4 s (server 2.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « أكيد، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو. »

### C1 — J03 playground (UI fr)
**Verdict: PASS (R15-2 fixed, real complaint, fr, J03 out of hours) — HANDOFF `refund` (here from the model's own `handoff_to_human {refund}`, accepted); AI « Désolé pour ce problème : l'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture. » — one sentence on the reason, out-of-hours wording, no « très vite » line after « absente » (R15: a generic sentence + « très vite »).**

- **T1** C: « Bonjour, j'ai reçu ma commande cassée, je veux un remboursement » · `fr` · 3.3 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé pour ce problème : l'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture. »
  - tools: `handoff_to_human {refund, evidence «j'ai reçu ma commande cassée, je veux un remboursement»} → ok`

### C2 — J04 playground (UI fr)
**Verdict: PASS (R15-2 fixed, real complaint, arabizi) — HANDOFF `refund`, 0 tool call; AI « Salam, smahli 3lik  3la had lmochkil. L'équipe ta3 lboutique rah tchouf m3ak le remboursement. » in arabizi; the Arabic-script hand-off line « سأحوّلك … » is no longer sent to an arabizi customer. (Double space « 3lik  3la » — R16-4.)**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 3.2 s (server 3.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam, smahli 3lik  3la had lmochkil. L'équipe ta3 lboutique rah tchouf m3ak le remboursement. »

### W1 — J04 playground (UI fr)
**Verdict: FAIL — R16-2 (wholesale → team, fr) — HANDOFF `off_catalogue`, accepted, but from the model's own `handoff_to_human` (R15: the platform's, 0 tool call, 2.2 s → now 6.4 s); the AI text is the model's « Je ne peux pas vous donner de prix de gros ici. Pour info, le hijab soie est à 1500 DA l'unité (au lieu de 2000 DA). » — two sentences, a refusal, no word that the team will answer (only the system line says it); the per-reason sentence was not used.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 6.4 s (server 6.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas vous donner de prix de gros ici. Pour info, le hijab soie est à 1500 DA l'unité (au lieu de 2000 DA). »
  - tools: `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie»} → ok`

### N5 — J04 playground (UI fr)
**Verdict: PASS (R15-4 item fixed) — T1 « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment … Hijab soie à 1500 DA … » — the asked price is given; the substitute is now the Hijab soie (stock 20; R15 offered the Coffret, stock 4 — both in stock); T2 « je le prends » → the substitute asked, no recap (second `search_products {parfum}` — R16-3); T3 « oui » → server line « … à la place, ce récapitulatif est pour le produit Hijab soie. » + recap Oran home 600 DA (2 100 DA, under the 20 000 DA free threshold — right); T4 « oui » → TEST-7864 2 100 DA.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 7.7 s (server 7.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez un petit cadeau, nous avons le Hijab soie à 1500 DA (au lieu de 2000 DA), en soie douce, 180 x 70 cm. Voulez-vous que je vous en dise plus ? »
  - tools: `search_products {«parfum»} → 1 product(s)`
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 7.6 s (server 7.3 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous voulez un cadeau à la place, le Hijab soie est disponible à 1500 DA (au lieu de 2000 DA), en soie douce, 180 x 70 cm. Voulez-vous le prendre ? »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«parfum»} → 1 product(s)`
- **T3** C: « oui » · `fr` · 5.8 s (server 5.6 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Hijab soie. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft caa1f7… core 72d9fb…, recap total 2100`
- **T4** C: « oui » · `fr` · 4.6 s (server 4.4 s)
  - AI: « Votre commande TEST-7864 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-7864, total 2100`

### F3 — J03 playground (UI fr)
**Verdict: PASS (R15-4 item fixed, fields one per message, arabizi) — the Arabic-script name « وليد بوزيد » kept; recap street « cite 20 aout villa 3 » exactly as typed (R15 « Cité 20 Août, villa 3 »); T5 « ih » → TEST-5998 6 050 DA. T1: the guard kept a `language_switch` (« Tapis de prière — 2800 DA, molletonné, 120 x 70 cm » — catalogue words).**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 4.8 s (server 4.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Marhba bik ! Tapis de prière — 2800 DA, molletonné, 120 x 70 cm, w zouj tapis ykoun 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.4 s (server 2.1 s)
  - AI: « Saha Walid. A3tini numéro ta3ek (ex: 0555123456) bach nkamlou la commande. »
- **T3** C: « 0770112244 » · `arabizi` · 2.4 s (server 2.1 s)
  - AI: « Saha Walid, tsajjel. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 6.6 s (server 6.5 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih » · `arabizi` · 5.7 s (server 5.6 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### P2 — J04 playground (UI fr)
**Verdict: PASS (R14-1 guarantee) — arabizi on every turn, arabizi recap, « ih » → TEST-1158 5 300 DA; T1 « Rahi disponible en S w M b 4900 DA … (L makach disponible) ».**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 4.9 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam 👋 Robe kabyle brodée b lyedd, qmach khfif, mliha l l3rass w lmounasabat. Rahi disponible en S w M b 4900 DA, w en XL b 5200 DA (L makach disponible). Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.3 s (server 5.1 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 5.9 s (server 5.7 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### F1 — J03 playground (UI fr)
**Verdict: PASS (fields one per message) — name, phone, wilaya asked in turn; T4 recap « (Marron) » Sétif 650 DA; T5 « oui » → TEST-1506 7 550 DA. T2 12.8 s / server 3.7 s and T3 19.5 s / server replay 8 ms, the two slowest page times of the round: T2's response left nginx at ~02:40:40 and reached the page 8.8 s later; T3's first answer (run 4.3 s, `AiRun` 01a1ec87-4e01…, nginx 200 at ~02:40:55) never reached the page, so the browser re-sent the same request after 19.3 s (same `turnKey`) and got the stored answer (`replay`). One `AiRun`, no duplicate turn. Network path between the VPS and the test PC, not the server (see Latency).**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 7.0 s (server 6.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Bonne nouvelle, le sac à main cuir en marron est disponible 😊 Il coûte 6900 DA. Souhaitez-vous le commander ? Si oui, dites-moi votre nom pour commencer. »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)`
- **T2** C: « Karim Haddad » · `fr` · 12.8 s (server 3.7 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233 » · `fr` · 19.5 s (server replay, 8 ms; original run 4.3 s)
  - AI: « Merci Karim, votre numéro est bien noté. Dans quelle wilaya souhaitez-vous recevoir le sac ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 3.8 s (server 3.7 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 6.2 s (server 6.0 s)
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS (R14-2 guarantee, R15-3 item fixed) — T2 « Sétif, El Eulma » → one `quote_delivery` (R15: two) → « Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Quelle est votre adresse … ? Si vous préférez, on peut aussi vous livrer en stop-desk. » (stop-desk said twice — R16-4); T3 recap; T4 « oui, c'est bien … » → TEST-6293 7 550 DA.**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 7.8 s (server 7.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le Sac à main cuir en Marron est disponible à 6900 DA. Dans quelle wilaya souhaitez-vous être livré ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)`
- **T2** C: « Sétif, El Eulma » · `fr` · 7.5 s (server 7.3 s)
  - AI: « Parfait, Sétif, El Eulma c'est noté. Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Quelle est votre adresse de livraison (rue, cité, numéro de bâtiment ou point de repère) ? Si vous préférez, on peut aussi vous livrer en stop-desk. »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 5.7 s (server 5.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F6 — J03 playground (UI fr)
**Verdict: PASS — 2 → 3 tapis → new recap 9 100 DA; « oui » → TEST-2670.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 4.9 s (server 4.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 6.7 s (server 6.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 3.8 s (server 3.6 s)
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F9 — J04 playground (UI fr)
**Verdict: FAIL — R16-1 (three delivery questions, arabizi; N16's Illizi question folded in) — three `quote_delivery` calls (Sétif 650 / 350, Oran stop-desk 400, Illizi `WILAYA_NOT_SERVED`) + an unrelated `search_products {«Retouche couture»}`; the reply answers Sétif and Illizi only (the Oran stop-desk fee, 400 DA, is missing) and ends with « T7ebb nwarrik produit men les produits li 3andna ? » (the R14-4 closing is back). `AiRun` 01a1ec82-330b…: guard `moroccan_darija` + `fee_missing`, retried, then `stripped` with both still remaining.**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 7.2 s (server 7.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk. Illizi, ma nwasslouch l Illizi f had lwaqt, wallah. T7ebb nwarrik produit men les produits li 3andna ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `search_products {«Retouche couture»} → 1 product(s)`

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, « Je ne peux pas valider cette commande ici : l'équipe de la boutique va s'en occuper. », HANDOFF `risky_client` (server reason).**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 4.8 s (server 4.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 6.4 s (server 6.2 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link) — « Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. … » — server `quote_delivery {Blida} → fee 450 / stopdeskFee 300` (`AiToolCall`, read-only); check.cjs « DELIVERY-Q-NO-FEE » is the known false hit of its fee regex.**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.5 s (server 2.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Livraison à domicile : 450 DA, ou en stop-desk : 300 DA. Le délai est de 2 à 5 jours. Vous cherchez quelque chose en particulier ? »

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya + address change → new recap « (Marron) » Oran 600 DA; « oui » → TEST-5759 7 500 DA. T2 `quote_delivery {Oran}` + `check_availability` before the recap call (R16-3).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.1 s (server 4.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 7.8 s (server 7.6 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `check_availability {qty 1} → available true` · `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.3 s (server 5.1 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N3 — J03 playground (UI fr)
**Verdict: PASS — T2 switches to arabizi; « twasslou l Constantine ? » answered with both fees (700 / 450) then the arabizi recap; « ih saha » → TEST-1310 6 300 DA.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 3.1 s (server 2.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Samira, 2 tapis de prière molletonnés à 2800 DA chacun, soit 5600 DA au total. Dans quelle wilaya souhaitez-vous être livrée ? »
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 6.2 s (server 6.0 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 4.6 s (server 4.4 s)
  - AI: « Commande ta3ek TEST-1310 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1310, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS (R15-3 item fixed) — T1 no `get_product` (R15: one); the Arabic-script name « سمير بن علي » sent alone is kept, French kept (T2: the guard rewrote a repeated greeting); « oui » → TEST-1344 3 250 DA.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 3.8 s (server 3.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Tapis de prière, molletonné 120 x 70 cm, est à 2800 DA et il est disponible. Je note 1 tapis pour vous. Quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « سمير بن علي » · `fr` · 3.3 s (server 3.1 s)
  - AI: « Merci, Samir ! Je note votre nom. Quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0661234567 » · `fr` · 2.2 s (server 2.1 s)
  - AI: « Merci ! Je note le 0661234567. Dans quelle wilaya habitez-vous ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.1 s (server 4.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui » · `fr` · 5.1 s (server 4.9 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### N7 — J03 playground (UI fr)
**Verdict: PASS (one message this round) — « nous n'avons pas de lunettes de soleil … sac à main en cuir, disponible en Noir ou Marron à 6900 DA, ou notre robe kabyle brodée à 4900 DA. Laquelle vous intéresse ? » — in-stock products, no hand-off, no order.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.6 s (server 6.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre sac à main en cuir, disponible en Noir ou Marron à 6900 DA, ou notre robe kabyle brodée à 4900 DA. Laquelle vous intéresse ? »
  - cards: « Sac à main cuir 6900 DA » (no photo) · « Robe kabyle brodée 4900 DA »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)`

### N9 — J04 playground (UI fr)
**Verdict: PASS — no tool call, no probe; « Ma 3andnach tsawer ta3 had la robe dork … »; arabizi recap (M) → « ih » → TEST-6890 (T1: the guard stripped a Moroccan form before sending).**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi` · 5.7 s (server 5.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alaykum salam ! Ma 3andnach tsawer ta3 had la robe dork, bessah nwasfhalek. Hiya robe kabyle brodée b lyedd, b tissu khfif, mliha bezzaf l l3rass w lmounasabat. Les tailles li kayen dork: S w M b 4900 DA, w XL b 5200 DA. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 5.8 s (server 5.6 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi` · 6.8 s (server 6.6 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N11 — J04 playground (UI ar)
**Verdict: PASS — recap → « ايه » → TEST-4074; T3 tracking → `lookup_order` only → « … ما خرجتش للتوصيل بعد … ما عندناش رقم تتبع حتى الآن … » — from the tool result (`not_sent`, tracking null), nothing invented.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.4 s (server 4.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 6.4 s (server 6.2 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 2.8 s (server 2.6 s)
  - AI: « الطلبية تاعك رقم TEST-4074 راهي مسجلة عندنا، وما خرجتش للتوصيل بعد، راهي في طور التحضير. ما عندناش رقم تتبع حتى الآن، وكي تخرج الطلبية نعطوك الرقم والمعلومات. مدة التوصيل من 2 إلى 5 أيام. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

### N12 — J04 playground (UI fr)
**Verdict: PASS (the « ... » turn dropped for the budget) — « ? » → the name question repeated; recap → « 👍 » → TEST-9479 1 950 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr` · 3.0 s (server 2.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Très bon choix ! Le Hijab soie (180 x 70 cm, en soie douce) est à 1500 DA au lieu de 2000 DA, et il est disponible. Pour la commande, comment vous appelez-vous ? »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « ? » · `fr` · 1.5 s (server 1.3 s)
  - AI: « Pour continuer la commande du Hijab soie, quel est votre nom ? »
- **T3** C: « Nadia Kaci 0661234568 » · `fr` · 3.4 s (server 3.2 s)
  - AI: « Merci Nadia, c'est noté avec le numéro 0661234568. Dans quelle wilaya habitez-vous ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.6 s (server 5.4 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `fr` · 5.2 s (server 5.0 s)
  - AI: « Votre commande TEST-9479 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-9479, total 1950`

### N14 — J03 playground (UI fr)
**Verdict: PASS — TEST-1692 → « non annule » → `lookup_order` + `cancel_order {TEST-1692}` → « … a bien été annulée » (simulated). T1 `quote_delivery {Blida}` before the recap call (R16-3).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.8 s (server 6.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr` · 5.1 s (server 4.9 s)
  - AI: « Votre commande TEST-1692 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-1692, total 7950`
- **T3** C: « non annule » · `fr` · 4.4 s (server 4.2 s)
  - AI: « Votre commande TEST-1692 a bien été annulée. N'hésitez pas à revenir si vous souhaitez une autre pièce, on sera ravis de vous aider ! »
  - tools: `lookup_order {} → TEST-1692 new / not_sent, tracking null` · `cancel_order {"orderNumber":"TEST-1692","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-1692`

### N17 — J04 playground (UI fr)
**Verdict: PASS — « oui mais livrez à Alger … » → new recap Alger 400 DA (1 900 DA), no order; « oui » → TEST-8063.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.9 s (server 6.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 8.2 s (server 8.0 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 5.3 s (server 5.1 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N18 — J03 playground (UI ar)
**Verdict: PASS — the Latin name « Samir Benali » sent alone is kept in the Arabic chat and in the recap; « ايه » → TEST-8849 8 200 دج. T1 (8.4 s, the guard rewrote a `confirm_without_recap`) ends « واش تحب نسجلو لك؟ وواش سميتك؟ » (R16-4).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 8.4 s (server 8.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « عندنا Djellaba homme بلون بيج، من صوف رفيع، مقاس واحد، والسعر 7500 دج بدل 9000 دج. واش تحب نسجلو لك؟ وواش سميتك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Samir Benali » · `ar` · 3.2 s (server 2.9 s)
  - AI: « صحيت، سمير بن علي. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 2.0 s (server 1.9 s)
  - AI: « صحيت، سمير. واش من ولاية تحب نوصلو لها الطلبية؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.0 s (server 3.8 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T5** C: « ايه » · `ar` · 6.2 s (server 6.0 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N21 — J04 playground (UI ar)
**Verdict: PASS — fields one per message, Arabic script; the recap call's address was the whole place « البليدة، بوفاريك، حي الورود رقم 12 », the recap shows « حي الورود رقم 12، بوفاريك، البليدة »; « 👍 » → TEST-6619 1 950 دج. T1 (the guard rewrote a `confirm_without_recap`) ends « تحب نحجزلك واحد؟ » (R16-4).**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 6.5 s (server 6.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بسعر 1500 دج بدل 2000 دج، وهو متوفر. حرير ناعم، مقاس 180 x 70 سم، مريح ويتلاقى مع كل لبسة. ⏎ تحب نحجزلك واحد؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « نادية قاسي » · `ar` · 2.3 s (server 2.0 s)
  - AI: « صحيت نادية، تسجل. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234568 » · `ar` · 4.2 s (server 4.0 s)
  - AI: « صحيت، تسجل. واش من ولاية تحب نوصلوا لها الطلبية ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.3 s (server 4.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «البليدة، بوفاريك، حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 6.4 s (server 6.2 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### N23 — J03 playground (UI fr)
**Verdict: PASS — « ih bessah wasslouha l Oran … » → new arabizi recap Oran 600 DA (8 100 DA), no order; « ih » → TEST-5687; recap streets as typed (« cite 500 … », « cite 1000 … »).**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 4.6 s (server 4.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 8.0 s (server 7.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 6.2 s (server 6.0 s)
  - AI: « Commande ta3ek TEST-5687 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → ok TEST-5687, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS — « ايه بصح ديرلي جوج ماشي واحد » → new recap 2 × (3 450 دج), no order; « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.0 s (server 3.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 7.5 s (server 7.2 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 7.0 s (server 6.7 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

### A1 — J04 playground (UI ar)
**Verdict: PASS — fields one per message, Arabic script; recap Alger 400 دج → « ايه » → TEST-4104 1 900 دج (T1: the guard stripped a `confirm_without_recap` sentence, T2 a repeated greeting).**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 4.8 s (server 4.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا Hijab soie — 1500 دج (بدل 2000 دج)، حرير ناعم بمقاس 180 x 70 سم. واش سميتك ؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « أمينة سعدي » · `ar` · 2.7 s (server 2.6 s)
  - AI: « صحيت يا أمينة. عطيني رقم الهاتف تاعك (مثال: 0555123456). »
- **T3** C: « 0698765432 » · `ar` · 3.0 s (server 2.8 s)
  - AI: « صحيت، تسجل. واش من ولاية تحب نوصلوليك فيها ؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 4.2 s (server 4.0 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 5.0 s (server 4.8 s)
  - AI: « تم تسجيل طلبيتك TEST-4104 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → ok TEST-4104, total 1900`

### A3 — J03 playground (UI ar)
**Verdict: PASS — Arabic-Indic phone « ٠٥٥٠١٢٣٤٥٦ » read as 0550123456 (J03, where the number is not blocked), no separator in the place; recap « …، الخروب، قسنطينة » → « ايه » → TEST-5126 6 300 دج. T2 9.6 s / server 9.4 s (the slowest server time of the round, one `create_order`).**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 5.0 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت يا سميرة، سجلت زوج Tapis de prière (سجادة ملبّدة، 120 x 70 سم) بـ 2800 دج للواحدة، والمجموع 5600 دج قبل التوصيل. واش من ولاية تحب نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 9.6 s (server 9.4 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 6.6 s (server 6.3 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

## Bugs

### R16-1 — A three-wilaya delivery question loses one answer when the guard strips a sentence (F9: Oran stop-desk not answered)
- Page: playground dialog (owner, fr UI, 1440) — « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J04 › step 5 › « Tester moi-même »; send « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? ».
- Expected: the three questions answered from the three quotes, in arabizi, as R15 F9: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f
  stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. » — and no unrelated
  closing (fixed in R14-4).
- Actual (F9, 03:35:16–03:35:23, 7.2 s / server 7.0 s): tools `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran,
  isStopdesk true} → fee 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `search_products {«Retouche couture», limit 1}` (nothing asked
  about a service); reply « Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk. Illizi, ma nwasslouch l Illizi f had lwaqt, wallah. T7ebb
  nwarrik produit men les produits li 3andna ? » — **no word on Oran**, although the 400 DA quote was made; the R14-4 closing « T7ebb nwarrik
  produit … ? » is back. `AiRun` 01a1ec82-330b…: `meta.guard {action stripped, retried true, violations [moroccan_darija, fee_missing],
  remaining [moroccan_darija, fee_missing]}` — the retry still had a Moroccan form, the strip removed the sentence that held it, and with it
  the Oran fee (`fee_missing` stays in `remaining`, so the reply went out knowing a quoted fee was absent).
- Evidence: .local/qa/journeys/R16/out/transcripts/F9.json T1 + F9.ui.txt · run1.log · .local/qa/campaign/retest-ai-r16/fr-F9-pg.png ·
  out/airun.txt (`AiRun` 01a1ec82-330b…) · out/toolcalls.txt (03:35:18, 4 rows)
- Likely cause: after the retry, the `stripped` action drops whole sentences with a Moroccan form even when that leaves a quoted fee out
  (`fee_missing` remaining) — the fee completion (`withBothFees`) does not run after a strip; the unrelated `search_products` (a service
  product) feeds the « nwarrik produit » closing.

### R16-2 — A hand-off the model makes itself keeps the model's text, not the per-reason sentence (W1 wholesale)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »
- Severity: Cosmetic
- Type: Text
- Steps: J04 › « Tester moi-même »: « Bonjour, prix de gros pour 50 pièces du hijab soie ? ».
- Expected: one AI sentence for the reason in the customer's language, as the platform hand-offs now do (H1 « Bien sûr, je vous mets en
  relation avec l'équipe de la boutique. », C1 « … elle verra le remboursement avec vous dès l'ouverture. ») — e.g. « Pour un prix de gros,
  l'équipe de la boutique va vous répondre. »
- Actual (W1, 03:34:04, 6.4 s / server 6.2 s, `AiRun` 01a1ec81-1ab5…): the model called `handoff_to_human {off_catalogue, evidence «prix de
  gros pour 50 pièces du hijab soie»}` (accepted, status HANDOFF `off_catalogue`); the AI text is the model's « Je ne peux pas vous donner de
  prix de gros ici. Pour info, le hijab soie est à 1500 DA l'unité (au lieu de 2000 DA). » — two sentences, a refusal, nothing on the team
  answering (only the system line « Je transmets à un membre de l'équipe qui vous répondra très vite. » says it). R15: the platform's
  hand-off, 0 tool call, 2.2 s. C1 also went through the model's `handoff_to_human {refund}` this round, but its text happened to be right.
- Evidence: .local/qa/journeys/R16/out/transcripts/W1.json + W1.ui.txt · `AiRun.meta.turn` (reply, toolCalls) · fr-W1-pg.png · compare
  H1.json, C1.json
- Likely cause: the per-reason sentence is applied on the platform-decided path only; when the hand-off comes from the model's tool call, its
  own reply is sent as is.

### R16-3 — Redundant lookups left
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim », « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: run PF1, N1, N14, N5, F9; read the tool calls.
- Expected: no tool call whose result the turn already has (R11-3 … R15-3); `create_order` computes the fee and the stock itself.
- Actual (none changed the answer):
  - PF1 T2 (03:39:16) `quote_delivery {wilayaId 19}` → the same 650 / 350 as T1's `quote_delivery {Sétif}` one message earlier.
  - N1 T2 (03:42:31, 7.8 s) `quote_delivery {Oran}` + `check_availability {qty 1}` before the recap `create_order` (3 calls).
  - N14 T1 (03:43:55) `quote_delivery {Blida}` before the recap `create_order` (all fields in the message).
  - N5 T2 (03:34:26) `search_products {parfum}` again after T1's same search.
  - F9 T1 `search_products {«Retouche couture»}` — nothing asked (R16-1).
  - Fixed since R15: F1b T2 one `quote_delivery` (R15 two), N4 T1 no `get_product`, F9's Illizi quote once (R15 N16: a second stop-desk
    quote); 0 search after a recap call (0 / 30).
- Evidence: .local/qa/journeys/R16/out/toolcalls.txt (03:39:17, 03:42:33 ×2, 03:43:56, 03:34:28, 03:35:18) · transcripts PF1.json, N1.json,
  N14.json, N5.json, F9.json
- Likely cause: the dedupe works inside a turn; quotes and searches of the previous turn, and the fee / stock checks that `create_order`
  already makes, are not treated as known.

### R16-4 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run C2, F1b, N21, N18, F5b, P2, PF2, F9.
- Expected: plain Algerian darija / arabizi / French, one offer of each choice, no question that sounds like a booking before the recap.
- Actual:
  - C2 « Salam, smahli 3lik  3la had lmochkil. » — a double space.
  - F1b T2 « … ou 350 DA en stop-desk si vous préférez. Quelle est votre adresse … ? Si vous préférez, on peut aussi vous livrer en
    stop-desk. » — the stop-desk offered twice in one reply.
  - After a `confirm_without_recap` rewrite, booking-like offer questions: N21 T1 « تحب نحجزلك واحد؟ » (« shall I reserve one for you? »),
    N18 T1 « واش تحب نسجلو لك؟ وواش سميتك؟ » (« shall we register it for you? »); French F1 T1 « Souhaitez-vous le commander ? Si oui,
    dites-moi votre nom pour commencer. » — no order follows a « yes » to them (the next field is asked), but they read as an order step.
  - French inside arabizi: F5b T1 « Merci Amina, tsajjel! La robe kabyle brodée taille M est disponible b 4900 DA. » (the guard kept the
    switch), P2 T1 « Rahi disponible en S w M b 4900 DA, w en XL », PF2 T1 « disponible b 1500 DA ».
  - F9 « wallah » and the closing « T7ebb nwarrik produit men les produits li 3andna ? » (R16-1).
  - The reply guard still strips a Moroccan form the model wrote (F9 T1, N9 T1) — nothing Moroccan reached the customer (R15: 4).
  - Fixed since R15-4: N5 T1 the asked price (« Parfum Oud 50 ml est à 3200 DA, mais … »), F5 / F5b T3 « oui c'est bon » confirmed in
    arabizi, F3 / PF2 street « cite 20 aout villa 3 » as typed, F3 T1 « Bach ngoulou commande bsmek » and F5 T1 « rani ndir lek » gone.
- Evidence: .local/qa/journeys/R16/out/transcripts/C2.json, F1b.json T2, N21.json T1, N18.json T1, F1.json T1, F5b.json T1, P2.json T1,
  PF2.json T1, F9.json T1 · `AiRun.meta.guard` (out/airun.txt, out/join.txt)
- Likely cause: free model wording; the `confirm_without_recap` rewrite turns the claim into an offer question rather than the next field
  question.

## Retest
- RETEST R15-1: fixed — F5 twice on the shared link with the exact R15 messages: T1 « Robe kabyle brodée taille M kayna, b 4900 DA. Tawsil:
  400 DA l dar, wela 250 DA f stop-desk ila t7ebb. … a3tini l'adresse ta3ek … ? » / « … disponible b 4900 DA. L dar: 400 DA, f stop-desk:
  250 DA. Wach t7ebb nwasslouha l dar wela f stop-desk ? … » — each from a `quote_delivery {wilayaId 16}` (R15: no tool, no price, no fee).
  Place-first flows: PF1 « Bonjour, j'habite à Sétif, El Eulma » → « 650 DA à domicile, ou 350 DA en stop-desk … Quel article vous
  intéresse ? », then the product → « … à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. … votre adresse à El Eulma …, ou préférez-vous
  le stop-desk ? »; PF2 « salam, ana men Blida, Boufarik. nheb hijab soie » → « … b 1500 DA (kan 2000 DA). Tawsil l Blida: 450 DA l dar,
  wela 300 DA f stop-desk … » before the name and the street. Same family: F1b, N3 both fees (6 / 6 this round). New in the family: a
  quoted fee dropped by the guard's strip (F9 Oran) → R16-1.
- RETEST R15-2: mostly fixed — H1 « Bien sûr, je vous mets en relation avec l'équipe de la boutique. » (R15 empty); H2 « أكيد، فريق المحل
  ماهوش متوفر درك، راح يجاوبك كي نفتحو. » (R15 empty) with no « قريبًا » line after the out-of-hours line; C1 « Désolé pour ce problème :
  l'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture. » (R15 generic) with no « très
  vite » line after « absente »; C2 arabizi « … L'équipe ta3 lboutique rah tchouf m3ak le remboursement. » with no Arabic-script hand-off line.
  Left: W1 (the model's own `handoff_to_human`) keeps the model's refusal text → R16-2.
- RETEST R15-3: partly fixed — F1b T2 one `quote_delivery` (R15 two), N4 T1 no `get_product`, Illizi quoted once in F9 (R15 N16 twice).
  Left: PF1 T2 re-quote of T1's wilaya, N1 T2 quote + `check_availability` before the recap call, N14 T1 quote before the recap call, N5 T2
  second search, F9 unrelated search → R16-3.
- RETEST R15-4: mostly fixed — N5 T1 « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible … » (R15: price not given);
  F5 / F5b T3 « oui c'est bon » → « Commande ta3ek TEST-6890 tsajlet ✅ … » in arabizi (R15 French); F3 recap street « cite 20 aout villa 3 »
  as typed (R15 « Cité 20 Août, villa 3 »), PF2 / N23 / N14 too; F5 « rani ndir lek », F3 « Bach ngoulou commande bsmek » gone. Left: French
  inside arabizi, Moroccan forms still stripped by the guard (2 replies), booking-like offer questions, the double stop-desk offer → R16-4.
- R1–R14 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 24 orders**; N5 T3 « oui » to a question →
  no order; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; one order per « oui »: 24 orders, never two for one « oui », none
  lost after a recap; **R4-1 / R11-2 / R13-1 (no hand-off on an order / field / yes message, nor for a product sold or not sold) holds — 0
  hand-off outside the 5 real requests and F11 (blocked, server)**; R14-3 (every real hand-off accepted) holds — 5 / 5, the 2 model calls
  accepted, 0 refused; R4-2 (a name in another script keeps the language) holds — N4, F3, N18; R14-1 (language kept) holds — 33 / 33;
  R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 30 / 30; R8-2 / R10-2 / R12-2 (no confirm request / claim
  without a recap) holds — 0 claim in 100 turns (3 rewritten / stripped by the guard; the offer questions left → R16-4); R4-8 (blocked
  sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N5, N7, P2, N9; R5-2 (no Tunisian / Moroccan forms sent) holds (guard
  ×2); R5-4 (no « home or stop-desk ? » after a street) holds — F5b / F1b / PF1 asked it before any street; R5-5 / R7-5 (delivery question
  answered with the fee) holds for F12, N3, PF1, not fully for F9 (R16-1); R5-6 (no `create_order` before a phone) holds — 0 / 55; R6-4 /
  R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 30 / 30; R7-2 (no photo said) holds — N9; no invented discount (catalogue old
  prices Hijab 2000, Djellaba 9000; Oran free delivery only from 20 000 DA — N5 2 100 DA paid); N11 tracking from `lookup_order`, no invented
  number or date; R8-3 (named variant) holds; R9-1 (Latin name in an Arabic chat) holds — N18; R10-1 (latency) — server max 9.4 s, 0 server
  turn ≥ 10 s; 2 page turns ≥ 10 s from the network path (F1), the turn-key replay held (1 run, the stored answer returned); R11-5 (no
  provider error) holds — 0 / 100; R12-1 (no `VALIDATION wilayaId`) holds — 0 refusal in 55 calls; R13-3 (Arabic street kept) holds — N11,
  N18, N21, N25, A1, A3; R13-5 (substitute line) holds — N5 « … à la place, ce récapitulatif est pour le produit Hijab soie. »; R15 fees —
  every fee said matches the shop's settings (100 / 100 turns, one missing in F9).

## Coverage
- Order flows to « oui »: French ×10 (PF1, N5, F1, F1b, F6, N1, N4, N12, N14, N17; F11 blocked), Arabic-script darija ×6 (N11, N18, N21,
  N25, A1, A3), arabizi ×8 (PF2, P2, N9, F3, N23, N3 after a switch, F5 and F5b mixed fr / arabizi on the shared link); no order, rightly:
  N7 (nothing chosen), F9, F12 (delivery questions only), C1, C2, H1, H2, W1 (team).
- Asked this round: F5 ×2 on the shared link, two place-first flows (place alone, place + product), H1, H2, C1, C2, W1, N5 (price asked),
  F3 (street as typed), P2, the sweep F1, F1b, F6, F9 (with N16's Illizi), F11, F12, N1, N3, N4, N7, N9, N11, N12, N14, N17, N18, N21, N23,
  N25, A1, A3 (F1, F3, N4, N18, N21, A1 with each field in its own message); latency of every turn; every fee against the shop's delivery
  settings.
- Also: « oui mais … » in three scripts (N17, N23, N25), a product not sold (N7), « ? » (N12), a cancel after the order (N14, simulated), a
  wilaya not served (F9 Illizi), commune-only place → both fees (PF1, F1b, F5 ×2), photo request (N9), out-of-stock product with its price and
  a substitute to the order (N5), the free-delivery threshold not reached (N5 Oran 2 100 DA), a blocked number (F11), out-of-hours shop (J03:
  C1, H2 wording).
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout; shared link valid (probe 03:31).

## Not tested
- N16 as its own conversation (its Illizi question is in F9), N7's « oui », N12's « ... » turn — left out to stay within 100 messages.
- The shared link beyond F5 ×2 / F12 (the visitor response has no tool calls; they were read from `AiToolCall`).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`). The live Messenger path (no page
  connected), so the hand-offs of C1 / C2 / H1 / H2 / W1 on a real conversation (inbox assignment, notification) were not seen.
- F6, N1, N14, N17, N23, N25 with their fields one per message (they test a change or a cancel; one message carries all fields as in R15);
  an angry message (`angry` reason); a J04 conversation inside opening hours.
- `cancel_order` / `lookup_order` on a real order with a courier and a tracking number; a product that HAS photos in a photo request; the
  stall / dup probes of R10 / R11 (F1 T3 gave an unplanned one: the browser's own re-send got the stored answer).

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-6890 (F5, F5b, N9), TEST-9884 (PF2), TEST-7864 (N5), TEST-1158 (P2),
  TEST-4074 (N11), TEST-9479 (N12), TEST-8063 (N17), TEST-6619 (N21), TEST-6971 (N25), TEST-4104 (A1), TEST-6293 (PF1, F1b), TEST-5998 (F3),
  TEST-1506 (F1), TEST-2670 (F6), TEST-5759 (N1), TEST-1310 (N3), TEST-1344 (N4), TEST-1692 (N14 — then cancelled, simulated), TEST-8849
  (N18), TEST-5687 (N23), TEST-5126 (A3); F11 refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (F5 / F5b / N9,
  PF1 / F1b; R15's TEST-6890, TEST-1158, TEST-4074, TEST-9479, TEST-8063, TEST-6619, TEST-6971, TEST-4104, TEST-1506, TEST-2670, TEST-5759,
  TEST-1344, TEST-5126 again).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:playground:*` TTL / count, `DeliveryFeeRule` and
  `Product` rows of both shops, `AiRun` rows since 02:30 UTC (out/airun.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn
  answered » lines (out/api-lines.txt), nginx access lines for F1 T2 / T3; nothing written.
- Hour counters (read-only): before the run J04 49 / 60 (TTL 5 s), J03 50 / 60 (TTL 382 s) — waited for expiry; after the run J04 51 / 60
  (window from 03:32:26), J03 49 / 60 (window from 03:39:03); no 429. Messages used: 100 / 100.
