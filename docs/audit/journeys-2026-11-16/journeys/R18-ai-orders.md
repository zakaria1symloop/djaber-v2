# R18 — Eighteenth retest of the AI order-taking (after the R17 fixes) — live site, deployed commit 441681b — 18/11/2026 05:43–05:56 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 441681b (checked read-only: `git log --oneline -1` = « 441681b fix(ai): live retest R17 —
a plain yes to the shown server recap is placed by the server even without a model call, off_catalogue needs unsold product words,
out-of-stock items never offered as alternatives, Arabic order-claim / booking families, R16 all-fields note skipped for an out-of-stock
take »; `djaber-v2-api` / `djaber-v2-worker` online, restarted 05:40:30). Same two own shops as R1–R17: « Boutique de Nassim » (J03 shop,
« Agent J03 Vendeur », default language FR) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Surfaces: step 5 ›
« Tester moi-même » (playground, tool calls visible) and, for F5 / F12, the J04 shared test link (`/agent-test/<token>`, valid until 18/11
18:04, so no new link was made; its tool calls were read server side, read-only, from `AiToolCall`). One browser at a time, the runs one
after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place (F11). Hour counters read before the run
(read-only, Redis `rl:playground:*`, `rl:agent-test*`, 05:42): no key for either shop, no link key. J04 flows 05:43:23–05:49:38, J03 flows
05:49:38–05:56:34. No 429. J03 was outside its opening hours: every J03 conversation starts with the shop's « out_of_hours » system line
(configured text, in Arabic for the Arabic UI: « فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »), not an AI reply; the J04
shop shows no such line.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, last change 16/11), used to check every fee:** Alger 400 home /
250 stop-desk, Blida 450 / 300, Sétif 650 / 350, Constantine 700 / 450, Oran 600 / 400 (home free from 20 000 DA), Illizi 1 500 / 1 000
inactive (not served). Stock (read-only, `Product` / `ProductVariant`): J04 Parfum Oud 50 ml 0, Montre connectée 0 (`sellOutOfStock` true),
Coffret cadeau Aïd 4, Hijab soie 20, Djellaba homme 10, Robe kabyle L 0; J03 Parfum Oud 50 ml 0, Montre connectée 0 (`sellOutOfStock` true),
Coffret cadeau Aïd 4, Sac à main cuir Noir 3 / Marron 3 / Rouge 0, Tapis de prière 15, Djellaba homme 10, Basket Runner 41 0, Robe kabyle L 0.

**Latency method (as R11–R17).** `conv.mjs` of R17 unchanged except paths: every POST of a turn is recorded from the page (`turnKey`, sent /
ended time, status, `Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. Server side,
read-only: the API's « playground turn answered » lines (`runMs`, `waitMs`, `totalMs`, `replayed`), the `AiRun` rows (`latencyMs`, `status`,
`flags`, `meta.guard`, `meta.turn`) + `AiToolCall` rows. No stall / dup probe.

**98 customer messages** (J04 shop 45 of which 4 on the shared link, J03 shop 53; budget 100), 31 conversations, 29 on the playground and 2
on the shared link: priority 1 — PF1 twice (J03 the exact R17 message; J04 as PF1b with the hijab), 2 NEW greeting-plus-place first messages
(PG1 « slm, ana f Oran, Bir El Djir » on J04, PG2 « السلام عليكم، أنا من البليدة بوفاريك » on J03), N5 twice (J04, then J03 as N5b, same
messages), 4 NEW yes variants to a recap put as the last message of sweep flows (N4 « oui c'est bon », P2 « wah », F3 « ih ndirha », N18
« 👍 »), F11 (blocked number); priority 2 — N7, A3, N21, A1, F9, N16; priority 3 — the sweep F1, F1b, F3, F5 (shared link), F6, F12 (shared
link), W1, H1, C2, N1, N3, N4, N11, N17, N18, N23, N25, P2. **N9 and N14 were not run** (the planned flows took 98 messages; N14 was kept
for a left-over of 3, which did not occur). Flows with `untilOrder` stop at the order, so no « oui » was spent after an order. No adaptive
re-send, no re-send by the script. Scripts `.local/qa/journeys/R18/scripts/` (conv.mjs, convs.json, render.cjs, check.cjs, lat-table.cjs,
server.sh = read-only `AiRun` query, tools.sh = read-only `AiToolCall` query, probe-link.mjs, run.sh, all.sh), transcripts
`.local/qa/journeys/R18/out/transcripts/<id>.json` (+ `.ui.txt`, `.log.json`), run logs `.local/qa/journeys/R18/out/run1.log` (J04),
`run2.log` (J03), `airun.txt`, `toolcalls.txt`, `api-lines.txt`, rendered turns `out/render.md`, screenshots
`.local/qa/campaign/retest-ai-r18/`.

Cases asked for this round:
- **R17-1**: PF1 ×2 and two new greeting-plus-place first messages in arabizi and Arabic script ⇒ no hand-off, the fees said, then a normal sale.
- **R17-2**: N5 ×2 — out of stock ⇒ substitute ⇒ one « oui » ⇒ exactly one order.
- 4 new yes variants to a recap (« oui c'est bon », « wah », « ih ndirha », « 👍 ») ⇒ exactly one order each; a blocked-number yes (F11) ⇒ refused.
- **R17-3 … R17-5**: N7, A3, N21, A1, F9, N16; **R17-6** through N5, PF1, N23; the sweep; latency per turn with `Server-Timing`; every R1–R17
  guarantee (no order without a server recap — Critical; one order per « oui »; a « oui » with a change gives a new recap; no
  `create_order` before a phone; no confirm question / registered claim without a server recap; no wrong hand-off and every real one
  accepted; language and script kept; no invented discount; tracking real; address street, commune, wilaya; fees match the shop's delivery
  settings).

**Result: 28 / 31 conversations pass** — priority 1: 4 / 7 (PF1b, N5, N5b, F11 pass; **PF1, PG1, PG2 fail — R18-1**) and the four yes variants 4 / 4 (inside N4 / P2 /
F3 / N18), priority 2: 6 / 6 (N7, A3, N21, A1, F9, N16), sweep 18 / 18 (N4, P2, F3, N18 counted here). **R17-1 half fixed: no hand-off on any of the 4 place-first messages (PF1 exact message included), and T2 now gives the price and
both fees with no premature `create_order`; but 3 of the 4 place-only first turns make no `quote_delivery` and say no fee (PF1 J03 « Merci
pour l'info, on a bien noté Sétif, El Eulma. Qu'est-ce qui vous intéresse aujourd'hui ? … », PG1 « Ahlan bik f Oran. Wach men produit t7ebb
tchri lyoum ? », PG2 « مرحبًا بيك في بلدية بوفاريك! واش تحب تلقى عندنا اليوم؟ ») — only PF1b (J04) answers « … 650 DA, ou 350 DA en stop-desk
… » (R18-1, Minor).** **R17-2 fixed: N5 and N5b — the substitute is asked first (as R16), its server recap follows the « oui », and the next
« oui » to that recap places the order at once (TEST-1709, TEST-3367); no confirm question after a recap.** **R17-3 fixed: N7 lists
in-stock items and sizes only (no Montre connectée, no basket 41, no robe L).** **R17-4 fixed: A3 T1 « سجلت زوج من Tapis de prière » (no
« تسجلت الطلب »), N21 / A1 T1 « واش سميتك ؟ », F1b T1 no « on le prépare pour vous »; A1's through a guard `confirm_without_recap`
rewrite.** **R17-5 partly fixed (F9 closing gone; N16's offer and French inside arabizi left — R18-4).** **R17-6 mostly fixed (N5 T2 0
search, PF1 T2 no `VALIDATION`, N23 T2 6.1 s); 3 server turns ≥ 10 s left (R18-3).** New: the price missing before the delivery
questions in PG2 T2 and N3 T1 (R18-2, Minor). **Latency: page median 5.4 s, p90 8.0 s; server median 5.2 s, p90 7.7 s, max 12.0 s (N7 T1);
4 page times ≥ 10 s (N7 T1 12.3 / 12.0 s, PG2 T2 10.7 / 10.4 s, PG1 T2 10.3 / 10.0 s, N5 T2 10.0 / 9.7 s) — all server time, not network;
`Server-Timing` on 98 / 98 answers; page − server median 0.22 s, max 0.34 s; 0 provider error.** **0 order without a server recap; 23 TEST
orders, each from a « oui / oui c'est bon / oui, c'est bien … / wah / ih / ih ndirha / ih saha / ايه / 👍 » to a server recap, exactly one
each; F11 « oui » refused as blocked; 0 « oui » to a server recap lost (R17: 1); 3 « yes » with a change (N17 fr, N23 arabizi, N25 Arabic
script) → a new recap, 0 order; 3 « oui » to no recap (N7 T2, N5 T3, N5b T3) → no order; 0 `create_order` before a phone in 53 calls; 0
`VALIDATION`; 0 wrong fee in 98 turns.** Failures — no Critical, no Major: two Minor (R18-1 place-only first message without the fees, R18-2
price missing before the delivery questions); issues: latency / redundant lookups (R18-3, Minor), wording left (R18-4, Cosmetic).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| PF1 | J03 · playground | fr, place alone then product | **T1 no hand-off but no fee, 0 call**; T2 price + both fees; recap → TEST-6293 | T3 5.0 s / 4.8 s | yes, 1 | FAIL — R18-1 |
| PF1b | J04 · playground | fr, place alone then product | T1 Sétif 650 / 350; T2 price; recap → TEST-7017 | T1 6.9 s / 6.7 s | yes, 1 | PASS (R17-1) |
| PG1 | J04 · playground | arabizi, greeting + place (NEW) | **T1 no fee, 0 call**; T2 price + 600 / 400; recap → « ih » → TEST-1288 | T2 10.3 s / 10.0 s | yes, 1 | FAIL — R18-1 |
| PG2 | J03 · playground | Arabic script, greeting + place (NEW) | **T1 no fee, 0 call; T2 450 / 300 without the price**; recap → « ايه » → TEST-1772 | T2 10.7 s / 10.4 s | yes, 1 | FAIL — R18-1, R18-2 |
| N5 | J04 · playground | fr, out of stock « c'est combien ? » | substitute asked; « oui » → recap; « oui » → TEST-1709 | T2 10.0 s / 9.7 s | yes, 1 | PASS (R17-2) |
| N5b | J03 · playground | fr, out of stock (re-run) | same path → TEST-3367 | T4 6.2 s / 6.1 s | yes, 1 | PASS (R17-2) |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED` | T2 8.0 s / 7.7 s | no (refused, as expected) | PASS |
| N4 | J03 · playground | fr, Arabic-script name alone, « oui c'est bon » | T1 next field; « سمير بن علي » kept → TEST-1344 | T3 7.2 s / 7.0 s | yes, 1 | PASS (yes variant) |
| P2 | J04 · playground | arabizi, « wah » | arabizi recap (S) → TEST-1158 5 300 DA | T1 7.1 s / 6.8 s | yes, 1 | PASS (yes variant) |
| F3 | J03 · playground | arabizi, fields one per message, « ih ndirha » | « وليد بوزيد » kept → TEST-5998 | T4 7.8 s / 7.6 s | yes, 1 | PASS (yes variant) |
| N18 | J03 · playground | Arabic script, Latin name alone, « 👍 » | « Samir Benali » kept → TEST-8849 | T5 6.7 s / 6.4 s | yes, 1 | PASS (yes variant) |
| N7 | J03 · playground | fr, product not sold, then « oui » | in-stock items / sizes only; no order, no hand-off | **T1 12.3 s / 12.0 s** (slowest) | no (right) | PASS (R17-3) |
| A3 | J03 · playground | Arabic script, « ٠٥٥٠… », no separator | T1 « سجلت زوج … » (noted, no claim); recap → TEST-5126 | T2 8.5 s / 8.3 s | yes, 1 | PASS (R17-4) |
| N21 | J04 · playground | Arabic script, fields one per message | T1 « واش سميتك ؟ »; recap → « 👍 » → TEST-6619 | T5 4.3 s / 4.0 s | yes, 1 | PASS (R17-4) |
| A1 | J04 · playground | Arabic script, fields one per message | T1 « واش سميتك؟ » (guard rewrite); recap → « ايه » → TEST-4104 | T5 7.0 s / 6.7 s | yes, 1 | PASS (R17-4) |
| F9 | J04 · playground | arabizi, 3 wilayas | Sétif 650 / 350, Oran stop-desk 400, Illizi not served; no closing | T1 5.9 s / 5.6 s | — | PASS (R17-5) |
| N16 | J04 · playground | arabizi, Illizi | « Ma nwasslouch l Illizi f had lwaqt » + an offer | T1 4.1 s / 3.8 s | — | PASS |
| F1 | J03 · playground | fr, fields one per message | T1 next field; recap → TEST-6293 7 550 DA | T1 7.7 s / 7.5 s | yes, 1 | PASS |
| F1b | J03 · playground | fr, fields over 3 messages | T1 no « on le prépare »; T2 one stop-desk offer → TEST-6293 | T2 8.0 s / 7.8 s | yes, 1 | PASS (R17-4) |
| F5 | J04 · shared link | fr / arabizi mixed, « oui c'est bon » | T1 4900 DA + 400 / 250 + address question; recap → TEST-6890 | T1 6.2 s / 6.0 s | yes, 1 | PASS |
| F6 | J03 · playground | fr, quantity change | 2 → 3 new recap → « oui » → TEST-2340 9 100 DA | T2 5.4 s / 5.2 s | yes, 1 | PASS |
| F12 | J04 · shared link | fr | « on livre à Blida ! … 450 DA à domicile, ou 300 DA en stop-desk » | T1 2.5 s / 2.3 s | — | PASS |
| W1 | J04 · playground | fr, wholesale | model HANDOFF `off_catalogue` accepted, « Pour le prix de gros, l'équipe … va vous répondre. » | T1 3.4 s / 3.2 s | — (team) | PASS |
| H1 | J04 · playground | fr « je veux parler à quelqu'un » | platform HANDOFF, « Bien sûr, je vous mets en relation … » | T1 2.2 s / 2.0 s | — (team) | PASS |
| C2 | J04 · playground | arabizi, broken order + refund | platform HANDOFF `refund`, arabizi reason sentence | T1 4.5 s / 4.3 s | — (team) | PASS |
| N1 | J03 · playground | fr, product + wilaya change | 1 call per turn; new recap Oran → « oui » → TEST-5759 7 500 DA | T2 6.6 s / 6.5 s | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T2 | **T1 no price**; T2 both fees + arabizi recap → « ih saha » → TEST-7010 | T2 8.5 s / 8.3 s | yes, 1 | PASS (R18-2 wording) |
| N11 | J04 · playground | Arabic script, tracking | TEST-4074; T3 from `lookup_order` ×2, nothing invented | T2 6.6 s / 6.4 s | yes, 1 | PASS |
| N17 | J04 · playground | fr « oui mais livrez à … » | new recap Alger, no order → « oui » → TEST-8063 | T2 8.1 s / 7.8 s | yes, 1 | PASS |
| N23 | J03 · playground | arabizi « ih bessah … » | new arabizi recap Oran, no order → « ih » → TEST-5687 | T3 7.4 s / 7.2 s | yes, 1 | PASS |
| N25 | J04 · playground | Arabic script « ايه بصح ديرلي جوج » | new recap 2 ×, no order → « ايه » → TEST-6971 | T3 8.9 s / 8.7 s | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a server recap → exactly one order with the recap's content: **23 / 23** (PF1, PF1b, PG1, PG2, N5 T4, N5b T4, N4, P2, F3, N18,
  A3, N21, A1, F1, F1b, F5, F6, N1, N3, N11, N17, N23, N25) + F11 refused as blocked (1 / 1). **Order without a server recap: 0.** **« oui » to a
  correct recap lost: 0** (R17: 1, N5 T3). Yes forms that placed: « oui » ×8, « oui c'est bon » ×2 (N4 NEW on the playground, F5 on the
  link), « oui, c'est bien … » ×1, **« wah » ×1 (NEW)**, « ih » ×2, **« ih ndirha » ×1 (NEW)**, « ih saha » ×1, « ايه » ×5, « 👍 » ×2 (**N18
  NEW in a Latin-name Arabic chat**, N21). One « oui » after a change: **5 / 5** (N1 product + wilaya + address, F6 quantity, N17 wilaya, N23
  wilaya, N25 quantity). No second `create_order` after an order in a turn.
- **« oui » that is not an answer to a server recap → no order: 3 / 3** — N7 T2 (after the not-sold answer → the open question again), N5 T3 /
  N5b T3 (to the model's substitute question → the substitute's server recap, no order).
- **« yes » with a change → a new recap, no order: 3 / 3** — N17 T2 (fr → Alger 400 DA, 1 900 DA, core f4cd80…), N23 T2 (arabizi → Oran
  600 DA, 8 100 DA), N25 T2 (Arabic script → 2 ×, 3 450 دج, core 1e692b…); each next « oui / ih / ايه » → the order with the new recap's
  content.
- Confirming call reworded vs the recap call, order still placed from the stored recap: **3 / 3** — F1 (recap call address « Cité 500 logements
  bloc 12, El Eulma » / confirming « Cité 500 logements bloc 12 »), N1 (« Cité 1000 logements bloc 4, Bir El Djir » / « Cité 1000 logements
  bloc 4 »), N3 (« Cité 1000 logements, bloc 5 » / « cité 1000 logements bloc 5 »).
- **Confirming calls refused: 0** (23 + F11). **Recap calls refused: 0.** **`VALIDATION` refusals: 0 in 53 `create_order` calls** (R17: 1, PF1 T2).
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, address): **29 / 29**, the named variant every time
  (PF1, F1, F1b, N1 Marron; P2 S, F5 M); **in the customer's language 29 / 29** — Arabic script 8 (PG2, N11, N21, N25 ×2, A1, N18, A3),
  arabizi 7 (PG1, P2, F3, F5, N3, N23 ×2), French 14.
- **Server recap without a model sentence asking to confirm or describing the order: 29 / 29** — lead-ins left: F1 « Merci Karim ! », N3 « Ih,
  nwasslou l Constantine. Tawsil l dar 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. » (the answer to « twasslou l Constantine ? »),
  N5 / N5b the server's substitute line. **Outside any recap: 0 model turn asks to confirm the order or claims it registered** (R17: 2 — N5
  T3, A3 T1); the guard rewrote one `confirm_without_recap` before it was sent (A1 T1). Left before a recap: the substitute questions N5 T2
  « … Dites-moi oui et je prépare la commande pour Bir El Djir. » / N5b T2 « Voulez-vous que je prépare la commande avec ce produit ? » (a
  « oui » to them gives the server recap, not an order — as R16) and item-noted lines « tsajjel: hijab soie wahed » (PG1 T2), « Tsajjelt Amina
  Saadi, 0698765432, … » (F5 T1), « سجلت زوج من Tapis de prière » (A3 T1), « 2 tapis de prière …, c'est noté ! » (N3 T1) (R18-4).
- **Recap address « street, commune, wilaya »: 29 / 29** — A3 no separator, A1 / N21 / N25 / PG2 « ، », N18 Latin name. **Street as the
  customer wrote it: 29 / 29** (F3 / N23 « cite … » although the N23 T1 recap call sent « Cité 500 logements bloc 12, Sétif », N3 « cité 1000
  logements bloc 5 » although the call sent « Cité 1000 logements, bloc 5 », F1 / N1 the commune not repeated although the call carried it;
  first-letter capitals not counted, as R14–R17).
- **Fees never wrong: 98 / 98 turns** — every fee said or recapped matches the shop's rules above (Oran home under 20 000 DA paid — PG1 2 100
  DA, N1 / N23 600 DA; from 20 000 DA free — N5 / N5b 24 990 DA « gratuite »; Oran stop-desk 400 DA in F9 with the free-home note; Illizi not
  served). **No asked fee missing.** **Place given with no question → the fees: 1 / 4** (PF1b; PF1, PG1, PG2 no — R18-1).
- **Phone in Arabic-Indic digits read as Latin: 1 / 1** — A3 (« ٠٥٥٠١٢٣٤٥٦ » → 0550123456; the number is blocked only on J04, this is J03).
- **Customer's name as written: 31 / 31 conversations in the recaps and orders** — Arabic script kept in French / arabizi chats (N4 « سمير بن
  علي » alone, F3 « وليد بوزيد »), Latin kept in an Arabic chat (N18 « Samir Benali » alone); N4 T2's sentence writes it « Samir Ben Ali »
  (R18-4); 0 name asked again once given.
- **Delivery question answered with the fee: 4 / 4** — F9 (three wilayas), N16 (not served), F12 on the link (Blida 450 / 300), N3 (Constantine
  both fees). **Place known, no street → price and both fees before the address / mode question: 5 / 6** — PF1 T2, PF1b (T1 fees + T2
  price), PG1 T2, F5 T1 (link), F1b T1–T2; **PG2 T2 no (both fees, no price — R18-2)** (R17: 2 / 3). N3 T1 asks the wilaya without the price
  (R18-2).
- **`create_order` before a phone is in the customer's messages: 0 / 53 calls.**
- **Hand-offs: 4 / 4 real ones accepted, 0 wrong** — H1, C2 decided by the platform with 0 tool call, W1 by the model's own `handoff_to_human
  {off_catalogue}` (accepted), F11's is the server's (`CUSTOMER_BLOCKED`). **No hand-off on the 4 place-first messages (R17: PF1 wrong)**, nor
  for a product not sold (N7), a tracking question (N11), a « yes » message, an out-of-stock product (N5 / N5b). AI sentence for the reason, in
  the customer's script: 4 / 4.
- **No 503 / provider error: 98 / 98 turns**; `AiRun` 98 rows, 94 `ok` + 4 `handoff` (F11 T2, W1, H1, C2), 0 `error`, 0 fallback, `attempt` 1
  everywhere; 9 runs carry a reply-guard retry (`guard_rewritten` 8 — P2 T1 language_switch + moroccan_darija, A1 T1 confirm_without_recap, F9
  T1 moroccan_darija, F5 T1 language_switch, N11 T3 moroccan_darija, N4 T2 / T3 language_switch, F1b T2 fee_missing; `guard_enforced` 1 — N16
  T1 moroccan_darija stripped, the not-served sentence kept).
- Latency: **page median 5.4 s, p90 8.0 s, max 12.3 s on 98 turns** (N7 T1 12.3 / 12.0 s, PG2 T2 10.7 / 10.4 s, PG1 T2 10.3 / 10.0 s, N5 T2
  10.0 / 9.7 s, N25 T3 8.9 / 8.7 s, N3 T2 8.5 / 8.3 s, A3 T2 8.5 / 8.3 s, N17 T2 8.1 / 7.8 s, F1b T2 8.0 / 7.8 s); page median J04 5.3 s, J03
  5.5 s; **server (`Server-Timing` total) median 5.2 s, p90 7.7 s, max 12.0 s**; `AiRun` max 11.97 s (N7 T1, two searches, no guard retry);
  API « playground turn answered » lines: 98 since 05:43, `waitMs − runMs` max 64 ms, 0 replay, 0 « did not finish »; 1 POST per turn seen by
  the page; page − server median 0.22 s, max 0.34 s. 9 turns ≥ 8 s on the page, 4 ≥ 10 s, **3 ≥ 10 s on the server (N7 T1, PG2 T2, PG1 T2)**
  (R17: 1 — N23 T2, 6.1 s this round).
- Quantity never asked again after a product is named: **0 quantity question in 98 turns** (« 2 pièces », « zoudj », « زوج », « 3 tapis au
  lieu de 2 », « ديرلي جوج », « wahed », « واحد » kept).
- Language kept: arabizi **9 / 9** (PG1, F9, N16, C2, F3, P2, N23, N3 after the switch, F5 mixed), Arabic-script darija **7 / 7** (PG2, N21,
  N11, N25, A1, N18, A3), French **15 / 15**; F5 T3 « oui c'est bon » confirmed in arabizi after the
  arabizi recap.
- **No Tunisian / Moroccan words sent: 31 / 31** — check.cjs word list: 0 hit (R17: 1); the guard rewrote / stripped a Moroccan form in 4
  replies (P2 T1, F9 T1, N11 T3, N16 T1) before they were sent (R17: 2).
- **Out-of-stock product offered: 0** (R17: 1) — N7 lists Sac (Noir / Marron, no Rouge), Robe (S / M / XL, no L), Basket (40 / 42 / 43, no
  41); P2 « taille L makach dork » (said unavailable, not offered); N5 / N5b name the Parfum Oud only because the customer asked for it.
- No Markdown in a reply: **98 / 98**. No invented discount: only the catalogue's old prices (Hijab « بدل 2000 دج » / « (بدل 2000 دج) »,
  Djellaba « بدل 9000 دج »); Oran free delivery only from 20 000 DA (N5 / N5b 24 990 DA).
- Tool calls in 98 turns (playground 94 turns from the response + shared link 4 turns from `AiToolCall`): `create_order` 53 (29 recaps + 23
  orders + 1 blocked), `quote_delivery` 12 (PF1b T1, PF1 T2, PG1 T2, PG2 T2, F9 ×3, N16, F5 T1, F12, F1b T2, N3 T2), `search_products` 4 (N4
  T1, N7 T1 ×2, F1 T1), `lookup_order` 2 (N11 T3, by phone then by number), `cancel_order` 0, `check_availability` 0, **`handoff_to_human` 1
  (W1, right, accepted)**, `get_product` 0, `add_faq_candidate` 0; **0 search after a recap call in 29 recaps**. Turns with more than one
  call: F9 (3 quotes, one per asked wilaya), N3 T2 (quote + recap, the wilaya first named there), N7 T1 (2 searches), N11 T3 (2 lookups).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards (« (no photo) » = the card has no image) · tool calls with their results (draft / core = first 6 characters of the server keys). Every J03 conversation has the « out_of_hours » system line. Shared-link turns (F5, F12) carry no tool calls, cards' photos or detected language in the visitor response; their tool calls are given from the server rows in the verdict.

### PF1 — J03 playground (UI fr)
**Verdict: FAIL — R18-1 (place first, fr, the exact R17-1 message, J03 out of hours) — R17-1's wrong hand-off is gone: T1 « Bonjour, j'habite à Sétif, El Eulma » → no `handoff_to_human`, status OK, intent greeting; **but 0 tool call and no fee**: « Merci pour l'info, on a bien noté Sétif, El Eulma. Qu'est-ce qui vous intéresse aujourd'hui ? … » (R16: « … 650 DA à domicile, ou 350 DA en stop-desk … »). T2 is now right (R17-1 / R17-6 T2 fixed): one `quote_delivery {wilayaId 19}`, price and both fees before the mode question « … disponible à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. … », no `create_order` without an address (R17: `VALIDATION address`). T3 recap, T4 « oui » → TEST-6293 7 550 DA. `AiRun` 01a1ecfd-49a2… (T1).**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 4.9 s (server 4.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Merci pour l'info, on a bien noté Sétif, El Eulma. Qu'est-ce qui vous intéresse aujourd'hui ? Dites-moi ce que vous cherchez et je vous montre les articles disponibles. 😊 »
- **T2** C: « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 » · `fr` · 3.9 s (server 3.7 s)
  - AI: « Parfait Karim, le sac à main cuir marron est disponible à 6900 DA. À domicile : 650 DA, en stop-desk : 350 DA. Souhaitez-vous une livraison à domicile (il me faudra votre adresse : rue, cité ou repère) ou en stop-desk ? »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 5.0 s (server 4.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr` · 4.9 s (server 4.7 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### PF1b — J04 playground (UI fr)
**Verdict: PASS (place first, fr, run 2 of 2 on the J04 shop, in hours) — T1 `quote_delivery {Sétif}` → « Bonjour ! Oui, on livre à Sétif et El Eulma. La livraison à domicile coûte 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Qu'est-ce qui vous intéresse aujourd'hui ? » — no hand-off, both fees; T2 « Hijab soie : 1500 DA » + the address question with the stop-desk fee (home fee said at T1), 0 tool call; T3 recap 2 150 DA; « oui » → TEST-7017.**

- **T1** C: « Bonjour, j'habite à Sétif, El Eulma » · `fr` · 6.9 s (server 6.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonjour ! Oui, on livre à Sétif et El Eulma. La livraison à domicile coûte 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Qu'est-ce qui vous intéresse aujourd'hui ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T2** C: « Je voudrais 1 hijab soie. Karim Haddad 0770112233 » · `fr` · 6.4 s (server 6.2 s)
  - AI: « Merci Karim ! Hijab soie : 1500 DA. Pour finaliser, quelle est votre adresse à Sétif / El Eulma (rue, cité ou repère) ? Sinon, on peut aussi vous livrer en stop-desk pour 350 DA. »
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 5.5 s (server 5.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 2 150 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft eff6e2… core 393f6e…, recap total 2150`
- **T4** C: « oui » · `fr` · 5.9 s (server 5.7 s)
  - AI: « Votre commande TEST-7017 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 650 DA ⏎ Total : 2 150 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …450a, customerConfirmed true} → ok TEST-7017, total 2150`

### PG1 — J04 playground (UI fr)
**Verdict: FAIL — R18-1 (NEW greeting + place, arabizi, J04) — T1 « slm, ana f Oran, Bir El Djir » → no hand-off (right) but 0 tool call and no fee: « Salam, marhba bik! Ahlan bik f Oran. Wach men produit t7ebb tchri lyoum ? » (`AiRun` 01a1ecf8-24a7…). T2 `quote_delivery {Oran, subtotal 1500}` → price, both fees (Oran home 600 — under 20 000 DA, paid — and stop-desk 400) and the mode / address question, in arabizi, **10.3 s / server 10.0 s** (R18-3); « tsajjel: hijab soie wahed » before any recap (R18-4). T3 arabizi recap 2 100 DA, T4 « ih » → TEST-1288.**

- **T1** C: « slm, ana f Oran, Bir El Djir » · `arabizi` · 4.1 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam, marhba bik! Ahlan bik f Oran. Wach men produit t7ebb tchri lyoum ? »
- **T2** C: « nheb hijab soie wahed, smiti Nadia Kaci 0661234568 » · `arabizi` · 10.3 s (server 10.0 s)
  - AI: « Saha Nadia, tsajjel: hijab soie wahed, 1500 DA. Tawsil l Bir El Djir (Oran): 600 DA l dar wela 400 DA f stop-desk, ywasel f 2 l 5 ayam. T7ebb nwasslouha l dar wela f stop-desk ? Ila l dar, a3tini l'adresse ta3ek (rue, cité, wela blassa ma3roufa 9rib). »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400`
- **T3** C: « cite 1000 logements bloc 4 » · `arabizi` · 5.1 s (server 4.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Smitek: Nadia Kaci ⏎ Numéro: 0661234568 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 062285… core 22b9bb…, recap total 2100`
- **T4** C: « ih » · `arabizi` · 5.9 s (server 5.7 s)
  - AI: « Commande ta3ek TEST-1288 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 600 DA ⏎ Total: 2 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …450a, customerConfirmed true} → ok TEST-1288, total 2100`

### PG2 — J03 playground (UI ar)
**Verdict: FAIL — R18-1 / R18-2 (NEW greeting + place, Arabic script, J03 out of hours, the Arabic out-of-hours line) — T1 « السلام عليكم، أنا من البليدة بوفاريك » → no hand-off but 0 tool call and no fee: « وعليكم السلام ورحمة الله، مرحبًا بيك في بلدية بوفاريك! واش تحب تلقى عندنا اليوم؟ » (« welcome to the municipality of Boufarik » — R18-4). T2 « نحب جلابة رجالي، سمير بن علي 0661234567 » → `quote_delivery {9}` → both fees (450 / 300) and the mode question **without the Djellaba's price (7 500 DA)** (R18-2), **10.7 s / server 10.4 s** (R18-3). T3 recap « حي 20 أوت فيلا 3، بوفاريك، البليدة » 7 950 دج, T4 « ايه » → TEST-1772.**

- **T1** C: « السلام عليكم، أنا من البليدة بوفاريك » · `ar` · 3.2 s (server 3.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام ورحمة الله، مرحبًا بيك في بلدية بوفاريك! واش تحب تلقى عندنا اليوم؟ »
- **T2** C: « نحب جلابة رجالي، سمير بن علي 0661234567 » · `ar` · 10.7 s (server 10.4 s)
  - AI: « صحيت، سميتك سمير بن علي ورقمك 0661234567 وبلديتك بوفاريك، ولاية البليدة. للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. تحب نوصلوها للدار ولا في ستوب ديسك؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `quote_delivery {9} → fee 450 / stop-desk 300`
- **T3** C: « حي 20 أوت فيلا 3 » · `ar` · 5.8 s (server 5.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 20 أوت فيلا 3، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 636105… core 9bff87…, recap total 7950`
- **T4** C: « ايه » · `ar` · 5.9 s (server 5.8 s)
  - AI: « تم تسجيل طلبيتك TEST-1772 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 7 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «بوفاريك», address «حي 20 أوت فيلا 3», items 1×product …efdc, customerConfirmed true} → ok TEST-1772, total 7950`

### N5 — J04 playground (UI fr)
**Verdict: PASS (R17-2 fixed, run 1 of 2, out of stock, price asked, fr) — T1 « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible … notre Coffret cadeau Aïd — 24990 DA … Ça vous intéresse ? » (price given); T2 « je le prends » + fields → 0 tool call (R17: 2 searches + recap, R17-6), the model asks the substitute first: « … Vous voulez bien le Coffret cadeau Aïd à 24990 DA ? Dites-moi oui et je prépare la commande pour Bir El Djir. » (as R16; 10.0 s / server 9.7 s with no tool); T3 « oui » → the server's substitute line + recap Coffret, Oran home « gratuite » (24 990 ≥ 20 000 DA — right), no order; **T4 « oui » to that recap → TEST-1709 at once** (R17: a new confirm question). One order, from the one « oui » given to a server recap.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 4.2 s (server 4.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Par contre, notre Coffret cadeau Aïd — 24990 DA, avec parfum, chocolat et carte personnalisée, est disponible. Ça vous intéresse ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 10.0 s (server 9.7 s)
  - AI: « Merci Karim ! Le Parfum Oud n'est pas disponible pour le moment. Vous voulez bien le Coffret cadeau Aïd à 24990 DA ? Dites-moi oui et je prépare la commande pour Bir El Djir. »
- **T3** C: « oui » · `fr` · 7.1 s (server 6.8 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T4** C: « oui » · `fr` · 5.4 s (server 5.1 s)
  - AI: « Votre commande TEST-1709 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-1709, total 24990`

### N5b — J03 playground (UI fr)
**Verdict: PASS (R17-2 fixed, run 2 of 2, same messages on the J03 shop, out of hours) — T1 price + unavailable + Coffret; T2 « … Voulez-vous que je prépare la commande avec ce produit ? » (0 tool call, 4.6 s); T3 « oui » → substitute line + recap (Oran « gratuite »); T4 « oui » → TEST-3367 24 990 DA. No confirm question after the recap.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 4.0 s (server 3.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Par contre, notre Coffret cadeau Aïd (24990 DA) contient un parfum, du chocolat et une carte personnalisée, et il est disponible. Voulez-vous que je vous le présente ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 4.6 s (server 4.4 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Merci pour vos coordonnées, Karim. Si vous voulez, je peux vous commander à la place le Coffret cadeau Aïd (24990 DA), qui est disponible. Voulez-vous que je prépare la commande avec ce produit ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T3** C: « oui » · `fr` · 6.0 s (server 5.8 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …6172, customerConfirmed true} → CONFIRMATION_REQUIRED draft 43ea74… core 7c062d…, recap total 24990`
- **T4** C: « oui » · `fr` · 6.2 s (server 6.1 s)
  - AI: « Votre commande TEST-3367 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …6172, customerConfirmed true} → ok TEST-3367, total 24990`

### F11 — J04 playground (UI fr)
**Verdict: PASS (blocked number) — recap → « oui » → `CUSTOMER_BLOCKED` (server), « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », HANDOFF; no block mentioned, no order.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 5.8 s (server 5.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T2** C: « oui » · `fr` · 8.0 s (server 7.7 s)
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### N4 — J03 playground (UI fr)
**Verdict: PASS (NEW yes variant « oui c'est bon » to a recap, fr, Arabic-script name alone) — T1 « … Pour continuer la commande, à quel nom dois-je l'enregistrer ? » (next field); recap « Nom : سمير بن علي » 3 250 DA → **« oui c'est bon » → TEST-1344, one order**. T2 writes the name in Latin letters in its sentence « je note le nom : Samir Ben Ali » (the recap and the order keep « سمير بن علي »; the guard rewrote a `language_switch` in T2 and T3) — R18-4.**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr` · 6.2 s (server 5.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait, le Tapis de prière est disponible à 2800 DA. C'est un tapis molletonné de 120 x 70 cm, très agréable pour la prière. Pour continuer la commande, à quel nom dois-je l'enregistrer ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 3 product(s)`
- **T2** C: « سمير بن علي » · `fr` · 3.2 s (server 3.0 s)
  - AI: « Très bien, je note le nom : Samir Ben Ali. Pouvez-vous me donner votre numéro de téléphone (par exemple 0555123456) pour continuer la commande ? »
- **T3** C: « 0661234567 » · `fr` · 7.2 s (server 7.0 s)
  - AI: « Très bien, le numéro est bien enregistré. Dans quelle wilaya habitez-vous ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr` · 4.7 s (server 4.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30d47b… core 6ae5a7…, recap total 3250`
- **T5** C: « oui c'est bon » · `fr` · 6.0 s (server 5.8 s)
  - AI: « Votre commande TEST-1344 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-1344, total 3250`

### P2 — J04 playground (UI fr)
**Verdict: PASS (NEW yes variant « wah », arabizi) — T1 sizes S / M / XL with their prices, « taille L makach dork » (L stock 0, not offered); T2 arabizi recap (S) 5 300 DA; **« wah » → TEST-1158, one order**. T1 guard rewrite (`language_switch` + `moroccan_darija`); French inside arabizi left « ideale l l3rass w lmounasabat » (R18-4).**

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 7.1 s (server 6.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3likoum salam! La robe kabyle brodée tsayabet bel yed, tissu khfif, ideale l l3rass w lmounasabat. Tailles S w M b 4900 DA, XL b 5200 DA, w taille L makach dork. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.4 s (server 4.2 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → CONFIRMATION_REQUIRED draft 0c46c8… core eb929b…, recap total 5300`
- **T3** C: « wah » · `arabizi` · 4.8 s (server 4.6 s)
  - AI: « Commande ta3ek TEST-1158 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …a5c5, customerConfirmed true} → ok TEST-1158, total 5300`

### F3 — J03 playground (UI fr)
**Verdict: PASS (NEW yes variant « ih ndirha », arabizi, fields one per message) — « وليد بوزيد » kept, street « cite 20 aout villa 3 » as typed; **« ih ndirha » → TEST-5998, one order**.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 4.4 s (server 4.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Zoudj tapis de prière kayn 3andna, 2800 DA l wa7da. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 2.3 s (server 2.1 s)
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456) bach nkamlou la commande. »
- **T3** C: « 0770112244 » · `arabizi` · 2.5 s (server 2.3 s)
  - AI: « Saha Walid, tsajjel numéro ta3ek. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 7.8 s (server 7.6 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T5** C: « ih ndirha » · `arabizi` · 6.1 s (server 5.9 s)
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### N18 — J03 playground (UI ar)
**Verdict: PASS (NEW yes variant « 👍 » in an Arabic-script chat, Latin name alone) — T1 « … واش سميتك ؟ »; « Samir Benali » kept in the recap; **« 👍 » → TEST-8849, one order**.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar` · 4.4 s (server 4.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « وعليكم السلام! عندنا جلابة رجالي من صوف فين، لونها بيج، مقاس واحد، بسعر 7500 دج بدل 9000 دج. واش سميتك ؟ »
  - cards: « Djellaba homme 7500 DA » (no photo)
- **T2** C: « Samir Benali » · `ar` · 3.7 s (server 3.5 s)
  - AI: « صحيت سامير! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234567 » · `ar` · 2.0 s (server 1.8 s)
  - AI: « صحيت، تسجل. واش من ولاية ؟ »
- **T4** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 4.1 s (server 3.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: Samir Benali ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 125d54… core 64b204…, recap total 8200`
- **T5** C: « 👍 » · `ar` · 6.7 s (server 6.4 s)
  - AI: « تم تسجيل طلبيتك TEST-8849 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «Samir Benali», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …efdc, customerConfirmed true} → ok TEST-8849, total 8200`

### N7 — J03 playground (UI fr)
**Verdict: PASS (R17-3 fixed, product not sold, then « oui ») — T1 two `search_products` (« lunettes de soleil », « lunettes » → nothing) → « Désolé, nous n'avons pas de lunettes de soleil … sac à main en cuir (Noir ou Marron, 6900 DA), la robe kabyle brodée (S, M ou XL, à partir de 4900 DA) ou les baskets Runner (pointures 40, 42 ou 43, 12500 DA) » — in-stock items and sizes only (no Montre connectée, no Rouge, no L, no 41); T2 « oui » → the open question again, no order, no hand-off. **T1 12.3 s / server 12.0 s — the slowest turn of the round** (R18-3).**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 12.3 s (server 12.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Désolé, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer le sac à main en cuir (Noir ou Marron, 6900 DA), la robe kabyle brodée (S, M ou XL, à partir de 4900 DA) ou les baskets Runner (pointures 40, 42 ou 43, 12500 DA). Lequel vous intéresse, Yacine ? »
  - tools: `search_products {«lunettes de soleil»} → 5 product(s)` · `search_products {«lunettes»} → 0 product(s)`
- **T2** C: « oui » · `fr` · 2.8 s (server 2.6 s)
  - AI: « Parfait, Yacine ! Lequel vous intéresse : le sac à main en cuir (Noir ou Marron), la robe kabyle brodée (S, M ou XL) ou les baskets Runner (pointures 40, 42 ou 43) ? »

### A3 — J03 playground (UI ar)
**Verdict: PASS (R17-4 fixed, Arabic script, « ٠٥٥٠… », no separator) — T1 « صحيت يا سميرة، سجلت زوج من Tapis de prière (2800 دج للواحد). واش من ولاية تحب نوصلوهم ليها؟ » — « I noted two », no « order registered » claim (R17 « تسجلت الطلب »); the phone read as 0550123456 (not blocked on J03); recap 6 300 دج → « ايه » → TEST-5126.**

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 6.9 s (server 6.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Nassim! كيف يمكنني مساعدتك؟ » · « out_of_hours: فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. »
  - AI: « صحيت يا سميرة، سجلت زوج من Tapis de prière (2800 دج للواحد). واش من ولاية تحب نوصلوهم ليها؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 8.5 s (server 8.3 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft eeed0a… core 4e537f…, recap total 6300`
- **T3** C: « ايه » · `ar` · 7.6 s (server 7.4 s)
  - AI: « تم تسجيل طلبيتك TEST-5126 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …a750, customerConfirmed true} → ok TEST-5126, total 6300`

### N21 — J04 playground (UI ar)
**Verdict: PASS (R17-4 fixed, fields one per message, Arabic script) — T1 « … مقاس 180 x 70 cm. واش سميتك ؟ » — the name asked (R17 « واش تحب نسجلوه ليك؟ »); recap → « 👍 » → TEST-6619 1 950 دج.**

- **T1** C: « سلام، نحب حجاب حرير » · `ar` · 4.2 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « عندنا Hijab soie بـ 1500 دج بدل 2000 دج، حرير ناعم ومريح، مقاس 180 x 70 cm. واش سميتك ؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « نادية قاسي » · `ar` · 3.9 s (server 3.6 s)
  - AI: « تشرفنا يا نادية! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0661234568 » · `ar` · 3.6 s (server 3.4 s)
  - AI: « صحيت يا نادية، تسجل رقم الهاتف تاعك. واش من ولاية تحب نوصلوليك الحجاب ؟ »
- **T4** C: « البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 3.9 s (server 3.7 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « 👍 » · `ar` · 4.3 s (server 4.0 s)
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`

### A1 — J04 playground (UI ar)
**Verdict: PASS (R17-4 fixed, fields one per message, Arabic script) — T1 « … خفيف وناعم. واش سميتك؟ » (R17 « تحب نجهزلك واحد ؟ »), reached through a guard rewrite of a `confirm_without_recap` (`AiRun` 01a1ecfa-5701…, `rewritten`, remaining []) — nothing of the model's first wording was sent; T2 no item-noted line; recap Alger 400 دج → « ايه » → TEST-4104.**

- **T1** C: « السلام عليكم، نحب حجاب حرير واحد » · `ar` · 4.9 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! الحجاب الحرير متوفر عندنا: Hijab soie — 1500 دج (بدل 2000 دج)، مقاس 180 x 70 سم، خفيف وناعم. واش سميتك؟ »
  - cards: « Hijab soie 1500 DA » (no photo)
- **T2** C: « أمينة سعدي » · `ar` · 3.2 s (server 2.9 s)
  - AI: « تشرفنا يا أمينة! عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية. »
- **T3** C: « 0698765432 » · `ar` · 1.9 s (server 1.7 s)
  - AI: « شكرا يا أمينة، صحيت. واش من ولاية تسكني؟ »
- **T4** C: « الجزائر، باب الزوار، شارع الإخوة بوعدو رقم 5 » · `ar` · 3.9 s (server 3.7 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (باب الزوار، الجزائر): 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ الاسم: أمينة سعدي ⏎ الهاتف: 0698765432 ⏎ العنوان: شارع الإخوة بوعدو رقم 5، باب الزوار، الجزائر ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 00d994… core 48979c…, recap total 1900`
- **T5** C: « ايه » · `ar` · 7.0 s (server 6.7 s)
  - AI: « تم تسجيل طلبيتك TEST-4104 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 400 دج ⏎ المجموع: 1 900 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «أمينة سعدي», phone 0698765432, wilaya 16, commune «باب الزوار», address «شارع الإخوة بوعدو رقم 5», items 1×product …450a, customerConfirmed true} → ok TEST-4104, total 1900`

### F9 — J04 playground (UI fr)
**Verdict: PASS (R17-5 item fixed, three wilayas, arabizi) — three `quote_delivery`; « Sétif : 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. » — every asked fee, no unrelated closing (R17 « T7ebb nchouf wach men produit ? »), « l dar » instead of « à domicile » (guard rewrote a Moroccan form, `AiRun` 01a1ecfa-cd11…).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi` · 5.9 s (server 5.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Sétif : 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk : 400 DA, ywasel f 2 l 5 ayam. Ma nwasslouch l Illizi f had lwaqt. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### N16 — J04 playground (UI fr)
**Verdict: PASS (Illizi alone) — `quote_delivery {Illizi} → WILAYA_NOT_SERVED` → « Ma nwasslouch l Illizi f had lwaqt, smah lina. Ila t7ebb, nqder n3awnek f wilaya okhra wela nwarrik produit. » — no fee invented, no hand-off; the closing offer is still there in another form (R18-4); the guard stripped a Moroccan form (`guard_enforced`, `remaining [moroccan_darija]`).**

- **T1** C: « slm, tawsil l Illizi ? » · `arabizi` · 4.1 s (server 3.8 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ma nwasslouch l Illizi f had lwaqt, smah lina. Ila t7ebb, nqder n3awnek f wilaya okhra wela nwarrik produit. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F1 — J03 playground (UI fr)
**Verdict: PASS (fields one per message, fr) — T1 « … Pour passer commande, quel est votre nom ? »; T4 recap with a « Merci Karim ! » lead-in (no confirm request in it; the recap call sent « Cité 500 logements bloc 12, El Eulma », the recap shows it once); « oui » → TEST-6293 7 550 DA.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 7.7 s (server 7.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6900 DA, en cuir véritable. Pour passer commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
  - tools: `search_products {«sac à main cuir marron»} → 1 product(s)`
- **T2** C: « Karim Haddad » · `fr` · 4.4 s (server 4.1 s)
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone (par exemple 0555123456) ? »
- **T3** C: « 0770112233 » · `fr` · 2.4 s (server 2.0 s)
  - AI: « Merci Karim, c'est noté ! Dans quelle wilaya êtes-vous ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 5.9 s (server 5.7 s)
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui » · `fr` · 4.9 s (server 4.6 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS (R17-4 item fixed) — T1 « Parfait Karim, le sac à main cuir marron est disponible à 6900 DA. Dans quelle wilaya souhaitez-vous être livré ? » (R17 « … et on le prépare pour vous »); T2 one quote, one stop-desk offer (guard rewrote a `fee_missing`, `AiRun` 01a1ed01-a57a…); T4 « oui, c'est bien … » → TEST-6293.**

- **T1** C: « Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr` · 6.8 s (server 6.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Karim, le sac à main cuir marron est disponible à 6900 DA. Dans quelle wilaya souhaitez-vous être livré ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Sétif, El Eulma » · `fr` · 8.0 s (server 7.8 s)
  - AI: « C'est noté, Karim ! Pour Sétif, la livraison à domicile est à 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Donnez-moi votre adresse à El Eulma (rue, cité ou repère), ou choisissez le stop-desk. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350`
- **T3** C: « Cité 500 logements bloc 12 » · `fr` · 5.5 s (server 5.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr` · 4.3 s (server 4.1 s)
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F5 — J04 shared link (UI fr)
**Verdict: PASS (shared link, fr / arabizi mixed, « oui c'est bon ») — T1 « Saha, robe kabyle brodée taille M kayen b 4900 DA. Tsajjelt Amina Saadi, 0698765432, Alger, Bab Ezzouar. L dar: 400 DA, f stop-desk: 250 DA. Wach howa l'adresse ta3ek … wela t7ebb tjibha f stop-desk ? » — price and both fees before the address question (« tsajjelt » = the fields noted, not an order); T2 arabizi recap; T3 « oui c'est bon » → TEST-6890. Server rows (read-only): T1 `quote_delivery {wilayaId 16} → 400 / 250` (guard rewrote a `language_switch`, `AiRun` 01a1ecfb-1c12…) · T2 `create_order` → `CONFIRMATION_REQUIRED` · T3 same call → `ok`.**

- **T1** C: « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar » · 6.2 s (server 6.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Saha, robe kabyle brodée taille M kayen b 4900 DA. Tsajjelt Amina Saadi, 0698765432, Alger, Bab Ezzouar. L dar: 400 DA, f stop-desk: 250 DA. Wach howa l'adresse ta3ek (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib), wela t7ebb tjibha f stop-desk ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « rue des frères Bouadou n 5 » · 4.1 s (server 3.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « oui c'est bon » · 6.0 s (server 5.8 s)
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — 2 → 3 tapis → new recap 9 100 DA; « oui » → TEST-2340.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces. Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr` · 4.7 s (server 4.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T2** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr` · 5.4 s (server 5.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T3** C: « oui » · `fr` · 4.5 s (server 4.3 s)
  - AI: « Votre commande TEST-2340 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2340, total 9100`

### F12 — J04 shared link (UI fr)
**Verdict: PASS (shared link) — « Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk … » (`quote_delivery {Blida}` from `AiToolCall`).**

- **T1** C: « Bonsoir, vous livrez à Blida ? » · 2.5 s (server 2.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Oui, on livre à Blida ! Le tarif est de 450 DA à domicile, ou 300 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous cherchez quelque chose en particulier ? »

### W1 — J04 playground (UI fr)
**Verdict: PASS (wholesale, fr) — this round through the model's own `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie»}` (R17: the platform, 0 call), accepted, AI « Pour le prix de gros, l'équipe de la boutique va vous répondre. » — one sentence, no refusal, 3.4 s.**

- **T1** C: « Bonjour, prix de gros pour 50 pièces du hijab soie ? » · `fr` · 3.4 s (server 3.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Pour le prix de gros, l'équipe de la boutique va vous répondre. »
  - tools: `handoff_to_human {off_catalogue, evidence «prix de gros pour 50 pièces du hijab soie»} → ok`

### H1 — J04 playground (UI fr)
**Verdict: PASS — platform HANDOFF, 0 tool call, « Bien sûr, je vous mets en relation avec l'équipe de la boutique. », 2.2 s.**

- **T1** C: « Bonjour, je veux parler à quelqu'un » · `fr` · 2.2 s (server 2.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Bien sûr, je vous mets en relation avec l'équipe de la boutique. »

### C2 — J04 playground (UI fr)
**Verdict: PASS (arabizi, broken order + refund) — platform HANDOFF (status detail `refund`, 0 tool call; R17: the model's `handoff_to_human {refund}`), « Salam, smahli 3lik 🙏 L'équipe ta3 lboutique rah tchouf m3ak le remboursement. » — arabizi, the reason's sentence.**

- **T1** C: « salam, wsaltni la commande mkassra, nheb tredouli drahmi » · `arabizi` · 4.5 s (server 4.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam, smahli 3lik 🙏 L'équipe ta3 lboutique rah tchouf m3ak le remboursement. »

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya + address change in one message → one call, the recap `create_order` (address sent « Cité 1000 logements bloc 4, Bir El Djir », the recap shows « Cité 1000 logements bloc 4, Bir El Djir, Oran »); Oran 600 DA (7 500 < 20 000 DA); « oui » → TEST-5759 7 500 DA from the reworded confirming call.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 6.6 s (server 6.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 6.6 s (server 6.5 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr` · 5.5 s (server 5.3 s)
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N3 — J03 playground (UI fr)
**Verdict: PASS (fr → arabizi at T2) — T2 `quote_delivery {Constantine}` + recap: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela 450 DA f stop-desk … » then the arabizi recap; « ih saha » → TEST-7010 6 300 DA. T1 « Parfait Samira, 2 tapis de prière molletonnés 120 x 70 cm, c'est noté ! Dans quelle wilaya êtes-vous ? » — the wilaya asked without the price (2 800 DA) (R18-2).**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 5.5 s (server 5.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Parfait Samira, 2 tapis de prière molletonnés 120 x 70 cm, c'est noté ! Dans quelle wilaya êtes-vous ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 8.5 s (server 8.3 s)
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 6.3 s (server 6.1 s)
  - AI: « Commande ta3ek TEST-7010 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-7010, total 6300`

### N11 — J04 playground (UI ar)
**Verdict: PASS (Arabic script, tracking) — recap → « ايه » → TEST-4074; T3 « … مازالت ما خرجتش، درك راهي في التحضير. كي تخرج الطلبية نعطيك رقم التتبع. … » — from `lookup_order` (status new, not sent, no tracking number), nothing invented; two lookups in T3, by phone (→ none, simulated order) then by number (R18-3).**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar` · 5.0 s (server 4.7 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T2** C: « ايه » · `ar` · 6.6 s (server 6.4 s)
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar` · 5.4 s (server 5.2 s)
  - AI: « طلبيتك رقم TEST-4074 مازالت ما خرجتش، درك راهي في التحضير. كي تخرج الطلبية نعطيك رقم التتبع. التوصيل يكون من 2 إلى 5 أيام. »
  - tools: `lookup_order {"phone":"0661234567"} → 0 order` · `lookup_order {"orderNumber":"TEST-4074"} → TEST-4074 new / not_sent, tracking null`

### N17 — J04 playground (UI fr)
**Verdict: PASS (« oui mais livrez à … ») — new recap Alger 400 DA, no order; « oui » → TEST-8063 1 900 DA.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 5.3 s (server 5.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft f00866… core 51097b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 8.1 s (server 7.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 55e0de… core f4cd80…, recap total 1900`
- **T3** C: « oui » · `fr` · 7.3 s (server 7.0 s)
  - AI: « Votre commande TEST-8063 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → ok TEST-8063, total 1900`

### N23 — J03 playground (UI fr)
**Verdict: PASS (arabizi « ih bessah … ») — new arabizi recap Oran 600 DA, no order; « ih » → TEST-5687 8 100 DA. T2 6.1 s (R17 12.1 s).**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi` · 4.0 s (server 3.8 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? » · « out_of_hours: Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, Sétif», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: « ih bessah wasslouha l Oran, Bir El Djir, cite 1000 logements bloc 4 » · `arabizi` · 6.1 s (server 5.9 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (Bir El Djir, Oran): 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: cite 1000 logements bloc 4, Bir El Djir, Oran ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft 4bfbdc… core e3d489…, recap total 8100`
- **T3** C: « ih » · `arabizi` · 7.4 s (server 7.2 s)
  - AI: « Commande ta3ek TEST-5687 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 600 DA ⏎ Total: 8 100 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cite 1000 logements bloc 4», items 1×product …efdc, customerConfirmed true} → ok TEST-5687, total 8100`

### N25 — J04 playground (UI ar)
**Verdict: PASS (Arabic script « ايه بصح ديرلي جوج ») — new recap 2 × 3 450 دج, no order; « ايه » → TEST-6971.**

- **T1** C: « سلام، نحب حجاب حرير واحد، نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar` · 4.1 s (server 3.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T2** C: « ايه بصح ديرلي جوج ماشي واحد » · `ar` · 6.2 s (server 5.9 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 480520… core 1e692b…, recap total 3450`
- **T3** C: « ايه » · `ar` · 8.9 s (server 8.7 s)
  - AI: « تم تسجيل طلبيتك TEST-6971 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, customerConfirmed true} → ok TEST-6971, total 3450`

## Bugs

### R18-1 — A place-only first message gets no fee (PF1, PG1, PG2)
- Page: playground dialog (owner, fr / ar UI, 1440) — « Boutique de Nassim » (out of hours), « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: J03 › step 5 › « Tester moi-même »: send « Bonjour, j'habite à Sétif, El Eulma » (PF1, the R17-1 message) or « السلام عليكم، أنا من
  البليدة بوفاريك » (PG2, ar UI); J04 › « Tester moi-même »: send « slm, ana f Oran, Bir El Djir » (PG1).
- Expected: no hand-off (holds now) and the place's fees in the first answer, as PF1b on J04 this round (« Bonjour ! Oui, on livre à Sétif
  et El Eulma. La livraison à domicile coûte 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Qu'est-ce qui vous intéresse
  aujourd'hui ? ») and R16 PF1 (R17-1 Expected); then the price and both fees before the address / mode question (R15-1).
- Actual (0 tool call, status OK, intent `greeting`, no guard action in all three):
  - **PF1 T1** (J03, 05:49:44, 4.9 s / server 4.7 s, `AiRun` 01a1ecfd-49a2…) → « Merci pour l'info, on a bien noté Sétif, El Eulma. Qu'est-ce
    qui vous intéresse aujourd'hui ? Dites-moi ce que vous cherchez et je vous montre les articles disponibles. 😊 »
  - **PG1 T1** (J04, 05:44:07, 4.1 s / 3.9 s, `AiRun` 01a1ecf8-24a7…) → « Salam, marhba bik! Ahlan bik f Oran. Wach men produit t7ebb tchri
    lyoum ? »
  - **PG2 T1** (J03, 05:50:12, 3.2 s / 3.0 s, `AiRun` 01a1ecfd-b48b…) → « وعليكم السلام ورحمة الله، مرحبًا بيك في بلدية بوفاريك! واش تحب تلقى
    عندنا اليوم؟ »
  - The fees come one turn later, with the product (PF1 T2 « … À domicile : 650 DA, en stop-desk : 350 DA. … », PG1 T2 « Tawsil l Bir El
    Djir (Oran): 600 DA l dar wela 400 DA f stop-desk … », PG2 T2 « للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج » — PG2 without the price,
    R18-2); all three flows end in one order from one « oui / ih / ايه » (TEST-6293, TEST-1288, TEST-1772). Same message on J04 (PF1b):
    `quote_delivery {Sétif}` and both fees.
- Evidence: .local/qa/journeys/R18/out/transcripts/PF1.json, PG1.json, PG2.json T1 (+ `.ui.txt`) · run1.log / run2.log ·
  .local/qa/campaign/retest-ai-r18/fr-PF1-pg.png, fr-PG1-pg.png, ar-PG2-pg.png · out/airun.txt · `AiRun.meta.turn` (toolCalls [], handoff
  false) · compare PF1b.json T1 and R16 PF1
- Likely cause: the R17-1 fix removes the wrong `off_catalogue` hand-off, but a place-only message classed `greeting` is left to the model,
  which quotes the wilaya only sometimes (1 / 4); no rule turns « a wilaya / commune named, no product » into a `quote_delivery` with both
  fees, as the delivery-question path does.

### R18-2 — The product's price not said before the delivery / field questions (PG2, N3)
- Page: playground dialog (owner, ar / fr, 1440) — « Boutique de Nassim » (out of hours)
- Severity: Minor
- Type: Bug
- Steps: J03 › « Tester moi-même »: PG2 « السلام عليكم، أنا من البليدة بوفاريك » → « نحب جلابة رجالي، سمير بن علي 0661234567 »; N3 « Bonjour, je
  voudrais 2 tapis de prière. Samira Benali, 0661234567 ».
- Expected: once a product is named, its price with the fees before the address / mode question (R15-1), as PG1 T2 « Saha Nadia, tsajjel:
  hijab soie wahed, 1500 DA. Tawsil l Bir El Djir (Oran): 600 DA l dar wela 400 DA f stop-desk … » and PF1 T2 « … disponible à 6900 DA. À
  domicile : 650 DA, en stop-desk : 350 DA. … ».
- Actual:
  - **PG2 T2** (05:50:16, 10.7 s / server 10.4 s, `AiRun` 01a1ecfd-c379…, `quote_delivery {wilayaId 9} → 450 / 300`, no search) → « صحيت،
    سميتك سمير بن علي ورقمك 0661234567 وبلديتك بوفاريك، ولاية البليدة. للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. تحب نوصلوها للدار ولا في
    ستوب ديسك؟ » — the Djellaba homme's 7 500 دج (old price 9 000) is said only in the T3 recap.
  - **N3 T1** (05:55:46, 5.5 s / 5.3 s, 0 tool call) → « Parfait Samira, 2 tapis de prière molletonnés 120 x 70 cm, c'est noté ! Dans quelle
    wilaya êtes-vous ? » — no price (2 800 DA each, 5 600 DA); the price first appears in the T2 recap.
- Evidence: .local/qa/journeys/R18/out/transcripts/PG2.json T2, N3.json T1 · ar-PG2-pg.png, fr-N3-pg.png · out/airun.txt
- Likely cause: the guard's `fee_missing` completion adds fees to a mode question but nothing checks that the named product's price was said
  before the field questions; when the product is known from the catalogue summary (no `search_products` call) the model skips the price.

### R18-3 — Three server turns ≥ 10 s; one redundant lookup
- Page: playground dialog (owner, fr / arabizi / ar, 1440) — both shops
- Severity: Minor
- Type: Bug
- Steps: run N7, PG2, PG1, N5, N11; read `Server-Timing` and the tool calls.
- Expected: server time under 10 s (R10-1); no tool call whose result the turn already has (R11-3 … R17-6).
- Actual:
  - **N7 T1** 12.3 s page / **12.0 s server** (`AiRun` 01a1ed00-3067…, 11 969 ms, `search_products {«lunettes de soleil»}` then
    `search_products {«lunettes»}` → nothing, no guard retry, attempt 1) — the slowest turn of the round.
  - **PG2 T2** 10.7 / **10.4 s** (`AiRun` 01a1ecfd-c379…, one `quote_delivery`); **PG1 T2** 10.3 / **10.0 s** (`AiRun` 01a1ecf8-375e…, one
    `quote_delivery`).
  - N5 T2 10.0 / 9.7 s with **0 tool call** (`AiRun` 01a1ecf8-bc96…, 9 714 ms — the model call alone; R17 10.0 s with 3 calls).
  - N11 T3: `lookup_order {phone 0661234567}` → `{orders: []}` (the order is simulated) then `lookup_order {orderNumber TEST-4074}` — the
    number was in the conversation (T2 reply).
  - Fixed since R17-6: N5 T2 0 search (R17 2), PF1 T2 one quote and no premature `create_order` (0 `VALIDATION` in 53 calls), N23 T2 6.1 s
    (R17 12.1 s); 0 search after a recap call.
- Evidence: .local/qa/journeys/R18/out/transcripts/N7.json T1, PG2.json T2, PG1.json T2, N5.json T2, N11.json T3 · out/airun.txt ·
  out/toolcalls.txt · out/api-lines.txt (`waitMs − runMs` ≤ 64 ms, so the time is in the run)
- Likely cause: the model call time (provider); the second search in N7 is a broader retry of an empty query; the phone lookup is tried
  first even when the order number is known.

### R18-4 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440) — both shops
- Severity: Cosmetic
- Type: Text
- Steps: run PG1, PG2, F5, A3, N4, N16, N5, N5b, P2.
- Expected: plain Algerian darija / arabizi / French; the customer's name as written; nothing that reads like an order step before the
  server recap; no offer that cannot apply.
- Actual:
  - Item / field « registered » lines before any recap (no order claimed, a « yes » was not sent to them): PG1 T2 « Saha Nadia, tsajjel:
    hijab soie wahed, 1500 DA. … », F5 T1 « Tsajjelt Amina Saadi, 0698765432, Alger, Bab Ezzouar. … », A3 T1 « … سجلت زوج من Tapis de prière
    … » (R17-4 family, the claim « تسجلت الطلب » is gone), N3 T1 « … c'est noté ! ».
  - Substitute questions worded as an order step: N5 T2 « … Dites-moi oui et je prépare la commande pour Bir El Djir. », N5b T2 « … Voulez-vous
    que je prépare la commande avec ce produit ? » (their « oui » gives the server recap, not an order — right).
  - PG2 T1 « مرحبًا بيك في بلدية بوفاريك! » (« welcome to the municipality of Boufarik »).
  - N4 T2 « Très bien, je note le nom : Samir Ben Ali. » for « سمير بن علي » (the recap and the order keep the Arabic script; the guard rewrote
    a `language_switch` in T2 and T3).
  - N16 « Ila t7ebb, nqder n3awnek f wilaya okhra wela nwarrik produit. » — nothing is delivered to Illizi (R17-5, reworded).
  - French inside arabizi: P2 T1 « … tissu khfif, ideale l l3rass w lmounasabat ».
  - N5 / N5b T1 still offer the Coffret cadeau Aïd (24 990 DA) for a 3 200 DA perfume, and T2 takes « je le prends » for the Coffret after
    asking (R17-5).
  - The reply guard still rewrites / strips a Moroccan form the model wrote (P2 T1, F9 T1, N11 T3, N16 T1 stripped) — nothing Moroccan reached
    the customer (check.cjs 0 hit).
  - Fixed since R17-5: F9 / F9-like closings (« T7ebb nchouf wach men produit ? »), N7 « je note vos coordonnées », F1b « on le prépare pour
    vous », « à domicile » in the F9 arabizi reply (« l dar »).
- Evidence: .local/qa/journeys/R18/out/transcripts/PG1.json T2, F5.json T1, A3.json T1, N3.json T1, N5.json T2, N5b.json T2, PG2.json T1,
  N4.json T2, N16.json, P2.json T1 · `AiRun.meta.guard` (out/airun.txt)
- Likely cause: free model wording.

## Retest
- RETEST R17-1: partly fixed — the wrong hand-off is gone: 4 place-first messages (PF1 exact « Bonjour, j'habite à Sétif, El Eulma » on J03 out
  of hours, PF1b the same on J04, PG1 arabizi, PG2 Arabic script), 0 `handoff_to_human`, status OK each time (R17: `off_catalogue` accepted);
  T2 now gives the price and both fees with one quote and no premature `create_order` (PF1 T2 « … disponible à 6900 DA. À domicile : 650 DA,
  en stop-desk : 350 DA. … », R17: fees without the price + `VALIDATION address`). Left: the place-only turn says no fee in 3 / 4 (PF1, PG1,
  PG2 → R18-1); PG2 T2 no price → R18-2. All four flows end in one order from one « oui ».
- RETEST R17-2: fixed — N5 (J04) and N5b (J03): T2 the model asks the substitute (« … Vous voulez bien le Coffret cadeau Aïd à 24990 DA ? Dites-moi
  oui et je prépare la commande … »), T3 « oui » → the server's substitute line + recap (« Le produit Parfum Oud 50 ml n'est pas disponible pour
  le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif … »), **T4 « oui » → TEST-1709 /
  TEST-3367 at once** (R17: a new confirm question « … je vous envoie le récapitulatif officiel à valider »). 0 « oui » to a server recap lost in
  23. The substitute question wording → R18-4.
- RETEST R17-3: fixed — N7 T1 « … le sac à main en cuir (Noir ou Marron, 6900 DA), la robe kabyle brodée (S, M ou XL, à partir de 4900 DA) ou
  les baskets Runner (pointures 40, 42 ou 43, 12500 DA) » — no Montre connectée (stock 0), no Rouge, no L, no 41; T2 « oui » → no order, no
  hand-off; now through two `search_products` (12.0 s server → R18-3).
- RETEST R17-4: fixed — A3 T1 « صحيت يا سميرة، سجلت زوج من Tapis de prière (2800 دج للواحد). واش من ولاية تحب نوصلوهم ليها؟ » (R17 « تسجلت الطلب »);
  N21 T1 « … واش سميتك ؟ » (R17 « واش تحب نسجلوه ليك؟ »); A1 T1 « … واش سميتك؟ » (R17 « تحب نجهزلك واحد ؟ »; the guard rewrote a
  `confirm_without_recap` this time, `AiRun` 01a1ecfa-5701…); F1b T1 « … disponible à 6900 DA. Dans quelle wilaya souhaitez-vous être livré ? »
  (R17 « … et on le prépare pour vous »). 0 confirm question / registered claim outside a server recap in 98 turns. Item-noted forms left
  (« tsajjel: hijab soie wahed », « Tsajjelt Amina Saadi … », « سجلت زوج ») → R18-4.
- RETEST R17-5: partly fixed — F9 « Sétif : 650 DA l dar, wela 350 DA f stop-desk, … Ma nwasslouch l Illizi f had lwaqt. » (no unrelated closing,
  no « à domicile »); N7 no « je note vos coordonnées ». Left: N16 « … nqder n3awnek f wilaya okhra wela nwarrik produit », P2 « ideale l l3rass w
  lmounasabat », N5 / N5b the Coffret as the alternative, the guard still rewriting / stripping Moroccan forms (4) → R18-4.
- RETEST R17-6: mostly fixed — N5 T2 0 search (R17 two searches + recap), PF1 T2 `quote_delivery` alone (R17 `create_order` → `VALIDATION
  address`), N23 T2 6.1 s (R17 12.1 s), 0 search after a recap call. Left: N7 T1 12.0 s, PG2 T2 10.4 s, PG1 T2 10.0 s on the server, N11 T3 a
  phone lookup before the known number → R18-3.
- R1–R16 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 23 orders**; one order per « oui »: 23 orders,
  never two for one « oui », 0 lost; N17 T2 / N23 T2 / N25 T2 « yes » with a change → new recap; N7 T2, N5 T3, N5b T3 « oui » to no recap → no
  order; R4-1 / R11-2 / R13-1 (no hand-off on an order / field / place / yes message, nor for a product sold or not sold) holds — 0 wrong; R14-3
  (every real hand-off accepted) holds — 4 / 4 (W1 model, H1 / C2 platform, F11 server); R4-2 (a name in another script keeps the language)
  holds — N4, F3, N18; R14-1 (language kept) holds — 31 / 31; R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 29
  / 29; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) holds — 0 in 98 turns (A1 T1 caught by the guard); R4-8 (blocked
  sentence) holds — F11; R5-1 (in-stock alternatives only) holds — N7, P2, N5 / N5b; R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×4);
  R5-4 (no « home or stop-desk ? » after a street) holds — PF1 / PF1b / PG1 / PG2 / F5 / F1b asked it before any street; R5-5 / R7-5 (delivery
  question answered with the fee) holds — F9, N16, F12, N3; R5-6 (no `create_order` before a phone) holds — 0 / 53; R6-4 / R11-4 / R13-2 (recap
  address « …, commune, wilaya ») holds — 29 / 29; R8-3 (named variant) holds; R9-1 (Latin name in an Arabic chat) holds — N18; R10-1
  (latency) — server max 12.0 s, 3 server turns ≥ 10 s (→ R18-3); R11-5 (no provider error) holds — 0 / 98; R12-1 (no `VALIDATION wilayaId`)
  holds — 0 refusal; R13-3 (Arabic street kept) holds — PG2, N11, N18, N21, N25, A1, A3; R13-5 (substitute line) holds — N5, N5b; R15-1 (price
  and both fees before the address question) holds for PF1, PF1b, PG1, F5, F1b, **not for PG2 (→ R18-2)**; R15 / R16 fees — every fee said
  matches the shop's settings (98 / 98 turns, none asked missing); no invented discount (catalogue old prices Hijab 2000, Djellaba 9000; Oran
  free delivery only from 20 000 DA — N5 / N5b 24 990 DA free, PG1 / N1 / N23 paid); N11 tracking from `lookup_order` (status new, not sent, no
  tracking number), nothing invented; R16-1 (every asked fee kept) holds — F9; R16-2 (one reason sentence, no refusal) holds — W1, C2.

## Coverage
- Order flows to « oui »: French ×10 (PF1, PF1b, N5, N5b, N4, F1, F1b, F6, N1, N17; F11 blocked), Arabic-script darija ×7 (PG2, N11, N18,
  N21, N25, A1, A3), arabizi ×6 (PG1, P2, F3, N23, N3 after a switch, F5 mixed fr / arabizi on the shared link); no order, rightly: N7 (nothing
  chosen, with its « oui »), F9, N16, F12 (delivery questions only), C2, H1, W1 (team).
- Asked this round: PF1 ×2 (J03 exact, J04), the 2 NEW greeting-plus-place messages (PG1 arabizi, PG2 Arabic script), N5 ×2 (J04, J03), the 4
  NEW yes variants (« oui c'est bon » N4, « wah » P2, « ih ndirha » F3, « 👍 » N18), F11; N7, A3, N21, A1, F9, N16; the sweep F1, F1b, F3, F5,
  F6, F12, W1, H1, C2, N1, N3, N4, N11, N17, N18, N23, N25, P2; latency of every turn; every fee against the shop's delivery settings.
- Also: « oui mais … » in three scripts (N17, N23, N25), a wilaya not served (F9, N16), the free-delivery threshold reached (N5 / N5b Oran 24 990
  DA → « gratuite ») and not reached (PG1, N1, N23 Oran 600 DA), a blocked number (F11), an out-of-hours shop in French and in Arabic (J03:
  PF1, PG2 and every J03 flow), Arabic-Indic digits (A3), a product not sold (N7).
- Kit: no blocked call, 0 API error, 0 console error, no kit timeout; shared link valid (F5 / F12 answered, no probe needed).

## Not tested
- N9 (photo request) and N14 (cancel after the order) — left out to stay within 100 messages (98 used; N14 needed 3); F9b, W1b, H2, C1, PF2,
  F5b, N12 not re-run (passed in R17 or earlier; not in this round's list); an `angry` hand-off; a J04 conversation outside opening hours / a
  J03 one inside.
- A « yes » sent to an item-noted line (PG1 T2 « tsajjel … », F5 T1 « Tsajjelt … », A3 T1 « سجلت زوج … ») — the flows went on with the field
  each message carried.
- The shared link beyond F5 / F12 (the visitor response has no tool calls; they were read from `AiToolCall`).
- A real order in the back office from the AI: both test surfaces are dry runs (`simulated: true`). The live Messenger path (no page
  connected), so the real hand-offs of W1 / H1 / C2 (inbox assignment, AI paused) were not seen.
- F6, N1, N17, N23, N25 with their fields one per message; `cancel_order` / `lookup_order` on a real order with a courier and a tracking
  number; a product that HAS photos in a photo request; the stall / dup probes of R10 / R11.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place (F11). Shared links of both shops left
  as they were (valid until 18/11 18:04), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-7017 (PF1b), TEST-1288 (PG1), TEST-1772 (PG2), TEST-1709 (N5), TEST-3367
  (N5b), TEST-1344 (N4), TEST-1158 (P2), TEST-5998 (F3), TEST-8849 (N18), TEST-5126 (A3), TEST-6619 (N21), TEST-4104 (A1), TEST-6293 (PF1, F1,
  F1b), TEST-6890 (F5), TEST-2340 (F6), TEST-5759 (N1), TEST-7010 (N3), TEST-4074 (N11), TEST-8063 (N17), TEST-5687 (N23), TEST-6971 (N25); F11
  refused (`CUSTOMER_BLOCKED`). The same content gives the same simulated number (PF1 / F1 / F1b; R17's TEST-6293, TEST-1158, TEST-5998,
  TEST-8849, TEST-6619, TEST-6890, TEST-2340, TEST-4074, TEST-8063, TEST-5687 again); a confirming call that rewords the address, or a changed
  draft, gets another number (N5 TEST-1709 vs R17 TEST-3157, N1, N3, N25, A1, A3).
- Server reads (read-only): `git log --oneline -1` on the VPS, pm2 status, Redis `rl:playground:*` and `rl:agent-test*` count / TTL,
  `DeliveryFeeRule`, `Product` and `ProductVariant` rows of both shops, `AiRun` rows since 04:42 UTC (out/airun.txt, + `meta.turn` of four
  runs), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (out/api-lines.txt) and the API error log date
  (unchanged since 09/11); nothing written.
- Hour counters (read-only): before the run no key on either shop; after the run J04 45 / 60 (window from 05:43:23, the 4 shared-link turns
  count in it too; link IP counter 4), J03 53 / 60 (window from 05:49:38); no 429. Messages used: 98 / 100.
