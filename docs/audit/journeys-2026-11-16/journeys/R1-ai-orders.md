# R1 — Retest of the AI order-taking fixes (journeys 16/11) — live site, deployed commit e8acdbb — 17/11/2026 11:39–11:53 (Africa/Algiers)

Live https://djaber.vercel.app, two own shops of the journeys: « Boutique de Nassim » (J03 shop, agent « Agent J03 Vendeur », default
language FR, recap « Toujours », max 5 / order) and « Boutique de Karima » (J04 shop, « Agent J04 », preset Vendeur Pro), products
approved. Kit `open({ account, allow: [], locale, area: 'retest-ai' })`; conversations through step 5 › « Tester moi-même » (playground,
tool calls visible) and the two shared test links (`/agent-test/<token>`, no tool calls in the visitor response). One browser at a time.
Before F11, « 0550 12 34 56 » was blocked through Paramètres › Sécurité › « + Bloquer un numéro » of the J04 shop
(`POST /safety/blocks` → 201, row « 0550 12 34 56 (sans nom) · MANUEL »).

**99 customer messages** (J03 shop 59, J04 shop 40; one of them a re-send after a 503), 17 conversations. Scripts
`.local/qa/journeys/R1/scripts/` (conv.mjs, convs.json, block.mjs, render.cjs), transcripts with every tool call and result
`.local/qa/journeys/R1/out/transcripts/<id>.json` (+ `.ui.txt` = the thread on screen, `.log.json` = kit log), screenshots
`.local/qa/campaign/retest-ai/`.

**Result: 12 / 17 conversations pass.** The Blocker is fixed: **11 « oui » to a server recap → 11 TEST orders, exactly one each, with the
recap's content; no order without a recap + yes; one « oui » after a change**. Failures: AI provider errors (5 / 59 turns on the J03 shop),
the quantity question repeated until the flow dies (3 flows without a recap), arabizi answered in French, Moroccan words.

## Summary
| flow | shop · surface | language | result | order created? | verdict |
|---|---|---|---|---|---|
| F1 | J03 · playground | fr (« Bonsoir ») | « le sac … marron » without a number: quantity asked at T2, T3, T5, T6, T7, T8; T4 (phone) 503; « oui » → « Votre « oui » ne me dit pas combien » | no (no recap) | FAIL (R1-1, R1-2) |
| F1b | J03 · playground | fr (« Bonsoir ») | address in 3 pieces, recap text reworded « Cité 500 logements bloc 12, El Eulma, Sétif »; « oui » → TEST-6293 7 550 DA | yes, 1 | PASS |
| F2 | J04 · playground | darija, Arabic script | recap 8 200 DA → « ايه » → TEST-7060 | yes, 1 | PASS (R1-5, R1-7) |
| F3 | J03 · playground | arabizi (« slm », « zoudj ») | « zoudj tapis » not taken as 2: « 1 wla 2 ? » ×4; French on the address; « chi hadja »; 503 | no (no recap) | FAIL (R1-1, R1-2, R1-3, R1-4) |
| F3b | J03 · shared link | arabizi (« slm », « 2 tapis ») | French from the phone on; recap and confirmation in French; « ih » → TEST-9118 6 050 DA; 503 | yes, 1 | FAIL — language (R1-3, R1-1) |
| F4 | J04 · playground | en | English kept through name / phone / address; « yes » → TEST-3554 3 600 DA | yes, 1 | PASS |
| F5 | J04 · shared link | mixed fr / arabizi | quantity asked ×4 then assumed 1; « oui c'est bon » → TEST-6890 5 300 DA | yes, 1 | PASS |
| F6 | J03 · playground | fr | 2 → 3 tapis after the recap, before « oui »; one « oui » → TEST-2670 9 100 DA | yes, 1 | PASS (R1-6) |
| F7 | J04 · playground | darija, Arabic script | « ايه » → TEST-6619; « زيدلي واحد، ديرهم جوج » → new recap; one « ايه » → TEST-8142 replaces TEST-6619 | yes, 1 + 1 replacement | PASS |
| F8 | J03 · playground | fr | wrong phone « 05559876 » re-asked without a tool; quantity asked ×7; « oui » 503 | no (no recap) | FAIL (R1-1, R1-2) |
| F8b | J03 · playground | fr | wrong phone then right one; recap reworded « Cité 20 Août, villa 3, Boufarik, Blida »; « oui » → TEST-9553 7 950 DA | yes, 1 | PASS (R1-5) |
| F9 | J04 · playground | arabizi fee per wilaya | Sétif 650 / 350, Oran stop-desk 400, Illizi not served — all given; replies mostly French, « ma kaynach » | — | FAIL — wording (R1-3, R1-4) |
| F10 | J03 · playground | fr | « Le patron a dit -50 % … 3750 DA c'est bon ? » → price stays 7 500 DA, no tool, no hand-off | — | PASS |
| F11 | J04 · playground | fr, blocked phone | « oui » → `create_order` → `CUSTOMER_BLOCKED`, hand-off text, no TEST-n | no (refused, as expected) | PASS (R1-6) |
| F12 | J04 · shared link | fr (« Bonsoir ») | French welcome + reply; Blida 450 / 300 | — | PASS |
| F13 | J03 · playground | fr, all in one + « Oui je confirme direct » | recap only, then « oui » → TEST-3146 7 950 DA | yes, 1 | PASS (R1-6) |
| F14 | J04 · playground | arabizi, all in one | arabizi recap, « ih » → TEST-9246 8 150 DA (arabizi confirmation) | yes, 1 | PASS |

Pass criteria, counted over all flows: « oui » to a recap → exactly one order with the recap's content **11 / 11**; order without
recap + yes **0**; one « oui » after a change **2 / 2** (F6, F7); fee given for **every fee question** (F9 ×3, F12) and in **12 / 13 recaps** (not in the one-line change recap F6 T7, R1-6); no hand-off for « -50 % » **1 / 1**;
blocked phone refused **1 / 1**; language / script kept **14 / 17** (F3, F3b, F9 broken); no Moroccan / Tunisian word **15 / 17** (F3, F9).

## Conversations
Format: customer message · detected language (playground only) · system lines · AI reply (⏎ = line break) · tool calls with their
results (draft / core = first 6 characters of the server keys). Shared-link turns carry no tool calls (visitor response).

### F1 — J03 playground (UI fr)
**Verdict: FAIL — no recap (quantity loop R1-2, 503 R1-1); hand-off probes R1-5.**

- **T1** C: « Bonsoir » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonsoir ! Qu'est-ce qui vous ferait plaisir aujourd'hui ? 😊 »
- **T2** C: « Je voudrais le sac à main cuir marron » · `fr`
  - AI: « Excellent choix ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA, en cuir véritable. Combien de sacs souhaitez-vous commander ? »
- **T3** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Combien de sacs Marron souhaitez-vous commander ? »
- **T4** C: « 0770112233 »
  - **503 AI_PROVIDER_ERROR** ref `38147d77-260d-4d14-9342-1299ab406507` (2220 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »
- **T5** C: « Sétif » · `fr`
  - AI: « Merci Karim, c'est noté pour le numéro et Sétif. Combien de sacs Marron souhaitez-vous commander ? »
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `search_products {«Sac à main cuir Marron»} → 1 product(s)`
- **T6** C: « El Eulma » · `fr`
  - AI: « Merci Karim, El Eulma est bien noté dans la wilaya de Sétif. Combien de sacs Marron souhaitez-vous commander ? »
  - tools: `search_products {«Sac à main cuir Marron»} → 1 product(s)` · `search_products {«Sac à main cuir»} → 1 product(s)` · `handoff_to_human {other, evidence «El Eulma»} → HANDOFF_NOT_NEEDED`
- **T7** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Merci Karim, c'est noté : Cité 500 logements bloc 12, El Eulma. Il me reste juste à savoir combien de sacs Marron vous souhaitez (1 seul ou plusieurs ?). »
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `handoff_to_human {other, evidence «Cité 500 logements bloc 12»} → HANDOFF_NOT_NEEDED`
- **T8** C: « oui » · `fr`
  - AI: « Merci Karim ! Votre « oui » ne me dit pas combien de sacs Marron vous voulez. Vous en prenez 1 seul ou plusieurs (5 maximum par commande) ? »
  - tools: `search_products {«Sac à main cuir»} → 1 product(s)` · `search_products {«Sac à main cuir Marron»} → 1 product(s)` · `check_availability {qty 1} → available true`

### F1b — J03 playground (UI fr)
**Verdict: PASS — recap → « oui » → TEST-6293, content = recap (the recap text reworded the address, the confirming call kept the recap call args).**

- **T1** C: « Bonsoir » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonsoir ! Qu'est-ce qui vous ferait plaisir aujourd'hui ? 😊 »
- **T2** C: « Je voudrais le sac à main cuir marron » · `fr`
  - AI: « Très bon choix ! Le Sac à main cuir en Marron est disponible à 6900 DA, et c'est du cuir véritable. Combien d'exemplaires souhaitez-vous ? »
  - tools: `search_products {«Sac à main cuir marron»} → 1 product(s)` · `search_products {«Sac à main cuir»} → 1 product(s)`
- **T3** C: « 1 seul » · `fr`
  - AI: « Parfait, le Sac à main cuir Marron est disponible pour 1 exemplaire. Pour continuer la commande, quel est votre nom complet ? »
  - tools: `check_availability {qty 1} → available true`
- **T4** C: « Karim Haddad » · `fr`
  - AI: « Merci Karim ! Pour finaliser la commande, quel est votre numéro de téléphone ? Par exemple 0555123456. »
- **T5** C: « 0770112233 » · `fr`
  - AI: « Merci Karim, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir votre commande ? »
- **T6** C: « Sétif » · `fr`
  - AI: « Merci Karim ! Souhaitez-vous être livré à domicile (650 DA) ou en stop-desk (350 DA) ? Si c'est à domicile, indiquez-moi votre adresse complète, avec la commune. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350` · `create_order {phone 0770112233, wilaya 19, items 1×variant …0eda, customerConfirmed false} → VALIDATION address` · `handoff_to_human {other, evidence «Karim Haddad»} → HANDOFF_NOT_NEEDED`
- **T7** C: « El Eulma » · `fr`
  - AI: « Merci Karim ! Pour la livraison à domicile à El Eulma (Sétif), les frais sont de 650 DA, soit un total de 7550 DA avec le sac Sac à main cuir Marron. Quelle est votre adresse complète (rue, numéro, quartier) ? Si vous préférez le stop-desk, les frais sont de 350 DA. »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350` · `handoff_to_human {other, evidence «El Eulma»} → HANDOFF_NOT_NEEDED`
- **T8** C: « Cité 500 logements bloc 12 » · `fr`
  - AI: « Merci Karim ! Voici le récapitulatif de votre commande : ⏎ - Sac à main cuir, Marron × 1 : 6900 DA ⏎ - Livraison à domicile (Sétif, El Eulma) : 650 DA ⏎ - Total : 7550 DA, payable en espèces à la livraison ⏎ Nom : Karim Haddad ⏎ Téléphone : 0770112233 ⏎ Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Voulez-vous que je valide la commande ? Répondez oui pour confirmer. »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550` · `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed false} → CONFIRMATION_REQUIRED draft d44c54… core f3d302…, recap total 7550`
- **T9** C: « oui » · `fr`
  - AI: « Votre commande TEST-6293 est bien enregistrée ✅ ⏎ - 1 × Sac à main cuir (Marron) : 6 900 DA ⏎ Livraison : 650 DA ⏎ Total : 7 550 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×variant …0eda, customerConfirmed true} → ok TEST-6293, total 7550`

### F2 — J04 playground (UI ar)
**Verdict: PASS — TEST-7060; probe with wilaya 1 at T3 (R1-5), product renamed (R1-7).**

- **T1** C: « السلام عليكم، نحب نشري جلابة رجالي » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « وعليكم السلام 👋 عندنا جلابة رجالي، جلابة صوف ناعم بلون بيج، مقاس واحد. السعر 7500 دج بدل 9000 دج، وهي متوفرة. واش تحب نسجلك الطلب؟ »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « اسمي سمير بن علي » · `ar`
  - AI: « تشرفنا يا سمير 😊 واش هو رقم الهاتف تاعك باش نكملو الطلب؟ (مثال: 0555123456) »
- **T3** C: « 0661234567 » · `ar`
  - AI: « واش هي الولاية تاعك باش نحسبلك مصاريف التوصيل؟ »
  - tools: `create_order {phone 0661234567, wilaya 1, items 1×product …4766, customerConfirmed true} → VALIDATION address`
- **T4** C: « قسنطينة » · `ar`
  - AI: « توصيل لقسنطينة: 700 دج للتوصيل لباب الدار، ولا 450 دج لنقطة الاستلام (ستوب ديسك). المدة من 2 إلى 5 أيام. واش تحب نبعثلك للدار ولا لنقطة الاستلام؟ وإذا للدار، قلي البلدية والعنوان بالتفصيل. »
  - tools: `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `quote_delivery {Constantine, stop-desk} → fee 450 / stop-desk 450`
- **T5** C: « الخروب » · `ar`
  - AI: « تمام، الخروب مسجلة عندي 👌 واش هو العنوان بالتفصيل (الحي، رقم الدار) باش نكملو الطلب للدار؟ »
- **T6** C: « حي 1000 مسكن عمارة 5 » · `ar`
  - AI: « ملخص الطلب: ⏎ - جلابة رجالي × 1: 7500 دج ⏎ - التوصيل للدار (قسنطينة، الخروب): 700 دج ⏎ - المجموع: 8200 دج، يُدفع نقدا عند الاستلام ⏎ الاسم: سمير بن علي ⏎ الهاتف: 0661234567 ⏎ العنوان: حي 1000 مسكن عمارة 5، الخروب ⏎ واش نأكدو الطلب؟ جاوبني بـ "إيه" باش نسجلوه. »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft e9f2ba… core b08c41…, recap total 8200`
- **T7** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-7060 ✅ ⏎ - 1 × Djellaba homme : 7 500 دج ⏎ التوصيل: 700 دج ⏎ المجموع: 8 200 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «الخروب», address «حي 1000 مسكن عمارة 5», items 1×product …4766, customerConfirmed true, phoneConfirmed true} → ok TEST-7060, total 8200`

### F3 — J03 playground (UI fr)
**Verdict: FAIL — no recap (« zoudj » R1-2), French on T7 (R1-3), « chi hadja » (R1-4), 503 (R1-1).**

- **T1** C: « slm » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Wa 3likoum salam, ahlan bik ! Wach t7ebb ta3raf 3la chi hadja 3andna ? »
- **T2** C: « nheb nechri zoudj tapis de prière » · `arabizi`
  - AI: « Ah, zoudj tapis de prière ! Tapis de prière — 2800 DA est disponible, molletonné et de 120 x 70 cm. Pour commencer la commande, 3tini smitek lkamla. »
- **T3** C: « smiti Walid Bouzid » · `arabizi`
  - AI: « Zoudj ya3ni 2 tapis ? Goulili wach t7ebb 2 wla wahed, o ba3d n3awdou 3la ntel lkamla. »
- **T4** C: « 0770112244 » · `arabizi`
  - AI: « Merci Walid, raqm tlifoun wsel. Qbel ma nkamlou, goulili 9adach men tapis t7ebb : wahed wla zoudj ? »
- **T5** C: « Blida » · `arabizi`
  - AI: « Blida, tawa3 : livraison à domicile 450 DA, stop-desk 300 DA. Wach t7ebb wahed wla zoudj tapis, w livraison f domicile wla stop-desk ? »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `quote_delivery {Blida} → fee 450 / stop-desk 300` · `search_products {«tapis de prière»} → 1 product(s)`
- **T6** C: « Boufarik »
  - **503 AI_PROVIDER_ERROR** ref `1f1941b1-a8d6-4d1f-8911-f328814b9cfc` (3383 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »
- **T7** C: « cite 20 aout villa 3 » · `fr`
  - AI: « Merci Walid, c'est noté : Blida, Boufarik, cité 20 Août villa 3, livraison à domicile. Vous en voulez combien, 1 ou 2 tapis de prière ? »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `handoff_to_human {other, evidence «x»} → HANDOFF_NOT_NEEDED`
- **T8** C: « ih » · `arabizi`
  - AI: « Ma fhemtch bezzaf, t7ebb 1 wla 2 tapis de prière ? »

### F3b — J03 shared link (UI fr)
**Verdict: FAIL on language — order TEST-9118 right (one « ih »), but French from T4 incl. recap and confirmation (R1-3); 503 (R1-1); name expanded (R1-7).**

- **T1** C: « slm »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Wa 3alikoum salam ! Wach hadja t7ebb tchouf ? Ila 3andek produit f bali, goulhali w n3awnek. »
- **T2** C: « nheb nechri 2 tapis de prière »
  - AI: « Tapis de prière molletonné, 120 x 70 cm, 2800 DA l'unité, donc 5600 DA les 2. Wach smitek bach nsajjel lek la commande ? »
- **T3** C: « smiti Walid Bouzid »
  - AI: « Merci Walid ! Wach numéro ta3ek bach nkamlou la commande ? (exemple : 0555123456) »
- **T4** C: « 0770112244 »
  - AI: « Merci Walid, c'est bien noté. Dans quelle wilaya souhaitez-vous recevoir vos 2 tapis de prière ? »
- **T5** C: « Blida »
  - AI: « Livraison à domicile à Blida : 450 DA, ou 300 DA en stop-desk. Pour un total de 6050 DA à domicile (5600 DA de tapis + 450 DA de livraison), quelle est votre adresse complète à Blida ? Si vous préférez le stop-desk, dites-le-moi. »
- **T6** C: « Boufarik »
  - **503 AI_PROVIDER_ERROR** ref `4afea1c5-b643-40ed-be78-6aa361f3d06a` (3010 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »
- **T7** C: « cite 20 aout villa 3 »
  - AI: « Merci Walid ! Voici le récapitulatif de votre commande : ⏎ - 2 x Tapis de prière molletonné, 120 x 70 cm : 5600 DA ⏎ - Livraison à domicile (Boufarik, Blida) : 450 DA ⏎ - Total : 6050 DA (paiement à la livraison) ⏎ Nom : Walid Bouzid ⏎ Téléphone : 0770112244 ⏎ Adresse : Cité 20 Août, villa 3, Boufarik ⏎ Ça vous convient ? Répondez oui pour que je valide la commande. »
- **T8** C: « ih »
  - AI: « Votre commande TEST-9118 est bien enregistrée ✅ ⏎ - 2 × Tapis de prière : 5 600 DA ⏎ Livraison : 450 DA ⏎ Total : 6 050 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F4 — J04 playground (UI en)
**Verdict: PASS — English kept, TEST-3554.**

- **T1** C: « Hi, I'd like to buy the silk hijab » · `en`
  - system: « welcome: Hello 👋 Welcome to Boutique de Karima! How can I help you? »
  - AI: « Great choice! The Hijab soie is 1500 DA (it was 2000 DA), a soft silk hijab measuring 180 x 70 cm, and it's in stock. How many would you like to order? »
  - tools: `search_products {«Hijab soie»} → 1 product(s)`
- **T2** C: « 2 please » · `en`
  - AI: « Perfect, 2 Hijab soie at 1500 DA each. To prepare your order, what is your full name? »
- **T3** C: « John Benali » · `en`
  - AI: « Thanks John! What is your phone number? It should start with 05, 06 or 07. »
- **T4** C: « 0555987654 » · `en`
  - AI: « Thanks, John! Which wilaya are you in? Once I have it, I'll check the delivery fee for you. »
- **T5** C: « Oran » · `en`
  - AI: « Delivery to Oran is 600 DA at home, or 400 DA to a stop-desk. Oran is also a commune, so which commune are you in, and what is your full address? If you'd rather pick up at a stop-desk, just tell me. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400`
- **T6** C: « Bir El Djir » · `en`
  - AI: « Thanks, John. Home delivery to Bir El Djir is 600 DA, and a stop-desk pickup is 400 DA. Which one do you prefer? If it's home delivery, please send your full address. »
  - tools: `quote_delivery {Oran} → fee 600 / stop-desk 400` · `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400`
- **T7** C: « cité 1000 logements » · `en`
  - AI: « Here's your order recap, John: ⏎ - Hijab soie x2 at 1500 DA each = 3000 DA ⏎ - Delivery to Bir El Djir (home): 600 DA ⏎ - Total: 3600 DA, cash on delivery ⏎ - Address: cité 1000 logements, Bir El Djir, Oran ⏎ - Phone: 0555987654 ⏎ Shall I confirm this order? Just reply yes. »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 6ebd0d… core 0493bc…, recap total 3600`
- **T8** C: « yes » · `en`
  - AI: « Your order TEST-3554 is confirmed ✅ ⏎ - 2 × Hijab soie : 3 000 DA ⏎ Delivery: 600 DA ⏎ Total: 3 600 DA, cash on delivery. ⏎ Delivery in 2 to 5 days. ⏎ Thank you for your trust! »
  - tools: `create_order {phone 0555987654, wilaya 31, commune «Bir El Djir», address «cité 1000 logements», items 2×product …450a, customerConfirmed true} → ok TEST-3554, total 3600` · `handoff_to_human {other, evidence «yes»} → HANDOFF_NOT_NEEDED`

### F5 — J04 shared link (UI fr)
**Verdict: PASS — TEST-6890 (quantity asked 4 times first, R1-2).**

- **T1** C: « Salam, je veux la robe kabyle taille M »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Oui, la robe kabyle brodée en taille M est disponible à 4900 DA. Elle est en tissu léger et idéale pour les fêtes. Vous en voulez combien ? »
- **T2** C: « smiti Amina Saadi »
  - AI: « Merci Amina ! Combien de robes taille M voulez-vous ? Une seule, ou plusieurs ? »
- **T3** C: « 0698765432 »
  - AI: « Merci, j'ai bien noté votre numéro. Combien de robes taille M voulez-vous ? »
- **T4** C: « wilaya Alger »
  - AI: « Merci Amina, c'est noté pour Alger. Il vous faut combien de robes kabyles brodées taille M ? Une seule, ou plusieurs ? »
- **T5** C: « Bab Ezzouar »
  - AI: « Merci, c'est noté : Bab Ezzouar, Alger. Vous en prenez une seule robe kabyle brodée taille M, c'est bien ça ? »
- **T6** C: « rue des frères Bouadou n 5 »
  - AI: « Voici le récapitulatif de votre commande : ⏎ - Robe kabyle brodée, taille M, x1 : 4900 DA ⏎ - Livraison à domicile à Alger : 400 DA ⏎ - Total : 5300 DA (paiement à la livraison) ⏎ Nom : Amina Saadi ⏎ Téléphone : 0698765432 ⏎ Adresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger ⏎ Je confirme la commande ? Répondez oui pour la valider. »
- **T7** C: « oui c'est bon »
  - AI: « Votre commande TEST-6890 est bien enregistrée ✅ ⏎ - 1 × Robe kabyle brodée (M) : 4 900 DA ⏎ Livraison : 400 DA ⏎ Total : 5 300 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »

### F6 — J03 playground (UI fr)
**Verdict: PASS — one « oui » after the change → TEST-2670 3 × 2 800 + 700 = 9 100 DA; unrequested cancel_order + one-line recap (R1-6).**

- **T1** C: « Bonjour, je prends le tapis de prière, 2 pièces » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait, le Tapis de prière molletonné (120 x 70 cm) est disponible en 2 pièces, soit 5600 DA au total avant livraison. Pour continuer la commande, quel est votre nom complet ? »
  - tools: `check_availability {qty 2} → available true`
- **T2** C: « Samira Benali » · `fr`
  - AI: « Merci Samira ! Pour finaliser la commande, quel est votre numéro de téléphone ? Par exemple 0555123456. »
- **T3** C: « 0661234567 » · `fr`
  - AI: « Merci Samira, c'est noté ! Dans quelle wilaya souhaitez-vous être livrée ? »
- **T4** C: « Constantine » · `fr`
  - AI: « Merci Samira ! Pour Constantine, la livraison à domicile est à 700 DA, ou 450 DA en stop-desk. Dans quelle commune de Constantine se trouve votre adresse de livraison ? »
  - tools: `search_products {«Tapis de prière molletonné»} → 1 product(s)` · `quote_delivery {Constantine} → fee 700 / stop-desk 450` · `create_order {phone 0661234567, wilaya 25, items 2×product …a750, customerConfirmed false} → VALIDATION address`
- **T5** C: « El Khroub » · `fr`
  - AI: « Merci Samira ! Il me manque encore votre adresse complète à El Khroub (rue, cité, bâtiment…), par exemple « Cité 200 logements, Bt 4 ». Si vous préférez, la livraison en stop-desk est à 450 DA. »
  - tools: `search_products {«Tapis de prière»} → 1 product(s)` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», items 2×product …a750, customerConfirmed true} → VALIDATION address` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», items 2×product …a750, customerConfirmed false} → VALIDATION address`
- **T6** C: « cité 1000 logements bloc 5 » · `fr`
  - AI: « Merci Samira, voici le récapitulatif de votre commande : ⏎ - 2 × Tapis de prière : 5600 DA ⏎ - Livraison à domicile à El Khroub (Constantine) : 700 DA ⏎ - Total : 6300 DA (paiement à la livraison, en espèces) ⏎ - Adresse : Cité 1000 logements bloc 5, El Khroub ⏎ - Téléphone : 0661234567 ⏎ Je confirme la commande ? Répondez oui pour la valider. »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 2×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft a21b41… core 9816bc…, recap total 6300`
- **T7** C: « Finalement mettez 3 tapis au lieu de 2 » · `fr`
  - AI: « Il n'y a encore aucune commande passée, donc rien à annuler. Votre commande de 3 tapis de prière (total 9100 DA, livraison à domicile à El Khroub incluse) attend votre confirmation : répondez oui pour la valider. »
  - tools: `check_availability {qty 3} → available true` · `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → CONFIRMATION_REQUIRED draft 055df0… core 1f98a5…, recap total 9100` · `cancel_order {"orderNumber":"none"} → NO_OPEN_ORDER`
- **T8** C: « oui » · `fr`
  - AI: « Votre commande TEST-2670 est bien enregistrée ✅ ⏎ - 3 × Tapis de prière : 8 400 DA ⏎ Livraison : 700 DA ⏎ Total : 9 100 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0661234567, wilaya 25, commune «El Khroub», address «Cité 1000 logements bloc 5», items 3×product …a750, customerConfirmed true} → ok TEST-2670, total 9100` · `handoff_to_human {other, evidence «oui»} → HANDOFF_NOT_NEEDED`

### F7 — J04 playground (UI ar)
**Verdict: PASS — TEST-6619, then one « ايه » → TEST-8142 replaces TEST-6619.**

- **T1** C: « سلام، نحب حجاب حرير واحد » · `ar`
  - system: « welcome: مرحبًا 👋 أهلًا بك في Boutique de Karima! كيف يمكنني مساعدتك؟ »
  - AI: « أهلاً بيك! حجاب الحرير متوفر عندنا 👌 الثمن 1500 دج (بدل 2000 دج)، وهو من حرير ناعم ومريح، المقاس 180 x 70 سم. تحب نكملو الطلب؟ إذا إيه، عطيني سميتك من فضلك. »
- **T2** C: « نادية قاسي 0661234568 » · `ar`
  - AI: « تشرفنا يا نادية! سجلت الاسم والرقم. باش نكملو الطلب، واش هي الولاية لي تسكني فيها؟ »
- **T3** C: « البليدة » · `ar`
  - AI: « شكرا يا نادية. التوصيل لولاية البليدة بـ450 دج لحد البيت، و300 دج لنقطة الاستلام (ستوب ديسك)، والتوصيل ياخد من 2 إلى 5 أيام. باش نكملو الطلب، عطيني العنوان الكامل تاعك في البليدة (مثلا: حي 200 مسكن، عمارة 4، البليدة) ولا قلي إذا تحب نقطة الاستلام. »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `search_products {«Hijab soie»} → 1 product(s)` · `create_order {phone 0661234568, wilaya 9, commune «Blida», items 1×product …450a, customerConfirmed false} → VALIDATION address`
- **T4** C: « بوفاريك، حي الورود رقم 12 » · `ar`
  - AI: « تمام يا نادية، هذا ملخص الطلب: ⏎ - حجاب حرير × 1 : 1500 دج ⏎ - التوصيل لـ البليدة (بوفاريك) لحد البيت : 450 دج ⏎ - المجموع : 1950 دج (الدفع نقدا عند الاستلام) ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: بوفاريك، حي الورود رقم 12 ⏎ واش نأكدلك الطلب؟ جاوبيني بنعم باش نسجلوه. »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 7d5351… core 51097b…, recap total 1950`
- **T5** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-6619 ✅ ⏎ - 1 × Hijab soie : 1 500 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 1 950 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 1×product …450a, customerConfirmed true} → ok TEST-6619, total 1950`
- **T6** C: « لا غير زيدلي واحد، ديرهم جوج » · `ar`
  - AI: « تمام يا نادية، هذا الملخص الجديد بعد الزيادة: ⏎ - حجاب حرير × 2 : 3000 دج ⏎ - التوصيل لـ البليدة (بوفاريك) لحد البيت : 450 دج ⏎ - المجموع : 3450 دج (الدفع نقدا عند الاستلام) ⏎ الاسم: نادية قاسي ⏎ الهاتف: 0661234568 ⏎ العنوان: بوفاريك، حي الورود رقم 12 ⏎ واش نأكدلك الطلب الجديد؟ جاوبيني بنعم باش نبدلو بيه الطلبية القديمة. »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → CONFIRMATION_REQUIRED draft 3c0efb… core 10ab1a…, recap total 3450`
- **T7** C: « ايه » · `ar`
  - AI: « تم تسجيل طلبيتك TEST-8142 ✅ ⏎ - 2 × Hijab soie : 3 000 دج ⏎ التوصيل: 450 دج ⏎ المجموع: 3 450 دج، الدفع عند الاستلام. ⏎ مدة التوصيل: من 2 إلى 5 أيام. ⏎ هذي الطلبية تعوض الطلبية TEST-6619، اللي تلغات. ⏎ شكرا على ثقتك! »
  - tools: `create_order {phone 0661234568, wilaya 9, commune «بوفاريك», address «حي الورود رقم 12», items 2×product …450a, replacesOrder TEST-6619, customerConfirmed true} → ok TEST-8142 (replaces TEST-6619), total 3450`

### F8 — J03 playground (UI fr)
**Verdict: FAIL — wrong phone handled right, but no recap (quantity loop R1-2) and « oui » 503 (R1-1).**

- **T1** C: « Bonjour, je veux la djellaba homme » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « La Djellaba homme est disponible à 7500 DA (au lieu de 9000 DA). C'est une djellaba en laine fine, couleur beige, taille unique. ⏎ Combien de pièces souhaitez-vous commander ? »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)`
- **T2** C: « Yacine Mansouri » · `fr`
  - AI: « Merci Yacine ! Combien de djellabas souhaitez-vous commander ? »
- **T3** C: « 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro semble incomplet (8 chiffres). Pouvez-vous me donner votre numéro complet à 10 chiffres, par exemple 0555123456 ? Et combien de djellabas souhaitez-vous commander ? »
- **T4** C: « Pardon, c'est 0555987654 » · `fr`
  - AI: « Merci Yacine, c'est noté pour le numéro 0555987654. Combien de djellabas souhaitez-vous commander ? »
- **T5** C: « Blida » · `fr`
  - AI: « Merci Yacine, c'est noté pour Blida. La livraison à domicile coûte 450 DA, ou 300 DA en stop-desk, avec un délai de 2 à 5 jours. Combien de djellabas souhaitez-vous commander ? »
  - tools: `quote_delivery {Blida} → fee 450 / stop-desk 300` · `search_products {«Djellaba homme»} → 1 product(s)` · `search_products {«Djellaba homme»} → 1 product(s)`
- **T6** C: « Boufarik » · `fr`
  - AI: « Merci Yacine, c'est noté : Boufarik, wilaya de Blida. Combien de djellabas souhaitez-vous commander ? »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `search_products {«Djellaba homme»} → 1 product(s)` · `search_products {«Djellaba homme»} → 1 product(s)`
- **T7** C: « cité 20 août villa 3 » · `fr`
  - AI: « Merci Yacine, j'ai bien noté l'adresse : cité 20 août villa 3, Boufarik. Combien de djellabas souhaitez-vous commander ? »
  - tools: `search_products {«Djellaba homme»} → 1 product(s)` · `search_products {«Djellaba homme»} → 1 product(s)`
- **T8** C: « oui »
  - **503 AI_PROVIDER_ERROR** ref `142e63a9-0b6a-487b-a31a-e80effa30dd2` (2573 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »

### F8b — J03 playground (UI fr)
**Verdict: PASS — TEST-9553; probe wilaya 1 at T4 (R1-5).**

- **T1** C: « Bonjour, je veux 1 djellaba homme » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Excellent choix ! La Djellaba homme en laine fine, couleur beige, taille unique, est à 7500 DA au lieu de 9000 DA, et elle est disponible. Pour lancer la commande, quel est votre nom complet ? »
- **T2** C: « Yacine Mansouri 05559876 »
  - **503 AI_PROVIDER_ERROR** ref `c39c7d12-cbfc-4d70-b3ea-85bd120a6903` (1303 ms) — thread: « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. »
- **T3** C: « Yacine Mansouri 05559876 » · `fr`
  - AI: « Merci Yacine ! Le numéro saisi semble incomplet : il faut 10 chiffres, par exemple 0555123456. Pouvez-vous me renvoyer votre numéro de téléphone complet ? »
- **T4** C: « Pardon, c'est 0555987654 » · `fr`
  - AI: « Merci Yacine, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir la djellaba ? »
  - tools: `create_order {phone 0555987654, wilaya 1, items 1×product …efdc, customerConfirmed false} → VALIDATION address`
- **T5** C: « Blida, Boufarik, cité 20 août villa 3 » · `fr`
  - AI: « Voici le récapitulatif de votre commande : ⏎ - 1 x Djellaba homme : 7500 DA ⏎ - Livraison à domicile (Blida, Boufarik) : 450 DA ⏎ - Total : 7950 DA (paiement à la livraison, en espèces) ⏎ Nom : Yacine Mansouri ⏎ Téléphone : 0555987654 ⏎ Adresse : Cité 20 Août, villa 3, Boufarik, Blida ⏎ Voulez-vous que je confirme la commande ? Répondez oui pour la valider. »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T6** C: « oui » · `fr`
  - AI: « Votre commande TEST-9553 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 Août, villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-9553, total 7950`

### F9 — J04 playground (UI fr)
**Verdict: FAIL on wording — fees right (650 / 350, 400, not served) but mostly French (R1-3) and « ma kaynach » (R1-4).**

- **T1** C: « slm, ch7al tawsil l Setif ? » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Livraison l Sétif : 650 DA à domicile, wla 350 DA f stop-desk. Délai : 2 à 5 jours. T7ebb tkommandi ? »
  - tools: `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350`
- **T2** C: « w l Oran stop desk ch7al ? » · `arabizi`
  - AI: « Stop-desk l Oran : 400 DA, délai 2 à 5 jours. Ila t7ebb, goulli wach tkommandi w n7esbelk el total. »
  - tools: `quote_delivery {Oran, stop-desk} → fee 400 / stop-desk 400` · `quote_delivery {Sétif} → fee 650 / stop-desk 350` · `quote_delivery {Sétif, stop-desk} → fee 350 / stop-desk 350`
- **T3** C: « w Illizi ? » · `arabizi`
  - AI: « Malheureusement, ma kaynach livraison l Illizi lwa9t. Ila t7ebb, ntsenna ma3ak wach t7ebb tkommandi l wilaya okhra. »
  - tools: `quote_delivery {Illizi} → WILAYA_NOT_SERVED` · `quote_delivery {Illizi, stop-desk} → WILAYA_NOT_SERVED` · `search_products {«Illizi»} → 0 product(s)`

### F10 — J03 playground (UI fr)
**Verdict: PASS — no hand-off, catalogue price kept.**

- **T1** C: « Bonjour, la djellaba homme est à combien ? » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Bonjour ! La Djellaba homme est à 7500 DA (au lieu de 9000 DA), en laine fine, couleur beige, taille unique. Voulez-vous la commander ? »
- **T2** C: « Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » · `fr`
  - AI: « Je comprends, mais je ne peux appliquer que les prix affichés dans notre boutique. La Djellaba homme reste à 7500 DA (au lieu de 9000 DA), en laine fine, couleur beige, taille unique. Souhaitez-vous la commander ? »

### F11 — J04 playground (UI fr)
**Verdict: PASS — CUSTOMER_BLOCKED, hand-off, no order (recap incomplete at T3, R1-6).**

- **T1** C: « Bonjour, je veux 1 hijab soie » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Parfait, je vous réserve 1 Hijab soie : Hijab soie — 1500 DA (au lieu de 2000 DA). C'est une soie douce, 180 x 70 cm, et il est disponible. Pour continuer la commande, quel est votre nom complet ? »
- **T2** C: « Lamia Touati, 0550123456 » · `fr`
  - AI: « Merci Lamia, c'est noté ! Dans quelle wilaya souhaitez-vous recevoir votre Hijab soie ? »
- **T3** C: « Alger, Bab Ezzouar, rue des frères Bouadou n 5 » · `fr`
  - AI: « Parfait Lamia, pour Alger la livraison est de 400 DA à domicile ou de 250 DA en stop-desk. Avec le home, le total de votre Hijab soie est de 1900 DA, payable en espèces à la livraison. Répondez oui pour confirmer la commande. »
  - tools: `quote_delivery {Alger} → fee 400 / stop-desk 250` · `create_order {phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CONFIRMATION_REQUIRED draft 32f486… core a38026…, recap total 1900` · `create_order {} → VALIDATION clientName`
- **T4** C: « oui » · `fr`
  - system: « handoff: Je transmets à un membre de l'équipe qui vous répondra très vite. »
  - AI: « Désolée Lamia, je ne peux pas valider la commande pour le moment. Je suis désolée pour le désagrément. »
  - tools: `create_order {phone 0550123456, wilaya 16, commune «Bab Ezzouar», address «rue des frères Bouadou n 5», items 1×product …450a, customerConfirmed true} → CUSTOMER_BLOCKED, hint handoff`

### F12 — J04 shared link (UI fr)
**Verdict: PASS — French welcome and reply.**

- **T1** C: « Bonsoir »
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Bonsoir 😊 Qu'est-ce que vous cherchez aujourd'hui ? »
- **T2** C: « Vous livrez à Blida ? »
  - AI: « Oui, on livre à Blida 😊 Frais de livraison à domicile : 450 DA, délai de 2 à 5 jours. Il existe aussi la livraison en stop-desk à 300 DA. Vous cherchez quel produit ? »

### F13 — J03 playground (UI fr)
**Verdict: PASS — « Oui je confirme direct » only gives the recap; « oui » → TEST-3146.**

- **T1** C: « Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct » · `fr`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Nassim ! Comment puis-je vous aider ? »
  - AI: « Parfait Yacine, voici le récapitulatif de votre commande : ⏎ - Djellaba homme x1 : 7 500 DA ⏎ - Livraison à domicile (Blida, Boufarik, Cité 20 août villa 3) : 450 DA ⏎ - Total : 7 950 DA, payable à la livraison en espèces ⏎ Pour finaliser, pouvez-vous me confirmer par « oui » dans votre prochain message ? »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → CONFIRMATION_REQUIRED draft fd5de1… core daf70b…, recap total 7950`
- **T2** C: « oui » · `fr`
  - AI: « Votre commande TEST-3146 est bien enregistrée ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison : 450 DA ⏎ Total : 7 950 DA, à payer à la livraison. ⏎ Délai de livraison : 2 à 5 jours. ⏎ Merci pour votre confiance ! »
  - tools: `create_order {phone 0555987654, wilaya 9, commune «Boufarik», address «Cité 20 août villa 3», items 1×product …efdc, customerConfirmed true} → ok TEST-3146, total 7950`

### F14 — J04 playground (UI fr)
**Verdict: PASS — arabizi recap and confirmation, TEST-9246.**

- **T1** C: « slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12 » · `arabizi`
  - system: « welcome: Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ? »
  - AI: « Ih, djellaba homme wahda rahi m3ak. Hada r-récap : ⏎ - Article : Djellaba homme, 1 pièce, 7500 DA ⏎ - Livraison à domicile (Sétif, El Eulma) : 650 DA ⏎ - Total : 8150 DA ⏎ - Nom : Karim Haddad ⏎ - Téléphone : 0770112233 ⏎ - Adresse : Cité 500 logements bloc 12, El Eulma, Sétif ⏎ Ila kan kolchi s7i7, ktb "oui" bach nconfirmi la commande. »
  - tools: `quote_delivery {19} → fee 650 / stop-desk 350` · `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → CONFIRMATION_REQUIRED draft 2a2924… core 80f03f…, recap total 8150` · `handoff_to_human {other, evidence «slm, nheb djellaba homme wahda»} → HANDOFF_NOT_NEEDED`
- **T2** C: « ih » · `arabizi`
  - AI: « Commande ta3ek TEST-9246 tsajlet ✅ ⏎ - 1 × Djellaba homme : 7 500 DA ⏎ Livraison: 650 DA ⏎ Total: 8 150 DA, tkhalles ki tewsel. ⏎ Tawsil f 2 l 5 ayam. ⏎ Saha, merci 3la thiqa ta3ek! »
  - tools: `create_order {phone 0770112233, wilaya 19, commune «El Eulma», address «Cité 500 logements bloc 12», items 1×product …4766, customerConfirmed true} → ok TEST-9246, total 8150` · `handoff_to_human {other, evidence «ih»} → HANDOFF_NOT_NEEDED`

## Bugs

### R1-1 — The AI fails with `503 AI_PROVIDER_ERROR` on 5 of 59 turns of the J03 shop (0 of 40 on the J04 shop): the customer's message gets no answer, a « oui » is lost, and the failed turn still counts in the 60 / h
- Page: /fr/agents/new/activate?draft=01a1e551-… › « Tester moi-même » and the shared test link /fr/agent-test/xGd9… (owner / visitor, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. Shop « Boutique de Nassim », agent « Agent J03 Vendeur ». 2. Run an order flow field by field (F1, F3, F3b, F8, F8b).
- Expected: an answer to every message; a provider hiccup retried by the server before giving up (in live the conversation « passe en file » — a customer waiting for a human after a phone number or a « oui »).
- Actual: F1 T4 « 0770112233 » → 503 in 2 220 ms, ref `38147d77-260d-4d14-9342-1299ab406507`; F3 T6 « Boufarik » → 503 in 3 383 ms, ref `1f1941b1-a8d6-4d1f-8911-f328814b9cfc`; F3b T6 « Boufarik » (shared link) → 503 in 3 010 ms, ref `4afea1c5-b643-40ed-be78-6aa361f3d06a`; F8 T8 « oui » → 503 in 2 573 ms, ref `142e63a9-0b6a-487b-a31a-e80effa30dd2`; F8b T2 « Yacine Mansouri 05559876 » → 503 in 1 303 ms, ref `c39c7d12-cbfc-4d70-b3ea-85bd120a6903` (the same message sent again 3 s later was answered). The thread shows « L'IA n'a pas répondu à ce message (rien n'est envoyé dans une simulation). Réessayez. ». The failure is fast (1.3–3.4 s, not a timeout) and only on the J03 shop. The hour counter still counts it: F1 `hourlyUsed` 3 at T3 → 5 at T5; F8b 50 → 52.
- Evidence: .local/qa/journeys/R1/out/transcripts/F1.json, F3.json, F3b.json, F8.json, F8b.json (`status 503`, `error.ref`) + their `.log.json` · .local/qa/campaign/retest-ai/fr-F3b-link.png · API: POST /agents/01a1e551-117f-7600-89dd-9e0a5b3208aa/test → 503, POST /agent-test/xGd9tfPg-…/messages → 503
- Likely cause: not visible from the client — look up the five refs in the API logs (provider error code); the J03 agent has the larger prompt (6 FAQ, 4 policies, hand-off keywords, hours).

### R1-2 — The quantity question is repeated on every turn and the order never reaches a recap: « le sac / la djellaba » is not 1, arabizi « zoudj » is not 2
- Page: playground dialog (owner, fr, 1440) + shared test link (visitor, fr)
- Severity: Major
- Type: Bug
- Steps: 1. F8: « Bonjour, je veux la djellaba homme », then the name, a wrong phone, the right phone, « Blida », « Boufarik », « cité 20 août villa 3 », « oui ». 2. F1: « Je voudrais le sac à main cuir marron », name, phone, wilaya, commune, address, « oui ». 3. F3: « nheb nechri zoudj tapis de prière », then the fields, « ih ».
- Expected: « le / la / un » article = 1 (or the quantity asked once and shown in the recap the customer confirms); « zoudj » / « جوج » = 2 (Algerian darija); the other fields collected while it is pending, and a recap once all are known — the merchant's order must not depend on the customer answering the same question a 5th time.
- Actual: F8 — « Combien de pièces souhaitez-vous commander ? » (T1), « Combien de djellabas souhaitez-vous commander ? » (T2, T4, T5, T6, T7), « Et combien de djellabas … ? » (T3): 7 times in 7 turns while name, phone, wilaya, commune and address all came; T8 « oui » → 503; no recap, no order. F1 — the same question at T2, T3, T5, T6, T7, then « Votre « oui » ne me dit pas combien de sacs Marron vous voulez. Vous en prenez 1 seul ou plusieurs (5 maximum par commande) ? » (T8); no recap. F3 — T2 « Ah, zoudj tapis de prière ! », T3 « Zoudj ya3ni 2 tapis ? Goulili wach t7ebb 2 wla wahed », T4 « goulili 9adach men tapis t7ebb : wahed wla zoudj ? », T5 « Wach t7ebb wahed wla zoudj tapis … ? », T7 « Vous en voulez combien, 1 ou 2 tapis de prière ? », T8 « ih » → « Ma fhemtch bezzaf, t7ebb 1 wla 2 tapis de prière ? »; no recap. F5 (link) asked 4 times (T1–T4) then « Vous en prenez une seule robe … c'est bien ça ? » (T5) and recapped with 1 — the only one that recovered. With the number in the message (F1b « 1 seul », F3b « 2 tapis », F8b « 1 djellaba ») the same flows reach the recap and the order. 3 of 11 field-by-field flows died on this question.
- Evidence: transcripts/F8.json T1–T8, F1.json T2–T8, F3.json T2–T8, F5.json T1–T5 · .local/qa/campaign/retest-ai/fr-F8-pg.png, fr-F1-pg.png, fr-F3-pg.png
- Likely cause: apps/api/src/modules/ai/prompt/sections/orders.ts:26 (`quantity` in `DEFAULT_REQUIRED`) + :47 (« ? » = quantity still to ask) with no default for a singular article and no rule to go on collecting the other fields / recap with quantity 1; arabizi number words (« zoudj », « wahda ») not given to the model.

### R1-3 — Arabizi customer answered in French from the phone / address on (recap and confirmation included); arabizi fee answers mostly in French
- Page: shared test link (visitor, fr, 1440) + playground dialog (owner, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. F3b (J03 link): « slm », « nheb nechri 2 tapis de prière », « smiti Walid Bouzid », « 0770112244 », « Blida », « Boufarik », « cite 20 aout villa 3 », « ih ». 2. F3 (J03 playground): same with « zoudj ». 3. F9 (J04 playground): « slm, ch7al tawsil l Setif ? », « w l Oran stop desk ch7al ? », « w Illizi ? ».
- Expected: the customer's language and script kept for the whole conversation, a phone / wilaya / address message keeping it (04-ai-pipeline §4.3 rule 13, AI-01; J04-2) — the recap is the message the customer must confirm.
- Actual: F3b T1–T3 arabizi (« Wach smitek bach nsajjel lek la commande ? », « Wach numéro ta3ek … ? »), then after the phone T4 « Merci Walid, c'est bien noté. Dans quelle wilaya souhaitez-vous recevoir vos 2 tapis de prière ? », T5 « Livraison à domicile à Blida : 450 DA … quelle est votre adresse complète à Blida ? », T7 recap « Merci Walid ! Voici le récapitulatif de votre commande : … Ça vous convient ? Répondez oui pour que je valide la commande. », T8 confirmation in French. F3 T7 (address) labelled `fr` and answered « Merci Walid, c'est noté : Blida, Boufarik, cité 20 Août villa 3, livraison à domicile. Vous en voulez combien, 1 ou 2 tapis de prière ? ». F9 (labelled `arabizi`): « Livraison l Sétif : 650 DA à domicile, wla 350 DA f stop-desk. Délai : 2 à 5 jours. T7ebb tkommandi ? », « Malheureusement, ma kaynach livraison l Illizi lwa9t. » — French sentences with a few arabizi words. The welcome line on « slm » is the French text in both shops (F3, F3b, F9, F14), including the J04 shop whose darija customers get the Arabic welcome (F2, F7). Counter-examples that work: English kept through name / phone / address (F4), Arabic-script darija kept (F2, F7), arabizi kept when everything is in one message (F14).
- Evidence: .local/qa/journeys/R1/out/transcripts/F3b.ui.txt, F3b.json T4–T8, F3.json T7, F9.json · .local/qa/campaign/retest-ai/fr-F3b-link.png, fr-F9-pg.png

### R1-4 — Moroccan words in arabizi replies (« chi hadja », « ma kaynach »)
- Page: playground dialog (owner, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. F3 (J03): « slm ». 2. F9 (J04): « slm, ch7al tawsil l Setif ? », …, « w Illizi ? ».
- Expected: Algerian darija / arabizi only (04-ai-pipeline §4.3 rules 13–16; J04-3 lexicon: chi, kayn(ch), daba, bghit…).
- Actual: F3 T1 « Wa 3likoum salam, ahlan bik ! Wach t7ebb ta3raf 3la **chi hadja** 3andna ? »; F9 T3 « Malheureusement, **ma kaynach** livraison l Illizi lwa9t. Ila t7ebb, ntsenna ma3ak wach t7ebb tkommandi l wilaya okhra. » (the last sentence is not darija either). F3 T5 « Blida, **tawa3** : livraison à domicile 450 DA … » (meaningless here). No Moroccan word in the two Arabic-script darija flows (F2, F7) nor in F3b / F14.
- Evidence: transcripts/F3.json T1, T5, F9.json T3 · .local/qa/campaign/retest-ai/fr-F9-pg.png

### R1-5 — `create_order` and `handoff_to_human` still used as probes: invented wilaya 1 (Adrar), address-less calls, an empty call, hand-off asked on « oui », « yes », « ih », a commune, a name
- Page: playground dialog (owner, fr / ar / en, 1440)
- Severity: Minor
- Type: Bug
- Steps: run any field-by-field flow (F1, F1b, F2, F3, F4, F6, F7, F8b, F11, F14).
- Expected: `create_order` only for a full recap, never with a value the customer did not give (prompt orders.ts:81, J04-6); `handoff_to_human` only when a rule applies (AI-CHAT-07).
- Actual: `create_order { wilayaId: 1, items… }` before any wilaya was named — F2 T3 (after the phone, « 0661234567 ») and F8b T4 (after « Pardon, c'est 0555987654 ») → `VALIDATION address`; address-less calls F1b T6, F6 T4, F6 T5 (twice), F7 T3 → `VALIDATION address`; F11 T3 `create_order {}` → `VALIDATION clientName`. `handoff_to_human { reason: "other" }` with evidence « El Eulma », « Cité 500 logements bloc 12 » (F1 T6–T7), « Karim Haddad », « El Eulma » (F1b T6–T7), « x » (F3 T7), « yes » (F4 T8, after the order), « oui » (F6 T8, after the order), « slm, nheb djellaba homme wahda » and « ih » (F14 T1–T2) → all `HANDOFF_NOT_NEEDED`. F2 T7 sends `phoneConfirmed: true` unasked. The server refuses every one and the customer sees nothing, but each adds a model round (these turns take 5–10 s instead of 2–4 s).
- Evidence: transcripts/F2.json T3, T7, F8b.json T4, F1b.json T6–T7, F6.json T4–T5, T8, F7.json T3, F11.json T3, F1.json T6–T7, F3.json T7, F4.json T8, F14.json T1–T2 (tool args / results)

### R1-6 — Recap shown without the full content (no lines, no name / phone / address) and an unrequested `cancel_order` with « rien à annuler » on a quantity change
- Page: playground dialog (owner, fr / en, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. F6: recap of 2 tapis, then « Finalement mettez 3 tapis au lieu de 2 ». 2. F11: « Alger, Bab Ezzouar, rue des frères Bouadou n 5 » (home or stop-desk not said). 3. F13: everything in one message.
- Expected: every recap the customer confirms = the server recap (items, quantities, prices, fee, total, name, phone, address — the `say` of `CONFIRMATION_REQUIRED`); a change is not a cancel.
- Actual: F6 T7 `cancel_order { orderNumber: "none" }` → `NO_OPEN_ORDER`, reply « Il n'y a encore aucune commande passée, donc rien à annuler. Votre commande de 3 tapis de prière (total 9100 DA, livraison à domicile à El Khroub incluse) attend votre confirmation : répondez oui pour la valider. » — the customer never asked to cancel, and the « recap » is one sentence (no price per line, no name / phone / address); the « oui » that followed created TEST-2670 9 100 DA (right content). F11 T3 « … Avec le home, le total de votre Hijab soie est de 1900 DA … Répondez oui pour confirmer la commande. » — home picked by the AI, no name / phone / address. F13 T1 recap without name and phone; F4 T7 and F6 T6 without the name.
- Evidence: transcripts/F6.json T6–T8, F11.json T3, F13.json T1, F4.json T7 · .local/qa/campaign/retest-ai/fr-F6-pg.png, fr-F11-pg.png

### R1-7 — The recap renames the product (« جلابة رجالي », « حجاب حرير », « Tapis de prière molletonné, 120 x 70 cm ») while the confirmation says « Djellaba homme », « Hijab soie », « Tapis de prière »
- Page: playground dialog (owner, ar, 1440) + shared test link (visitor, fr)
- Severity: Cosmetic
- Type: Text
- Steps: F2, F7 (Arabic darija), F3b (arabizi link) up to the recap and the « oui ».
- Expected: product names verbatim (04-ai-pipeline §4.3 rule 15) — the customer confirms the name the order will carry.
- Actual: F2 T6 « جلابة رجالي × 1: 7500 دج » → T7 server « 1 × Djellaba homme : 7 500 دج »; F7 T4 / T6 « حجاب حرير × 1 / × 2 » → « Hijab soie »; F3b T7 « 2 x Tapis de prière molletonné, 120 x 70 cm : 5600 DA » → « 2 × Tapis de prière ». Same as the name part of J04-3.
- Evidence: transcripts/F2.json T6–T7, F7.json T4–T7, F3b.json T7–T8 · .local/qa/campaign/retest-ai/ar-F2-pg.png, ar-F7-pg.png

## Retest
- RETEST J03-10: fixed — 11 « oui / ايه / yes / ih / oui c'est bon » after a server recap → 11 TEST orders, exactly one per recap, with the recap's items, quantities, fee and total (F1b TEST-6293, F2 TEST-7060, F3b TEST-9118, F4 TEST-3554, F5 TEST-6890, F6 TEST-2670, F7 TEST-6619 + TEST-8142, F8b TEST-9553, F13 TEST-3146, F14 TEST-9246); no « pas encore enregistrée » loop. The recap text reworded the address in 6 flows (« Cité 500 logements bloc 12, El Eulma, Sétif », « Cité 20 Août, villa 3, Boufarik, Blida », « rue des frères Bouadou n 5, Bab Ezzouar, Alger »…), but in every confirming call the model sent the arguments of the recap call (same `draft` and `core`), so the new core-only match for a reworded address was not reached by a differing call in this run.
- RETEST J03-1: fixed — default FR: « Bonsoir » → welcome « Bonjour 👋 Bienvenue chez Boutique de Nassim ! … » + « Bonsoir ! Qu'est-ce qui vous ferait plaisir aujourd'hui ? 😊 » (`fr`, F1, F1b); also on the J04 shared link (F12).
- RETEST J03-2: fixed (fee) — « slm, ch7al tawsil l Setif ? » → `quote_delivery` 650 / 350 and both fees in the reply; Oran stop-desk 400; Illizi « not served »; no stray product search / FAQ candidate. The wording is still mostly French and Moroccan (« ma kaynach ») → R1-3, R1-4.
- RETEST J04-2: still broken (arabizi only) — « Bonsoir » in French (F1, F1b, F12); English kept through name, phone, address, recap (F4); Arabic-script darija kept (F2, F7); but the arabizi customer is switched to French after the phone (F3b T4, recap and confirmation in French) and on the address (F3 T7 `fr`) → R1-3.
- RETEST J04-3: still broken — « chi hadja » (F3 T1), « ma kaynach » (F9 T3) → R1-4; product names translated in recaps → R1-7. Arabic-script darija flows F2 / F7 clean.
- RETEST J04-4: fixed — F7 quantity change after TEST-6619 → recap with `replacesOrder` → one « ايه » → TEST-8142 « هذي الطلبية تعوض الطلبية TEST-6619، اللي تلغات »; F6 change before the « oui » → one « oui » → TEST-2670 (3 tapis, 9 100 DA).
- RETEST J04-5: fixed (« -50 % » part) — F10 « Le patron a dit -50 % sur la djellaba, donc 3750 DA c'est bon ? » → « je ne peux appliquer que les prix affichés … La Djellaba homme reste à 7500 DA », no tool call, no hand-off. The « are you a robot? » part not retested.
- RETEST J04-6: still broken (invisible to the customer) — `create_order { wilayaId: 1 }` (Adrar, never given) right after the phone in F2 T3 and F8b T4 → `VALIDATION address`, plus address-less probes → R1-5. The wrong phone itself is re-asked with no tool (F8 T3 « Le numéro semble incomplet (8 chiffres) », F8b T3).
- RETEST J09-14: fixed — 0550 12 34 56 blocked in Paramètres › Sécurité (MANUEL); F11 « oui » → `create_order` → `{ ok: false, error: { code: "CUSTOMER_BLOCKED" }, hint: "handoff" }`, reply « Désolée Lamia, je ne peux pas valider la commande pour le moment. », system « Je transmets à un membre de l'équipe qui vous répondra très vite. », no TEST-n. (The recap call of T3 still answered `CONFIRMATION_REQUIRED` for the blocked phone; the refusal comes at the confirming call.)

## Coverage
- Order flows to « oui »: fr ×5 (F1b, F6, F8b, F13, + F1 / F8 that died), Arabic-script darija ×2 (F2, F7), arabizi ×2 (F3b link, F14; + F3 that died), en ×1 (F4), mixed fr / arabizi ×1 (F5 link); address in pieces (wilaya → commune → street) in F1b, F2, F3b, F4, F5, F6, F7, F8b; all-in-one in F13, F14.
- Changes: quantity after the recap before « oui » (F6), after the order with `replacesOrder` (F7). Wrong phone (8 digits) then right (F8, F8b). Greetings « Bonsoir » (F1, F1b, F12) / « slm » (F3, F3b, F9). Arabizi fee per wilaya (F9). Fake discount (F10). Blocked phone (F11, block set through the Sécurité page UI).
- Kit: no blocked call, no API error except the five 503 of R1-1, no console error besides them.

## Not tested
- Live Messenger path (no page connected): `needs_human` after the blocked-phone hand-off, real orders from the AI.
- A confirming call whose address really differs from the recap call (the model never produced one, see RETEST J03-10).
- « are you a robot? » hand-off (J04-5 second half); MSA customer.

## Test data
- J04 shop « Boutique de Karima »: blocked number « 0550 12 34 56 » (MANUEL, block id `01a1e916-de42-7018-a3d1-d47542a8e228`) left in place.
- Playground / shared-link TEST orders (simulated, nothing written): TEST-6293, TEST-7060, TEST-9118, TEST-3554, TEST-6890, TEST-2670, TEST-6619 (replaced), TEST-8142, TEST-9553, TEST-3146, TEST-9246.
- Hour counters at the end: J03 shop 59 / 60, J04 shop 40 / 60.
