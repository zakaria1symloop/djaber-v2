# R3 — Third retest of the AI order-taking (after the R2 fixes) — live site, deployed commit b99e0f9 — 17/11/2026 14:08–14:23 (Africa/Algiers)

Live https://djaber.vercel.app, API on the VPS at b99e0f9 (checked read-only: `git log -1` = b99e0f9, `djaber-v2-api` / `djaber-v2-worker`
restarted 14:05:48). Same two own shops as R1 / R2: « Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default language FR,
recap « Toujours », max 5 / order) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro). Same kit and surfaces: step 5
› « Tester moi-même » (playground, tool calls visible) and the two shared test links (`/agent-test/<token>`, no tool calls in the visitor
response). One browser at a time, the 21 runs one after the other. The block « 0550 12 34 56 » (MANUEL, from R1) on the J04 shop was still
in place.

**100 customer messages** (J03 shop 57, J04 shop 43; no re-send needed), 21 conversations = the 17 R2 flows + 3 new adversarial flows
(N1–N3) + one 2-message probe (N3p). Scripts `.local/qa/journeys/R3/scripts/` (conv.mjs = R2 script with the R3 paths, convs.json written
by hand from the R2 convs.json, render.cjs = R2 renderer + product cards + `secondPhone` + an invented « Client » name), transcripts with
every tool call and result `.local/qa/journeys/R3/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen, `.log.json` = kit log),
console logs `.local/qa/journeys/R3/out/<id>.console.txt`, screenshots `.local/qa/campaign/retest-ai-r3/`.

The R2 customer messages were kept, shortened where a flow did not need the field-by-field steps (budget: 100 messages for 20 flows instead
of 17), and the cases asked for this round were placed so that they really happen:
- **home address given as the commune only**: F5 (link, « wilaya Alger » → « Bab Ezzouar », as R2-2), F1b (« Sétif, El Eulma » then the
  street), F2 (« قسنطينة » → « الخروب »), F4 (« Oran » → « Bir El Djir »), F8 / F3 (« Blida, Boufarik »).
- **confirming « yes » restating the address** (to make the model reword its `create_order`): F1b, F2, F4 as in R2; the rewording happened
  in F4, F7, N1 and N3 (tool args below).
- **Moroccan-prone arabizi, photos asked**: F3b (shared link) now starts « slm, ach kayen ? » then « sifetli tsawer ta3 tapis de prière »
  (Moroccan « ach », « sifet »), then « nheb nechri jouj »; wilaya and commune kept as separate messages (where R2-1 happened).
- **phone alone, then the next field** (R2-3): F1, F2, F3, F3b, F5, F8 (8-digit then right phone).
- **invented-values probe**: every playground flow, tool args checked (« Not given » list of the server).
- **Markdown**: F2 T1 (R2-6 « **Djellaba homme** »), every reply scanned for `**`, `__`, `#`, backticks, `* ` bullets.
- **Arabic recap** (R2-7): F2, F7.
- **New N1** (J03 playground, fr): full order in one message → recap → « Finalement je préfère le sac à main cuir marron à la place, et
  livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » (product AND wilaya AND address change after the recap) → « oui ».
- **New N2** (J04 playground, fr): « Nadia Kaci, 0661234568 ou 0770998877 » (two phone numbers).
- **New N3** (J03 playground): French « Bonjour, je voudrais 2 tapis de prière », « Samira Benali, 0661234567 », then darija « khouya
  twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 », « ih saha ». N3p (2 messages, the 2 spare messages of the
  budget) re-probes the switch with a message carrying more darija (« … ch7al tawsil khouya ? »).

**Result: 18 / 20 conversations pass** (N3p probe not counted) — R2 flows 16 / 17, new flows 2 / 3. **17 « oui / ih / ايه / yes / ih saha »
to a recap → 17 TEST orders, exactly one each, with the recap's items, fee and total; 4 confirming calls differed from the recap call in
wording only (F4, F7, N1, N3) and were all placed; 0 provider errors in 100 turns; 0 quantity question; 0 Markdown; 0 visible
hand-off on a field / yes; no second `create_order` after an order was placed and no repeated identical call in a turn.** Failures: a
Tunisian « tawa » and « Ch7al men wilaya » on the arabizi shared link (F3b), a French recap right after the customer switched to darija
(N3).

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr (« Bonsoir ») | « le sac … marron » = 1, never asked; no probe after the phone; wilaya + commune + street in one → recap → « oui » → TEST-6293 7 550 DA | yes, 1 | PASS |
| F1b | J03 · playground | fr | « Sétif, El Eulma » (commune only) → the AI asks the street; « oui, c'est bien la cité 500 … » → TEST-6293; confirming call = recap call | yes, 1 | PASS (probes R3-3) |
| F2 | J04 · playground | darija, Arabic script | phone acknowledged (« تسجّلت الرقم »), « الخروب » → street asked; Arabic recap « (الخروب، قسنطينة) »; « ايه، العنوان … » → TEST-4074 8 200 DA; no Markdown | yes, 1 | PASS |
| F3 | J03 · playground | arabizi (« slm », « zoudj ») | zoudj = 2, arabizi to the end; « a3tini smiya ta3 nhar » for the street → recap → « ih » → TEST-1493 6 050 DA | yes, 1 | PASS (R3-5) |
| F3b | J03 · shared link | arabizi (« ach kayen », « sifetli », « jouj ») | « ach » / « sifet » not echoed, photo card sent, jouj = 2; **« tawa »**, **« Ch7al men wilaya nta ? »**, « tswal l dar »; « ih » → TEST-8478 6 050 DA | yes, 1 | FAIL — Tunisian word / wrong darija (R3-2, R3-5) |
| F4 | J04 · playground | en | « Bir El Djir » → street asked; confirming call address « Cité 1000 Logements, Bir El Djir » ≠ recap call « cité 1000 logements » → TEST-9160 3 600 DA | yes, 1 | PASS (R3-3, R3-4) |
| F5 | J04 · shared link | mixed fr / arabizi | « wilaya Alger » → commune asked; « Bab Ezzouar » → « Quelle est votre adresse exacte (rue, cité, bâtiment ou point de repère) ? »; recap with the street → « oui c'est bon » → TEST-6890 5 300 DA | yes, 1 | PASS |
| F6 | J03 · playground | fr | probe `create_order {name « Client », phone 0500000000, wilaya 1}` at T1; 2 → 3 tapis after the recap: full new recap → « oui » → TEST-2670 9 100 DA | yes, 1 | PASS (R3-3) |
| F7 | J04 · playground | darija, Arabic script | Arabic recap « (بوفاريك، البليدة) »; « ايه » → TEST-6619; « زيدلي واحد، ديرهم جوج » → recap replacing it + model sentence « استني تأكيدك بـ « إيه » »; confirming call reworded → TEST-3456 replaces TEST-6619 | yes, 1 + 1 replacement | PASS (R3-3, R3-4) |
| F8 | J03 · playground | fr | « la djellaba » = 1 Djellaba homme; probe phone 0500000000 / wilaya 1 at T2; 8-digit phone re-asked; « Blida, Boufarik » → street asked → recap → « oui » → TEST-7633 7 950 DA | yes, 1 | PASS (R3-3) |
| F8b | J03 · playground | fr | wrong phone then right one; all the rest in one → recap → « oui » → TEST-3146 7 950 DA | yes, 1 | PASS (R3-3) |
| F9 | J04 · playground | arabizi fee per wilaya | Arabic welcome now; Sétif 650 / 350, Oran stop-desk 400, Illizi not served — arabizi, no Moroccan word | — | PASS |
| F10 | J03 · playground | fr | « -50 % … 3750 DA c'est bon ? » → price stays 7 500 DA, no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | full recap (with « Votre commande est prête à être confirmée … » before it), « oui » → `CUSTOMER_BLOCKED`, hand-off text, no TEST-n | no (refused, as expected) | PASS (R3-4) |
| F12 | J04 · shared link | fr (« Bonsoir ») | French welcome + reply; Blida 450 / 300 | — | PASS |
| F13 | J03 · playground | fr, all in one + « Oui je confirme direct » | recap only, then « oui » → TEST-3146 7 950 DA | yes, 1 | PASS |
| F14 | J04 · playground | arabizi, all in one | Arabic welcome now; arabizi recap, « ih » → TEST-8190 8 150 DA | yes, 1 | PASS |
| N1 | J03 · playground | fr, product + wilaya + address changed after the recap | full new recap « 1 × Sac à main cuir (Marron) … Bir El Djir, Oran : 600 DA … 7 500 DA »; « oui » → TEST-5759 (the sac, Oran, new address); the djellaba never ordered | yes, 1 | PASS |
| N2 | J04 · playground | fr, two phone numbers | « 0661234568 comme numéro principal et 0770998877 en second »; recap « Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 »; « oui » → TEST-1856 with `secondPhone` | yes, 1 | PASS (R3-3) |
| N3 | J03 · playground | fr → darija (arabizi) at T3 | turn detected `arabizi`, but the recap comes **in French** (« Voici le récapitulatif … Répondez « oui » … »); « ih saha » → TEST-8515 6 300 DA, confirmation in arabizi | yes, 1 | FAIL — recap not in the customer's new language (R3-1) |
| N3p | J03 · playground | fr → darija | probe (2 msgs): with « … ch7al tawsil khouya ? » the recap is in arabizi, after the model sentence « Recap ydhher dork, t7ebb nkamlouh b confirmation ? » | — | (probe; R3-1 not reproduced, R3-4) |

Pass criteria, counted over all flows:
- « oui » to a recap → exactly one order with the recap's content: **17 / 17** (F1, F1b, F2, F3, F3b, F4, F5, F6, F7 ×2, F8, F8b, F13, F14,
  N1, N2, N3). Order without recap + yes: **0**. One « oui » after a change: **3 / 3** (F6 quantity, F7 after the order with
  `replacesOrder`, N1 product + wilaya + address). No second `create_order` after the order in the same turn (R2: 3 × `ORDER_ALREADY_PLACED`)
  and no repeated identical recap call in a turn (R2: F4 ×3, F6 ×3, F8 ×2, F11 ×2).
- Confirming call reworded vs the recap call, order still placed (J03-10 core match): **4 / 4** — F4 address « cité 1000 logements » →
  « Cité 1000 Logements, Bir El Djir » (TEST-9160), F7 address « حي الورود رقم 12 » → « حي الورود رقم 12، بوفاريك، البليدة » and commune
  « Boufarik » → « بوفاريك » (TEST-3456), N1 « Cité 1000 logements bloc 4, Bir El Djir, Oran » → « Cité 1000 logements bloc 4 » (TEST-5759),
  N3 « Cité 1000 logements bloc 5, El Khroub » → « Cité 1000 logements bloc 5 » (TEST-8515; recap draft 5f3486… core 9816bc…, the same core
  as N3p / F6). F1b and F2 resent the recap call's arguments although the « yes » restated the address.
- Recap complete (items with catalogue names, mode, fee, total, name, phone, address): **21 / 21 recaps** (19 playground recaps with
  `CONFIRMATION_REQUIRED` + F3b, F5 on the links); no recap with the commune as the address. In the customer's language: **20 / 21** (N3 T3
  French, R3-1).
- No 503 / provider error: **0 / 100 turns** — turn time median 4.9 s, max 11.3 s (F13 T1, the all-in-one message).
- Quantity never asked again after a product is named: **0 quantity question in 100 turns**; « le sac », « la djellaba », « la robe »,
  « the silk hijab », « جلابة رجالي », « حجاب حرير واحد » = 1; « zoudj », « jouj », « 2 tapis », « 2 pièces », « 2 please » = 2; « 1 seul »,
  « wahda » kept.
- Language kept: arabizi to the end **4 / 4** (F3, F3b, F9, F14), English (F4), Arabic-script darija (F2, F7), French (F1, F1b, F6, F8, F8b,
  F10–F13, N1, N2); switch French → darija followed **1 / 2** (N3 recap French, N3p arabizi).
- No Moroccan / Tunisian words: **19 / 20** (F3b « tawa », R3-2); the customer's own « ach », « sifetli » were not echoed (« Kayen bezzaf »,
  « a3tini », « Mlih »).
- Fee given: **every fee question** (F9 ×3, F12, N3p) and **every recap**; N3 « twasslou l Constantine ? » answered by the recap's fee line.
- No hand-off on a field / yes message: **0 visible** besides F11 (blocked); 4 `handoff_to_human { reason: "other" }` calls on an order /
  name / phone message refused by the platform (F1b T1, F7 T3, F11 T1, N2 T2), invisible to the customer (R3-3).
- Blocked phone refused: **1 / 1** (F11).
- No Markdown in a reply: **100 / 100** (F2 T1 now « عندنا Djellaba homme بسعر 7500 دج »).
- Commune-only home address → street asked: **7 / 7** (F1b, F2, F4, F5, F8, F3 « Blida, Boufarik », F3b « Boufarik »), the server's `VALIDATION address`
  visible in F2 T5 and F4 T5.
- Phone message → no claim that another field was not understood: **7 / 7** (F1, F2, F3, F3b, F5, F8, F8b).

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · product cards · tool calls
with their results (draft / core = first 6 characters of the server keys). Shared-link turns carry no tool calls (visitor response).

### F1 — J03 playground (UI fr)
**Verdict: PASS — « le sac » = 1, no probe after the phone, recap T5 → « oui » → TEST-6293.**

- **T1** C: « Bonsoir » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Qu'est-ce qui vous ferait plaisir aujourd'hui ? »
- **T2** C: « Je voudrais le sac à main cuir marron » · `fr`
  - AI: « Excellent choix ! Le Sac à main cuir en marron est disponible à 6900 DA, en cuir véritable. Pour continuer la commande, quel est votre nom complet ? »
  - cards: « Sac à main cuir 6900 DA »
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `search_products {«Sac à main cuir»} → 1 product(s)`
- **T3** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim, c'est noté ! Quel est votre numéro de téléphone pour la commande ? (format : 0555123456) »
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)`
- **T4** C: « 0770112233 » · `fr`
  - AI: « Merci Karim, c'est noté pour le numéro. Dans quelle wilaya souhaitez-vous recevoir votre commande ? »
- **T5** C: « Sétif, El Eulma, Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - cards: « Sac à main cuir 6900 DA »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550` · `search_products {«sac à main cuir»} → 1 product(s)`
- **T6** C: « oui » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F1b — J03 playground (UI fr)
**Verdict: PASS — « Sétif, El Eulma » → street asked; « oui, c'est bien la cité … » → TEST-6293; confirming call = recap call; probes T1 / T3 (R3-3).**

- **T1** C: « Je voudrais le sac à main cuir marron, 1 seul » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait, le Sac à main cuir en Marron est disponible ! Il coûte 6900 DA et il est en cuir véritable. Pour préparer votre commande, quel est votre nom ? »
  - cards: « Sac à main cuir 6900 DA »
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `check_availability {qty 1} → available true` · `handoff_to_human {other, evidence «Je voudrais le sac à main cuir marron, 1 seul»} → HANDOFF_NOT_NEEDED`
- **T2** C: « Karim Haddad 0770112233 » · `fr`
  - AI: « Merci Karim, c'est noté ! Dans quelle wilaya êtes-vous ? »
- **T3** C: « Sétif, El Eulma » · `fr`
  - AI: « Livraison à domicile à El Eulma : 650 DA, ou 350 DA en stop-desk, avec un délai de 2 à 5 jours. Quelle est votre adresse (rue, cité ou repère) pour la livraison à domicile, ou préférez-vous le stop-desk ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350` · `create_order {phone 0770112233, wilaya 19, customerConfirmed false} → VALIDATION items`
- **T4** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (El Eulma, Sétif) : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T5** C: « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — phone acknowledged (R2-3 fixed), street asked after « الخروب », Arabic recap with « قسنطينة » and « ، » (R2-7 fixed), no Markdown (R2-6), TEST-4074; confirming call = recap call.**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام! عندنا Djellaba homme بسعر 7500 دج (بدل 9000 دج)، من صوف رفيع، لونها بيج ومقاسها واحد. تحب نسجلو لك الطلب؟ »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « اسمي سمير بن علي » · `ar`
  - AI: « أهلاً سمير! واش رقم الهاتف متاعك باش نكملو الطلب؟ (مثال: 0555123456) »
- **T3** C: « 0661234567 » · `ar`
  - AI: « شكرا سمير، تسجّلت الرقم. واش الولاية متاعك باش نحسبو لك التوصيل؟ »
- **T4** C: « قسنطينة » · `ar`
  - AI: « التوصيل لقسنطينة: 700 دج لين الدار، ولا 450 دج في ستوب ديسك. واش البلدية متاعك، وواش العنوان بالضبط (الشارع، الحي أو معلم قريب)؟ »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450`
- **T5** C: « الخروب » · `ar`
  - AI: « تمام، الخروب مسجلة. واش العنوان بالضبط؟ (مثال: شارع، حي أو معلم قريب)، ولا تحب تستلم في ستوب ديسك؟ »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «الخروب», items 1×product …4766, customerConfirmed false} → VALIDATION address`
- **T6** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ - التوصيل للدار (الخروب، قسنطينة): 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T7** C: « ايه، العنوان حي 1000 مسكن عمارة 5 في الخروب قسنطينة » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-4074 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → ok TEST-4074, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: PASS — zoudj = 2, arabizi to the end, TEST-1493; « smiya ta3 nhar » (R3-5).**

- **T1** C: « slm » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Wa 3likoum salam ! Wach men produit t7ebb ? »
- **T2** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - AI: « Mrhba bik ! Zoudj tapis de prière, 2 × 2800 DA, kayen en stock. Wach smitek lik (ism kamel) ? »
  - cards: « Tapis de prière 2800 DA »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)`
- **T3** C: « smiti Walid Bouzid » · `arabizi`
  - AI: « Saha Walid ! A3tini numéro ta3ek (10 chiffres, par exemple 0555123456). »
- **T4** C: « 0770112244 » · `arabizi`
  - AI: « Saha Walid, wach men wilaya ? »
- **T5** C: « Blida, Boufarik » · `arabizi`
  - AI: « Tawsil l Blida (Boufarik): 450 DA l dar, wela 300 DA f stop-desk, ywasel f 2 l 5 ayam. T7ebb twasselna l dar wela nekhtaro stop-desk ? Ila l dar, a3tini smiya ta3 nhar (rue, cité...). »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `quote_delivery {Blida, stop-desk} → fee 300 / stop-desk 300`
- **T6** C: « cite 20 aout villa 3 » · `arabizi`
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: Cité 20 Août, villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `create_order {phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 944991… core 068def…, recap total 6050`
- **T7** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-1493 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {phone 0770112244, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 2×product …a750, customerConfirmed true} → ok TEST-1493, total 6050`

### F3b — J03 shared link (UI fr)
**Verdict: FAIL — « tawa » (Tunisian) T2 and « Ch7al men wilaya nta ? » T5 (R3-2); « tswal » (R3-5). « ach » / « sifetli » not echoed, photo card sent, order TEST-8478 right (jouj = 2).**

- **T1** C: « slm, ach kayen ? »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Kayen bezzaf : basket de sport, djellaba homme, robe kabyle brodée, sac à main en cuir, montre connectée, tapis de prière, coffret cadeau Aïd... Wach men wa7ed t7ebb ? 😊 »
- **T2** C: « sifetli tsawer ta3 tapis de prière »
  - AI: « Hada tapis de prière molletonné, 120 x 70 cm, b 2800 DA. Rani nab3atlek les photos tawa. »
  - cards: « Tapis de prière 2800 DA »
- **T3** C: « nheb nechri jouj »
  - AI: « Mrahba bik, ndirlek commande ta3 zoudj tapis de prière (2 x 2800 DA). Wach smitek ? »
- **T4** C: « smiti Walid Bouzid »
  - AI: « Merhba Walid. Nsajjel commande ta3 zoudj tapis de prière (2 x 2800 DA). A3tini numéro ta3ek, par exemple 0555123456. »
- **T5** C: « 0770112244 »
  - AI: « Merci Walid, numéro bien noté. Ch7al men wilaya nta ? »
- **T6** C: « Blida »
  - AI: « Tawsil l Blida: 450 DA l dar, wela 300 DA f stop-desk, ywasel f 2 l 5 ayam. Wach t7ebb tswal l dar wela stop-desk ? Ila l dar, a3tini l-adresse (rue, cité ou repère). »
- **T7** C: « Boufarik »
  - AI: « Mlih, Boufarik f wilaya Blida. Tswal l dar (450 DA) wela f stop-desk (300 DA) ? Ila l dar, a3tini l-adresse (rue, cité ou repère). »
- **T8** C: « cite 20 aout villa 3 »
  - AI: « Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (Boufarik, Blida): 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Smitek: Walid Bouzid ⏎ Numéro: 0770112244 ⏎ Adresse: cité 20 août villa 3, Boufarik, Blida ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
- **T9** C: « ih »
  - AI: « Commande ta3ek TEST-8478 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 450 DA ⏎ Total: 6 050 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept; confirming call address « Cité 1000 Logements, Bir El Djir » ≠ recap call « cité 1000 logements » → TEST-9160; probe wilaya 1 T3 (R3-3); prefix sentence T6 (R3-4).**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (was 2000 DA). It's a soft silk hijab, 180 x 70 cm, and it's in stock. Would you like to order it? If so, what's your full name? »
  - cards: « Hijab soie 1500 DA »
- **T2** C: « 2 please » · `en`
  - AI: « Perfect, 2 Hijab soie at 1500 DA each. To place the order, what's your full name? »
  - tools: `check_availability {qty 2} → available true`
- **T3** C: « John Benali 0555987654 » · `en`
  - AI: « Thanks John! I've noted your name and phone number. Which wilaya do you live in? »
  - tools: `check_availability {qty 2} → available true` · `create_order {phone 0555987654, wilaya 1, items 2×product …450a, customerConfirmed false} → VALIDATION wilayaId`
- **T4** C: « Oran » · `en`
  - AI: « Oran is covered: home delivery is 600 DA, or 400 DA to a stop-desk, and it takes 2 to 5 days. Would you like home delivery? If so, what's the street or building address in Oran? »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400`
- **T5** C: « Bir El Djir » · `en`
  - AI: « Thanks! What's the street, building or nearby landmark in Bir El Djir for the delivery? »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», items 2×product …450a, customerConfirmed false} → VALIDATION address`
- **T6** C: « cité 1000 logements » · `en`
  - AI: « Thanks John, I have everything for your order. ⏎ Here is your order summary: ⏎ - 2 × Hijab soie : 3 000 DA ⏎ - Home delivery (Bir El Djir, Oran): 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Name: John Benali ⏎ Phone: 0555987654 ⏎ Address: cité 1000 logements, Bir El Djir, Oran ⏎ Reply « yes » to confirm the order, or tell me what to change. »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T7** C: « yes, Cité 1000 Logements in Bir El Djir, Oran » · `en`
  - AI: « Your order TEST-9160 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 Logements, Bir El Djir», items 2×product …450a, customerConfirmed true} → ok TEST-9160, total 3600`

### F5 — J04 shared link (UI fr)
**Verdict: PASS — « Bab Ezzouar » → street asked (R2-2 fixed); recap with the street → TEST-6890.**

- **T1** C: « Salam, je veux la robe kabyle taille M »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Wa 3likoum salam 😊 La Robe kabyle brodée taille M est disponible, à 4900 DA. Pour la commander, quel est votre nom complet ? »
  - cards: « Robe kabyle brodée 4900 DA »
- **T2** C: « smiti Amina Saadi »
  - AI: « Merci Amina, c'est noté. Quel est votre numéro de téléphone pour la commande ? (ex : 0555123456) »
- **T3** C: « 0698765432 »
  - AI: « Merci Amina, c'est noté. Dans quelle wilaya habitez-vous ? »
- **T4** C: « wilaya Alger »
  - AI: « Merci Amina, c'est noté pour Alger. Dans quelle commune êtes-vous ? »
- **T5** C: « Bab Ezzouar »
  - AI: « Parfait, Bab Ezzouar c'est noté. Quelle est votre adresse exacte (rue, cité, bâtiment ou point de repère) ? »
- **T6** C: « rue des frères Bouadou n 5 »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
- **T7** C: « oui c'est bon »
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — probe { « Client », 0500000000, wilaya 1 } T1 (R3-3); 2 → 3 tapis → full new recap → TEST-2670 9 100 DA.**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait, on a bien 2 tapis de prière disponibles à 2800 DA l'unité 🙏 Pour finaliser la commande, quel est votre nom ? »
  - tools: `check_availability {qty 2} → available true` · `create_order {name «Client», phone 0500000000, wilaya 1, items 2×product …a750, customerConfirmed true} → VALIDATION clientPhone`
- **T2** C: « Samira Benali 0661234567 » · `fr`
  - AI: « Merci Samira, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir la commande ? »
  - tools: `check_availability {qty 2} → available true`
- **T3** C: « Constantine, El Khroub, cité 1000 logements bloc 5 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `check_availability {qty 2} → available true` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T4** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `check_availability {qty 3} → available true` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100`
- **T5** C: « oui » · `fr`
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100`

### F7 — J04 playground (UI ar)
**Verdict: PASS — Arabic recaps (R2-7 fixed); TEST-6619 then one « ايه » → TEST-3456 replaces it (confirming call reworded address + commune); second confirm request in the T6 prefix (R3-4); probes T3 (R3-3).**

- **T1** C: « سلام، نحب حجاب حرير واحد » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلًا بيك! عندنا Hijab soie، حجاب حرير ناعم بمقاس 180 x 70 سم، بسعر 1500 دج بدل 2000 دج. نحبو نسجلولك الطلب؟ واش سميتك؟ »
  - cards: « Hijab soie 1500 DA »
- **T2** C: « نادية قاسي 0661234568 » · `ar`
  - AI: « تسجل رقمك يا نادية. واش الولاية متاعك باش نحسبلك التوصيل؟ »
- **T3** C: « البليدة » · `ar`
  - AI: « تمام يا نادية. واش تحب توصّل لدار (450 دج) ولا لنقطة الاستلام ستوب ديسك (300 دج)؟ إذا كان لدار، عطيني الشارع أو الإقامة متاعك. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `quote_delivery {Blida, stop-desk} → fee 300 / stop-desk 300` · `create_order {phone 0661234568, wilaya 9, customerConfirmed false} → VALIDATION items` · `handoff_to_human {other, evidence «x»} → HANDOFF_NOT_NEEDED`
- **T4** C: « بوفاريك، حي الورود رقم 12 » · `ar`
  - AI: « هذا ملخص الطلبية: ⏎ - 1 × Hijab soie : 1 500 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`
- **T6** C: « لا غير زيدلي واحد، ديرهم جوج » · `ar`
  - AI: « تمام يا نادية، بدلنا الطلبية لـ 2 حجاب سوا. استني تأكيدك بـ « إيه » باش نسجلوها. ⏎ هذا ملخص الطلبية: ⏎ - 2 × Hijab soie : 3 000 دج ⏎ - التوصيل للدار (بوفاريك، البليدة): 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: حي الورود رقم 12، بوفاريك، البليدة ⏎ هذي الطلبية تعوض الطلبية TEST-6619. ⏎ جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو. »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «Boufarik», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → CONFIRMATION_REQUIRED draft c78036… core 10ab1a…, recap total 3450`
- **T7** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-3456 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ هذي الطلبية تعوض الطلبية TEST-6619، اللي تلغات. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12، بوفاريك، البليدة», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → ok TEST-3456 (replaces TEST-6619), total 3450`

### F8 — J03 playground (UI fr)
**Verdict: PASS — « la djellaba » = 1; probe phone 0500000000 / wilaya 1 T2 (R3-3); 8-digit phone re-asked; TEST-7633.**

- **T1** C: « Bonjour, je veux la djellaba » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine beige, taille unique, et elle est disponible. Pour commander, quel est votre nom complet ? »
  - cards: « Djellaba homme 7500 DA »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Yacine Mansouri » · `fr`
  - AI: « Merci Yacine ! Quel est votre numéro de téléphone (10 chiffres, commençant par 05, 06 ou 07, par exemple 0555123456) ? »
  - tools: `create_order {phone 0500000000, wilaya 1, items 1×product …efdc, customerConfirmed true} → VALIDATION clientPhone`
- **T3** C: « 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro 05559876 ne compte que 8 chiffres. Pouvez-vous me donner les 10 chiffres, par exemple 0555123456 ? »
  - tools: `create_order {phone 05559876, wilaya 1, items 1×product …efdc, customerConfirmed true} → VALIDATION wilayaId`
- **T4** C: « Pardon, c'est 0555987654 » · `fr`
  - AI: « Merci Yacine, numéro bien noté ! Dans quelle wilaya êtes-vous ? »
- **T5** C: « Blida, Boufarik » · `fr`
  - AI: « Merci Yacine, c'est noté : Blida, commune de Boufarik. Quelle est votre adresse de livraison (rue, cité, bâtiment ou point de repère) ? »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T6** C: « cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T7** C: « oui » · `fr`
  - AI: « Votre commande TEST-7633 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-7633, total 7950`

### F8b — J03 playground (UI fr)
**Verdict: PASS — TEST-3146; probe wilaya 1 T2 (R3-3).**

- **T1** C: « Bonjour, je veux 1 djellaba homme » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonjour ! Très bon choix : la Djellaba homme en laine fine, couleur beige, est disponible à 7500 DA (au lieu de 9000 DA). Pour la commande, quel est votre nom complet ? »
  - cards: « Djellaba homme 7500 DA »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Yacine Mansouri 05559876 » · `fr`
  - AI: « Merci Yacine ! Pouvez-vous me redonner votre numéro complet à 10 chiffres, par exemple 0555123456 ? »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `create_order {phone 05559876, wilaya 1, items 1×product …efdc, customerConfirmed false} → VALIDATION wilayaId`
- **T3** C: « Pardon, c'est 0555987654 » · `fr`
  - AI: « Merci Yacine, c'est noté ! Dans quelle wilaya souhaitez-vous être livré ? »
- **T4** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T5** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F9 — J04 playground (UI fr)
**Verdict: PASS — Arabic welcome for arabizi in the darija shop (R2-5 fixed); fees in arabizi, Illizi not served.**

- **T1** C: « slm, ch7al tawsil l Setif ? » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk. Ywasel f 2 l 5 ayam. T7ebb nchouf produit ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350`
- **T2** C: « w l Oran stop desk ch7al ? » · `arabizi`
  - AI: « Tawsil l Oran f stop-desk: 400 DA, ywasel f 2 l 5 ayam. T7ebb nchouf produit ? »
  - tools: `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400`
- **T3** C: « w Illizi ? » · `arabizi`
  - AI: « Ma nwasslouch l Illizi f had lwaqt, wallah makach livraison lhom. T7ebb nchouf wahed men les produits ta3na f wilaya okhra ? »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED`

### F10 — J03 playground (UI fr)
**Verdict: PASS — no hand-off, catalogue price kept.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme — 7500 DA (au lieu de 9000 DA). Elle est en laine fine, couleur beige, taille unique, et elle est disponible. Voulez-vous la commander ? »
  - cards: « Djellaba homme 7500 DA »
- **T2** C: « Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - AI: « Je comprends, mais je ne peux pas appliquer une autre réduction : le prix de la Djellaba homme reste 7500 DA (au lieu de 9000 DA). Voulez-vous que je la prépare pour vous ? »

### F11 — J04 playground (UI fr)
**Verdict: PASS — full recap, CUSTOMER_BLOCKED, hand-off, no order; prefix sentence T3 (R3-4); hand-off probe T1 (R3-3).**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Très bon choix ! Le Hijab soie est disponible : il est à 1500 DA au lieu de 2000 DA, en soie douce, 180 x 70 cm. Pour la commande, quel est votre nom complet ? »
  - cards: « Hijab soie 1500 DA »
  - tools: `check_availability {qty 1} → available true` · `handoff_to_human {other, evidence «je veux 1 hijab soie»} → HANDOFF_NOT_NEEDED`
- **T2** C: « Lamia Touati, 0550123456 » · `fr`
  - AI: « Merci Lamia ! Dans quelle wilaya habitez-vous ? »
- **T3** C: « Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Merci Lamia ! Votre commande est prête à être confirmée, le récapitulatif va vous être envoyé. ⏎ Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Bab Ezzouar, Alger) : 400 DA ⏎ Total : 1 900 DA, à payer à la livraison. ⏎ Nom : Lamia Touati ⏎ Téléphone : 0550123456 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900`
- **T4** C: « oui » · `fr`
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Désolé Lamia, je ne peux pas finaliser la commande pour le moment. Je vérifie avec l'équipe et je vous tiens informée dès que possible. »
  - tools: `create_order {phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS — French welcome and reply, fees given.**

- **T1** C: « Bonsoir »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Qu'est-ce qui vous ferait plaisir aujourd'hui ? Vous cherchez un vêtement, un parfum, une montre ou autre chose ? »
- **T2** C: « Vous livrez à Blida ? »
  - AI: « Oui, on livre à Blida 😊 Les frais sont de 450 DA à domicile, ou 300 DA en stop-desk, avec une livraison en 2 à 5 jours. Vous cherchez quel produit ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » only gives the recap; « oui » → TEST-3146.**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F14 — J04 playground (UI fr)
**Verdict: PASS — Arabic welcome, arabizi recap and confirmation, TEST-8190.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « Hada récap ta3 la commande: ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Tawsil l dar (El Eulma, Sétif): 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Smitek: Karim Haddad ⏎ Numéro: 0770112233 ⏎ Adresse: Cite 500 logements bloc 12, El Eulma, Sétif ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350` · `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cite 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-8190 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cite 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → ok TEST-8190, total 8150`

### N1 — J03 playground (UI fr)
**Verdict: PASS — product, wilaya and address changed after the recap → one full new recap (sac Marron, Oran 600 DA, 7 500 DA) → one « oui » → TEST-5759; confirming call dropped « , Bir El Djir, Oran » from the address, placed (core match).**

- **T1** C: « Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950` · `search_products {«djellaba homme»} → 1 product(s)`
- **T2** C: « Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ - Livraison à domicile (Bir El Djir, Oran) : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4, Bir El Djir, Oran», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6e57bf… core 146d71…, recap total 7500`
- **T3** C: « oui » · `fr`
  - AI: « Votre commande TEST-5759 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 600 DA ⏎ Total : 7 500 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «Cité 1000 logements bloc 4», items 1×variant …0eda, customerConfirmed true} → ok TEST-5759, total 7500`

### N2 — J04 playground (UI fr)
**Verdict: PASS — both numbers kept (main + « Deuxième téléphone » in the recap, `secondPhone` in the order) → TEST-1856; probes T2 (R3-3).**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonne nouvelle, le Hijab soie est disponible ! Il est à 1500 DA au lieu de 2000 DA, en soie douce, 180 x 70 cm. Pour preparer votre commande, quel est votre nom complet ? »
  - cards: « Hijab soie 1500 DA »
- **T2** C: « Nadia Kaci, 0661234568 ou 0770998877 » · `fr`
  - AI: « Merci Nadia, c'est noté : 0661234568 comme numéro principal et 0770998877 en second. Dans quelle wilaya souhaitez-vous être livrée ? »
  - tools: `create_order {phone 0661234568, secondPhone 0770998877, wilaya 1, items 1×product …450a, customerConfirmed true} → VALIDATION wilayaId` · `handoff_to_human {other, evidence «Nadia Kaci, 0661234568 ou 0770998877»} → HANDOFF_NOT_NEEDED`
- **T3** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 × Hijab soie : 1 500 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Nom : Nadia Kaci ⏎ Téléphone : 0661234568 ⏎ Deuxième téléphone : 0770998877 ⏎ Adresse : Cité 20 août villa 3, Boufarik, Blida ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `create_order {phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft e42dad… core 51097b…, recap total 1950`
- **T4** C: « oui » · `fr`
  - AI: « Votre commande TEST-1856 est bien enregistrée ✅ ⏎ - 1 × Hijab soie : 1 500 DA ⏎ Livraison : 450 DA ⏎ Total : 1 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0661234568, secondPhone 0770998877, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …450a, customerConfirmed true, phoneConfirmed true} → ok TEST-1856, total 1950`

### N3 — J03 playground (UI fr)
**Verdict: FAIL — the turn after the switch to darija is detected `arabizi` but the recap is French; the confirmation is arabizi (R3-1). Order TEST-8515 right; confirming call reworded the address, placed.**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Avec plaisir ! Les 2 tapis de prière molletonnés (120 x 70 cm) sont disponibles, à 2800 DA l'unité. Pour commander, quel est votre nom complet ? »
  - cards: « Tapis de prière 2800 DA »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `check_availability {qty 2} → available true` · `get_product`
- **T2** C: « Samira Benali, 0661234567 » · `fr`
  - AI: « Merci Samira ! Dans quelle wilaya souhaitez-vous être livrée ? »
- **T3** C: « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » · `arabizi`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom : Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5, El Khroub», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 5f3486… core 9816bc…, recap total 6300`
- **T4** C: « ih saha » · `arabizi`
  - AI: « Commande ta3ek TEST-8515 tsajlet ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison: 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → ok TEST-8515, total 6300`

### N3p — J03 playground (UI fr)
**Verdict: Probe (not counted) — with more darija in the message the recap is arabizi; model sentence « Recap ydhher dork, t7ebb nkamlouh b confirmation ? » before it (R3-4).**

- **T1** C: « Bonjour, je voudrais 2 tapis de prière, Samira Benali 0661234567 » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Samira, on a bien 2 tapis de prière molletonnés (120 x 70 cm) disponibles à 2800 DA l'unité. Pour continuer, dans quelle wilaya êtes-vous ? »
  - cards: « Tapis de prière 2800 DA »
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « ana f Constantine El Khroub, cité 1000 logements bloc 5, ch7al tawsil khouya ? » · `arabizi`
  - AI: « Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. Recap ydhher dork, t7ebb nkamlouh b confirmation ? ⏎ Hada récap ta3 la commande: ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ - Tawsil l dar (El Khroub, Constantine): 700 DA ⏎ Total: 6 300 DA, tkhalles ki tewsel. ⏎ Smitek: Samira Benali ⏎ Numéro: 0661234567 ⏎ Adresse: Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `quote_delivery {Constantine, stop-desk} → fee 450 / stop-desk 450` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`

## Bugs

### R3-1 — The customer switches from French to darija mid-order and the recap comes in French (the confirmation then in arabizi)
- Page: playground dialog (owner, fr, 1440) — « Boutique de Nassim »
- Severity: Major
- Type: Bug
- Steps: 1. J03 › step 5 › « Tester moi-même ». 2. « Bonjour, je voudrais 2 tapis de prière », « Samira Benali, 0661234567 ». 3. Send
  « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 ». 4. « ih saha ».
- Expected: from T3 on, the replies in the customer's new language (04-ai-pipeline §3.6, J04-2: the language follows the customer's last
  message), the recap in arabizi like F3 / F14 / N3p (« Hada récap ta3 la commande: … Ktebli « ih » bach nconfirmi … »).
- Actual: T3 is labelled `arabizi` by the turn, but the reply is the French server recap: « Voici le récapitulatif de votre commande : ⏎ - 2 ×
  Tapis de prière : 5 600 DA ⏎ - Livraison à domicile (El Khroub, Constantine) : 700 DA ⏎ Total : 6 300 DA, à payer à la livraison. ⏎ Nom :
  Samira Benali ⏎ Téléphone : 0661234567 ⏎ Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine ⏎ Répondez « oui » pour confirmer
  la commande, ou dites-moi ce qu'il faut changer. »; T4 « ih saha » → « Commande ta3ek TEST-8515 tsajlet ✅ … Saha, merci 3la thiqa
  ta3ek! » (arabizi). The customer's question « twasslou l Constantine ? » gets no sentence of its own (only the fee line of the recap).
  With more darija in the same message (N3p « ana f Constantine El Khroub, cité 1000 logements bloc 5, ch7al tawsil khouya ? ») the recap
  is in arabizi.
- Evidence: .local/qa/journeys/R3/out/transcripts/N3.json T3–T4 (`language: "arabizi"` on T3), N3p.json T2 · .local/qa/campaign/retest-ai-r3/fr-N3-pg.png
- Likely cause: the recap / confirmation text uses the server's turn language `req.guard.lang` (apps/api/src/modules/ai/ai-run.service.ts:194,
  206, 233 → order-confirmation-text.ts:86 `locOf`, where `mixed` falls to `fr`), while the reported language is the model's
  (`out.language ?? lang`, playground.service.ts:274). `turnLanguage` (language.ts:70) keeps the previous `fr` (or `mixed`) for a Latin
  message with « Constantine », « El Khroub », « cité … logements bloc » and only « khouya », « twasslou », « ana f » as darija clues.

### R3-2 — The arabizi shared link still writes a Tunisian « tawa » (« now ») and « Ch7al men wilaya nta ? » (« how many of wilaya are you? »)
- Page: shared test link /fr/agent-test/<J03 token> (« Boutique de Nassim », visitor, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. Open the J03 shared test link. 2. « slm, ach kayen ? », « sifetli tsawer ta3 tapis de prière », « nheb nechri jouj », « smiti
  Walid Bouzid », « 0770112244 ».
- Expected: Algerian darija / arabizi only (04 §4.3 rules 13–16, J04-3): « dork » / « drok », « wach men wilaya ? » / « f ayya wilaya ? ».
- Actual: T2 « Hada tapis de prière molletonné, 120 x 70 cm, b 2800 DA. Rani nab3atlek les photos **tawa**. » (card « Tapis de prière
  2 800 DA » sent) — « tawa » is Tunisian (the list has « tawwa » / « توة » only); T5 « Merci Walid, numéro bien noté. **Ch7al men wilaya
  nta ?** » — « ch7al » means « how much / how many »: the J04-3 check `WRONG_DARIJA` matches « ch7al wilaya » but not « ch7al **men**
  wilaya ». The Moroccan words of R2-1 (« sift-li », « Ach », « Mezyan », « Issa ») are gone; the customer's own « ach » and « sifetli »
  were not echoed (« Kayen bezzaf : … Wach men wa7ed t7ebb ? », « a3tini l-adresse », « Mlih, Boufarik f wilaya Blida »). Playground
  arabizi flows (F3, F9, F14, N3, N3p) had neither form.
- Evidence: .local/qa/journeys/R3/out/transcripts/F3b.json T2, T5 + F3b.ui.txt · .local/qa/campaign/retest-ai-r3/fr-F3b-link.png
- Likely cause: apps/api/src/modules/ai/language.ts:159 `MOROCCAN_WORDS` has `tawwa|توة` but not `tawa`; language.ts:176 `WRONG_DARIJA`
  allows only whitespace between « ch7al » and « wilaya / smitek / numéro … » (no optional « men / l »).

### R3-3 — `create_order` / `handoff_to_human` still used as probes: invented name « Client », phone « 0500000000 », wilaya 1, `items: []`, hand-off « other » on order / phone messages
- Page: playground dialog (owner, fr / ar / en, 1440)
- Severity: Minor
- Type: Bug
- Steps: run F4, F6, F8, F8b, N2 (field-by-field) and F1b, F7, F11 (any order flow); read the tool calls.
- Expected: `create_order` only with the customer's values (orders.ts, J04-6); `handoff_to_human` only when a rule applies (AI-CHAT-07).
- Actual: F6 T1 (after « Bonjour, je prends le tapis de prière, 2 pièces », nothing else given) `create_order { clientName: "Client",
  clientPhone: "0500000000", wilayaId: 1, items 2× … } → VALIDATION, notGivenByCustomer ["clientPhone","wilayaId"]` — the invented name
  « Client » is not in the list; F8 T2 (after the name) `{ clientPhone: "0500000000", wilayaId: 1 }` → same; wilaya 1 never named in F4 T3,
  F8 T3, F8b T2, N2 T2 → `notGivenByCustomer ["wilayaId"]`; the 8-digit « 05559876 » sent as `clientPhone` (F8 T3, F8b T2) is not reported
  invalid by the tool (the AI re-asked it on its own); `items: []` in F1b T3, F7 T3. `handoff_to_human { reason: "other" }` with evidence
  « Je voudrais le sac à main cuir marron, 1 seul » (F1b T1), « x » (F7 T3), « je veux 1 hijab soie » (F11 T1), « Nadia Kaci, 0661234568 ou
  0770998877 » (N2 T2) → `HANDOFF_NOT_NEEDED`. Better than R2: the server now names the values not given, no probe reaches the customer
  (no « ما فهمتش الولاية »), no repeated identical call, no call after the order was placed.
- Evidence: transcripts/F6.json T1, F8.json T2–T3, F8b.json T2, F4.json T3, N2.json T2, F1b.json T1/T3, F7.json T3, F11.json T1 (tool args / results)
- Likely cause: the « not given » check (apps/api/src/modules/ai/tools/tool-registry.ts:493) covers the phone and the wilaya but not a
  placeholder `clientName`; phone format is checked after the « missing » answer; the model still calls `create_order` to learn the
  missing fields and `handoff_to_human` « other » on first messages.

### R3-4 — The model's own sentence is still kept in front of the server recap: a second « confirm » request, or text about the recap itself
- Page: playground dialog (owner, ar / fr / en, 1440)
- Severity: Cosmetic
- Type: Text
- Steps: 1. F7 (J04, ar): … « ايه » (TEST-6619) then « لا غير زيدلي واحد، ديرهم جوج ». 2. N3p (J03): « Bonjour, je voudrais 2 tapis de
  prière, Samira Benali 0661234567 », « ana f Constantine El Khroub, cité 1000 logements bloc 5, ch7al tawsil khouya ? ». 3. F11 (J04):
  … « Alger, Bab Ezzouar, rue des frères Bouadou n 5 ». 4. F4 (J04, en): … « cité 1000 logements ».
- Expected: one recap with one call to action; no sentence about the recap's own sending (R2-6 fix).
- Actual: F7 T6 « تمام يا نادية، بدلنا الطلبية لـ 2 حجاب سوا. **استني تأكيدك بـ « إيه » باش نسجلوها.** ⏎ هذا ملخص الطلبية: … ⏎ **جاوبني
  بـ « إيه » باش نأكدو الطلبية**، ولا قولي واش نبدلو. »; N3p T2 « Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk,
  ywasel f 2 l 5 ayam. **Recap ydhher dork, t7ebb nkamlouh b confirmation ?** ⏎ Hada récap ta3 la commande: … Ktebli « ih » bach nconfirmi
  la commande … »; F11 T3 « Merci Lamia ! **Votre commande est prête à être confirmée, le récapitulatif va vous être envoyé.** ⏎ Voici le
  récapitulatif de votre commande : … »; F4 T6 « Thanks John, I have everything for your order. ⏎ Here is your order summary: … ». The R2
  cases (F8 « Répondez oui pour confirmer » twice, F5 address said twice) are gone.
- Evidence: transcripts/F7.json T6, N3p.json T2, F11.json T3, F4.json T6 · .local/qa/campaign/retest-ai-r3/ar-F7-pg.png
- Likely cause: apps/api/src/modules/ai/tools/order-confirmation-text.ts `CONFIRM_ASK` (after `recapReply`, l. 199–216) matches
  « باش نأكد », « للتأكيد », « pour confirmer », « bach nconfirmi » but not « تأكيدك », « b confirmation », « confirmée », and the kept
  prefix is not checked for talk about the recap itself (« le récapitulatif va vous être envoyé », « Recap ydhher »).

### R3-5 — Odd arabizi words in the address question: « a3tini smiya ta3 nhar » (« the name of the day »), « tswal l dar »
- Page: playground dialog (owner, fr, 1440) + shared test link (visitor, fr) — « Boutique de Nassim »
- Severity: Cosmetic
- Type: Text
- Steps: 1. F3 (playground): « slm », « nheb nechri zoudj tapis de prière », « smiti Walid Bouzid », « 0770112244 », « Blida, Boufarik ».
  2. F3b (link): … « Blida », « Boufarik ».
- Expected: understandable Algerian arabizi: « a3tini l'adresse (rue, cité…) », « smiyet ennhej », « t7ebb nwasslouha l dar ? ».
- Actual: F3 T5 « Tawsil l Blida (Boufarik): 450 DA l dar, wela 300 DA f stop-desk, ywasel f 2 l 5 ayam. T7ebb twasselna l dar wela
  nekhtaro stop-desk ? Ila l dar, a3tini **smiya ta3 nhar** (rue, cité...). » (« nhar » = day; « nhej » = street); F3b T6 « Wach t7ebb
  **tswal** l dar wela stop-desk ? », T7 « **Tswal** l dar (450 DA) wela f stop-desk (300 DA) ? » (not a darija verb). The customer still
  understood from « (rue, cité...) » and sent the address.
- Evidence: transcripts/F3.json T5, F3b.json T6–T7
- Likely cause: free model wording; no fixed arabizi text for the address question (the recap / confirmation texts are fixed and fine).

## Retest
- RETEST R2-1: partly fixed — « sift-li », « Ach », « Mezyan », « Issa » gone (F3b same steps); the customer's Moroccan « ach kayen ? »,
  « sifetli tsawer » were answered in Algerian (« Kayen bezzaf : … Wach men wa7ed t7ebb ? », photo card sent, « a3tini l-adresse »,
  « Mlih »); new on the same link: Tunisian « tawa » and « Ch7al men wilaya nta ? » → R3-2.
- RETEST R2-2: fixed — F5 (same link steps) « Bab Ezzouar » → « Parfait, Bab Ezzouar c'est noté. Quelle est votre adresse exacte (rue, cité,
  bâtiment ou point de repère) ? », recap only after « rue des frères Bouadou n 5 »; the commune-only case also asked the street in F1b
  (« Sétif, El Eulma »), F2 (« الخروب », `create_order … → VALIDATION address`), F4 (« Bir El Djir », same), F8 / F3 / F3b; 0 recap with the
  commune as the address in 21 recaps.
- RETEST R2-3: fixed — F2 T3 after « 0661234567 »: « شكرا سمير، تسجّلت الرقم. واش الولاية متاعك باش نحسبو لك التوصيل؟ » (R2: « ما فهمتش
  الولاية »); F2 T4 « قسنطينة » taken as the wilaya only (fee given, then « واش البلدية متاعك »); F3b T5 « Merci Walid, numéro bien noté »
  (R2: « rani nestanna numéro ta3ek »); no reply denying a field just given in 100 turns.
- RETEST R2-4: partly fixed — no repeated identical recap call, no `create_order` after the order in the same turn, the server names the
  values the customer never gave (`notGivenByCustomer`), the empty `quote_delivery {}` probe is gone and nothing reaches the customer; still
  invented `clientName "Client"` / phone « 0500000000 » / wilaya 1 / `items: []` probes and 4 refused `handoff_to_human` « other » → R3-3.
- RETEST R2-5: fixed — an arabizi first message gets the Arabic welcome in the darija shop J04 (F9 « slm, ch7al tawsil l Setif ? », F14
  « مرحبًا 👋 أهلًا بك في Boutique de Karima! … »); in the French shop J03 it keeps the French welcome (F3, F3b), as the fix defines
  (language.ts `systemLocale`: arabizi → Arabic text only when the shop speaks darija).
- RETEST R2-6: partly fixed — Markdown gone (0 in 100 replies; F2 T1 « عندنا Djellaba homme بسعر 7500 دج » without `**`); the R2 double
  « Répondez oui » (F8) and repeated address (F5) gone; a model sentence with a second confirm request or talk about the recap is still kept
  in F7 T6, N3p T2, F11 T3 → R3-4.
- RETEST R2-7: fixed — Arabic recaps with the wilaya in Arabic and « ، »: F2 « - التوصيل للدار (الخروب، قسنطينة): 700 دج … العنوان: حي 1000
  مسكن عمارة 5، الخروب، قسنطينة », F7 « (بوفاريك، البليدة) … حي الورود رقم 12، بوفاريك، البليدة » (also after the change, T6, where the recap
  call sent the commune in Latin « Boufarik »).
- RETEST J03-10: fixed — 17 « yes » to a recap → 17 TEST orders, one each, the recap's content; 4 reworded confirming calls placed (F4, F7,
  N1, N3), see the pass criteria.
- RETEST J04-4: fixed — F7 change after TEST-6619 → « هذي الطلبية تعوض الطلبية TEST-6619 » → TEST-3456 « … اللي تلغات »; F6 quantity change
  before the « oui » and N1 product + wilaya + address change before the « oui » → one order with the new content.
- RETEST J09-14: fixed — F11 « oui » → `CUSTOMER_BLOCKED`, « Désolé Lamia, je ne peux pas finaliser la commande pour le moment. Je vérifie
  avec l'équipe et je vous tiens informée dès que possible. » + system « Je transmets à un membre de l'équipe … », no TEST-n.

## Coverage
- Order flows to « oui »: fr ×8 (F1, F1b, F6, F8, F8b, F13, N1, N2 + F5 mixed), Arabic-script darija ×2 (F2, F7), arabizi ×3 (F3 playground,
  F3b link, F14), en ×1 (F4), fr → darija ×1 (N3); commune-only home address in F1b, F2, F3, F3b, F4, F5, F8; all-in-one in F13, F14, N1;
  confirming « yes » restating the address in F1b, F2, F4.
- New adversarial cases: product + wilaya + address change after the recap (N1), two phone numbers (N2), French → darija switch mid-order
  (N3, N3p). Moroccan-prone arabizi incl. photos asked (F3b). Quantity words as in R2. Changes: quantity before « oui » (F6), after the order
  (F7). Wrong 8-digit phone then right (F8, F8b). Greetings « Bonsoir » (F1, F12) / « slm » (F3, F3b, F9, F14). Fee per wilaya incl. a
  wilaya not served (F9). Fake discount (F10). Blocked phone (F11).
- Kit: no blocked call, no API error, no console error in any of the 21 runs.

## Not tested
- Live Messenger path (no page connected): Messenger rendering of the plain-text replies, `needs_human` after the blocked-phone hand-off,
  the AiRun panel / error label of a live message.
- A provider failure (none happened in R2 nor R3).
- Second phone number on a real order (N2 is a simulated TEST order: the `secondPhone` reached the tool and the recap; the order screen was
  not checked); a customer switching from darija back to French.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, from R1) left in place.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-6293 (F1, F1b), TEST-4074, TEST-1493, TEST-8478, TEST-9160,
  TEST-6890, TEST-2670, TEST-6619 (replaced), TEST-3456, TEST-7633, TEST-3146 (F8b, F13 — same content, same simulated number), TEST-8190,
  TEST-5759, TEST-1856, TEST-8515.
- Hour counters at the end (14:23): J03 shop 57 / 60; J04 shop 27 / 60 (its window restarted during the run: 55 at F4 T7 14:12, 6 at F7 T1
  14:14), no 429. Messages used: 100 / 100.
