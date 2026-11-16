# End-to-end journey campaign — live djaber.vercel.app (from 16/11/2026)

Owner request 16/11: « cover everything, literally everything » — not screen by screen but whole business journeys, where every
number is checked across all the screens that show it. Runs after the deploy of the 15/11 fixes (batch 1 `1044e42` + batch 2).

- **Report:** `docs/audit/2026-11-16-journeys-report.md` (merged by `tools/qa/merge-report.mjs`-like script from the journey files).
- **Journey files:** `docs/audit/journeys-2026-11-16/journeys/<id>.md`, one per agent run. Each agent writes ONLY its own file.
- **Kit:** `tools/qa/pw-kit.mjs` — same safety net as 15/11 (no courier send, no Chargily payment, no Meta connect / reply, no
  deletion of shared accounts, no admin action on other shops). Own accounts: `open({ account, allow })` (see the kit).
- **Retest of the 294 bugs of 15/11:** every journey also re-checks the bug IDs of its screens (`docs/audit/full-test-2026-11-15/areas/*.md`)
  and writes `RETEST <ID>: fixed | still broken (what) | cannot test (why)`.

## Ground rules (every agent)
1. Live site. Each journey uses its OWN fresh shop: sign up `qa-j<NN>-<role>@test.djaber.local` (owner) through the real sign-up
   page, then invite admin / operator members to `*@test.djaber.local` when the journey needs them (invitation e-mails cannot be
   read: use the accept link only if the API returns it, else note it). Never touch « Boutique Test Équipe » data of other
   agents, never another tester's shop. Accounts + passwords → `.local/qa/journeys/accounts-<id>.json` (git-ignored), never in reports.
2. Safety: everything the 15/11 kit blocks stays blocked. A real courier, payment or Meta call is never made; such a step is
   « blocked (safety) » and the journey continues by the manual path (manual parcel / « Marquer expédiée », cash payment…).
3. AI: real model, up to 120 customer messages per journey that talks to the AI (it costs the owner's AI credits).
4. **Cross-check every figure**: after each money / stock / order step, read the SAME figure on every screen that shows it
   (order page, orders list + KPIs, client card + list, Home KPIs + À traiter, cash journal + day total + closing, Paiements
   report, Ventes par période, Statistiques, product stock + movements, notifications, exports). Any difference = bug, with
   both values and both screens.
5. fr for the main run, then ar (RTL) and en for the key screens of the journey; 390 px for the merchant's daily screens.
6. Bug format = the 15/11 README format, IDs `J<NN>-<n>`. Severity as 15/11. Evidence: screenshot + API call.
7. Do not fix code, do not push, do not deploy.

## Journeys
| id | journey | key checks |
|---|---|---|
| J01 | **New merchant, day 1**: landing → pricing (plan pick) → sign-up → verify-e-mail notice → onboarding all 6 steps (stock mode, first product with photo, preset agent, page connect = blocked → skip, ready) → Home first visit → checklist → plan offer | each step resumes after F5 / sign-out; checklist and Home say the truth; plan intent offered; no test data visible to a new merchant (presets, guides, incidents) |
| J02 | **Catalogue build**: 15 products (simple, variants with own prices, services, sell beyond stock, promo old price, thousands prices, Arabic names), categories, units, import file (good + bad rows), export, duplicate, archive / restore, moderation states | the same price everywhere (table, grid, phone card, product page, AI playground card, AI answer, order form, sale sheet, export); stock = movements; moderation hides from AI |
| J03 | **AI sales agent setup**: wizard all 5 steps, FAQ, limits, recap mode, hand-off rules, 8 step-5 scenarios, playground (prices, stock, variants, delivery fee per wilaya, full order with recap → oui → TEST order, change, cancel), shared test link | scenario labels = messages; results true; playground = live rules (recap required, yes in next message, cancel words) |
| J04 | **Customer → AI → order (fr / darija / arabizi / ar / en)**: 6 full conversations in the playground and shared link: greeting, product questions, stock, fee, fields one by one, recap, « oui », order number; then « c'est quand ? », change quantity (replacesOrder), cancel, wrong phone, invented-data probes, prompt injection, « le patron a dit -50 % », photo text | no order without recap + yes; one order per recap; server confirmation text; language kept; no Moroccan words; no false « correction »; numbers only from tools |
| J05 | **Order lifecycle (manual + from AI)**: create order (all fields, wilaya = commune names, stop-desk), call & confirm (no answer ×3, callback, confirm), edit items / discount / fee (Admin) and as operator (price locked), deposit payment, prepare, manual parcel « Marquer expédiée », deliver with COD remainder, return, cancel, print slip, export, history | cash rows = payments = order « payé / reste » = client totals = Home = reports; history readable; read-only states; auto-send wording |
| J06 | **Counter sales & cash register day**: 10 sales (cash, CCP, mixed, partial with client, draft → validate from menu, price edited, discount %, refund / cancel ≤ 7 d), manual cash rows (in / out), day closing with counted cash, reopen, export, period filters | theoretical cash = Σ cash rows; closing gap right; Paiements report = Statistiques « encaissé » = journal; refunds per method |
| J07 | **Stock & purchases**: suppliers, purchase (create, edit, receive partial / full, pay partial, cancel), adjustments ±, inventory session (count, variance note, validate), alerts, stock mode simple ↔ advanced (own shop) | stock = Σ movements on product page, stock page, movements, alerts, AI stock words; weighted cost; purchase « payé » = cash out rows = reports |
| J08 | **Delivery**: couriers page (forms, saves blocked), fee grid (edit, copy, reset, free threshold), delivery list / tabs / filters, manual parcels, tracking panel, public tracking page | fee shown = order form fee = AI quote = recap; free threshold applied the same way everywhere |
| J09 | **Clients & inbox**: clients from orders / sales / AI, tags, notes, block / unblock (Arabic digits), merge, archive / restore, export, « À relancer »; inbox conversation states, hand-off, resume, quick replies, system messages variables | client counts and totals identical on list / card / menu / dialogs; blocked phone refuses AI order; variables rendered |
| J10 | **Team & roles**: invite admin + operator, each runs a slice of J05 / J06 / J07; 403 pages; what is hidden / greyed and why; billing as admin; settings as each role | permission matrix (02-actors-roles §3) on screen AND API; no money edit without `orders.money` |
| J11 | **Analytics & reports end of day**: after J05–J07 data, every report and tab for today / 7 d / custom range (start > end), exports | every « revenus / encaissé / commandes / IA % » figure equals the source data; no negative %; same figure same label |
| J12 | **Settings, billing, security, help**: profile (language), workspace, notifications prefs, security (sessions, 2FA screens), credits, billing (checkout blocked), integrations (API key, webhook example.invalid), danger zone dialogs, help hub, ticket with attachment (signed link), public pages, legal, SEO tags, headers | no technical text; attachment link expires; frame headers; canonical = real domain |
| J13 | **Platform admin**: as super admin on the journey shops only — shops list / sheet, moderation queue of J02 products, presets, plans, CMS, AI routes, audit log of the journeys' admin actions | audit 2FA truth; route states; actions need reason |
| J14 | **Phone, RTL, keyboard**: J05 + J06 daily screens at 390 px in ar, and keyboard-only (Tab / Enter / Esc, focus visible, drawer) | usable without a mouse; nothing cut / overlapped |

## Output of each journey file
`# Journey J<NN> — <title> — tested <date/time Africa/Algiers>`, then `## Bugs` (format above), `## Figure cross-checks`
(table: figure · screens compared · values · OK/KO), `## Retest of 15/11 bugs` (one line per ID of the journey's screens),
`## Coverage`, `## Blocked by safety`, `## Not tested`, `## Test data` (accounts' e-mails, shops, records — no passwords).
