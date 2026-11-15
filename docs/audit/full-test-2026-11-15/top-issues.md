## Top issues (read this first)

17 areas tested on the live site 15/11/2026 (Playwright, fr / ar / en, desktop + 390 px, keyboard), ≈ 175 AI turns in 39
conversations. 279 bugs: 1 Blocker · 47 Major · 172 Minor · 59 Cosmetic. Grouped by what to fix first — one fix often
closes several IDs.

| # | Issue | IDs | Why it matters |
|---|---|---|---|
| 1 | **The AI places orders without the customer's « oui »** — it retries `create_order` with `customerConfirmed:true` in the same turn after the server asked for confirmation, and probes with invented data (« Client », 0555000000) | AI-CHAT-01, AI-CHAT-03 | Real orders the customer never confirmed; « faux numéro » re-check skipped |
| 2 | **Every number field drops the decimal separator and the minus sign** (one shared input): « 2500,00 » → 250 000 DA, « 1.5 » → 15, « -100 » → +100; purchase quantity re-fills « 1 » when erased (« 5 » → 15) | ORDERS-01, PRODUCTS-01, DELIVERY-01, STOCK-01, STOCK-02, SETTINGS (numbers), SALES-CASH (counted cash) | Prices 100× too high quoted by the AI, wrong stock, a −5 DA free-delivery threshold makes delivery free |
| 3 | **Money that doesn't add up** — « Marquer livrée » ignores the deposit; lowering an order total lowers « payé » below a recorded payment; a draft sale validated from its menu collects 0 DA, a draft forgets the partial amount; mixed-payment cancel refunds all as cash | ORDERS-05, ROLES-02, SALES-CASH-01, SALES-CASH-02, SALES-CASH (cancel) | Cash register ≠ money in hand |
| 4 | **The AI contradicts itself** (« commande enregistrée par erreur », « coordonnées inventées ») and can cancel the order it just created — the format retry drops the conversation but keeps the turn's tool calls | AI-CHAT-02, AI-CHAT-05 | Real confirmed orders cancelled, confused customers |
| 5 | **Operator can sell at any price** (unit price editable and accepted) | ROLES-01 | Permission bypass on money |
| 6 | **Confirming an order silently sends it to the courier** (auto-send) while the next step still offers « Envoyer au transporteur »; the test shop had two real ZR Express accounts with auto-send on (deactivated 15/11) | ORDERS-06 | Unwanted real parcels |
| 7 | **Security** — support-ticket attachments readable by anyone with the link (no login, cached 1 year); audit log claims « 2FA ✓ » for every admin action; no CSP / frame protection (clickjacking on login); « Forcer la 2FA » in one click | HELP-05, ADMIN-02, PUBLIC-03, ADMIN-03 | Data exposure, false audit trail |
| 8 | **Public site not ready for review** — canonical / hreflang / og:url / sitemap / robots point to `http://localhost:3010`; every legal page (Privacy, Terms, Cookies, Content rules, Deletion) is one placeholder sentence | PUBLIC-01, PUBLIC-02 | Meta / Google Play review, SEO, shared links |
| 9 | **Wrong figures** — « Traitées par l'IA » / « Autonomie » negative (−166 %); « Paiements » counts cancelled sales (326 522 vs 19 722 DA); revenue differs between reports; a client's order count differs between list and sheet | ANALYTICS-01, ANALYTICS-02, ANALYTICS-03, CLIENTS-01 | Merchant decisions on false numbers |
| 10 | **AI setup & test screens mislead the merchant** — step-5 scenarios show another message than the one sent, the 3 hand-off scenarios can never pass, a chip after the first message sends an empty message; playground card shows base price; platform test presets (« test », « groq », « Retest UX-008 ») offered to every merchant; voice route « OK » while its providers are off | AGENTS-01…04, AGENTS-06, AI-CHAT-06, ADMIN-01 | Merchants lose trust in the AI before going live |

Also important: SETTINGS-01 (saving the profile switches the app to English), SETTINGS-02 (system-message variables in the wrong case reach customers raw), SETTINGS-03 (« Bloquer un numéro » accepts « abc » and doesn't block the real number), MOBILE-A11Y-01 / -02 (phone menu and focus unusable with a keyboard), PRODUCTS-02 / -03 (stock column hidden at 1440 px, grid shows base price), HOME-01 (Queue says « Tout est calme » when it failed to load), HELP-01 / -02 (help search and 8 one-line guides).

### Patterns behind many bugs (fix once)
- **One number input** for money / quantities (item 2) — fix the component, then re-run the 6 areas' number cases.
- **Technical text still reaches screens** in new places (`validation.url`, `COURIER_CREDENTIALS_INVALID`, `malformed_output:no_json`, `pack:pack-500`, « comptage serveur », « Supprimer (soft) », spec notes in dialogs) — extend `no-technical-text.spec.ts` to these sources and re-run `tools/qa/text-leak-crawl.mjs`.
- **Browser Back skips the leave guard** on every form (PRODUCTS-06, SETTINGS).
- **Malformed IDs in URLs show « Requête invalide · Réessayer »** instead of « Introuvable » (PRODUCTS, HELP).
- **Start date after end date is silently dropped** in period filters (SETTINGS, STOCK, SALES-CASH).
- **One-click destructive actions** without confirmation (session sign-out, « Forcer la 2FA », « Résoudre l'insight »).

### AI improvement proposals (from the ai-chat area, ranked by impact)
1. **Make order confirmation a server fact, not a model flag** — split `create_order` into `prepare_order` (validate, price, store a draft, return the recap) and `confirm_order` accepted only after the customer's « oui » on a recap the server sent.
2. **A real stock / price check tool**; forbid `create_order` as a probe.
3. **Fix the format retry** (`ai-run.service.ts`): keep the conversation, never re-offer tools after a tool already ran in the turn.
4. **Server-written order confirmation** (number, items, total, delay, COD) built from the tool result, not the model's text.
5. **Language**: carry the conversation language (playground too) and add a language check to the reply guard (arabizi → arabizi / darija, French → French).
6. **Keep the chosen product in `context.cart`** in the prompt, not only in the history.
7. **Stop « petite correction » self-doubt**: mark earlier AI replies that came from a tool so the model doesn't re-judge them.
8. **Sell-beyond-stock wording** in the catalogue (« orderable, may take longer » instead of « out of stock (orderable) »).
9. **No `handoff_to_human` while an order is being filled** (each refused handoff costs a 5–10 s round).
10. **Photos the AI cannot see / manipulation**: explicit rules for « comme sur la photo » text and « le patron a dit … ».
11. **Playground fidelity**: let it change / cancel its own TEST orders; same rate limits as live; no shared-link loophole (AI-CHAT-10).
12. **Trustworthy step-5 scenarios** (count the handoff message as the reply, show the message actually sent).
13. **Cost / latency**: prompt caching of the static sections (18 255 input tokens for one turn with 10 products; 10–21 s turns with 3 tools).

### Test data left on the live test shop « Boutique Test Équipe » (to clean)
Products / clients / orders / sales / purchases / categories / tags named « QA … » (each area file lists its own), the draft agents « QA ai-chat Agent » and « QA agents Vendeur », 2 test links, fee rows of Sétif / Oran / Illizi, ticket #T-2026-00011 / -00012, promo code QAADMIN-BTE (inactive), 1 Nov cash correction + reversal, account `qa-public-1@test.djaber.local` (+ its workspace). The shop's two ZR Express courier accounts are **deactivated** and auto-send is **off** since 15/11 (safety).
