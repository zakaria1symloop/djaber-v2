# R22b — live check of R22-1 (bare quantity above the agent's maximum)

- Date: 2026-11-18, 19:51–19:56 (Africa/Algiers) · live https://djaber.vercel.app · API at `578a4b3` (confirmed read-only on the VPS: `git log --oneline -1`).
- Shop: J03r « Boutique de Sofiane », Agent J03r Vendeur (max 5 per order, max 50 000 DA), playground (`wizard-test-myself`), `tools/qa/pw-kit.mjs`, one browser, flows one after the other.
- **12 / 16 customer messages sent.** Playground hour counter 47 → 59 / 60.
- Scripts: `.local/qa/journeys/R22b/scripts/` (`conv.mjs` = R22 script, R22b paths, budget 16; `convs.json`). Evidence: `.local/qa/journeys/R22b/out/run1–3.log`, `out/transcripts/*.json|.ui.txt|.log.json`, `out/airun.txt`, `out/toolcalls.txt`, screenshots `.local/qa/campaign/retest-ai-r22b/*.png`.

## Checks

| # | Flow | Customer messages | Result (reply · tools · Server-Timing / page) | Verdict |
|---|---|---|---|---|
| 1 | Q3, arabizi (UI fr) | « slm, ch7al djellaba homme ? » → « nheb 7 » | T1 « Djellaba homme — 7 500 DA (kanet 9 000 DA), f laine fine, couleur beige, taille unique. T7ebb nsajjel lek wahda ? » · 0 tool · ST 4 081 ms / page 5.8 s. **T2 « La commande wa7da ma tfoutch 5 pièces, rani nba3at talab ta3ek l l'équipe ta3 lboutique w rah tjawbek. »** + system hand-off line · status HANDOFF, AiRun `handoff` 161 ms, 0 model call, 0 tool · ST 192 ms / page 7.0 s. No recap, no « nsajjel lek 7 ». | **PASS** |
| 2a | QF, French (UI fr) | « Bonjour, la djellaba homme c'est combien ? » → « je prends 8 » | T1 price 7 500 DA (au lieu de 9 000 DA) · `search_products {query:"Djellaba homme"}` · ST 3 983 ms / page 9.1 s. **T2 « Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre. »** · HANDOFF, AiRun `handoff` 142 ms, 0 tool · ST 192 ms / page 3.6 s. | **PASS** |
| 2b | QA, Arabic script (UI ar) | « السلام، بشحال الجلابة تاع الرجال؟ » → « نحب 6 » | T1 « … Djellaba homme بسعر 7 500 دج (بدل 9 000 دج) … تحب نسجلوها لك؟ » · 0 tool (guard `moroccan_darija` → stripped) · ST 4 772 ms / page 9.9 s. **T2 « الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك. »** · HANDOFF, AiRun `handoff` 45 ms, 0 tool · ST 66 ms / page 1.5 s. | **PASS** |
| 3 | QN, arabizi (UI fr) | « slm, ch7al djellaba homme ? » → « nheb 2 » → « Walid Bouzid 0555123456, Blida, Boufarik, cité 20 août villa 3, l dar » → « oui » | T1 price 7 500 DA · 0 tool · ST 4 847 ms / 6.0 s. T2 « Zwin, 2 djellaba homme ndirhom lek. Wach smitek ? » · `check_availability` (+ stray `noop`) · ST 4 439 ms / 14.0 s — no hand-off. T3 `create_order {qty 2, wilayaId 9, Boufarik, cité 20 août villa 3}` → `CONFIRMATION_REQUIRED` → server recap « 2 × Djellaba homme : 15 000 DA · Tawsil l dar (Boufarik, Blida): 450 DA · Total: 15 450 DA … » · ST 3 020 ms / 6.4 s. T4 « oui » → 0 model call (AiRun 85 ms) · `create_order` ok → **« Commande ta3ek TEST-3700 tsajlet ✅ … Total: 15 450 DA »** · ST 113 ms / 2.5 s. `create_order` ok ×1 in AiToolCall (the T3 call returned `ok:false`), 0 real `Order` row in the workspace (simulated). | **PASS** |
| 4 | QS, French (UI fr) | « Bonjour, je veux les baskets Runner » → « 42 » | T1 « … Le Basket Runner — 12 500 DA … pointures disponibles sont la 40, la 42 et la 43 (la 41 est en rupture …). Quelle pointure vous faut-il ? » · 0 tool · ST 3 535 ms / 3.8 s. **T2 « Parfait, la pointure 42 est disponible. Pour continuer la commande, quel est votre nom ? »** · status OK (no hand-off, no limit sentence), 0 tool · ST 2 238 ms / 2.5 s. 42 read as the size. | **PASS** |

**Result: 5 / 5 checks pass — R22-1 fixed on live** (« nheb 7 », « je prends 8 », « نحب 6 » after the price → server hand-off with the limit sentence in the customer's language, 0 model call; « nheb 2 » sells to one TEST order; a size « 42 » is not a quantity).

## Observations (not part of the checks)
- Page time far above Server-Timing on several turns: Q3 T2 192 ms server / 7.0 s on the page (browser `responseStart` 2 278 ms), QN T2 4 439 ms / 14.0 s (`responseStart` 10 374 ms). The gap is before the response reaches the browser, not in the API turn.
- Guard still active on first turns: QA T1 `moroccan_darija` (stripped, still in `remaining` after the retry), QN T1 `language_switch` + `confirm_without_recap` (stripped); the replies sent were clean.
- Kit: 0 API error, 0 console error; « leaks » only in the merchant inspector's prompt preview (`{product}`, `{name}`, `{price}`, rule names) — same as R22, by design (AGT-07).
