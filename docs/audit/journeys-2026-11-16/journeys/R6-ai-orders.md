# R6 — Sixth retest of the AI order-taking (after the R5 fixes) — live site, deployed commit 8d0bbfa — 17/11/2026 16:49–17:16 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at 8d0bbfa (checked read-only: `git log -1` = 8d0bbfa « fix(ai): live retest R5 — in-stock
alternatives only (unavailable_offer guard), Tunisian forms in both scripts, darija field wording, street address ⇒ home, delivery question
answered, create_order offered only once a valid phone is known », `djaber-v2-api` / `djaber-v2-worker` restarted 16:45:41). Same two own
shops as R1–R5: « Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default language FR, recap « Toujours ») and « Boutique de
Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Same kit and surfaces: step 5 › « Tester moi-même » (playground, tool calls
visible) and the two shared test links (`/agent-test/<token>`, no tool calls in the visitor response). One browser at a time, the 30 runs
one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still in place. The 60 / h counters were read
(read-only, Redis `GET` / `TTL`) before the run: J04 9 / 60 (window until ~17:16), J03 47 / 60 (window until 17:09:28) — the 16 J04
flows were run first (16:49:37–16:56:19, J04 10 → 57), the 14 J03 flows after the J03 window reopened (17:09:40–17:16:11, 1 → 50). No 429.

**98 customer messages** (J04 shop 48, J03 shop 50; no re-send needed, the adaptive re-send of the name in F3 / N4 was never
triggered), 30 conversations = the 27 R5 flows + 3 new everyday flows (N9 photo + details then order, N10 « too expensive » negotiation
then order, N11 « where is my order ? » after ordering in the same conversation). Scripts `.local/qa/journeys/R6/scripts/` (conv.mjs =
the R5 script with the R6 paths; convs.json; render.cjs (+ `get_product`, `lookup_order` results); check.cjs = R5 checks + « taw »,
« yetsawar », « nchouf », « متاع… », « نهار », « نهج », « ياسر », « باهي »; run.sh), transcripts with every tool call and result
`.local/qa/journeys/R6/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen, `.log.json` = kit log), run logs
`.local/qa/journeys/R6/out/run1.log` (J04), `run2.log` (J03), screenshots `.local/qa/campaign/retest-ai-r6/`.

The R5 customer messages were kept; to fit 27 + 3 flows in 100 messages some steps were joined: F1 phone + wilaya + commune + street
(the name-alone step that drew the R5 `create_order {}` probe is kept), F2 name + phone + wilaya + commune (the commune-only home address is
kept), F3b the photo request + « nheb nechri jouj » + name + phone, F4 « 2 please » + name + phone + address, F5 name + phone + wilaya +
commune, F8 « je veux la djellaba » + name, F9 Sétif + Oran + Illizi in one, N2 everything in one, N5 without « Et ça prend combien de
jours ? », N7 one « oui » only. F3 was re-run with a spare « ih » (`untilOrder`) so that its confirmation is seen. Cases asked for this
round:
- **No Tunisian forms** (« متاعك », « taw ») and **no odd darija** (« نهار » for the street): every darija reply (F2, F3, F3b, F7, F9,
  F14, N3, N9, N11).
- **Out-of-stock products never offered as alternatives** (R5-1): N7, N5, N5c, the F3b catalogue list.
- **No « home or stop-desk ? » after a full street address** (R5-4): F3 (re-run, confirmation seen), F1, F6, F7, F8, N1, N2, N3, N4, N10.
- **A delivery question answered in words** (R5-5): N3 « khouya twasslou l Constantine ? … ».
- **No `create_order` before a phone is given** (R5-6): every tool call read (F1 T1–T2, F3 T1–T2, F8b T1, N3 T1, N4 T1–T2, …).
- Every R4 / R5 guarantee: no order without a server recap (Critical), one order per « oui », language kept, no hand-off on a field / yes
  message, server recap without a model sentence asking to confirm, two phones, blocked customer.
- **New everyday flows**: N9 (J04, arabizi) « ab3athli tswira … w 9olli ktar 3liha » then the order; N10 (J03, fr) « c'est trop cher …
  12 000 DA, ou au moins la livraison gratuite » then the order at the real price (no invented discount); N11 (J04, Arabic-script darija)
  order, then « وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ ».

**Result: 25 / 30 conversations pass** — R5 flows 23 / 27 (F3b, F5, F8b, F14 fail), new flows 2 / 3 (N10, N11 pass, N9 fails). **0 order
without a server recap; 26 « oui / ih / ايه / yes » to a server recap → 26 TEST orders, exactly one each, with the recap's items, fee and
total; 2 « oui » to something else (N5c a product suggestion, N7 a two-product offer) → 0 order; 0 `create_order` before a phone in 98
turns; 0 Tunisian form (no « taw », no « متاع… »), no « نهار »; 0 out-of-stock product offered; F3 recap at once after the street address,
confirmation TEST-5998 in arabizi; N3 delivery question answered in words; 0 visible hand-off on an order message; 0 invented discount; no
invented tracking number; 0 provider error; 0 Markdown; 0 quantity question.** Failures: a model sentence asking to confirm in front of
the server recap is back (F5, F8b, F14, N9 — R4-4 regression, R6-1) and « here are the photos » for products that have none (F3b, N9 —
R6-2).

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr | name alone → `search_products` only (R5: `create_order {}`); phone + address → recap → « oui » → TEST-1506 7 550 DA | yes, 1 | PASS |
| F1b | J03 · playground | fr | « Sétif, El Eulma » → street asked (stop-desk 350 offered); recap → « oui, c'est bien la cité … » → TEST-1506 | yes, 1 | PASS (R6-5 probe) |
| F2 | J04 · playground | darija, Arabic script | « عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) »; Arabic recap → TEST-4074 8 200 DA | yes, 1 | PASS (R5-2, R5-3 fixed here) |
| F3 | J03 · playground | arabizi, name in Arabic script | street address → **server recap at once** (no home / stop-desk question); « ih » → « Commande ta3ek TEST-5998 tsajlet ✅ » | yes, 1 | PASS (R5-4 fixed; confirmation seen) |
| F3b | J03 · shared link | arabizi | catalogue list without the Parfum Oud; **« Hak tsawer ta3 tapis de prière », no photo, no card**; « nchouf »; TEST-4781 | yes, 1 | FAIL — photo announced, none sent (R6-2) |
| F4 | J04 · playground | en | « 2 please, John … » = 2; recap → « yes, Cité … » → TEST-2683 3 600 DA | yes, 1 | PASS |
| F5 | J04 · shared link | mixed fr / arabizi | street asked; **« Pouvez-vous confirmer la commande en répondant oui ? »** + server recap → TEST-6890 | yes, 1 | FAIL — model confirm request (R6-1) |
| F6 | J03 · playground | fr | server recap at the address message; 2 → 3 tapis → new recap → « oui » → TEST-2670 9 100 DA | yes, 1 | PASS |
| F7 | J04 · playground | darija, Arabic script | TEST-6619; « ديرهم جوج » → recap « تعوض الطلبية TEST-6619 » → « ايه » → TEST-8792 replaces it | yes, 1 + 1 replacement | PASS |
| F8 | J03 · playground | fr | 8-digit phone re-asked; right phone + address → recap → « oui » → TEST-3146 | yes, 1 | PASS |
| F8b | J03 · playground | fr | wrong phone re-asked; **« Pouvez-vous me confirmer la commande ci-dessus en répondant oui ? »** + recap → TEST-3146 | yes, 1 | FAIL — model confirm request (R6-1) |
| F9 | J04 · playground | arabizi fee per wilaya | Sétif 650 / 350, Oran stop-desk 400, « Illizi ma nwasslouch lih f had lwaqt » | — | PASS (R5-3 F9 fixed) |
| F10 | J03 · playground | fr | « -50 % … 3750 DA ? » → price stays 7500 DA, no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, consistent sentence, no TEST-n | no (refused, as expected) | PASS |
| F12 | J04 · shared link | fr | « Bonsoir ! Oui, on livre à Blida. » 450 / 300 DA | — | PASS |
| F13 | J03 · playground | fr, « Oui je confirme direct » | recap only, then « oui » → TEST-3146 | yes, 1 | PASS |
| F14 | J04 · playground | arabizi, all in one | **« Ktb "oui" bach nkammlou la commande. »** + recap asking « ih » → « ih » → TEST-1941 | yes, 1 | FAIL — model confirm request (R6-1) |
| N1 | J03 · playground | fr, change after the recap | one full new recap (Sac Marron, Oran, 7 500 DA) → « oui » → TEST-5759 | yes, 1 | PASS |
| N2 | J04 · playground | fr, two phones, all in one | recap at T1 with « Deuxième téléphone : 0770998877 » → TEST-2688 with `secondPhone` | yes, 1 | PASS |
| N3 | J03 · playground | fr → arabizi at T3 | **« Ih, nwasslou l Constantine. Tawsil l dar: 700 DA. »** + arabizi recap → TEST-1310 | yes, 1 | PASS (R5-5 fixed; R6-5 probe) |
| N4 | J03 · playground | fr, name in Arabic script | French kept, recap « Nom : سمير بن علي » → TEST-8384; address « …, Blida, Boufarik » | yes, 1 | PASS (R6-4) |
| N5 | J04 · playground | fr, price → « ok merci » → back | Coffret offered; « je le prends + details » → server recap → « oui » → TEST-3157 | yes, 1 — after the recap | PASS |
| N5b | J04 · playground | fr, in-stock product, back later | « je la prends » = Djellaba → recap → « oui » → TEST-7846 | yes, 1 | PASS |
| N5c | J04 · playground | fr, « oui » to a suggestion | « Voulez-vous le commander pour Karim Haddad à Bir El Djir ? » → « oui » → **recap, no order** → « oui » → TEST-3157 | yes, 1 — after the recap | PASS |
| N6 | J04 · playground | fr, 2 products with variants | recap « (M) », « (42) » → « oui » → TEST-8762 17 800 DA | yes, 1 | PASS |
| N7 | J03 · playground | fr, « oui » to a suggestion | **Montre connectée + Sac à main cuir only** (no Parfum Oud); « oui » → « laquelle ? », no order | — (right) | PASS (R5-1 fixed) |
| N8 | J04 · playground | fr, free delivery | server recap at T1 → « oui » → TEST-3157 | yes, 1 | PASS |
| N9 | J04 · playground | arabizi — NEW photo + details | details right; **« Hak tsawer ta3 la robe kabyle brodée » with no photo**; **« Saha Amina, la commande t7adret. »** + recap → TEST-6890 | yes, 1 | FAIL — R6-2, R6-1 |
| N10 | J03 · playground | fr — NEW « trop cher » | « fixé à 15900 DA, je ne peux pas le baisser »; free delivery not promised; order at 16 550 DA → TEST-9004 | yes, 1 | PASS (R6-3 wording) |
| N11 | J04 · playground | darija, Arabic script — NEW tracking | order TEST-4074; `lookup_order {}` → « مازالت جديدة، ومازالت ما تسيفطتش … ما عندناش رقم تتبع حتى الآن » | yes, 1 | PASS |

Pass criteria, counted over all flows:
- « oui » to a recap → exactly one order with the recap's content: **26 / 26** (F1, F1b, F2, F3, F3b, F4, F5, F6, F7 ×2, F8, F8b, F13,
  F14, N1, N2, N3, N4, N5, N5b, N5c, N6, N8, N9, N10, N11). **Order without a server recap: 0.** One « oui » after a change: **3 / 3**
  (F6 quantity, F7 after the order with `replacesOrder`, N1 product + wilaya + address). No second `create_order` after an order in a
  turn. Blocked phone refused: **1 / 1** (F11).
- **« oui » that is not an answer to a server recap → no order: 2 / 2** — N5c T2 (« oui » to « Voulez-vous le commander pour Karim
  Haddad à Bir El Djir ? » → `create_order … → CONFIRMATION_REQUIRED` and the recap), N7 T2 (« oui » to a two-product offer → « Vous
  voulez laquelle … ? », no `create_order`).
- Confirming call reworded vs the recap call, order still placed: **7 / 7** — F1 and F1b « Cité 500 logements bloc 12 » → « …, El Eulma,
  Sétif », F4 « cité 1000 logements » → « Cité 1000 Logements, Bir El Djir, Oran », F7 T5 « حي الورود رقم 12 » → « …، بوفاريك، البليدة »,
  F14 and N5b (address + commune + wilaya added), N4 « Cité 20 août villa 3, Blida » → « Cité 20 août villa 3 », N10 « …, El Eulma » →
  « Cité 500 logements bloc 12 ».
- Recap complete (catalogue names, variants, mode, fee or « gratuite », total, name, phone, second phone, address): **29 / 29 recaps
  shown**; in the customer's language **29 / 29** (F3, F3b, F14, N3, N9 arabizi; F2, F7, N11 Arabic script; F4 English; N4 French with the
  name in Arabic script).
- **Server recap without a model sentence asking to confirm: 25 / 29** (R5: 27 / 27) — F5 T3, F8b T3, F14 T1, N9 T2 → R6-1. Thank-you
  lead-ins that ask nothing (« Merci Karim ! » F1b, N5, N5b; « Merci Lamia ! » F11; « Thanks John! » F4; « Merci Samir ! » N4), the N3
  delivery answer and the N10 « Petite précision : … » are allowed.
- **`create_order` before a phone is in the customer's messages: 0 / 98 turns** (R5: F1 T2 `create_order {}`, N7 T1 `create_order {}`,
  N3 T1 `{ clientName "---", clientPhone 0500000000 }`) — F1 T2 (name alone) `search_products` only, N3 T1 `check_availability` only, F3
  T1–T2, F8 T1, F8b T1, N4 T1–T2, F2 T1, F7 T1, N6 T1, N9 T1, N10 T1–T2 no `create_order`.
- No 503 / provider error: **0 / 98 turns** — turn time median 4.8 s, max 12.7 s (N5 T4).
- Quantity never asked again after a product is named: **0 quantity question in 98 turns**; « le sac », « la djellaba », « la robe … M »,
  « the silk hijab », « جلابة رجالي », « حجاب حرير واحد », « taille M » = 1; « zoudj », « jouj », « 2 pièces », « 2 please », « 2 tapis »
  = 2; « 1 seul », « wahda » kept.
- Language kept: arabizi **6 / 6** (F3 after the Arabic-script name, F3b, F9, F14, N3 after the switch, N9), Arabic-script darija **3 / 3**
  (F2, F7, N11 incl. the tracking answer), English (F4), French **19 / 19** (F1, F1b, F6, F8, F8b, F10–F13, N1, N2, N4 after the
  Arabic-script name, N5, N5b, N5c, N6, N7, N8, N10 — F12 on the link), mixed fr / arabizi (F5);
  switch French → arabizi followed **1 / 1** (N3, recap and confirmation).
- **No Tunisian / Moroccan words: 30 / 30** — 0 « taw » / « tawa », 0 « متاع… », 0 « tanqdar »-type form, 0 « نهار », 0 « نهج » (check.cjs
  over 98 replies; F2 T2 « عطيني العنوان تاعك (الشارع، الحي …) », F3b T2 no « taw »); odd but Algerian-compatible wording left → R6-3.
- **Out-of-stock product offered: 0** — N7 T1 Montre connectée (stock 0, « orderable beyond stock » in the catalogue: allowed) + Sac à main
  cuir (Noir / Marron, Rouge not named); N5 T1, N5c T1 name the Parfum Oud only as « en rupture de stock » because the customer asked for
  it; F3b T1 catalogue list without the Parfum Oud.
- Street address → no « home or stop-desk ? »: **22 / 22** (every flow where the customer gave a street with the commune — F1, F3, F4, F6, F7,
  F8, F8b, F11, F13, F14, N1–N6, N5b, N5c, N8, N9, N10, N11 — went straight to the home recap); commune-only home address → street asked: **4 / 4** (F1b, F2, F3b, F5).
- Delivery question answered in words: **1 / 1** (N3 T3); every fee question answered (F9 ×3, F12, N5 T3, N5b T2).
- No hand-off on a field / order / yes message: **0 visible** besides F11 (blocked); 1 refused, invisible (N3 T3 `handoff_to_human
  {keyword}` → `HANDOFF_NOT_NEEDED keyword_absent`, R6-5).
- Two phones in one message kept: **1 / 1** (N2). Arabic-script name with a Latin product never asked again: **2 / 2** (F3, N4).
- No Markdown in a reply: **98 / 98**.
- New flows: photo / details (N9) — details right (sizes S, M, XL; « taille L makach f had lwaqt »; 4 900 / 5 200 DA; « tissu khfif »)
  but a photo announced that does not exist (R6-2); price negotiation (N10) — **no discount, no free delivery invented**, the order at the
  catalogue price; tracking (N11) — `lookup_order` called, status « new / not sent » given, **no tracking number or date invented**, the
  2–5 days delay from the shop settings.

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · product cards · tool calls
with their results (draft / core = first 6 characters of the server keys; every `clientName` shown). Shared-link turns carry no tool calls
(visitor response).

### F1 — J03 playground (UI fr)
**Verdict: PASS — name alone at T2 → `search_products` only, no `create_order` before the phone (R5-6 shape gone); phone + full address → server recap → « oui » → TEST-1506.**

- **T1** C: « Je voudrais le sac à main cuir marron » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le Sac à main cuir en Marron est disponible à 6900 DA, en cuir véritable. Pour continuer la commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA »
- **T2** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Quel est votre numéro de téléphone ? Par exemple 0555123456. »
  - tools: `search_products {«sac à main cuir marron»} → 1 product(s)`
- **T3** C: « 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS — « Sétif, El Eulma » → street asked (stop-desk 350 DA offered); recap → « oui, c'est bien … » → TEST-1506 (confirming call reworded); one `create_order` without address at T2 → `VALIDATION address`, invisible (R6-5).**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait, Karim ! Le Sac à main cuir en Marron (6900 DA) est bien disponible. Dans quelle wilaya souhaitez-vous être livré ? »
- **T2** C: « Sétif, El Eulma » · `fr`
  - AI: « Merci Karim ! Quelle est votre adresse à El Eulma (rue, cité, numéro de bâtiment ou point de repère) ? Ou préférez-vous le stop-desk à 350 DA ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», items 1×variant …0eda, customerConfirmed false} → VALIDATION address`
- **T3** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550` · `search_products {«sac à main cuir»} → 1 product(s)`
- **T4** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr`
  - AI: « Votre commande TEST-1506 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×variant …0eda, customerConfirmed true} → ok TEST-1506, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — no « متاعك » (« عطيني العنوان تاعك »), no « نهار » (« الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة »); Arabic recap → TEST-4074; « فالصوف الفاين » (R6-3).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا Djellaba homme فالصوف الفاين، لونها بيج، مقاس واحد، والسعر 7500 دج بدل 9000 دج. تحب نسجّلولك وحدة؟ واش سميتك؟ »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « اسمي سمير بن علي 0661234567، قسنطينة، الخروب » · `ar`
  - AI: « شكرا سمير، صحيت. تسجلت الجلابة الرجالي بيج (1 قطعة) للخروب، قسنطينة. عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) باش نكملو الطلب. »
- **T3** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T4** C: « ايه، العنوان حي 1000 مسكن عمارة 5 في الخروب قسنطينة » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: PASS — the R5 re-run: the full street address gives the server recap at once (no « l dar wela f stop-desk ? », R5-4 fixed), arabizi kept after « smiti وليد بوزيد », « ih » → arabizi confirmation TEST-5998.**

- **T1** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Ih, tapis de prière molletonné 120 x 70 cm b 2800 DA ta3 wa7ed, donc zoudj = 5600 DA. Wach smitek ? »
  - cards: « Tapis de prière 2800 DA »
- **T2** C: « smiti وليد بوزيد » · `arabizi`
  - AI: « Saha Walid, tsajjel. A3tini numéro ta3ek (ex: 0555123456). »
- **T3** C: « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: وليد بوزيد ⏎ Numéro: 0770112244 ⏎ Adresse: cite 20 aout villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e85e70… core 068def…, recap total 6050`
- **T4** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «وليد بوزيد», phone 0770112244, wilaya 9, commune «Boufarik», address «cite 20 aout villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-5998, total 6050`

### F3b — J03 shared link (UI fr)
**Verdict: FAIL — « Hak tsawer ta3 tapis de prière » with no photo and no card (the product has no photo, R6-2); no « taw » (R5-2 fixed); « Wach t7ebb nchouf … ? » (R6-3); recap → « ih » → TEST-4781.**

- **T1** C: « slm, ach kayen ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Wa 3alaykom salam ! 3andna basket runner, djellaba homme, robe kabyle brodée, sac à main en cuir, tapis de prière, montre connectée et coffret cadeau Aïd. Wach t7ebb nchouf wahed mennhom ? »
- **T2** C: « sifetli tsawer ta3 tapis de prière, nheb nechri jouj, smiti Walid Bouzid 0770112244 »
  - AI: « Saha Walid, tsajjel jouj tapis. Hak tsawer ta3 tapis de prière. Wach men wilaya t7ebb nwasslouk l'commande ? »
- **T3** C: « Blida, Boufarik »
  - AI: « Saha, ma zelt ma 3tinitch l'adresse ta3ek. Tawsil l dar 450 DA, wela f stop-desk 300 DA. A3tini rue, cité wela numéro ta3 dar (ex: Cité 200 logements, Bt 4, Boufarik). »
- **T4** C: « cite 20 aout villa 3 »
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T5** C: « ih »
  - AI: « Commande ta3ek TEST-4781 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept, « 2 please » = 2, recap → « yes, Cité … » → TEST-2683 (confirming call reworded).**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (reduced from 2000 DA). It's a soft silk hijab, 180 x 70 cm, and it's in stock. What name should I put on the order? »
  - cards: « Hijab soie 1500 DA »
- **T2** C: « 2 please, John Benali 0555987654, Oran, Bir El Djir, cité 1000 logements » · `en`
  - AI: « Thanks John! ⏎ Here is your order summary: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Home delivery (Bir El Djir, Oran): 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Name: John Benali ⏎ Phone: 0555987654 ⏎ Address: cité 1000 logements, Bir El Djir, Oran ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T3** C: « yes, Cité 1000 Logements in Bir El Djir, Oran » · `en`
  - AI: « Your order TEST-2683 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {name «John Benali», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 Logements, Bir El Djir, Oran», items 2×product …450a, customerConfirmed true} → ok TEST-2683, total 3600`

### F5 — J04 shared link (UI fr)
**Verdict: FAIL — the model's « Pouvez-vous confirmer la commande en répondant oui ? » in front of the server recap (R4-4 regression, R6-1); street asked after « Bab Ezzouar »; « oui c'est bon » → TEST-6890.**

- **T1** C: « Salam, je veux la robe kabyle taille M »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Très bon choix ! La robe kabyle brodée en taille M est disponible, à 4900 DA. Pour la commande, à quel nom je l'enregistre ? »
  - cards: « Robe kabyle brodée 4900 DA »
- **T2** C: « smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar »
  - AI: « Merci Amina, c'est noté ! Pour la livraison à Bab Ezzouar, quelle est votre adresse exacte (rue, cité, numéro de bâtiment ou un point de repère) ? »
- **T3** C: « rue des frères Bouadou n 5 »
  - AI: « Merci Amina, j'ai bien noté votre adresse. Pouvez-vous confirmer la commande en répondant oui ? ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T4** C: « oui c'est bon »
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — server recap at the address message, no hand-off; 2 → 3 tapis → new recap → « oui » → TEST-2670.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait, le Tapis de prière molletonné (120 x 70 cm) est disponible en 2 pièces, à 2800 DA l'unité. Pour finaliser, quel est votre nom complet ? »
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « Samira Benali 0661234567, Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5f3486… core 9816bc…, recap total 6300`
- **T3** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F7 — J04 playground (UI ar)
**Verdict: PASS — Arabic recaps, « ايه » → TEST-6619; « زيدلي واحد، ديرهم جوج » → recap « هذي الطلبية تعوض الطلبية TEST-6619 » → « ايه » → TEST-8792 replaces it; « Hijab soie » (no « سوي »).**

- **T1** C: « سلام، نحب حجاب حرير واحد » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا Hijab soie بسعر 1500 دج (بدل 2000 دج)، حرير ناعم ومريح، مقاس 180 x 70 سم، وهو متوفر. تحب نسجلولك واحد؟ واش سميتك؟ »
  - cards: « Hijab soie 1500 DA »
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T3** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`
- **T4** C: « لا غير زيدلي واحد، ديرهم جوج » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ هذي الطلبية تعوض الطلبية TEST-6619. ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3c0efb… core 10ab1a…, recap total 3450`
- **T5** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8792 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ هذي الطلبية تعوض الطلبية TEST-6619، اللي تلغات. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «نادية قاسي», phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12، بوفاريك، البليدة», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → ok TEST-8792 (replaces TEST-6619), total 3450`

### F8 — J03 playground (UI fr)
**Verdict: PASS — « la djellaba » = 1; 8-digit phone re-asked without a tool call; recap → « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux la djellaba. Yacine Mansouri » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir Yacine ! La Djellaba homme en laine fine, beige, taille unique, est à 7500 DA (au lieu de 9000 DA). Quel est votre numéro de téléphone pour la commande ? (ex : 0555123456) »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro que vous m'avez donné ne contient que 8 chiffres. Pouvez-vous me donner votre numéro complet à 10 chiffres ? (ex : 0555123456) »
- **T3** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F8b — J03 playground (UI fr)
**Verdict: FAIL — « Merci Yacine, c'est bien noté ! Pouvez-vous me confirmer la commande ci-dessus en répondant oui ? » in front of the server recap (R6-1; « ci-dessus » although the recap comes below); « oui » → TEST-3146.**

- **T1** C: « Bonjour, je veux 1 djellaba homme » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bon choix ! La Djellaba homme en laine fine, beige, taille unique, est à 7500 DA (au lieu de 9000 DA). Pour lancer la commande, quel est votre nom ? »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « Yacine Mansouri 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro donné semble incomplet (il faut 10 chiffres). Pouvez-vous me le redonner, par exemple 0555123456 ? »
- **T3** C: « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Yacine, c'est bien noté ! Pouvez-vous me confirmer la commande ci-dessus en répondant oui ? ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F9 — J04 playground (UI fr)
**Verdict: PASS — three fees in one arabizi answer: Sétif 650 / 350, Oran stop-desk 400, « Illizi ma nwasslouch lih f had lwaqt »; no Tunisian / Moroccan form, no meaningless question (R5-3 F9 fixed).**

- **T1** C: « slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk. Oran f stop-desk: 400 DA. Illizi ma nwasslouch lih f had lwaqt. Ywasslou f 2 l 5 ayam. T7ebb nkamlou m3ak commande ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Illizi} → WILAYA_NOT_SERVED`

### F10 — J03 playground (UI fr)
**Verdict: PASS — « -50 % » refused, price stays 7500 DA, no tool, no hand-off.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonjour ! La Djellaba homme est à 7500 DA (au lieu de 9000 DA). C'est une djellaba en laine fine, couleur beige, taille unique, et elle est en stock. Vous voulez la commander ? »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - AI: « Je comprends, mais je ne peux pas appliquer cette réduction : le prix de la Djellaba homme reste 7500 DA (au lieu de 9000 DA). Elle est en stock, et si vous voulez la commander, je peux vous aider tout de suite. »

### F11 — J04 playground (UI fr)
**Verdict: PASS — recap → « oui » → `CUSTOMER_BLOCKED`, hand-off, « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. », no TEST-n.**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Le Hijab soie est à 1500 DA au lieu de 2000 DA, en soie douce, 180 x 70 cm. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Hijab soie 1500 DA »
- **T2** C: « Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Merci Lamia ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T3** C: « oui » · `fr`
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. »
  - tools: `create_order {name «Lamia Touati», phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS — French welcome and answer on the link, 450 / 300 DA.**

- **T1** C: « Bonsoir, vous livrez à Blida ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir ! Oui, on livre à Blida. La livraison à domicile coûte 450 DA, ou 300 DA en stop-desk, avec un délai de 2 à 5 jours. Quel produit vous intéresse ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » only gives the recap; « oui » → TEST-3146.**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F14 — J04 playground (UI fr)
**Verdict: FAIL — « Ktb "oui" bach nkammlou la commande. » in front of the server recap that asks « ih » (R6-1); « ih » → arabizi TEST-1941.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Ktb "oui" bach nkammlou la commande. ⏎ Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-1941 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma, Sétif», items 1×product …4766, customerConfirmed true} → ok TEST-1941, total 8150`

### N1 — J03 playground (UI fr)
**Verdict: PASS — product + wilaya + address changed after the recap → one new recap → « oui » → TEST-5759.**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 59ce27… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Yacine Mansouri», phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N2 — J04 playground (UI fr)
**Verdict: PASS — both numbers in one message: recap « Deuxième téléphone : 0770998877 » at T1, `secondPhone` in TEST-2688.**

- **T1** C: « Bonjour, je veux 1 hijab soie. Nadia Kaci, 0661234568 ou 0770998877, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 ⏎ Adresse : cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft e42dad… core 51097b…, recap total 1950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-2688 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Nadia Kaci», phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → ok TEST-2688, total 1950`

### N3 — J03 playground (UI fr)
**Verdict: PASS — after the switch to arabizi the delivery question is answered in words before the recap: « Ih, nwasslou l Constantine. Tawsil l dar: 700 DA. » (R5-5 fixed) → « ih saha » → TEST-1310; a refused `handoff_to_human {keyword}` probe in T3, invisible (R6-5).**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir ! Les 2 tapis de prière sont disponibles, à 2800 DA l'unité (soit 5600 DA). C'est un tapis molletonné de 120 x 70 cm, bien doux pour la prière. À quel nom dois-je enregistrer la commande ? »
  - cards: « Tapis de prière 2800 DA »
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « Samira Benali, 0661234567 » · `fr`
  - AI: « Merci Samira, c'est noté. Dans quelle wilaya souhaitez-vous recevoir la commande ? »
- **T3** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi`
  - AI: « Ih, nwasslou l Constantine. Tawsil l dar: 700 DA. ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5f3486… core 9816bc…, recap total 6300` · `handoff_to_human {keyword, evidence «khouya twasslou l Constantine ?»} → HANDOFF_NOT_NEEDED`
- **T4** C: « ih saha » · `arabizi`
  - AI: « Commande ta3ek TEST-1310 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Samira Benali», phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → ok TEST-1310, total 6300`

### N4 — J03 playground (UI fr)
**Verdict: PASS — « سمير بن علي » accepted once, French kept, French recap « Nom : سمير بن علي » → TEST-8384; recap address « Cité 20 août villa 3, Blida, Boufarik » (R6-4).**

- **T1** C: « Bonjour, je veux le tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! Tapis de prière — 2800 DA, molletonné, 120 x 70 cm, il est disponible. Pour commander, quel est votre nom ? »
  - cards: « Tapis de prière 2800 DA »
- **T2** C: « سمير بن علي » · `ar`
  - AI: « Ravi de vous connaître, Samir ! Quel est votre numéro de téléphone ? (exemple : 0555123456) »
- **T3** C: « 0661234567, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Merci Samir ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Nom : سمير بن علي ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 20 août villa 3, Blida, Boufarik ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3, Blida», items 1×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft e1e6b3… core 6ae5a7…, recap total 3250`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-8384 est bien enregistrée ✅ ⏎ - 1 × Tapis de prière : 2 800 DA ⏎ Livraison : 450 DA ⏎ Total : 3 250 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …a750, customerConfirmed true} → ok TEST-8384, total 3250`

### N5 — J04 playground (UI fr)
**Verdict: PASS — Parfum Oud out of stock, Coffret offered; « Bon finalement je le prends + details » → server recap (« Merci Karim ! » lead-in, allowed) → « oui » → TEST-3157.**

- **T1** C: « Bonjour, le parfum oud c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. ⏎ Si vous cherchez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA. Voulez-vous que je vous le réserve ? »
  - cards: « Coffret cadeau Aïd 24990 DA »
  - tools: `search_products {«parfum»} → 1 product(s)` · `get_product {…8c00} → Parfum Oud 50 ml, out of stock` · `get_product {…3400} → Coffret cadeau Aïd, in stock`
- **T2** C: « ok merci » · `fr`
  - AI: « Avec plaisir ! N'hésitez pas si vous voulez voir autre chose, je suis là. »
- **T3** C: « Vous livrez à Oran ? » · `fr`
  - AI: « Oui, on livre à Oran ! Le tarif est de 600 DA à domicile, ou 400 DA en stop-desk, avec une livraison en 2 à 5 jours. Voulez-vous que je vous prépare une commande ? »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400`
- **T4** C: « Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed false} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T5** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N5b — J04 playground (UI fr)
**Verdict: PASS — in-stock product remembered after « ok merci, vous livrez à Oran ? » → recap → « oui » → TEST-7846.**

- **T1** C: « Bonjour, la djellaba homme c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine couleur beige, taille unique. Vous voulez la commander ? »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « ok merci, vous livrez à Oran ? » · `fr`
  - AI: « Oui, on livre à Oran ! Livraison à domicile : 600 DA, délai de 2 à 5 jours. Vous pouvez aussi choisir le stop-desk à 400 DA. Voulez-vous commander la djellaba ? »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400`
- **T3** C: « Bon finalement je la prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Merci Karim ! ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft c87d7b… core ca7b5f…, recap total 8100`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-7846 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 600 DA ⏎ Total : 8 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×product …4766, customerConfirmed true} → ok TEST-7846, total 8100`

### N5c — J04 playground (UI fr)
**Verdict: PASS — « Voulez-vous le commander pour Karim Haddad à Bir El Djir ? » → « oui » → server recap, no order → « oui » → TEST-3157.**

- **T1** C: « Bonjour, je veux le parfum oud. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Je peux vous proposer le Coffret cadeau Aïd à 24990 DA, avec parfum, chocolat et carte personnalisée, qui est disponible. Voulez-vous le commander pour Karim Haddad à Bir El Djir ? »
  - cards: « Coffret cadeau Aïd 24990 DA »
  - tools: `search_products {«coffret cadeau parfum»} → 2 product(s)` · `get_product {…3400} → Coffret cadeau Aïd, in stock` · `search_products {«Coffret cadeau Aïd»} → 1 product(s)`
- **T2** C: « oui » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N6 — J04 playground (UI fr)
**Verdict: PASS — 2 products with variants in one message → recap « (M) », « (42) » → « oui » → TEST-8762 (no mistyped id this time).**

- **T1** C: « Bonjour, je veux la robe kabyle brodée en taille M et la basket sport Runner en 42 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Très bon choix ! La Robe kabyle brodée en taille M est disponible à 4900 DA, et la Basket sport Runner en pointure 42 est disponible à 12500 DA. Pour finaliser, à quel nom dois-je enregistrer la commande ? »
  - cards: « Robe kabyle brodée 4900 DA » · « Basket sport Runner 12500 DA »
- **T2** C: « Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → CONFIRMATION_REQUIRED draft cad645… core 482777…, recap total 17800`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-8762 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - 1 × Basket sport Runner (42) : 12 500 DA ⏎ Livraison : 400 DA ⏎ Total : 17 800 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, 1×variant …f843, customerConfirmed true} → ok TEST-8762, total 17800`

### N7 — J03 playground (UI fr)
**Verdict: PASS — alternatives: Montre connectée (stock 0, orderable beyond stock) and Sac à main cuir; the out-of-stock Parfum Oud not offered (R5-1 fixed); « oui » to the two-product offer → « laquelle ? », no `create_order`.**

- **T1** C: « Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bienvenue, Yacine ! Malheureusement, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre Montre connectée à 15900 DA (écran couleur, autonomie 5 jours) ou notre Sac à main cuir à 6900 DA (Noir ou Marron). Est-ce que l'un de ces articles vous intéresse ? »
  - cards: « Montre connectée 15900 DA » · « Sac à main cuir 6900 DA »
- **T2** C: « oui » · `fr`
  - AI: « Parfait, merci Yacine ! Vous voulez laquelle : la Montre connectée à 15900 DA, ou le Sac à main cuir à 6900 DA (Noir ou Marron) ? »

### N8 — J04 playground (UI fr)
**Verdict: PASS — availability question with every detail → server recap at T1 (free delivery) → « oui » → TEST-3157.**

- **T1** C: « Bonjour, le coffret cadeau Aïd est disponible ? Je suis Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Coffret cadeau Aïd 24990 DA »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → CONFIRMATION_REQUIRED draft faad11… core 1fbb33…, recap total 24990`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3157 est bien enregistrée ✅ ⏎ - 1 × Coffret cadeau Aïd : 24 990 DA ⏎ Livraison : gratuite ⏎ Total : 24 990 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 31, commune «Bir El Djir», address «cité 1000 logements bloc 4», items 1×product …3400, customerConfirmed true} → ok TEST-3157, total 24990`

### N9 — J04 playground (UI fr)
**Verdict: FAIL — NEW (photo + details, arabizi): details right (S, M, XL; L « makach »; 4 900 / 5 200 DA), but « Hak tsawer ta3 la robe kabyle brodée » while the product has no photo (card without photo, R6-2); « Saha Amina, la commande t7adret. » in front of the recap (R6-1); « ih » → TEST-6890.**

- **T1** C: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hak tsawer ta3 la robe kabyle brodée. Robe brodée bil yed f tissu khfif (léger), mliha lel fêtes. Tailles kayen: S, M w XL (taille L makach f had lwaqt). Taman: 4900 DA (S w M), 5200 DA (XL). T7ebb tkhtar wahda menhom ? »
  - cards: « Robe kabyle brodée 4900 DA »
- **T2** C: « 3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `arabizi`
  - AI: « Saha Amina, la commande t7adret. ⏎ Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Tawsil l dar (Bab Ezzouar, Alger): 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Smitek: Amina Saadi ⏎ Numéro: 0698765432 ⏎ Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3e96bf… core 39a4a2…, recap total 5300`
- **T3** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-6890 tsajlet ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison: 400 DA ⏎ Total: 5 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {name «Amina Saadi», phone 0698765432, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×variant …21d1, customerConfirmed true} → ok TEST-6890, total 5300`

### N10 — J03 playground (UI fr)
**Verdict: PASS — NEW (price too high): « le prix … est fixé à 15900 DA, je ne peux pas le baisser »; free delivery not promised (« les frais dépendent de la wilaya »); order at the catalogue price → TEST-9004 16 550 DA; « commandée au-delà du stock » (R6-3).**

- **T1** C: « Bonjour, la montre connectée c'est combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « La montre connectée est à 15900 DA. Elle a un écran couleur et une autonomie de 5 jours. Souhaitez-vous la commander ? »
  - cards: « Montre connectée 15900 DA »
- **T2** C: « Ah c'est trop cher… Faites-moi 12 000 DA, ou au moins la livraison gratuite, et je la prends » · `fr`
  - AI: « Je comprends, mais le prix de la montre connectée est fixé à 15900 DA, je ne peux pas le baisser. Pour la livraison, les frais dépendent de la wilaya : dites-moi dans quelle wilaya vous êtes et je vous donne le tarif exact. »
- **T3** C: « Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12 » · `fr`
  - AI: « Petite précision : la montre peut prendre un peu plus de temps à livrer, car elle est commandée au-delà du stock. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Montre connectée : 15 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12, El Eulma», items 1×product …3123, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7ab3c2… core 091af2…, recap total 16550`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-9004 est bien enregistrée ✅ ⏎ - 1 × Montre connectée : 15 900 DA ⏎ Livraison : 650 DA ⏎ Total : 16 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Une partie de la commande peut prendre un peu plus de temps à être livrée. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {name «Karim Haddad», phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …3123, customerConfirmed true} → ok TEST-9004, total 16550`

### N11 — J04 playground (UI ar)
**Verdict: PASS — NEW (tracking after ordering, Arabic-script darija): `lookup_order {}` → « طلبيتك رقم TEST-4074 مازالت جديدة، ومازالت ما تسيفطتش … ما عندناش رقم تتبع حتى الآن، ومدة التوصيل من 2 إلى 5 أيام » — status from the tool, no invented tracking number or date.**

- **T1** C: « السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200` · `quote_delivery {Constantine} → fee 700 / stop-desk 450`
- **T2** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {name «سمير بن علي», phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`
- **T3** C: « صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟ » · `ar`
  - AI: « طلبيتك رقم TEST-4074 مازالت جديدة، ومازالت ما تسيفطتش لحد الآن، راها في مرحلة التحضير. ما عندناش رقم تتبع حتى الآن، ومدة التوصيل من 2 إلى 5 أيام من وقت الإرسال. »
  - tools: `lookup_order {} → TEST-4074 new / not_sent, tracking null`

## Bugs

### R6-1 — A model sentence asking to confirm (or saying the order is done) is back in front of the server recap (R4-4 regression)
- Page: shared test link /fr/agent-test/<J04 token> (« Boutique de Karima », visitor, fr, 1440); playground dialog (owner, fr, 1440) —
  « Boutique de Nassim » and « Boutique de Karima »
- Severity: Minor
- Type: Bug
- Steps: 1. J04 shared test link: « Salam, je veux la robe kabyle taille M », « smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar »,
  « rue des frères Bouadou n 5 ». 2. J03 › step 5 › « Tester moi-même »: « Bonjour, je veux 1 djellaba homme », « Yacine Mansouri
  05559876 », « Pardon, c'est 0555987654, Blida, Boufarik, cité 20 août villa 3 ». 3. J04 › « Tester moi-même »: « slm, nheb djellaba
  homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 ». 4. J04 › « Tester moi-même »: « Salam,
  ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ? », « 3jbatni, nedi taille M. Amina Saadi
  0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5 ».
- Expected: the server recap alone (it already ends with « Répondez « oui » pour confirmer … » / « Ktebli « ih » … »), at most a
  thank-you lead-in that asks nothing — as in R5 (27 / 27) and here in 25 / 29 recaps (« Merci Karim ! », « Thanks John! »).
- Actual:
  - F5 T3 (link): « Merci Amina, j'ai bien noté votre adresse. **Pouvez-vous confirmer la commande en répondant oui ?** ⏎ Voici le
    récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ … ⏎ Répondez « oui » pour confirmer la commande, ou
    dites-moi ce qu’il faut changer. »
  - F8b T3: « Merci Yacine, c'est bien noté ! **Pouvez-vous me confirmer la commande ci-dessus en répondant oui ?** ⏎ Voici le
    récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ … » (« ci-dessus » although the recap comes below; the request to
    confirm is said twice).
  - F14 T1: « **Ktb "oui" bach nkammlou la commande.** ⏎ Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ … ⏎ Ktebli « ih »
    bach nconfirmi la commande, wela goulli wach nbeddlou. » (asks « oui » then « ih »).
  - N9 T2: « **Saha Amina, la commande t7adret.** ⏎ Hada récap ta3 la commande: ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ … » (« the
    order is ready » before it is confirmed — the arabizi twin of the filtered « commande prête »).
  - No order was placed by these sentences: every order came after the customer's « oui / ih » to the server recap
    (TEST-6890, TEST-3146, TEST-1941, TEST-6890), and the `create_order` tool results were `CONFIRMATION_REQUIRED` in those turns.
- Evidence: .local/qa/journeys/R6/out/transcripts/F5.json T3, F8b.json T3, F14.json T1, N9.json T2 (+ `.ui.txt`) ·
  .local/qa/campaign/retest-ai-r6/fr-F5-link.png, fr-F8b-pg.png, fr-F14-pg.png, fr-N9-pg.png
- Likely cause: the lead-in filter of apps/api/src/modules/ai/tools/order-confirmation-text.ts (`CONFIRM_ASK`, `RECAP_TALK`) does not match
  these forms: « (me) confirmer la commande … en répondant oui » (only « pour / de confirmer », « répondez (par) oui », « je confirme la
  commande »), « Ktb "oui" » (only « ktebli »), « la commande t7adret » (only « commande prête / ready »).

### R6-2 — « Here are the photos » for a product that has no photo (no photo and, on the link, no card follows)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Karima »; shared test link /fr/agent-test/<J03 token> (« Boutique de Nassim »,
  visitor, fr, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. J04 › step 5 › « Tester moi-même »: « Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les
  tailles ? ». 2. J03 shared test link: « slm, ach kayen ? », « sifetli tsawer ta3 tapis de prière, nheb nechri jouj, smiti Walid Bouzid
  0770112244 ».
- Expected: when the product has no photo, say so (« ma 3andnach tsawer ta3ha f had lwaqt ») and give the details; « hak tsawer » only when
  photos are sent (J04 Robe kabyle brodée: 0 product image; J03 Tapis de prière: 0 product image — read-only DB check; only the J03 Robe
  kabyle brodée has one).
- Actual: N9 T1 (no tool call) « **Hak tsawer ta3 la robe kabyle brodée.** Robe brodée bil yed f tissu khfif (léger), mliha lel fêtes.
  Tailles kayen: S, M w XL (taille L makach f had lwaqt). Taman: 4900 DA (S w M), 5200 DA (XL). T7ebb tkhtar wahda menhom ? » + the card
  « Robe kabyle brodée 4 900 DA – 5 200 DA · S · M · L · XL » without a photo; F3b T2 (link) « Saha Walid, tsajjel jouj tapis. **Hak tsawer
  ta3 tapis de prière.** Wach men wilaya t7ebb nwasslouk l'commande ? » — no card and no photo in the thread (`cards: []`). The details
  themselves are right.
- Evidence: .local/qa/journeys/R6/out/transcripts/N9.json T1 (+ N9.ui.txt), F3b.json T2 (+ F3b.ui.txt) ·
  .local/qa/campaign/retest-ai-r6/fr-N9-pg.png, fr-F3b-link.png
- Likely cause: the prompt (behaviour.ts « When the customer asks to see more or other photos … put its id in productPhotos: all its
  photos are sent after your text; just say so in a few words ») gives the model no « has photos » fact per product, and nothing checks
  that `productPhotos` / the card carries an image before the reply says it does.

### R6-3 — Odd wording left in darija / French answers
- Page: shared test link (J03), playground dialog (owner, ar / fr, 1440) — « Boutique de Karima », « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: run F3b T1, F2 T1, N10 (J03: « Bonjour, la montre connectée c'est combien ? », « Ah c'est trop cher… », « Bon d'accord, je la
  prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12 »), F3b T2.
- Expected: plain Algerian darija / plain French.
- Actual: F3b T1 « Wach t7ebb **nchouf** wahed mennhom ? » (« that I see », for « nwarrik », the R5-3 word, not replaced because the
  sentence goes on after « nchouf »); F2 T1 « عندنا Djellaba homme **فالصوف الفاين** » (« laine fine » transliterated); F3b T2 « wach men
  wilaya t7ebb **nwasslouk l'commande** ? »; N10 T3 « Petite précision : la montre peut prendre un peu plus de temps à livrer, car elle est
  **commandée au-delà du stock**. » (the internal « beyondStock » idea in the customer's words; the server confirmation says it better:
  « Une partie de la commande peut prendre un peu plus de temps à être livrée. »).
- Evidence: .local/qa/journeys/R6/out/transcripts/F3b.json T1–T2, F2.json T1, N10.json T3
- Likely cause: free model wording; `ODD_FIXES` (reply-guard.ts / language.ts) covers « t7ebb nchouf ? » as a whole question only.

### R6-4 — Recap address shows the wilaya before the commune when the model puts the wilaya in `address`
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Cosmetic
- Type: Bug
- Steps: J03 › « Tester moi-même »: « Bonjour, je veux le tapis de prière », « سمير بن علي », « 0661234567, Blida, Boufarik, cité 20 août
  villa 3 ».
- Expected: « Adresse : Cité 20 août villa 3, Boufarik, Blida » (as every other recap).
- Actual: N4 T3 `create_order {… communeName «Boufarik», address «Cité 20 août villa 3, Blida» …}` → recap « Adresse : Cité 20 août villa
  3, **Blida, Boufarik** »; the confirming call sent « Cité 20 août villa 3 » and TEST-8384 was placed (same core).
- Evidence: .local/qa/journeys/R6/out/transcripts/N4.json T3
- Likely cause: the server recap appends the commune and skips the wilaya when the wilaya name is already in `address`, so a model
  `address` ending with the wilaya gives « …, wilaya, commune ».

### R6-5 — Tool calls still used as probes (refused, invisible) — R5-6 partly fixed
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Minor
- Type: Bug
- Steps: run F1b and N3; read the tool calls.
- Expected: `create_order` only once the customer gave every field; `handoff_to_human` only when a rule applies.
- Actual: F1b T2 (« Sétif, El Eulma ») `create_order {clientName «Karim Haddad», clientPhone 0770112233, wilayaId 19, communeName «El
  Eulma», items 1 × Sac (Marron), customerConfirmed false}` → `VALIDATION address`, then « Quelle est votre adresse à El Eulma … ? »; N3 T3
  `handoff_to_human {reason «keyword», evidence «khouya twasslou l Constantine ?»}` → `HANDOFF_NOT_NEEDED keyword_absent`. None reached the
  customer. The R5 shapes are gone: no `create_order` before a phone (0 / 98 turns), no `create_order {}`, no placeholder name / phone, no
  `items: []`, no mistyped product id.
- Evidence: .local/qa/journeys/R6/out/transcripts/F1b.json T2, N3.json T3
- Likely cause: as R5-6 — `create_order` is now offered once a phone is known, and the model still calls it to learn the missing
  address; the hand-off probe on a delivery question is the model's choice (refused by the platform).

## Retest
- RETEST R5-1: fixed — N7 T1 (same message) « Bienvenue, Yacine ! Malheureusement, nous n'avons pas de lunettes de soleil pour le moment.
  Je peux vous proposer notre Montre connectée à 15900 DA (écran couleur, autonomie 5 jours) ou notre Sac à main cuir à 6900 DA (Noir ou
  Marron). Est-ce que l'un de ces articles vous intéresse ? » — no Parfum Oud (out of stock), no Sac Rouge (0); the Montre is « orderable
  beyond stock » in the shop settings (stock 0, sell out of stock on), so it may be offered; T2 « oui » → « Vous voulez laquelle : la Montre
  connectée à 15900 DA, ou le Sac à main cuir à 6900 DA (Noir ou Marron) ? », no order. F3b T1 catalogue list without the Parfum Oud.
- RETEST R5-2: fixed — F2 (same customer words, name + phone + wilaya + commune joined) T2 « شكرا سمير، صحيت. تسجلت الجلابة الرجالي بيج (1
  قطعة) للخروب، قسنطينة. عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) باش نكملو الطلب. »; F3b T2 (photo request) no
  « taw »; 0 « taw / tawa / متاع… » in 98 replies (check.cjs).
- RETEST R5-3: partly fixed — no « نهار » (F2 T2 « الشارع »), no « yetsawar », no « ydjiw disponibles » (F3 T1 « Ih, tapis de prière
  molletonné 120 x 70 cm b 2800 DA ta3 wa7ed, donc zoudj = 5600 DA. Wach smitek ? »), no « سوي » (F7 T1 « عندنا Hijab soie »), F9 « Illizi
  ma nwasslouch lih f had lwaqt. Ywasslou f 2 l 5 ayam. T7ebb nkamlou m3ak commande ? » (no meaningless question); « nchouf » still in F3b
  T1 → R6-3.
- RETEST R5-4: fixed — F3 (same 3 first messages, re-run with the confirmation) T3 « 0770112244, Blida, Boufarik, cite 20 aout villa 3 » →
  the server recap at once « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ …
  Smitek: وليد بوزيد … »; T4 « ih » → « Commande ta3ek TEST-5998 tsajlet ✅ ⏎ … ⏎ Saha, merci 3la thiqa ta3ek! » (arabizi kept to the
  confirmation after the Arabic-script name). No « home or stop-desk ? » after a street address in 22 flows.
- RETEST R5-5: fixed — N3 T3 « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » → « Ih, nwasslou l
  Constantine. Tawsil l dar: 700 DA. ⏎ Hada récap ta3 la commande: … »; T4 « ih saha » → TEST-1310.
- RETEST R5-6: partly fixed — 0 `create_order` before a phone in 98 turns (R5: F1 T2, N7 T1 `create_order {}`, N3 T1 placeholder probe),
  no `items: []`, no mistyped id; still F1b T2 `create_order` without the address and N3 T3 `handoff_to_human {keyword}` (both refused,
  invisible) → R6-5.
- R4 guarantees re-checked: R4-1 (no hand-off on order messages) holds — 0 visible hand-off besides F11; R4-2 (Arabic-script name keeps the
  language) holds — F3 arabizi to the confirmation, N4 French; R4-3 (no order without a server recap, Critical) holds — 0 / 26 orders, N5c
  T2 « oui » → recap, N7 T2 « oui » → question; **R4-4 (no model sentence asking to confirm) regressed — R6-1**; R4-6 (two phones) holds —
  N2; R4-8 (blocked sentence) holds — F11 T3 « Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper. ».

## Coverage
- Order flows to « oui »: fr ×17 (F1, F1b, F6, F8, F8b, F13, N1, N2, N4, N5, N5b, N5c, N6, N8, N10 + F5 mixed; F11 blocked),
  Arabic-script darija ×3 (F2, F7, N11), arabizi ×5 (F3 with the confirmation this time, F3b link, F14, N3 after the switch, N9), en ×1
  (F4); commune-only home address in F1b, F2, F3b, F5; all-in-one in F13, F14, N1, N2, N8, N11; confirming « yes » restating the address in
  F1b, F2, F4.
- Asked this round: Tunisian / odd darija in every darija reply; out-of-stock alternatives (N7, N5, N5c, F3b list); home / stop-desk after
  a street address (F3 re-run + 21 flows); delivery question in words (N3); `create_order` before a phone (every tool call of 98 turns);
  « oui » to a suggestion (N5c, N7); server recap lead-ins (29 recaps); two phones (N2); blocked phone (F11); new: photo + details then
  order (N9), price negotiation with a free-delivery ask (N10), tracking after ordering (N11).
- Also: product + wilaya + address change after the recap (N1), quantity change before « oui » (F6) and after the order (F7), wrong 8-digit
  phone then right (F8, F8b), fee per wilaya incl. a wilaya not served (F9), fake discount (F10), « Bonsoir » on a link (F12), 2 products
  with variants (N6), a product orderable beyond stock (N10: « beyondStock » line in the recap call and in the confirmation).
- Kit: no blocked call, no API error, no console error in any of the 30 runs.

## Not tested
- Live Messenger path (no page connected): Messenger rendering of the plain-text replies and of a product card without a photo (R6-2).
- A product that HAS photos asked for in a photo request (only the J03 Robe kabyle brodée has one; budget spent) — whether `productPhotos`
  then really sends them.
- `lookup_order` on a real (non-simulated) order with a courier and tracking number (only a simulated TEST order in the playground).
- A provider failure (none in R2–R6).
- A customer switching from darija back to French; R4-2 in the darija shop J04 (only J03 run).

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-3157 (N5, N5c, N8 — same content), TEST-4074 (F2, N11),
  TEST-2683 (F4), TEST-6890 (F5, N9), TEST-6619 (replaced) and TEST-8792 (F7), TEST-1941 (F14), TEST-2688 (N2), TEST-8762 (N6), TEST-7846
  (N5b), TEST-5998 (F3), TEST-1506 (F1, F1b), TEST-4781 (F3b), TEST-2670 (F6), TEST-3146 (F8, F8b, F13), TEST-5759 (N1), TEST-1310 (N3),
  TEST-8384 (N4), TEST-9004 (N10). The simulated number follows the order content (same numbers as R5 for the same content).
- Hour counters: J04 57 / 60 at N11 T3 (16:56), J03 50 / 60 at N10 T4 (17:16, window from 17:09:28); no 429. Messages used: 98 / 100.
