# R22 — Twenty-second retest of the AI order-taking (after the J03r / J04r fixes) — live site, deployed commit 0b60a12 — 18/11/2026 18:49–19:04 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 0b60a12 (checked read-only: `git log --oneline -1` = « 0b60a12 fix: journey re-run J03r /
J04r / J14r — phones read per line (a wrong then right phone no longer blocks the order), the order-quantity limit hands off server-side,
cancelled TEST orders visible to the lookup, sold-out variants off the product cards, playground usage read, MSA wording layer; … »;
`djaber-v2-api` / `djaber-v2-worker` online, restarted 18:41:26). The two shops of the 18/11 journey re-runs: « Boutique de Karima »
(J04r shop, « Agent J04r », preset Vendeur Pro, default darija, max 5 per order, no amount limit, no opening hours) and « Boutique de
Sofiane » (J03r shop, « Agent J03r Vendeur », default FR, max 5 per order / 50 000 DA, hours Sun–Thu + Sat 08:00–23:00, so Wednesday
18:57–19:03 is inside them). Surfaces: step 5 › « Tester moi-même » (playground, tool calls visible) and each shop's 24 h shared test
link (`/agent-test/<token>`, valid until 19/11 16:50 / 16:24, so no new link was made; the link turns' tool calls were read server side,
read-only, from `AiToolCall`). One browser at a time, the flows one after the other. Hour counters before the run (read-only, Redis
`rl:*`, 18:46): J04r 35 (window of the J04r batch 2, expired 18:50:11), J03r none.

**Delivery settings (read-only, `DeliveryFeeRule`, identical on both shops, last change 18/11 16:10 / 16:49):** Alger 400 home / 250
stop-desk, Blida 450 / 300, Sétif 650 / 350 (custom), Constantine 700 / 450, Oran 600 / 400 (`freeAbove` 20 000 DA, home only), Illizi 1 500 /
1 000 inactive. Stock (read-only, `Product` / `ProductVariant`): J04r Hijab soie 20 (1 500, old price 2 000), Djellaba homme 10 (7 500, old
9 000), Robe kabyle S 5 / M 5 / L 0 / XL 2 (4 900, XL 5 200), Basket sport Runner 40 3 / 41 0 / 42 4 / 43 2 (12 500), Parfum Oud 50 ml 0
(3 200), Montre connectée 0 (15 900, `sellOutOfStock` true), Coffret cadeau Aïd 4 (24 990), « عباية مطرزة » 3 (6 500); J03r the same set
without the Hijab and the Abaya, + Sac à main cuir Noir 3 / Marron 3 / Rouge 0 (6 900), Tapis de prière 15 (2 800), Basket Runner (same
variants). No customer block in either shop.

**Latency method (as R11–R21).** J04r's `conv.mjs` (R21 script + header line + DOM dump) with R22 paths, the shop per conversation, and the
`GET …/test/usage` answer recorded on opening: every POST of a turn is recorded from the page (`turnKey`, sent / ended time, status,
`Server-Timing`, browser timing), the turn time is taken when the answer block appears on the page. `Server-Timing` carries `queue` and
`total` (+ `replay`); « no model time » is read from `total` plus the run's `AiRun.meta.steps` (one entry per model call; `[]` = the server
answered without the model). Server side, read-only: `AiRun` rows (`latencyMs`, `status`, `meta.guard`, `meta.steps`) + `AiToolCall` rows,
the API's « playground turn answered » lines (`runMs`, `waitMs`, `replayed`). No stall / dup probe.

**95 customer messages** (budget 100; J04r 48 of which 9 on the shared link, J03r 47 of which 3 on the shared link) in 31 conversations
(28 playground, 3 shared link). One extra start of FS at 18:51 stopped in the kit before its first message (the « Tester moi-même »
button did not show within 30 s; 0 message sent) and FS was run again at 19:03. Q3c (= Q3 + one message with the details) was added
after Q3 failed, to reproduce it and see the `create_order` path. Flows with `untilOrder` stop at the order. No adaptive re-send, no
re-send by the script (one re-send by the page itself: PH6 T2, same `turnKey`, answered as a replay). Scripts `.local/qa/journeys/R22/scripts/`
(conv.mjs, convs.json, check.cjs, render.cjs, lat-table.cjs, join.cjs, pre.sh / server.sh / tools.sh read-only queries, run.sh, ui.mjs =
step 3 label + playground chips, no message sent), transcripts `.local/qa/journeys/R22/out/transcripts/<id>.json` (+ `.ui.txt`,
`.log.json`, `.dom.html` for FA), run logs `out/run1.log` (J04r), `out/run2.log` (J03r + FS + Q3c), `out/airun.txt`, `out/steps.txt`,
`out/toolcalls.txt`, `out/pre.txt`, rendered turns `out/render.md`, screenshots `.local/qa/campaign/retest-ai-r22/`.

Cases asked for this round:
- **J04r-1** ×6: a wrong phone, then the right one in the next message — fr (PH1 playground), Arabic-script darija (PH2 playground 390,
  PH6 field by field), arabizi (PH3 shared link), en (PH4 playground), fr (PH5 shared link) — ⇒ the right phone, a recap, « oui » ⇒ one
  order; a phone with spaces (FS), dashes (FD), Arabic-Indic digits with spaces (FA); an 11-digit number refused (PH6 T3, PX T1).
- **J03r-1 / J04r-5** ×4: « 6 tapis » (Q1), « 8 حبات » (Q2), « nheb 7 » (Q3, Q3c), « 500 pièces » (Q4) ⇒ a hand-off with the limit sentence;
  « 5 tapis » = the max (Q5) still sells.
- **J04r-2**: order ⇒ « annulez la commande » ⇒ « elle est bien annulée ? » (CX1; CX2 after a replacement; CX3 in Arabic script); « je veux
  annuler ? » as a question (CQ1) ⇒ no cancel without a confirmation.
- **J04r-3** (M3, P3), **J04r-4** (C4, MSA on the shared link at 390), **J03r-4** (CARD), **J04r-6** (header of every opening), J03r-3 /
  J03r-5 / J03r-6 read on the page (no message).
- Sweep F1, F3, N3, N5, N17, P2, A3; latency per turn; every R1–R21 guarantee.

**Result: 27 / 31 conversations pass** — priority 1 (phones) **9 / 10** (the phone part 10 / 10; **PH4 fails R22-3**: no product price before the field question), priority 2 (order limit) **4 / 6** (**Q3 and Q3c fail — R22-1**),
priority 3 (cancel) **4 / 4**, priority 4 **4 / 4**, sweep **6 / 7** (**A3 fails — R22-3**, the same miss). **J04r-1 fixed: the right phone after a wrong one
is used 7 / 7** (PH1 fr « 0698765 » → « 0698765432 », PH2 Arabic « 0661234 » → « 0661234567 », PH3 arabizi on the link « 0555 12 34 » →
« 0555123456 », PH4 en « 077099887 » → « sorry, 0770998877 », PH5 fr on the link « 069876543 » → « 0698765432 », PH6 Arabic field by field
« 06612345678 » → « 0661234567 », PX fr « 06987654321 » → « pardon c'est 0698765432 »), each wrong number answered with one question, the
next message → the server recap with the right number → one order on the yes, 0 `create_order` refused for the phone (J04r: every call
refused « clientPhone missing »); « 0661 23 45 67 », « 0555-12-34-56 », « ٠٥٥٥ ٩٨ ٧٦ ٥٤ » → « 0661234567 », « 0555123456 », « 0555987654 » in
the recap and the order; **an 11-digit number refused 2 / 2** (PH6 T3 « الرقم اللي عطيتيني فيه بزاف ديجيتات، لازم يكون 10 أرقام », PX T1 « Votre
numéro contient 11 chiffres »; J04r: passed over in silence). **J03r-1 / J04r-5 partly fixed: a number followed by a counted word or the
product's name is handed off before any model call, with the limit sentence, 3 / 3** (Q1 « Je veux 6 tapis … » / Q4 « 500 pièces … » → « Une
commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. », Q2 « نحب 8 حبات … » →
« الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. », 0.04–0.05 s server); « 5 tapis » (Q5) → recap → one order; **but
« nheb 7 » right after the product's price is taken by the model: Q3 « Saha, nsajjel lek 7 djellaba homme. Wach smitek ? », Q3c « … l
commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ? » twice, no hand-off (R22-1)**. **J04r-2 fixed**: « elle est bien
annulée ? » → « Oui, la commande TEST-7347 est bien annulée. » / « … TEST-1210 … » / « إيه، الطلبية TEST-2536 راهي ملغية. » with 0 model call
(0.05–0.09 s), « je veux annuler ? » → « Voulez-vous vraiment annuler la commande TEST-4234 (2 × Tapis de prière) ? », nothing cancelled until
« oui annulez ». **J04r-3 fixed** (name / price before « واش سميتك ؟ », 2 / 2), **J04r-4 fixed** (C4 MSA in all 6 replies and the recap), **J03r-4
fixed** (cards « S · M · XL », « 40 · 42 · 43 »), **J04r-6 fixed** (header = the shop's counter on 28 / 28 openings), J03r-3 / J03r-5 / J03r-6
fixed on the page. **Latency: page median 3.5 s, p90 9.2 s, max 20.2 s (PH6 T2, a POST lost on the network then replayed); server median
3.0 s, p90 7.0 s, max 13.0 s (M3 T1); 3 turns ≥ 10 s on the server (M3 T1 13.0, PH5 T1 11.6, A3 T1 11.4 s) — R21 1, J04r 9; `Server-Timing` on
95 / 95 answers; the 29 turns answered without the model 0.04–0.26 s server.** Page − server median 0.27 s but p90 2.6 s, max 10.1 s
(R21 max 0.38 s): the server had answered (`total` 0.1 s) and the response reached the browser seconds later — network between this PC
and the VPS (an SSH session timed out at 18:48), counted on the page column, not filed. **0 order without a server recap; 24 TEST orders,
each from one yes to a server recap (23 with 0 model call; C4's « نعم، أؤكد الطلب » through the model, still one order); 0 yes lost; 2
changes after a recap → a new recap, 0 order; 4 cancels → the right order each; 0 `create_order` with a wrong or missing phone in 51 calls;
1 `VALIDATION` on `create_order` (Q3c T3, an invented `wilayaId 1`); 0 wrong fee in 95 turns.** Failures — no Critical: R22-1 the bare
« nheb 7 » above the limit (Major, the J03r-1 class), R22-2 slow turns / model calls left (Minor), R22-3 PH4 / A3 ask a field before naming the
product and its price (Minor), R22-4 wording (Cosmetic).

## Summary
| flow | shop · surface | language | result | slowest turn (page / server) | order created? | verdict |
|---|---|---|---|---|---|---|
| PH1 | J04r · playground | fr, « 0698765 » then « 0698765432 » | T1 price + home fee + « Le numéro 0698765 semble incomplet »; T2 recap 0698765432; « oui » 0.10 s → TEST-6718 | T1 12.4 s / 9.1 s | yes, 1 | PASS (J04r-1 fixed; R22-2 note) |
| PH2 | J04r · playground 390 | Arabic script, « 0661234 » then « 0661234567 » | T1 « الرقم اللي كتبتو ناقص »; T2 recap 2 200 دج; « ايه » 0.15 s → TEST-8535 | T1 8.4 s / 4.9 s | yes, 1 | PASS |
| PH3 | J04r · shared link | arabizi, « 0555 12 34 » then « 0555123456 » | T1 « Numéro li 3tiitni makach 10 chiffres (0555 12 34 ghir 8) »; T2 recap; « ih » 0.24 s → TEST-1617 | T1 6.5 s / 6.2 s | yes, 1 | PASS (J04r L3 fixed) |
| PH4 | J03r · playground | en, « 077099887 » then « sorry, 0770998877 » | T1 450 / 300 + « missing a digit »; T2 recap; « yes » 0.13 s → TEST-8346 | T1 5.2 s / 5.0 s | yes, 1 | **FAIL — R22-3** (T1 fee only, no product price; phone part PASS) |
| PH5 | J03r · shared link | fr, « 069876543 » then « 0698765432 » | T1 price + 400 / 250 + « semble incomplet »; T2 recap 6 000 DA; « oui » 0.12 s → TEST-4234 | **T1 11.8 s / 11.6 s** | yes, 1 | PASS (R22-2 note) |
| PH6 | J03r · playground | Arabic script, field by field, « 06612345678 » then « 0661234567 » | T3 **11 digits refused**; T4 « صحيت نادية. واش من ولاية ؟ »; T5 recap 3 500 دج; « ايه » 0.28 s → TEST-6280 | T2 20.2 s (network, replay) / 3.6 s | yes, 1 | PASS |
| PX | J03r · playground | fr, « 06987654321 » then « pardon c'est 0698765432 » | T1 price + 400 / 250 + « contient 11 chiffres »; T2 recap; « oui » 0.09 s → TEST-6868 | T1 9.2 s / 9.0 s | yes, 1 | PASS (AI-CHAT-03 note) |
| FS | J04r · playground | fr, « 0661 23 45 67 » | recap 0661234567, 8 150 DA; « oui » 0.14 s → TEST-7347 | T1 3.3 s / 3.0 s | yes, 1 | PASS |
| FD | J03r · playground | arabizi, « 0555-12-34-56 » | recap 0555123456; « ih » 0.16 s → TEST-5915 | T1 3.2 s / 2.2 s | yes, 1 | PASS |
| FA | J04r · playground | Arabic script, « ٠٥٥٥ ٩٨ ٧٦ ٥٤ » | recap 0555987654, Oran 600 دج; « ايه » 0.29 s → TEST-9746 | T1 8.3 s / 3.2 s | yes, 1 | PASS |
| Q1 | J03r · playground | fr « Je veux 6 tapis … » + every field | **server hand-off « Une commande ne peut pas dépasser 5 pièces … », 0 model call** | T1 0.3 s / 0.08 s | — (team) | PASS (J03r-1 fixed here) |
| Q2 | J04r · playground | Arabic script « نحب 8 حبات حجاب حرير … » | **« الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. »** | T1 0.3 s / 0.07 s | — (team) | PASS |
| Q3 | J04r · playground | arabizi « ch7al djellaba homme ? » → « nheb 7 » | **T2 « Saha, nsajjel lek 7 djellaba homme. Wach smitek ? »** — no limit, no hand-off | T1 6.2 s / 6.0 s | no | **FAIL — R22-1** |
| Q3c | J04r · playground | Q3 + name / phone / address | **T2 « … l commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ? »; T3 the same offer, `create_order {quantity 1, wilayaId 1}` → VALIDATION** | T3 10.1 s / 9.9 s | no | **FAIL — R22-1** |
| Q4 | J03r · playground | fr « Je veux commander 500 pièces de votre premier produit » | server hand-off with the limit sentence | T1 0.3 s / 0.06 s | — (team) | PASS |
| Q5 | J03r · playground | fr « 5 tapis » (= the max) | recap 5 × 14 400 DA; « oui » 0.24 s → TEST-8099 | T1 2.7 s / 2.5 s | yes, 1 | PASS |
| CX1 | J04r · playground | fr, order, cancel, « elle est bien annulée ? » | TEST-7347 → `cancel_order` ok → **« Oui, la commande TEST-7347 est bien annulée. » 0.09 s, 0 model call** | T3 3.4 s / 3.2 s | yes, 1, then cancelled | PASS (J04r-2 fixed) |
| CX2 | J04r · playground | fr, order, « mets-en 2 », cancel, question | TEST-4458 → TEST-1210 (replaces) → cancelled → **« Oui, la commande TEST-1210 est bien annulée. »** | T5 4.3 s / 3.4 s | yes, 2 (1 replaced), then cancelled | PASS |
| CQ1 | J03r · playground | fr, order, **« je veux annuler ? »**, « oui annulez » | T3 a confirm question, **no cancel**; T4 `cancel_order` TEST-4234 ok | T2 10.2 s (network) / 0.12 s | yes, 1, then cancelled | PASS (R22-4 note) |
| CX3 | J03r · playground | Arabic script, order, « ألغيلي الطلبية », « راهي تلغات صح؟ » | TEST-2536 cancelled → **« إيه، الطلبية TEST-2536 راهي ملغية. » 0.12 s** | T3 5.6 s / 3.2 s | yes, 1, then cancelled | PASS |
| M3 | J04r · playground | Arabic script « عندكم الساعة الذكية؟ نحب نطلب وحدة » | « … Montre connectée بـ 15 900 دج. واش سميتك؟ » — name + price | **T1 13.8 s / 13.0 s** (slowest server turn) | — | PASS (J04r-3 fixed; R22-2, R22-4 notes) |
| P3 | J04r · playground | Arabic script « … نحب نطلبها » | « أيه، الساعة الذكية متوفرة للطلب بـ 15 900 دج … واش سميتك … ؟ » | T1 8.2 s / 8.0 s | — | PASS (R22-4 note) |
| C4 | J04r · shared link 390 | MSA, 6 messages | **MSA in every reply and the recap** (« أجبني بـ « نعم » لتأكيد الطلب ») → TEST-3145 7 100 دج | T1 6.8 s / 6.6 s | yes, 1 | PASS (J04r-4 fixed; R22-2, R22-4 notes) |
| CARD | J03r · playground | fr, robes, Basket 41 | cards **« 4 900 DA – 5 200 DA · S · M · XL »**, **« 12 500 DA · 40 · 42 · 43 »** | T1 9.0 s / 6.4 s | — | PASS (J03r-4 fixed) |
| F1 | J03r · playground | fr, fields one per message, « oui je prends » | recap Marron 7 550 DA → 0.10 s → TEST-8319 | T2 4.2 s / 4.0 s | yes, 1 | PASS |
| F3 | J03r · playground | arabizi, « smiti وليد بوزيد », « ih ndirha » | « Saha وليد. »; recap → 0.09 s → TEST-5222 | T1 7.3 s / 7.0 s | yes, 1 | PASS |
| N3 | J03r · playground | fr → arabizi « twasslou l Constantine ? » | T2 « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. » + recap; « ih saha » 0.15 s → TEST-9032 | T2 3.9 s / 3.7 s | yes, 1 | PASS |
| N5 | J04r · playground | fr, out of stock, « oui », choice, « oui » | Coffret substitute → its recap (home free); « le hijab soie » → recap 2 100 DA; « oui » 0.08 s → TEST-6230 | T1 4.2 s / 3.9 s | yes, 1 | PASS |
| N17 | J04r · playground | fr « oui mais livrez à Alger … » | new recap 1 900 DA, no order → « oui » 0.12 s → TEST-1216 | T1 8.6 s / 2.7 s | yes, 1 | PASS |
| P2 | J04r · playground | arabizi, « wah ndirha » | « Taille L makanach dork »; recap S 5 300 DA → 0.31 s → TEST-9410 | T1 6.1 s / 5.3 s | yes, 1 | PASS |
| A3 | J03r · playground | Arabic script « … زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » | **T1 « تمام يا سميرة. واش من ولاية تحبي نوصلوهم ليها؟ » — no product, no price, 11.4 s, a `quote_delivery {}` run**; T2 recap 0550123456 → « ايه » 0.10 s → TEST-2155 | **T1 11.6 s / 11.4 s** | yes, 1 | **FAIL — R22-3** (R22-2 note) |

Pass criteria, counted over all flows:
- **A wrong phone, then the right one in the next message → the right phone in the recap and the order: 7 / 7** (PH1, PH2, PH3 link, PH4,
  PH5 link, PH6, PX; fr ×3, Arabic script ×2, arabizi ×1, en ×1). Each wrong number got one short question naming what is wrong (« semble
  incomplet », « ناقص », « makach 10 chiffres (0555 12 34 ghir 8) », « missing a digit », « contient 11 chiffres », « فيه بزاف ديجيتات »), the right
  number the server recap at once (PH6 after its wilaya question) — **`create_order` refused for the phone: 0 / 51 calls** (J04r: every call
  after a correction). No `create_order` ran with a wrong number (PH5 T1 and PH6 T3 asked one; the server did not run it — `stray`).
- **Phone written with separators → read as one number: 4 / 4** — « 0661 23 45 67 » (FS), « 0555-12-34-56 » (FD), « ٠٥٥٥ ٩٨ ٧٦ ٥٤ » (FA),
  « ٠٥٥٠١٢٣٤٥٦ » (A3) → 0661234567, 0555123456, 0555987654, 0550123456; « 0555 12 34 » (8 digits, PH3) refused as too short.
- **11-digit number refused: 2 / 2** — PH6 T3 « 06612345678 », PX T1 « 06987654321 »; the 11 digits were never cut to 10.
- **Quantity above « Quantité max par commande » (5) → hand-off with the limit sentence, never a recap or an offer of the max: 3 / 5** — Q1
  « 6 tapis », Q2 « 8 حبات », Q4 « 500 pièces » (server, 0 model call, `AiRun.status handoff`, 0.04–0.05 s, the platform's hand-off line
  after it); **Q3 / Q3c « nheb 7 » after the price: 0 / 2** (R22-1). **At the max → sold: 1 / 1** (Q5 « 5 tapis » → recap 14 400 DA → TEST-8099).
- « oui » (any yes form) to a server recap → exactly one order with the recap's content: **24 / 24** — « oui » ×10, « ih », « ih saha »,
  « ih ndirha », « wah ndirha », « ايه » ×5, « yes », « oui c'est bon », « oui je prends », « نعم، أؤكد الطلب » (C4, on the link). **Placed with 0
  model call: 23 / 24**, server 0.06–0.31 s; C4 T6 « نعم، أؤكد الطلب » went through the model (1 call, 2.8 s; R22-2). **Order without a server
  recap: 0. Yes to a correct recap lost: 0.**
- **Yes with a change → a new recap, no order: 1 / 1** (N17 T2 → Alger 1 900 DA); change without a yes → a new recap: CX2 T3 (« finalement
  mets-en 2 », « Elle remplacera la commande TEST-4458. ») and N5 T4; each next yes → the new content, 0 model call. **« oui » that answers no
  recap → no order: 1 / 1** (N5 T3 « oui » to the Coffret question → the Coffret's server recap, lead-in « Le produit Parfum Oud 50 ml n'est pas
  disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. »).
- **Cancel after an order → `cancel_order` on that order: 4 / 4** (CX1 TEST-7347, CX2 TEST-1210 — not the replaced TEST-4458, CQ1 TEST-4234
  after the confirmation, CX3 TEST-2536). **« elle est bien annulée ? » / « راهي تلغات صح؟ » → the server's « yes, cancelled », no doubt, no team
  promise: 3 / 3**, 0 model call, 0.05–0.09 s (J04r: « je ne peux pas confirmer … ma réponse précédente était trop rapide »). **« je veux annuler
  ? » → a confirm question, no `cancel_order`: 1 / 1**; « oui annulez » → cancelled.
- Recap complete (catalogue names, variant, mode, fee, total, name, phone, « street, commune, wilaya »): **26 / 26 recaps**; in the customer's
  language 26 / 26 (Arabic script 6 incl. 1 MSA, arabizi 5, French 14, English 1); the named variant every time (P2 S, F1 Marron).
- **Server recap without a model sentence in front: 26 / 26** (lead-ins only the server's: N3 T2 delivery answer, N5 T3 substitute line).
  **Outside any recap, 0 model turn asks to confirm the order or claims it registered** (Q3c T1 `confirm_without_recap` stripped by the guard
  before it was sent; Q3 T2 « nsajjel lek 7 » = R22-1).
- **Fees never wrong: 95 / 95 turns** — Alger 400 / 250, Blida 450 / 300, Sétif 650, Constantine 700 / 450, Oran 600 / 400 (home under 20 000
  paid: FA, CX3, N5 T4, C4; Coffret 24 990 → « gratuite »). Delivery question answered with the delay and both fees: 2 / 2 (N3 T2, C4 T4).
  Where a full address came with the place, the home fee only (PH1 T1, PH2 T1, N5 T2 — R21-3 note, unchanged).
- **Price of the product being sold before the field / mode question: 13 / 15** — PH1, PH2, PH3, PH5, PX, PH6, F1, F3, N3, P2, Q3, M3, P3
  (M3 / P3 = the « sell beyond stock » Arabic messages that had none in J04r); **PH4 T1 and A3 T1 none** (R22-3).
- **Language kept: 31 / 31 conversations** — French 14, Arabic-script darija 8, arabizi 6, English 1, fr → arabizi 1 (N3), MSA 1 (C4, every reply MSA: « الدفع يكون
  عند الاستلام نقدًا فقط. هل تودّ أن أساعدك في اختيار منتج؟ », « نعم، يمكنك استبدال المنتج خلال 7 أيام … », recap « هذا ملخص الطلب: … أجبني بـ « نعم »
  لتأكيد الطلب، أو أخبرني بما يجب تغييره. », confirmation « تم تسجيل طلبك TEST-3145 ✅ … شكراً على ثقتك! »).
  **No Tunisian / Moroccan word sent: 31 / 31** (check.cjs 0 hit; the guard rewrote / stripped a Moroccan form in 4 replies before they were sent).
- **Customer's name as written: 31 / 31** (F3 « Saha وليد. », PH6 « صحيت نادية. », recaps « وليد بوزيد », « سمير بن علي »); 0 name asked again.
- **Hand-offs: 3 / 3 real ones made (Q1, Q2, Q4 — order limit), 0 wrong**; 0 `handoff_to_human` run (PH6 T4 asked one on a phone message; the
  server did not run it). Missing: Q3 / Q3c (R22-1).
- **Out-of-stock product / variant offered: 0** — N5 Coffret, P2 « Taille L makanach dork », CARD « La taille L n'est plus disponible » and
  « la Basket Runner en 41 est en rupture … 40, 42 et 43 »; **cards without the sold-out variants 2 / 2** (CARD).
- **No Markdown, amounts with the thousands space: 95 / 95 replies** (check.cjs: 0 amount ≥ 1 000 without the space, 0 phone / order number /
  street number spaced — « 0698765432 », « TEST-6718 », « cité 1000 logements », « حي 1000 مسكن », « 120 x 70 », « 180 x 70 », « n 5 » kept).
  No invented discount (catalogue old prices only: Hijab 2 000, Djellaba 9 000).
- **No 503 / provider error: 95 / 95**; `AiRun` 95 rows: 92 `ok` + 3 `handoff` (Q1, Q2, Q4), 0 `error`, `attempt` 1; 8 runs with a guard
  action (`rewritten` 6: PH3 T1 / P2 T1 / Q3c T2 moroccan_darija, P3 T1 unavailable_offer, PH6 T2 repeat_greeting, F3 T1 language_switch;
  `stripped` 2: M3 T1 moroccan_darija + unavailable_offer, Q3c T1 language_switch + confirm_without_recap).
- Latency: **page median 3.5 s, p90 9.2 s, max 20.2 s on 95 turns; server (`Server-Timing` total, the run time for the one replay) median 3.0
  s, p90 7.0 s, max 13.0 s** (R21: 3.0 / 5.7 / 10.6 s; J04r: 3.3 / 9.7 / 14.6 s). **≥ 10 s on the server: 3** (M3 T1 13.0 s, PH5 T1 11.6 s, A3
  T1 11.4 s); 9.0–9.9 s: Q3c T1–T3, PH1 T1, PX T1. Page median J04r 3.6 s, J03r 3.4 s. **29 turns without the model (23 orders, 3 limit
  hand-offs, 3 « bien annulée ? »): server 0.04–0.26 s.** The 66 model turns: server median 3.3 s, p90 8.9 s. API « playground turn
  answered » lines 18:49–19:04: 96 (95 turns + the PH6 T2 replay), `waitMs − runMs` ≤ 101 ms, 0 « did not finish ». Page − server: median 0.27
  s, p90 2.6 s, max 10.1 s, 25 turns > 1 s (R21 max 0.38 s) — network: on CQ1 T2 the server answered in 0.12 s and the browser got the
  first byte 10.1 s after sending; PH6 T2's first POST got no answer in 20 s, the page re-sent it with the same `turnKey` and got the stored
  answer (`replay`, 7 ms; the run itself 3.6 s; no second run, no duplicate).
- **Model calls (`AiRun.meta.steps`): 106 in 95 turns** (R21 105 in 99) — 0 calls 29 turns, 1 call 38, 2 calls 19, 3 calls 6 (PH1 T1, M3 T1,
  C4 T3, CARD T1, F1 T2, Q3c T1), 4 calls 3 (PH5 T1, PX T1, A3 T1); next call for `tools` 27×, `guard` 8×, `format` 1×, `stray` 4× (PH5 T1 and
  PH6 T3 `create_order`, PH6 T4 `handoff_to_human`, F1 T2 « dummy »; R21 1×). **0 model call after a recap yes, except C4 T6.**
- Tool calls run (playground from the response + shared link from `AiToolCall`): `create_order` 51 (26 recaps + 24 orders + 1 VALIDATION,
  Q3c T3), `search_products` 10, `quote_delivery` 11 (1 `{}` → VALIDATION, A3 T1), `cancel_order` 4 (all right), `lookup_order` 1 (PH1 T1 `{}` on
  an order message → nothing), `handoff_to_human` 0, `add_faq_candidate` 0, `get_product` 0. `phoneConfirmed` sent once (PX T2, accepted
  as a recap — AI-CHAT-03 note).
- **Usage header on opening = the shop's counter: 28 / 28** (`GET /agents/:id/test/usage` → `used` N, header « N tours cette heure · limite 60 /
  h » / « الأدوار هذه الساعة: N · الحد 60 / س » / « N turns this hour », first turn `hourlyUsed` N + 1 every time: 35, 38, 5, 7, 8 … 47).

## Conversations
Format: customer message · detected language · time from send to the answer on the page (server `total` from `Server-Timing`) · system lines · AI reply (⏎ = line break) · product cards · tool calls run, with their results (draft / core = first 6 characters of the server keys). Calls the model asked but the server did not run are not listed here; they are in `out/steps.txt` and quoted in the verdicts. Shared-link turns (PH3, PH5, C4) carry no tool calls, cards or detected language in the visitor response; their tool calls are given from the server rows in the verdict. Order of the sections: priority 1, 2, 3, 4, then the sweep.

### PH1 — J04r playground (UI fr)
**Verdict:** PASS (J04r-1, fr) — T1 price, home fee and « Le numéro 0698765 semble incomplet », no `create_order`, but a `lookup_order {}` (nothing asked about an order) and 9.1 s server, 3 model calls (R22-2); **T2 « 0698765432 » → the server recap with 0698765432** (J04r P5: « clientPhone missing » on every call); **T3 « oui » 0.10 s server, 0 model call** → TEST-6718. The page time of T3 (4.0 s) is network: `Server-Timing` total 97 ms.

- **T1** C: « Je veux 1 hijab soie, livraison Alger Bab Ezzouar rue des frères Bouadou n 5, Amine Kaci 0698765 » · `fr` · 12.4 s (server 9.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Merci Amine ! Hijab soie : 1 500 DA. Livraison à domicile : 400 DA. Le numéro 0698765 semble incomplet : pouvez-vous me donner le numéro à 10 chiffres (ex : 0555123456) ? Dès que je l'ai, je vous envoie le récapitulatif de la commande. »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `search_products {«hijab soie»} → 1 product(s)` · `lookup_order {} → 0 order` · `quote_delivery {16} → fee 400 / stop-desk 250`
- **T2** C: « 0698765432 » · `fr` · 4.0 s (server 2.3 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Amine Kaci ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft 69c7b5… core 165c24…, recap total 1900`
- **T3** C: « oui » · `fr` · 4.0 s (server 0.1 s)
  - AI: « Votre commande TEST-6718 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → ok TEST-6718, total 1900`

### PH2 — J04r playground (UI ar)
**Verdict:** PASS (J04r-1, Arabic script, 390) — T1 « الرقم اللي كتبتو ناقص » + price 1 500 دج + home fee 700 دج (stop-desk not said: the address was given, R21-3 note); **T2 « 0661234567 » → recap**; **T3 « ايه » 0.15 s server, 0 model call** → TEST-8535. (The hour window of the J04r shop was renewed between T1 and T2: T1 `hourlyUsed` 39, T2 1.)

- **T1** C: « السلام، نحب حجاب حرير واحد، اسمي نادية بن علي، قسنطينة الخروب حي 1000 مسكن عمارة 4، 0661234 » · `ar` · 8.4 s (server 4.9 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا نادية! حجاب الحرير متوفر عندنا بسعر 1 500 دج، قماش حرير ناعم بمقاس 180 x 70 سم. الرقم اللي كتبتو ناقص، عطيني رقم الهاتف تاعك (مثال: 0555123456). التوصيل للدار: 700 دج. »
  - cards: « Hijab soie 1500 DA » (no photo)
  - tools: `quote_delivery {25} → fee 700 / stop-desk 450`
- **T2** C: « 0661234567 » · `ar` · 4.5 s (server 3.1 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 2 200 دج، الدفع عند الاستلام. ⏎ الاسم: نادية بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 4، قسنطينة الخروب», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft f870dc… core 48ca51…, recap total 2200`
- **T3** C: « ايه » · `ar` · 3.2 s (server 0.2 s)
  - AI: « تم تسجيل طلبيتك TEST-8535 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 2 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 4», items 1×product …0845, customerConfirmed true} → ok TEST-8535, total 2200`

### PH3 — J04r shared link (UI fr)
**Verdict:** PASS (J04r-1, arabizi, shared link — J04r L3 reproduced) — T1 « Numéro li 3tiitni makach 10 chiffres (0555 12 34 ghir 8) » + price + home fee; server rows: T1 `quote_delivery` only; **T2 `create_order {clientPhone 0555123456}` → recap**; **T3 « ih » 0.24 s server, 0 model call** → TEST-1617.

- **T1** C: « nheb hijab soie wahed, smiti Amina Saadi, Alger Bab Ezzouar rue des frères Bouadou n 5, 0555 12 34 » · 6.5 s (server 6.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Saha Amina, hijab soie b 1 500 DA, wa7ed. Numéro li 3tiitni makach 10 chiffres (0555 12 34 ghir 8). A3tini numéro kamel (ex: 0555123456). Tawsil l dar: 400 DA. »
- **T2** C: « 0555123456 » · 3.2 s (server 3.1 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 1 900 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0555123456 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T3** C: « ih » · 0.4 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-1617 tsajlet ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison: 400 DA ⏎ Total: 1 900 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### PH4 — J03r playground (UI en)
**Verdict:** FAIL — R22-3 (the phone part PASSES: J04r-1 in English) — **T1 says the fees and that the phone « is missing a digit », never the prayer rug or its 2 800 DA** (R15-1 / R18-2); T2 « sorry, 0770998877 » → recap with 0770998877; T3 « yes » 0.13 s server, 0 model call → TEST-8346.

- **T1** C: « Hi, I want 1 prayer rug delivered at home to Blida, Boufarik, cité 20 août villa 3, John Doe, 077099887 » · `en` · 5.2 s (server 5.0 s)
  - system: « welcome: Hello 👋 Welcome to Boutique de Sofiane! How can I help you? »
  - AI: « Thanks, John! The delivery to Boufarik (Blida) is 450 DA at home, and it takes 2 to 5 days. Stop-desk delivery is 300 DA. The phone number you sent, 077099887, is missing a digit. Could you send it again with all 10 digits, for example 0555123456? »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300`
- **T2** C: « sorry, 0770998877 » · `en` · 3.2 s (server 2.7 s)
  - AI: « Here is your order summary: ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Home delivery (Boufarik, Blida): 450 DA ⏎ Total: 3 250 DA, cash on delivery. ⏎ Name: John Doe ⏎ Phone: 0770998877 ⏎ Address: cité 20 août villa 3, Boufarik, Blida ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {name «John Doe», phone 0770998877, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft a4c19a… core 2ec0ee…, recap total 3250`
- **T3** C: « yes » · `en` · 0.6 s (server 0.1 s)
  - AI: « Your order TEST-8346 is confirmed ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Delivery: 450 DA ⏎ Total: 3 250 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «John Doe», phone 0770998877, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …6b3a, customerConfirmed true} → ok TEST-8346, total 3250`

### PH5 — J03r shared link (UI fr)
**Verdict:** PASS (J04r-1, fr, shared link) — **T1 11.6 s server, 4 model calls** (search, quote, a `stray` `create_order` the server did not run, text — R22-2); price, 400 / 250 and « semble incomplet »; **T2 → recap with 0698765432**; T3 « oui » 0.12 s, 0 model call → TEST-4234 (the same simulated number as J03r's L04 with the same content).

- **T1** C: « Je veux 2 tapis de prière livrés à domicile à Alger, Bab Ezzouar, rue des frères Bouadou n 5, Amine Kaci 069876543 » · 11.8 s (server 11.6 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Merci Amine ! Le numéro 069876543 semble incomplet, il faut 10 chiffres (ex : 0555123456). Tapis de prière : 2 800 DA. Pouvez-vous me le redonner ? Pour info, la livraison à domicile à Alger est à 400 DA, délai 2 à 5 jours. En stop-desk, c'est 250 DA. »
- **T2** C: « 0698765432 » · 3.4 s (server 2.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 6 000 DA, à payer à la livraison. ⏎ Nom : Amine Kaci ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T3** C: « oui » · 0.3 s (server 0.1 s)
  - AI: « Votre commande TEST-4234 est bien enregistrée ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison : 400 DA ⏎ Total : 6 000 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### PH6 — J03r playground (UI ar)
**Verdict:** PASS (J04r-1, Arabic script, field by field — J04r C2 reproduced on J03r) — T1 price 2 800 دج; T2 asks the phone; **T3 « 06612345678 » refused: « الرقم اللي عطيتيني فيه بزاف ديجيتات، لازم يكون 10 أرقام »** (J04r: passed over); **T4 « 0661234567 » → « صحيت نادية. واش من ولاية ؟ »**; T5 → recap; T6 « ايه » 0.28 s, 0 model call → TEST-6280. T2's 20.2 s on the page: the first POST got no answer in 20 s, the page re-sent it with the same `turnKey`, answer replayed in 7 ms (run 3.6 s, one run). T3 asked a `create_order` and T4 a `handoff_to_human` that the server did not run (`stray`).

- **T1** C: « السلام عليكم، نحب تابي تاع الصلاة واحد » · `ar` · 10.1 s (server 5.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Sofiane! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا Tapis de prière بـ 2 800 دج، وهو متوفر. مبطّن وقياسه 120 x 70 سم، مريح للصلاة. تحب نكمّلو معاك الطلبية؟ »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T2** C: « اسمي نادية بن علي » · `ar` · 20.2 s (server 0.0 s) · 2 attempts, same turnKey
  - AI: « صحيت. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية تاع Tapis de prière. »
- **T3** C: « 06612345678 » · `ar` · 4.5 s (server 4.3 s)
  - AI: « الرقم اللي عطيتيني فيه بزاف ديجيتات، لازم يكون 10 أرقام. عطيني رقم الهاتف تاعك (مثال: 0555123456) باش نكملو الطلبية تاع Tapis de prière. »
- **T4** C: « 0661234567 » · `ar` · 4.7 s (server 4.5 s)
  - AI: « صحيت نادية. واش من ولاية ؟ »
- **T5** C: « قسنطينة، الخروب، حي 1000 مسكن عمارة 4 » · `ar` · 2.6 s (server 2.4 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Tapis de prière : 2 800 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 3 500 دج، الدفع عند الاستلام. ⏎ الاسم: نادية بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 4», items 1×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 9de8f5… core f86201…, recap total 3500`
- **T6** C: « ايه » · `ar` · 0.5 s (server 0.3 s)
  - AI: « تم تسجيل طلبيتك TEST-6280 ✅ ⏎ - 1 × Tapis de prière : 2 800 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 3 500 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 4», items 1×product …6b3a, customerConfirmed true} → ok TEST-6280, total 3500`

### PX — J03r playground (UI fr)
**Verdict:** PASS (11 digits, fr) — **T1 « Votre numéro contient 11 chiffres : pouvez-vous me le renvoyer avec 10 chiffres … ? »** + price + 400 / 250 (9.0 s, 4 model calls, two `search_products` — R22-2); **T2 « pardon c'est 0698765432 » → recap** (the call carried `phoneConfirmed: true`, accepted as a recap — AI-CHAT-03 note); T3 « oui » 0.09 s → TEST-6868.

- **T1** C: « Je veux 1 tapis de prière, livraison à domicile à Alger, Bab Ezzouar, rue des frères Bouadou n 5, Amine Kaci 06987654321 » · `fr` · 9.2 s (server 9.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Merci Amine ! Tapis de prière : 2 800 DA. Pour Alger, la livraison à domicile est à 400 DA et le stop-desk à 250 DA, délai 2 à 5 jours. Votre numéro contient 11 chiffres : pouvez-vous me le renvoyer avec 10 chiffres, par exemple 0698765432 ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `quote_delivery {Alger} → fee 400 / stop-desk 250`
- **T2** C: « pardon c'est 0698765432 » · `fr` · 3.1 s (server 2.9 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 3 200 DA, à payer à la livraison. ⏎ Nom : Amine Kaci ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …6b3a, customerConfirmed true, phoneConfirmed true} → CONFIRMATION_REQUIRED draft b57619… core 7c8354…, recap total 3200`
- **T3** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-6868 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 400 DA ⏎ Total : 3 200 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …6b3a, customerConfirmed true} → ok TEST-6868, total 3200`

### FS — J04r playground (UI fr)
**Verdict:** PASS (spaces) — « 0661 23 45 67 » → recap « Téléphone : 0661234567 »; « oui » 0.14 s, 0 model call → TEST-7347. (A first start at 18:51 stopped in the kit before its first message — 0 sent.)

- **T1** C: « Je prends 1 djellaba homme, Samira Benali, 0661 23 45 67, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr` · 3.3 s (server 3.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 8 150 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …c0ba, customerConfirmed true} → CONFIRMATION_REQUIRED draft 14da01… core 29a466…, recap total 8150`
- **T2** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-7347 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 650 DA ⏎ Total : 8 150 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …c0ba, customerConfirmed true} → ok TEST-7347, total 8150`

### FD — J03r playground (UI fr)
**Verdict:** PASS (dashes, arabizi) — « 0555-12-34-56 » → recap « Numéro: 0555123456 »; « ih » 0.16 s → TEST-5915.

- **T1** C: « salam, nheb tapis de prière wahed, l dar, Blida, Boufarik, cité 20 août villa 3, Walid Bouzid 0555-12-34-56 » · `arabizi` · 3.2 s (server 2.2 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 3 250 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0555123456 ⏎ Adresse: Cité 20 août villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Walid Bouzid», phone 0555123456, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 550486… core b56513…, recap total 3250`
- **T2** C: « ih » · `arabizi` · 1.5 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-5915 tsajlet ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison: 450 DA ⏎ Total: 3 250 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Walid Bouzid», phone 0555123456, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …6b3a, customerConfirmed true} → ok TEST-5915, total 3250`

### FA — J04r playground (UI ar)
**Verdict:** PASS (Arabic-Indic digits with spaces) — « ٠٥٥٥ ٩٨ ٧٦ ٥٤ » → recap « الهاتف: 0555987654 », Oran home 600 دج; « ايه » 0.29 s → TEST-9746. DOM: every number in `<bdi dir="ltr">`.

- **T1** C: « نحب حجاب حرير واحد، للدار في وهران، بئر الجير، حي 1000 مسكن عمارة 4، سمير بن علي ٠٥٥٥ ٩٨ ٧٦ ٥٤ » · `ar` · 8.3 s (server 3.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بئر الجير، وهران): 600 دج ⏎ المجموع: 2 100 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0555987654 ⏎ العنوان: حي 1000 مسكن عمارة 4، بئر الجير، وهران ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0555987654, wilaya 31, commune «بئر الجير», address «حي 1000 مسكن عمارة 4», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft a80b78… core 0c88bd…, recap total 2100`
- **T2** C: « ايه » · `ar` · 1.9 s (server 0.3 s)
  - AI: « تم تسجيل طلبيتك TEST-9746 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 2 100 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0555987654, wilaya 31, commune «بئر الجير», address «حي 1000 مسكن عمارة 4», items 1×product …0845, customerConfirmed true} → ok TEST-9746, total 2100`

### Q1 — J03r playground (UI fr)
**Verdict:** PASS (J03r-1 fixed for this message) — « Je veux 6 tapis de prière … » + every field → **server hand-off, 0 model call, 0.08 s: « Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. »** + the shop's hand-off line; `AiRun.status handoff`; no recap of 5 (J03r LIM: recap « 5 × Tapis de prière »).

- **T1** C: « Je veux 6 tapis de prière, livraison à domicile à Alger, Bab Ezzouar, rue des frères Bouadou n 5, Amine Kaci 0698765432 » · `fr` · 0.3 s (server 0.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. »

### Q2 — J04r playground (UI ar)
**Verdict:** PASS — « نحب 8 حبات حجاب حرير … » → **« الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. »**, 0 model call, 0.07 s.

- **T1** C: « نحب 8 حبات حجاب حرير، للدار في قسنطينة الخروب حي 1000 مسكن عمارة 4، نادية بن علي 0661234567 » · `ar` · 0.3 s (server 0.1 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ » · « handoff: سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. »
  - AI: « الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. »

### Q3 — J04r playground (UI fr)
**Verdict:** **FAIL — R22-1** — T1 price « 7 500 DA, rahi f promo (kanet 9 000 DA) … T7ebb nsajjel lek wahda ? »; **T2 « nheb 7 » → « Saha, nsajjel lek 7 djellaba homme. Wach smitek ? »** — 7 above the max 5 taken as the order's quantity, the name asked, no limit sentence, no hand-off (1 model call, 3.2 s).

- **T1** C: « slm, ch7al djellaba homme ? » · `arabizi` · 6.2 s (server 6.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Djellaba homme b 7 500 DA, rahi f promo (kanet 9 000 DA). Hiya beige, f laine fine, taille unique. T7ebb nsajjel lek wahda ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « nheb 7 » · `arabizi` · 3.5 s (server 3.3 s)
  - AI: « Saha, nsajjel lek 7 djellaba homme. Wach smitek ? »

### Q3c — J04r playground (UI fr)
**Verdict:** **FAIL — R22-1** (Q3 reproduced, then the details) — **T2 « nheb 7 » → « Nqder nsajjel lek djellaba homme, bessah l commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ? »** (the J04r-5 offer: 5 now and a second order); **T3 with name / phone / address → the model's `create_order {quantity 1, wilayaId 1, no commune / address}` → VALIDATION, then « … maximum 5 djellabat f commande wahda, wach t7ebb 5 djellabat wela tfadhel commande okhra ? »** — no hand-off in 3 turns, 9.0–9.9 s each (R22-2).

- **T1** C: « slm, ch7al djellaba homme ? » · `arabizi` · 9.5 s (server 9.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Salam ! Djellaba homme b 7 500 DA bedl 9 000 DA, men sof fin, beige, taille wa7da, w kayna. T7ebb tcommandi ? »
  - cards: « Djellaba homme 7500 DA » (no photo)
  - tools: `search_products {«djellaba homme»} → 1 product(s)`
- **T2** C: « nheb 7 » · `arabizi` · 9.2 s (server 9.0 s)
  - AI: « Nqder nsajjel lek djellaba homme, bessah l commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ? »
- **T3** C: « Walid Bouzid 0555123456, Blida, Boufarik, cité 20 août villa 3, l dar » · `arabizi` · 10.1 s (server 9.9 s)
  - AI: « Saha Walid. Tawsil l dar: 450 DA. Bessah, maximum 5 djellabat f commande wahda, wach t7ebb 5 djellabat wela tfadhel commande okhra ? »
  - tools: `create_order {name «Walid Bouzid», phone 0555123456, wilaya 1, items 1×product …c0ba, customerConfirmed true} → VALIDATION wilayaId` · `quote_delivery {9} → fee 450 / stop-desk 300`

### Q4 — J03r playground (UI fr)
**Verdict:** PASS (the J03r « 500 pièces » chip message, typed) — server hand-off with the limit sentence, 0.06 s.

- **T1** C: « Je veux commander 500 pièces de votre premier produit » · `fr` · 0.3 s (server 0.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? » · « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. »

### Q5 — J03r playground (UI fr)
**Verdict:** PASS — « 5 tapis » (= the max) → recap « 5 × Tapis de prière : 14 000 DA … Total : 14 400 DA »; « oui » 0.24 s → TEST-8099.

- **T1** C: « Je veux 5 tapis de prière, livraison à domicile à Alger, Bab Ezzouar, rue des frères Bouadou n 5, Amine Kaci 0698765432 » · `fr` · 2.7 s (server 2.5 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 5 × Tapis de prière : 14 000 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 14 400 DA, à payer à la livraison. ⏎ Nom : Amine Kaci ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 5×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 61f2f2… core 27504a…, recap total 14400`
- **T2** C: « oui » · `fr` · 0.5 s (server 0.2 s)
  - AI: « Votre commande TEST-8099 est bien enregistrée ✅ ⏎ - 5 × Tapis de prière : 14 000 DA ⏎ Livraison : 400 DA ⏎ Total : 14 400 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 5×product …6b3a, customerConfirmed true} → ok TEST-8099, total 14400`

### CX1 — J04r playground (UI fr)
**Verdict:** PASS (J04r-2 fixed) — recap → « oui » 0.10 s → TEST-7347; « annulez la commande s'il vous plaît » → `cancel_order {TEST-7347, customerConfirmed true}` → ok, « La commande TEST-7347 a bien été annulée. »; **« elle est bien annulée ? » → « Oui, la commande TEST-7347 est bien annulée. », 0 model call, 0.09 s** (J04r C6 / R1: « je ne peux pas confirmer … ma réponse précédente était trop rapide »).

- **T1** C: « Je prends 1 djellaba homme, Samira Benali, 0661234567, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr` · 3.0 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 8 150 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …c0ba, customerConfirmed true} → CONFIRMATION_REQUIRED draft 14da01… core 29a466…, recap total 8150`
- **T2** C: « oui » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Votre commande TEST-7347 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 650 DA ⏎ Total : 8 150 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 19, commune «El Eulma», address «cité 500 logements bloc 12», items 1×product …c0ba, customerConfirmed true} → ok TEST-7347, total 8150`
- **T3** C: « annulez la commande s'il vous plaît » · `fr` · 3.4 s (server 3.2 s)
  - AI: « La commande TEST-7347 a bien été annulée. Si vous changez d'avis, je reste là pour vous aider ! »
  - tools: `cancel_order {"orderNumber":"TEST-7347","customerConfirmed":true,"reason":"Demande du client d'annuler la commande"} → ok, cancelled TEST-7347`
- **T4** C: « elle est bien annulée ? » · `fr` · 0.4 s (server 0.1 s)
  - AI: « Oui, la commande TEST-7347 est bien annulée. »

### CX2 — J04r playground (UI fr)
**Verdict:** PASS (J04r-2, after a replacement — J04r C6 reproduced) — TEST-4458; « finalement mets-en 2 » → new recap « Elle remplacera la commande TEST-4458. »; « oui » 0.10 s → TEST-1210 « Elle remplace la commande TEST-4458, qui est annulée. »; cancel → `cancel_order {TEST-1210}` ok; **« elle est bien annulée ? » → « Oui, la commande TEST-1210 est bien annulée. »**, 0 model call, 0.07 s.

- **T1** C: « Ok je prends 1 hijab soie, Karim Haddad, 0770112233, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 3.6 s (server 2.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft 473e54… core 142729…, recap total 1900`
- **T2** C: « oui c'est bon » · `fr` · 0.7 s (server 0.3 s)
  - AI: « Votre commande TEST-4458 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → ok TEST-4458, total 1900`
- **T3** C: « finalement mets-en 2 » · `fr` · 3.7 s (server 2.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 3 400 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Elle remplacera la commande TEST-4458. ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …0845, replacesOrder TEST-4458, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7f905e… core 137bae…, recap total 3400`
- **T4** C: « oui » · `fr` · 1.2 s (server 0.1 s)
  - AI: « Votre commande TEST-1210 est bien enregistrée ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Livraison : 400 DA ⏎ Total : 3 400 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Elle remplace la commande TEST-4458, qui est annulée. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …0845, replacesOrder TEST-4458, customerConfirmed true} → ok TEST-1210 (replaces TEST-4458), total 3400`
- **T5** C: « annulez la commande s'il vous plaît » · `fr` · 4.3 s (server 3.4 s)
  - AI: « C'est fait, la commande TEST-1210 (2 × Hijab soie, 3 400 DA) est annulée. Si vous souhaitez en repasser une autre, je suis là pour vous aider. »
  - tools: `cancel_order {"orderNumber":"TEST-1210","customerConfirmed":true,"reason":"Demande du client d'annuler la commande"} → ok, cancelled TEST-1210`
- **T6** C: « elle est bien annulée ? » · `fr` · 1.5 s (server 0.1 s)
  - AI: « Oui, la commande TEST-1210 est bien annulée. »

### CQ1 — J03r playground (UI fr)
**Verdict:** PASS (a question is not a cancel) — TEST-4234; **« je veux annuler ? » → « Bien sûr. Tapis de prière : 2 800 DA. Voulez-vous vraiment annuler la commande TEST-4234 (2 × Tapis de prière) ? Répondez « oui » pour que je l'annule. », no `cancel_order`** (the inserted price line → R22-4); « oui annulez » → `cancel_order {TEST-4234}` ok. T2's 10.2 s on the page is network (server 0.12 s).

- **T1** C: « Je prends 2 tapis de prière, livraison à domicile, Amine Kaci 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 3.9 s (server 2.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 6 000 DA, à payer à la livraison. ⏎ Nom : Amine Kaci ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft d49472… core 315c35…, recap total 6000`
- **T2** C: « oui » · `fr` · 10.2 s (server 0.1 s)
  - AI: « Votre commande TEST-4234 est bien enregistrée ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison : 400 DA ⏎ Total : 6 000 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amine Kaci», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 2×product …6b3a, customerConfirmed true} → ok TEST-4234, total 6000`
- **T3** C: « je veux annuler ? » · `fr` · 4.3 s (server 2.4 s)
  - AI: « Bien sûr. Tapis de prière : 2 800 DA. Voulez-vous vraiment annuler la commande TEST-4234 (2 × Tapis de prière) ? Répondez « oui » pour que je l'annule. »
- **T4** C: « oui annulez » · `fr` · 3.9 s (server 3.3 s)
  - AI: « Votre commande TEST-4234 (2 × Tapis de prière) a bien été annulée. Si vous voulez commander autre chose ou repasser une commande plus tard, je suis là pour vous aider ! »
  - tools: `cancel_order {"orderNumber":"TEST-4234","customerConfirmed":true,"reason":"Annulation demandée par le client"} → ok, cancelled TEST-4234`

### CX3 — J03r playground (UI ar)
**Verdict:** PASS (Arabic script) — TEST-2536; « ألغيلي الطلبية من فضلك » → `cancel_order` ok, « تم إلغاء الطلبية TEST-2536 بنجاح. »; **« راهي تلغات صح؟ » → « إيه، الطلبية TEST-2536 راهي ملغية. », 0 model call, 0.12 s**.

- **T1** C: « نحب زوج تابي تاع الصلاة، للدار في وهران، بئر الجير، حي 1000 مسكن عمارة 4، سمير بن علي 0661234567 » · `ar` · 4.4 s (server 3.2 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Sofiane! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (بئر الجير، وهران): 600 دج ⏎ المجموع: 6 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 4، بئر الجير، وهران ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «بئر الجير», address «حي 1000 مسكن عمارة 4», items 2×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 49f578… core bbc641…, recap total 6200`
- **T2** C: « ايه » · `ar` · 2.5 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-2536 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 6 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 31, commune «بئر الجير», address «حي 1000 مسكن عمارة 4», items 2×product …6b3a, customerConfirmed true} → ok TEST-2536, total 6200`
- **T3** C: « ألغيلي الطلبية من فضلك » · `ar` · 5.6 s (server 3.2 s)
  - AI: « تم إلغاء الطلبية TEST-2536 بنجاح. إذا تحب تطلب حاجة أخرى، أنا هنا. »
  - tools: `cancel_order {"orderNumber":"TEST-2536","customerConfirmed":true,"reason":"Le client demande l'annulation de sa commande"} → ok, cancelled TEST-2536`
- **T4** C: « راهي تلغات صح؟ » · `ar` · 1.0 s (server 0.1 s)
  - AI: « إيه، الطلبية TEST-2536 راهي ملغية. »

### M3 — J04r playground (UI ar)
**Verdict:** PASS (J04r-3 fixed) — « التوصيل ممكن يطول شوية، تقدر تطلبها. Montre connectée بـ 15 900 دج. واش سميتك؟ » — the catalogue name and the price before the name question (J04r M2: neither); **13.0 s server, 3 model calls (search, a Moroccan form + an unavailable-offer line stripped by the guard, text) — slowest turn (R22-2)**; the delay sentence comes before the product (R22-4).

- **T1** C: « عندكم الساعة الذكية؟ نحب نطلب وحدة » · `ar` · 13.8 s (server 13.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « التوصيل ممكن يطول شوية، تقدر تطلبها. Montre connectée بـ 15 900 دج. واش سميتك؟ »
  - cards: « Montre connectée 15900 DA » (no photo)
  - tools: `search_products {«Montre connectée»} → 1 product(s)`

### P3 — J04r playground (UI ar)
**Verdict:** PASS (J04r-3 fixed) — « أيه، الساعة الذكية متوفرة للطلب بـ 15 900 دج، بشاشة ملونة وبطارية تدوم 5 أيام. التوصيل ممكن ياخذ شوية وقت أكثر. واش سميتك باش نسجّلوا الطلب؟ » — price, delay, no « made to order » (J04r P3b); the product named « الساعة الذكية », not « Montre connectée », and « أيه » with a hamza (R22-4); 8.0 s, a guard rewrite (unavailable_offer).

- **T1** C: « عندكم الساعة الذكية؟ نحب نطلبها » · `ar` · 8.2 s (server 8.0 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أيه، الساعة الذكية متوفرة للطلب بـ 15 900 دج، بشاشة ملونة وبطارية تدوم 5 أيام. التوصيل ممكن ياخذ شوية وقت أكثر. واش سميتك باش نسجّلوا الطلب؟ »
  - cards: « Montre connectée 15900 DA » (no photo)

### C4 — J04r shared link (UI ar)
**Verdict:** PASS (J04r-4 fixed — MSA customer on the shared link at 390) — T1 « الدفع يكون عند الاستلام نقدًا فقط. هل تودّ أن أساعدك في اختيار منتج؟ », T2 « نعم، يمكنك استبدال المنتج خلال 7 أيام، لكن لا يتم الاسترجاع نقدًا. … », T3 « عباية مطرزة — 6 500 دج … هل تريد أن أسجّل لك الطلب؟ », T4 « التوصيل إلى وهران: 600 دج للتوصيل للمنزل، أو 400 دج إلى نقطة الاستلام (نقطة الاستلام). … » (the term twice → R22-4), **T5 server recap in MSA « هذا ملخص الطلب: … أجبني بـ « نعم » لتأكيد الطلب، أو أخبرني بما يجب تغييره. »**, T6 « نعم، أؤكد الطلب » → « تم تسجيل طلبك TEST-3145 ✅ … شكراً على ثقتك! » — through the model (1 call, 2.8 s — R22-2), one order. J04r C4: darija from T2 on.

- **T1** C: « مرحباً، ما هي طرق الدفع المتاحة؟ » · 6.8 s (server 6.6 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « الدفع يكون عند الاستلام نقدًا فقط. هل تودّ أن أساعدك في اختيار منتج؟ »
- **T2** C: « هل يمكنني إرجاع المنتج إذا لم يناسبني؟ » · 1.4 s (server 1.2 s)
  - AI: « نعم، يمكنك استبدال المنتج خلال 7 أيام، لكن لا يتم الاسترجاع نقدًا. هل تحتاج مساعدة في اختيار منتج معين؟ »
- **T3** C: « أريد عباية مطرزة واحدة، كم سعرها؟ » · 6.5 s (server 6.3 s)
  - AI: « عباية مطرزة — 6 500 دج، وهي متوفرة حاليًا. إنها عباية سوداء بقماش خفيف مطرّز. هل تريد أن أسجّل لك الطلب؟ »
  - cards: « عباية مطرزة 6500 DA » (no photo)
- **T4** C: « كم سعر التوصيل إلى وهران؟ » · 3.4 s (server 3.2 s)
  - AI: « التوصيل إلى وهران: 600 دج للتوصيل للمنزل، أو 400 دج إلى نقطة الاستلام (نقطة الاستلام). المدة من 2 إلى 5 أيام. هل تريد أن نسجّل طلب العباية؟ »
- **T5** C: « الاسم: فاطمة الزهراء بوعلام، الهاتف: 0555987654، العنوان: وهران، بئر الجير، حي 1000 مسكن رقم 12 » · 3.2 s (server 3.0 s)
  - AI: « هذا ملخص الطلب: ⏎ - 1 × عباية مطرزة : 6 500 دج ⏎ - التوصيل إلى المنزل (بئر الجير، وهران): 600 دج ⏎ المجموع: 7 100 دج، الدفع عند الاستلام. ⏎ الاسم: فاطمة الزهراء بوعلام ⏎ الهاتف: 0555987654 ⏎ العنوان: حي 1000 مسكن رقم 12، بئر الجير، وهران ⏎ أجبني بـ « نعم » لتأكيد الطلب، أو أخبرني بما يجب تغييره. »
- **T6** C: « نعم، أؤكد الطلب » · 3.1 s (server 2.9 s)
  - AI: « تم تسجيل طلبك TEST-3145 ✅ ⏎ - 1 × عباية مطرزة : 6 500 دج ⏎ التوصيل: 600 دج ⏎ المجموع: 7 100 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكراً على ثقتك! »

### CARD — J03r playground (UI fr)
**Verdict:** PASS (J03r-4 fixed) — « … 4 900 DA en S et M, et à 5 200 DA en XL. La taille L n'est plus disponible pour le moment. » with the card **« Robe kabyle brodée · 4 900 DA – 5 200 DA · S · M · XL · CARTE RÉELLE »**; « la Basket Runner en 41 est en rupture … 40, 42 et 43 » with **« Basket Runner · 12 500 DA · 40 · 42 · 43 »** (J03r PR1: « S · M · L · XL », « 40 · 41 · 42 · 43 »). The bubble line reads « AGENT J03R VENDEUR · RÉPONDU · VENTE · 0,90 » (J03r-5 fixed).

- **T1** C: « Bonjour, vous avez quoi comme robes ? » · `fr` · 9.0 s (server 6.4 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Nous avons la Robe kabyle brodée, brodée à la main sur un tissu léger, idéale pour les fêtes. Elle est à 4 900 DA en S et M, et à 5 200 DA en XL. La taille L n'est plus disponible pour le moment. Quelle taille vous faut-il ? »
  - cards: « Robe kabyle brodée 4900 DA »
  - tools: `search_products {«robe»} → 1 product(s)`
- **T2** C: « Les baskets Runner en 41 ? » · `fr` · 3.9 s (server 3.6 s)
  - AI: « Désolé, la Basket Runner en 41 est en rupture de stock pour le moment. Les pointures 40, 42 et 43 sont disponibles, à 12 500 DA chacune. Vous voulez laquelle ? »
  - cards: « Basket Runner 12500 DA » (no photo)
  - tools: `search_products {«Basket Runner»} → 1 product(s)`

### F1 — J03r playground (UI fr)
**Verdict:** PASS — « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6 900 DA … à quel nom … ? »; fields one per message; recap 7 550 DA; « oui je prends » 0.08 s, 0 model call → TEST-8319. T2 asked a « dummy » tool (`stray`, not run).

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr` · 3.4 s (server 3.1 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6 900 DA, en cuir véritable. Pour lancer la commande, à quel nom dois-je l'enregistrer ? »
  - cards: « Sac à main cuir 6900 DA » (no photo)
- **T2** C: « Karim Haddad » · `fr` · 4.2 s (server 4.0 s)
  - AI: « Merci Karim ! Pour continuer, quel est votre numéro de téléphone ? (ex : 0555123456) »
- **T3** C: « 0770112233 » · `fr` · 2.3 s (server 2.1 s)
  - AI: « Merci Karim ! Dans quelle wilaya êtes-vous ? »
- **T4** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr` · 3.5 s (server 3.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …e807, customerConfirmed true} → CONFIRMATION_REQUIRED draft 29c96d… core 17f800…, recap total 7550`
- **T5** C: « oui je prends » · `fr` · 0.3 s (server 0.1 s)
  - AI: « Votre commande TEST-8319 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …e807, customerConfirmed true} → ok TEST-8319, total 7550`

### F3 — J03r playground (UI fr)
**Verdict:** PASS — « Zoudj Tapis de prière b 2 800 DA l wa7da, yaʻni 5 600 DA. … Wach smitek ? »; « Saha وليد. »; recap « Smitek: وليد بوزيد »; « ih ndirha » 0.09 s → TEST-5222.

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi` · 7.3 s (server 7.0 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Zoudj Tapis de prière b 2 800 DA l wa7da, yaʻni 5 600 DA. Molletonné, 120 x 70 cm. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « smiti وليد بوزيد » · `arabizi` · 3.5 s (server 3.3 s)
  - AI: « Saha وليد. A3tini numéro ta3ek (ex: 0555123456) ? »
- **T3** C: « 0770112244 » · `arabizi` · 2.1 s (server 1.9 s)
  - AI: « Saha. Wach men wilaya ? »
- **T4** C: « Blida, Boufarik, cite 20 aout villa 3 » · `arabizi` · 3.2 s (server 3.0 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 1cfe09… core 4bb9cf…, recap total 6050`
- **T5** C: « ih ndirha » · `arabizi` · 0.3 s (server 0.1 s)
  - AI: « Commande ta3ek TEST-5222 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …6b3a, customerConfirmed true} → ok TEST-5222, total 6050`

### N3 — J03r playground (UI fr)
**Verdict:** PASS — T1 « Deux Tapis de prière … à 2 800 DA chacun … Quelle est votre wilaya ? »; **T2 « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. » + the recap** (R20-2 still fixed); « ih saha » 0.15 s → TEST-9032.

- **T1** C: « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » · `fr` · 3.5 s (server 3.3 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Sofiane ! Comment puis-je vous aider ? »
  - AI: « Merci Samira ! Deux Tapis de prière molletonné, 120 x 70 cm, à 2 800 DA chacun, soit 5 600 DA au total, sont disponibles. Quelle est votre wilaya ? »
  - cards: « Tapis de prière 2800 DA » (no photo)
- **T2** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi` · 3.9 s (server 3.7 s)
  - AI: « Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700 DA, f stop-desk: 450 DA. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements, bloc 5», items 2×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft a00196… core 453bb9…, recap total 6300`
- **T3** C: « ih saha » · `arabizi` · 0.4 s (server 0.2 s)
  - AI: « Commande ta3ek TEST-9032 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «cité 1000 logements bloc 5», items 2×product …6b3a, customerConfirmed true} → ok TEST-9032, total 6300`

### N5 — J04r playground (UI fr)
**Verdict:** PASS — T1 price + « Désolé, Parfum Oud 50 ml est en rupture … » + the Coffret 24 990 DA; T2 the out-of-stock line again + « Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous le Coffret … ? »; T3 « oui » → the Coffret's recap, home « gratuite », 24 990 DA; T4 « le hijab soie » → recap 2 100 DA; T5 « oui » 0.08 s → TEST-6230.

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr` · 4.2 s (server 3.9 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Le Parfum Oud 50 ml est à 3 200 DA. Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est à 24 990 DA et disponible. »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
- **T2** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr` · 3.7 s (server 3.5 s)
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous le Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) à 24 990 DA à la place ? »
  - cards: « Coffret cadeau Aïd 24990 DA » (no photo)
  - tools: `quote_delivery {31} → fee 600 / stop-desk 400`
- **T3** C: « oui » · `fr` · 3.0 s (server 2.8 s)
  - AI: « Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …57ad, customerConfirmed true} → CONFIRMATION_REQUIRED draft 536480… core e74b25…, recap total 24990`
- **T4** C: « le hijab soie » · `fr` · 3.4 s (server 3.2 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft 30ea62… core bdb3e2…, recap total 2100`
- **T5** C: « oui » · `fr` · 0.3 s (server 0.1 s)
  - AI: « Votre commande TEST-6230 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 600 DA ⏎ Total : 2 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …0845, customerConfirmed true} → ok TEST-6230, total 2100`

### N17 — J04r playground (UI fr)
**Verdict:** PASS — recap Blida 1 950 DA; « oui mais livrez à Alger … » → new recap 1 900 DA, no order; « oui » 0.12 s → TEST-1216.

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3 » · `fr` · 8.6 s (server 2.7 s)
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft d68a20… core 728f4b…, recap total 1950`
- **T2** C: « oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr` · 5.2 s (server 3.8 s)
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → CONFIRMATION_REQUIRED draft 854af0… core 17e487…, recap total 1900`
- **T3** C: « oui » · `fr` · 3.0 s (server 0.1 s)
  - AI: « Votre commande TEST-1216 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …0845, customerConfirmed true} → ok TEST-1216, total 1900`

### P2 — J04r playground (UI fr)
**Verdict:** PASS — « Robe kabyle brodée — 4 900 DA (S, M) wa 5 200 DA (XL). Taille L makanach dork. Wach men taille t7ebb ? »; recap S 5 300 DA; « wah ndirha » 0.31 s → TEST-9410.

- **T1** C: « salam, nheb la robe kabyle brodée » · `arabizi` · 6.1 s (server 5.3 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Wa 3alikoum salam! Robe kabyle brodée — 4 900 DA (S, M) wa 5 200 DA (XL). Taille L makanach dork. Wach men taille t7ebb ? »
  - cards: « Robe kabyle brodée 4900 DA » (no photo)
- **T2** C: « taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi` · 4.0 s (server 3.0 s)
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …acd7, customerConfirmed true} → CONFIRMATION_REQUIRED draft 85f040… core 1dbdbe…, recap total 5300`
- **T3** C: « wah ndirha » · `arabizi` · 1.5 s (server 0.3 s)
  - AI: « Commande ta3ek TEST-9410 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (S) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …acd7, customerConfirmed true} → ok TEST-9410, total 5300`

### A3 — J03r playground (UI ar)
**Verdict:** **FAIL — R22-3** (R21 PASS) — **T1 « تمام يا سميرة. واش من ولاية تحبي نوصلوهم ليها؟ » — no product, no price, 11.4 s, 4 model calls (search, two `quote_delivery`, one run `{}` → VALIDATION — R22-2)**; T2 recap « 2 × Tapis de prière … الهاتف: 0550123456 » (Arabic-Indic digits read right); « ايه » 0.10 s → TEST-2155.

- **T1** C: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ » · `ar` · 11.6 s (server 11.4 s)
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Sofiane! كيف يمكنني مساعدتك؟ »
  - AI: « تمام يا سميرة. واش من ولاية تحبي نوصلوهم ليها؟ »
  - tools: `quote_delivery {} → VALIDATION wilayaName missing`
- **T2** C: « قسنطينة الخروب حي 1000 مسكن عمارة 5 » · `ar` · 3.8 s (server 3.6 s)
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ الاسم: سميرة بن علي ⏎ الهاتف: 0550123456 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …6b3a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 70427d… core 081a65…, recap total 6300`
- **T3** C: « ايه » · `ar` · 0.3 s (server 0.1 s)
  - AI: « تم تسجيل طلبيتك TEST-2155 ✅ ⏎ - 2 × Tapis de prière : 5 600 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 6 300 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سميرة بن علي», phone 0550123456, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 2×product …6b3a, customerConfirmed true} → ok TEST-2155, total 6300`

## Bugs

### R22-1 — A bare quantity above « Quantité max par commande » (« nheb 7 » after the price) is taken by the model: « nsajjel lek 7 », then « T7ebb tkhalli 5, wela tdir commande okhra ? » — no hand-off
- Page: playground dialog (owner, fr UI, 1440) — J04r shop; same code path in live Messenger
- Severity: Major (the J03r-1 / J04r-5 class, one case left)
- Type: Bug
- Steps: 1. Agent with max 5 per order. 2. « slm, ch7al djellaba homme ? ». 3. « nheb 7 ». 4. (Q3c) « Walid Bouzid 0555123456, Blida, Boufarik, cité 20 août villa 3, l dar ».
- Expected: above the max ⇒ never created, hand off with the limit sentence (04-ai-pipeline §4.3 rule 32; step 3 « Au-delà, l'agent transmet la conversation à l'équipe »), as Q1 « Je veux 6 tapis … », Q2 « نحب 8 حبات … » and Q4 « 500 pièces … » now do.
- Actual (Q3 18:53:15–18:53:25, Q3c 19:03:33–19:04:03):
  - Q3 T2 « nheb 7 » → « Saha, nsajjel lek 7 djellaba homme. Wach smitek ? » (1 model call, 3.2 s) — 7 accepted, the name asked.
  - Q3c T2 « nheb 7 » → « Nqder nsajjel lek djellaba homme, bessah l commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ? » (9.0 s) — the J04r-5 offer (5 now and a second order for the rest) word for word.
  - Q3c T3 (name, phone, address) → the model's `create_order { items: [{ quantity: 1 }], wilayaId: 1, clientName: "Walid Bouzid", clientPhone: "0555123456" }` (quantity 1, wilaya 1 = Adrar, no commune / address) → `VALIDATION wilayaId`, reply « Saha Walid. Tawsil l dar: 450 DA. Bessah, maximum 5 djellabat f commande wahda, wach t7ebb 5 djellabat wela tfadhel commande okhra ? » (9.9 s). No hand-off in 3 turns; a « ih » would give a recap of 5.
  - The same limit with the product or a unit word after the number is handed off by the server, 0 model call, 0.04–0.05 s: Q1 « Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. », Q2 « الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. », Q4 the same as Q1.
- Evidence: .local/qa/journeys/R22/out/transcripts/Q3.json T2, Q3c.json T1–T3 · out/toolcalls.txt (19:03:55 `create_order` → VALIDATION) · out/steps.txt · .local/qa/campaign/retest-ai-r22/fr-Q3-pg-1440.png, fr-Q3c-pg-1440.png
- Likely cause: apps/api/src/modules/ai/order-limit.ts `quantitiesAsked` keeps a number only when words follow it (`if (!words.length) continue`), so « nheb 7 » (nothing after the 7) never reaches `quantityAbove`, although the product is the one of the previous turn; and the model never sends `create_order` with the 7 (it lowers it to 1 or offers 5), so the `order_limit` answer that would hand off never comes.

### R22-2 — Slow turns left: 3 server turns ≥ 10 s (M3 T1 13.0 s), extra model calls on first messages, a recap yes in MSA through the model
- Page: playground + shared link (both shops)
- Severity: Minor
- Type: Performance
- Steps: the 95 turns of this run (`Server-Timing` total, `AiRun.meta.steps`).
- Expected: R21 level (server median 3.0 s, p90 5.7 s, max 10.6 s, 1 turn ≥ 10 s); a yes to a server recap with no model time.
- Actual: server median 3.0 s, **p90 7.0 s, max 13.0 s, 3 turns ≥ 10 s** (J04r: p90 9.7 s, 9 turns ≥ 10 s — better, not back to R21):
  - M3 T1 « عندكم الساعة الذكية؟ نحب نطلب وحدة » 13.0 s — `search_products` 4.0 s, a reply with a Moroccan form and an unavailable-offer line (6.7 s) stripped by the guard, a third call 2.1 s.
  - PH5 T1 (shared link, wrong phone) 11.6 s — search, quote, a `create_order` the server did not run (`stray`), text.
  - A3 T1 11.4 s — search, `quote_delivery {}` (VALIDATION « No wilaya given »), `quote_delivery` again, text (R22-3).
  - 9.0–9.9 s: Q3c T1–T3, PX T1 (two `search_products` for the same product), PH1 T1 (`lookup_order {}` on an order message, → nothing).
  - C4 T6 « نعم، أؤكد الطلب » (MSA yes to a server recap) → 1 model call, 2.8 s; the order is right (TEST-3145); the 23 other yes forms 0 model call.
  - `stray` calls 4 in 95 turns (R21 1): PH5 T1 / PH6 T3 `create_order`, PH6 T4 `handoff_to_human` (on « 0661234567 »), F1 T2 « dummy ».
  - Not counted as a server problem: page − server median 0.27 s but p90 2.6 s, max 10.1 s (CQ1 T2: server 0.12 s, first byte 10.1 s after sending; PH6 T2: no answer in 20 s, re-sent with the same `turnKey`, replayed). This PC's link to the VPS was slow during the run (an SSH session timed out at 18:48).
- Evidence: .local/qa/journeys/R22/out/steps.txt · out/airun.txt · transcripts *.json `attempts[].serverTiming`, `browserTiming`

### R22-3 — A first message with the product, the name and the phone (Arabic script / English): the field question comes without the product or its price
- Page: playground dialog (owner, ar / en UI, 1440) — J03r shop
- Severity: Minor
- Type: Bug
- Steps: 1. A3: « السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦ ». 2. PH4: « Hi, I want 1 prayer rug delivered at home to Blida, Boufarik, cité 20 août villa 3, John Doe, 077099887 ».
- Expected: the product being sold and its price before the first field / mode question (R15-1 / R18-2; R21 A3 T1 said it, 13 / 15 turns of this run do).
- Actual:
  - A3 T1 « تمام يا سميرة. واش من ولاية تحبي نوصلوهم ليها؟ » — no « Tapis de prière », no « 2 800 دج » (R21 A3 T1 gave the price; « سجادات صلاة » is a new spelling of the product); 11.4 s, a `quote_delivery {}` run (R22-2). The recap in T2 has the right product.
  - PH4 T1 « Thanks, John! The delivery to Boufarik (Blida) is 450 DA at home, and it takes 2 to 5 days. Stop-desk delivery is 300 DA. The phone number you sent, 077099887, is missing a digit. Could you send it again with all 10 digits, for example 0555123456? » — the fees, not the prayer rug or its 2 800 DA (the model called `quote_delivery` only, no product lookup).
- Evidence: .local/qa/journeys/R22/out/transcripts/A3.json T1, PH4.json T1 · out/steps.txt · .local/qa/campaign/retest-ai-r22/ar-A3-pg-1440.png, en-PH4-pg-1440.png
- Likely cause: the price is added only for a product named in the catalogue's words or returned by this turn's search (`saleProductsOf`, J04r-3 fix); in A3 the search result was not kept as the product being sold, in PH4 no search ran (« prayer rug » is an English name of « Tapis de prière »).

### R22-4 — Wording left
- Page: playground dialog / shared test page (fr / ar, 1440 / 390) — both shops
- Severity: Cosmetic
- Type: Text
- Steps: run CQ1, C4, M3, P3, PH2, N5.
- Expected: no line unrelated to the question; one word per term; the catalogue name; the product before its delivery remark.
- Actual:
  - CQ1 T3 « je veux annuler ? » → « Bien sûr. Tapis de prière : 2 800 DA. Voulez-vous vraiment annuler la commande TEST-4234 (2 × Tapis de prière) ? … » — a price line in a cancel question.
  - C4 T4 (MSA) « … أو 400 دج إلى نقطة الاستلام (نقطة الاستلام). » — the MSA word layer turned the bracketed « ستوب ديسك » into the same words as the term before it.
  - M3 T1 « التوصيل ممكن يطول شوية، تقدر تطلبها. Montre connectée بـ 15 900 دج. واش سميتك؟ » — the delay before the product; P3 T1 « أيه، الساعة الذكية … » (« إيه » written with a hamza on alif) and the product named by the customer's words, not « Montre connectée ».
  - One fee only where a full address came with the place (PH2 T1 « التوصيل للدار: 700 دج. », PH1 T1, N5 T2) and the out-of-stock line twice in N5 T1–T2 — as R21-3.
  - Arabizi first messages still get the Arabic-script welcome (PH3, Q3, Q3c, P2, F3 → « مرحبًا 👋 أهلًا بك في … ») — J04r observation, unchanged.
- Evidence: .local/qa/journeys/R22/out/transcripts/CQ1.json T3, C4.json T4, M3.json T1, P3.json T1, PH2.json T1 · .local/qa/campaign/retest-ai-r22/ar-C4-link-390.png, fr-CQ1-pg-1440.png
- Likely cause: free model wording; the asked-price fix (`withAskedPrice`) adds the price to a reply naming a product even when the message asks no price; `withMsaWording` replaces « ستوب ديسك » by word without checking the term next to it.

## Retest
- RETEST J03r-1: partly fixed — a quantity above the max followed by the product or a unit word is handed off by the server with the limit sentence, 0 model call, no recap of the max: Q1 « 6 tapis » (« Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. »), Q2 « 8 حبات », Q4 « 500 pièces »; the max itself still sells (Q5 « 5 tapis » → TEST-8099); the amount limit not re-run. Still broken for a bare number after the product (« nheb 7 ») → R22-1.
- RETEST J03r-2: not re-run (the 8 step-5 scenarios would take 8 of the 5 messages left); the scenario's message itself (« Je veux commander 500 pièces de votre premier produit », Q4) is now handed off for the limit, which the new `limits_respected` check requires.
- RETEST J03r-3: fixed — the chip reads « Grosse quantité (500 pièces) » / « كمية كبيرة (500 قطعة) » (ui.mjs, no message sent).
- RETEST J03r-4: fixed — cards « 4 900 DA – 5 200 DA · S · M · XL » and « 12 500 DA · 40 · 42 · 43 » (CARD), matching the AI's « La taille L n'est plus disponible » / « 41 … en rupture ».
- RETEST J03r-5: fixed (fr) — the bubble line reads « AGENT J03R VENDEUR · RÉPONDU · VENTE · 0,90 » (CARD.ui.txt); the inspector and the ar / en lines not read.
- RETEST J03r-6: fixed — « Mot-clé personnalisé : un des mots-clés que vous ajoutez ci-dessous » / « كلمة مفتاحية مخصصة: إحدى الكلمات المفتاحية التي تضيفها أدناه » above the chips avocat / arnaque / tribunal / محامي.
- RETEST J04r-1: fixed — a wrong phone then the right one in the next message → the right phone, the recap, one order on the yes: 7 / 7 (fr PH1 / PX playground and PH5 link, Arabic script PH2 at 390 and PH6 field by field, arabizi PH3 on the link = J04r L3, en PH4), 0 `create_order` refused for the phone in 51 calls; « 0661 23 45 67 », « 0555-12-34-56 », « ٠٥٥٥ ٩٨ ٧٦ ٥٤ » read as one number; 11 digits refused 2 / 2 (PH6 T3, PX T1); 0 `phoneConfirmed` loop (once sent in PX T2, accepted as a plain recap).
- RETEST J04r-2: fixed — « elle est bien annulée ? » after the cancel → « Oui, la commande TEST-7347 est bien annulée. » (CX1), « … TEST-1210 … » after a replacement (CX2 = J04r C6), « إيه، الطلبية TEST-2536 راهي ملغية. » (CX3), all from the server with 0 model call; every cancel on the order just placed; « je veux annuler ? » → a confirm question, no `cancel_order` (CQ1); no « annulée » claim without a cancellation in 95 turns.
- RETEST J04r-3: fixed — the « vendre en rupture » watch in Arabic script gets its name / price before « واش سميتك ؟ »: M3 « Montre connectée بـ 15 900 دج », P3 « الساعة الذكية متوفرة للطلب بـ 15 900 دج »; no « made to order »; left: 13.0 s on M3 (R22-2), wording (R22-4).
- RETEST J04r-4: fixed — the MSA customer of C4 (same 6 messages, shared link, 390) is answered in MSA in all 6 replies, the server recap (« أجبني بـ « نعم » لتأكيد الطلب، أو أخبرني بما يجب تغييره. ») and the confirmation (« تم تسجيل طلبك … شكراً على ثقتك! »); left « نقطة الاستلام (نقطة الاستلام) » (R22-4) and the MSA yes through the model (R22-2).
- RETEST J04r-5: partly fixed — « 6 », « 8 حبات », « 500 pièces » handed off; « nheb 7 » gets the same « T7ebb tkhalli 5, wela tdir commande okhra ? » offer as J04r P2 → R22-1.
- RETEST J04r-6: fixed — the header on opening is the shop's counter of the hour, 28 / 28 openings (`GET /agents/:id/test/usage` → « 35 tours cette heure · limite 60 / h », « الأدوار هذه الساعة: 38 · الحد 60 / س », « 0 turns this hour » for a fresh window …; first turn `hourlyUsed` = N + 1 each time; shared-link turns counted in it). The 429 state not reached (max 47 / 60).
- RETEST J04r-7: partly fixed — 3 server turns ≥ 10 s (J04r 9), p90 7.0 s (J04r 9.7 s), max 13.0 s (J04r 14.6 s); the J04r slow turns of the phone loop and the limit are gone (Q1 / Q2 / Q4 0.04–0.05 s, every corrected phone → recap in 2.3–3.1 s server, PH6 T4 4.5 s for its wilaya question); left → R22-2.
- R21 bugs: R21-1 (model time on out-of-stock / field turns) partly — N5 T1–T4 2.7–3.9 s, F1 / F3 field turns 1.9–4.0 s, but the slow first messages of R22-2; R21-2 (arabizi out-of-stock loop) not re-run (N5c not in this round's list); R21-3 (wording) partly — one fee where an address was given, the out-of-stock line twice in N5 (R22-4).
- R1–R21 guarantees re-checked: **R4-3 (no order without a server recap, Critical) holds — 0 / 24 orders**; one order per yes: 24, never two, 0 lost; N17 T2 yes with a change → new recap; N5 T3 yes to no recap → no order; 4 cancels → the right order (CX2 the replacing order, not the replaced one); R4-1 / R11-2 / R13-1 (no hand-off on order / field / place / yes / delivery messages) holds — 0 `handoff_to_human` run (PH6 T4 asked one, not run); R14-3 (every real hand-off made) — 3 / 3 limit hand-offs, 2 missing (R22-1); R4-2 / R9-1 (a name in another script keeps the language) holds — F3, PH6; R14-1 (language kept) holds — 31 / 31, MSA too (J04r-4); R4-4 / R6-1 (no model sentence asking to confirm in front of the recap) holds — 26 / 26; R8-2 / R10-2 / R12-2 (no confirm request / claim without a recap) holds — Q3c T1 caught by the guard; Q3 T2 « nsajjel lek 7 » = R22-1; R5-1 (in-stock alternatives only) holds — N5, P2, CARD, cards too now; R5-2 (no Tunisian / Moroccan forms sent) holds (guard ×4); R5-4 (no « home or stop-desk ? » after a street) holds; R5-5 / R7-5 (delivery question answered with the fee) holds — N3 T2, C4 T4; **R5-6 (no `create_order` before a phone) holds — 0 / 51, also with a wrong phone given**; R6-4 / R11-4 / R13-2 (recap address « …, commune, wilaya ») holds — 26 / 26; R8-3 (named variant) holds — P2 S, F1 Marron; R10-1 (latency) — 3 server turns ≥ 10 s (R22-2); R11-5 (no provider error) holds — 0 / 95; R12-1 (no `VALIDATION wilayaId` on a recap) — 1, Q3c T3's invented `wilayaId 1` (R22-1); R13-3 (Arabic street kept) holds — PH2, PH6, FA, CX3, A3, C4; R13-5 (substitute line) holds — N5 T3; **R15-1 / R18-2 (price before the field question) — 13 / 15, PH4 T1 and A3 T1 miss it (R22-3)**; R15 / R16 fees — 0 wrong fee in 95 turns, Oran free from 20 000 DA applied once (N5 Coffret); R16-2 (one reason sentence) holds — Q1 / Q2 / Q4 limit sentence; R17 (a plain yes to the recap placed) holds; R19-1 / R19-2 (0 model call on a yes to a recap; 0 hand-off tool on a product-less message) — 23 / 24 (C4 T6 MSA yes through the model, R22-2) / holds; R20-1 yes forms « ih ndirha », « wah ndirha », « oui je prends » 0 model call again; R20-4 (amounts with the space, other numbers untouched) holds — 95 / 95.

## Coverage
- Order flows to a yes: French ×12 (PH1, PH5 link, PX, FS, Q5, CX1, CX2, CQ1, F1, N5, N17; N3 fr → arabizi), Arabic-script darija ×5 (PH2, PH6, FA, CX3, A3), MSA ×1 (C4 on the link), arabizi ×4 (PH3 link, FD, F3, P2), English ×1 (PH4); a replacement (CX2); 4 cancels after the order, 3 « is it cancelled? » questions, a cancel asked as a question (CQ1); stopped by design: Q1, Q2, Q4 (limit hand-offs), M3, P3 (first message only), CARD; no order, wrongly: Q3, Q3c (R22-1).
- Asked this round: the wrong-then-right phone in fr / Arabic script / arabizi / en on both surfaces, phones with spaces / dashes / Arabic-Indic digits with spaces, 11 digits twice; quantities above the limit in fr / Arabic script / arabizi + the 500-piece scenario message, the max itself; cancel, « bien annulée ? » in fr and Arabic script, a cancel question; the Arabic « sell beyond stock » watch ×2; MSA on the shared link at 390; cards with sold-out variants; the usage header of every opening; the sweep F1, F3, N3, N5, N17, P2, A3; latency of every turn; every fee against the shop's settings.
- Also read on the page with no message: step 3 hand-off label (J03r-6) and the playground chips (J03r-3) in fr and ar.
- Kit: 0 API error, 0 console error on the playground (the PH3 link page logged two `ERR_NAME_NOT_RESOLVED` for a third-party resource, the conversation unaffected), « leaks » only in the merchant inspector's prompt preview (`{product}`, `{name}`, `{price}`, `{shop}` = by design, AGT-07); one kit timeout before FS's first message (re-run).

## Not tested
- The step-5 « Relancer les 8 scénarios » (J03r-2) — 8 messages, over the budget left.
- The amount limit (J03r LIM T2 « 3 coffrets ») — it handed off in J03r; not re-sent.
- The 429 state of the playground (J04r-6's « réessayez dans … ») — no shop reached 60 / h (J04r 44, J03r 47).
- « nheb 7 » in other scripts (« نحب 7 », « I want 7 ») and a bare number on a product with variants; « 6 » written as a word (« six tapis », « ستة »).
- A phone correction with a second number in the same message (« 0661… et aussi 0770… »); a `+213` number.
- R21's N5c (arabizi out-of-stock loop, R21-2), N4, N7, N18, F5 / F5b on the link, F11 (blocked number — the J03r / J04r shops have no block), PG1 / PG2, DQ1 / DQ2, YC, Y2 — not in this round's list.
- Live-only behaviour: real orders, the live hand-off (AI paused, inbox), Messenger cards — both test surfaces are dry runs (`simulated: true`).
- The stall / dup probes of R10 / R11 (PH6 T2's lost POST showed the replay path once: same `turnKey`, one run, no duplicate).

## Test data
- J04r shop « Boutique de Karima » (workspace `01a1ef58-…`, agent `01a1ef59-4a82-…`) and J03r shop « Boutique de Sofiane » (workspace `01a1ef35-…`, agent `01a1ef36-954a-…`), both drafts, unchanged by this run (no setting saved; ui.mjs only read the step 3 page and opened the playground). Shared links left as they were (J04r `usedCount` 18 → 27, J03r 6 → 9), none created.
- Playground / link TEST orders (simulated, nothing written): TEST-6718 (PH1), TEST-8535 (PH2), TEST-1617 (PH3), TEST-8346 (PH4), TEST-4234 (PH5 on the link; CQ1, then cancelled — simulated), TEST-6280 (PH6), TEST-6868 (PX), TEST-7347 (FS; CX1, then cancelled), TEST-5915 (FD), TEST-9746 (FA), TEST-8099 (Q5), TEST-4458 → TEST-1210 (CX2, replaced, then cancelled), TEST-2536 (CX3, cancelled), TEST-3145 (C4), TEST-8319 (F1), TEST-5222 (F3), TEST-9032 (N3), TEST-6230 (N5), TEST-1216 (N17), TEST-9410 (P2), TEST-2155 (A3). The same content gives the same simulated number (J04r's TEST-7347, TEST-4458, TEST-1210, TEST-9746, J03r's TEST-4234, TEST-2536 again).
- Server reads (read-only): `git log` on the VPS, pm2 status, Redis `rl:*` before / after, `Agent` (limits, hours, languages), `DeliveryFeeRule`, `Product`, `ProductVariant`, `AgentTestLink`, `CustomerBlock`, `AiRun` rows since 17:49 UTC with `meta.guard` / `meta.steps` (out/airun.txt, out/steps.txt), `AiToolCall` rows (out/toolcalls.txt), API « playground turn answered » lines (96 = 95 turns + 1 replay, `waitMs − runMs` ≤ 101 ms, 0 « did not finish »); nothing written.
- Hour counters (read-only, after the run, 19:05): J04r 44 / 60 (window from 18:50:11; 4 J04r turns fell in the previous window, which expired during PH2), J03r 47 / 60 (window from 18:57); no 429. Messages used: 95 / 100.
