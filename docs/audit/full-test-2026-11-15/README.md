# Full-site test campaign — live djaber.vercel.app (from 15/11/2026)

Owner request 15/11: verify the whole website, every page, button, text field and state, with Playwright; one report
of all bugs; a loop starts test agents every 5 minutes until the campaign is done. Fixing comes after.

- **Master report:** `docs/audit/2026-11-15-full-test-report.md`, merged from the area files below by the loop.
- **Area files:** `docs/audit/full-test-2026-11-15/areas/<area>.md`, one per agent run. Each agent writes ONLY its own file.
- **Status:** `docs/audit/full-test-2026-11-15/status.json`, `{ <area>: "todo" | "running" | "done" }`, updated by the loop only.
- **Kit:** `tools/qa/pw-kit.mjs` (sign in by role × locale, client-side navigation, console / API-error / text-leak recorder,
  screenshots, safety net). Accounts in `.local/qa/accounts.json` (git-ignored). Screenshots go to `.local/qa/campaign/<area>/`.

## Ground rules (every agent)
1. Live site, test shop « Boutique Test Équipe » only (owner / admin / operator accounts), the super admin for the admin
   area. Never open, change or act on another shop (they belong to the testers).
2. The kit aborts the calls that touch the real world or the shared accounts: courier sends, courier credentials,
   Chargily payments, Meta page connect / reconnect / replies, account and workspace deletion, Google / Sheets OAuth,
   webhook test calls, admin actions on shops, password / e-mail / 2FA / member role changes, stock-mode switch,
   onboarding reopen. A blocked call shows an error in the UI: that is expected — note it as « blocked (safety) », not a bug.
2b. Since 15/11 16:40 the test shop's courier accounts (real ZR Express) are deactivated and « envoi automatique au transporteur » is off. Never re-enable them: confirming an order must not reach a real courier.
3. Test data you create is named `QA <area> <what>` (e.g. « QA orders robe ») so it can be found and cleaned later.
   Invitations only to `*@test.djaber.local`. Webhook URLs only `https://example.invalid/...`.
4. AI playground: at most 15 test messages per run (each one costs AI credits) — except the `ai-chat` area: up to 200.
5. Test like a merchant AND like a tester: every button, menu item, tab, filter, sort, pagination, search, form field
   (empty, too long, wrong format, Arabic text, emoji, negative numbers, decimals, paste), dialogs (open, cancel, ESC,
   submit, server error), leave guard, refresh (F5) keeps filters, back button, empty / loading / error states,
   permissions, fr + ar (RTL) + en, and 390 px wide (phone) on the main screens.
6. Compare with the specs when unsure: `docs/specs/12-screen-states.md`, `03-functional-modules.md`, `04-business-rules.md`,
   `11-error-catalogue.md`. A difference with the spec is a bug (say which spec line).
7. Do not fix code. Do not push, deploy or change the server. Read the code only to explain a bug when it helps.

## Bug format (area file)
```
### <AREA>-<NN> — <one-line title>
- Page: /fr/orders/… (role, locale, viewport)
- Severity: Blocker | Major | Minor | Cosmetic
- Type: Bug | Text | UX | Spec gap | Performance | Security
- Steps: 1. … 2. … 3. …
- Expected: … (spec reference if any)
- Actual: … (exact text / error code / HTTP status from the kit log)
- Evidence: .local/qa/campaign/<area>/<file>.png · API: METHOD /path → status
```
End the area file with « Coverage » (what was tested, what could not be and why) and « Blocked by safety » (list).

## Areas
| id | scope | role(s) |
|---|---|---|
| ai-chat | **talk to the AI agent** through the agent playground (and the scenario runner if present): first set up a QA catalogue in the test shop (8–10 products: with / without variants, one out of stock, one « vendre en rupture », one service, prices with thousands, a promo) + delivery fees + one agent from the wizard (FR, then also test its AR / Darija behaviour). Then hold full conversations, not single questions: greetings, product questions, prices, variants, stock (« combien il en reste »), delivery fee per wilaya / commune / stop-desk, full order flow (name, phone, wilaya, commune, address, recap, confirm), changing quantity / product mid-order, cancel, order tracking, two products at once, wilaya = commune names, wrong phone, Arabic / Darija / arabizi / French / English / mixed, typos, voice-like short messages, insults, off-topic, prompt injection (« ignore tes instructions… »), asking its name, asking for a human, complaint, refund, wholesale price, competitor brand, photo-like description, repeated « allo » / « slm », long silence then « bonjour » again. Record each conversation (customer → AI) in the area file with a verdict per turn (correct / wrong / risky) and every rule broken (04-ai-pipeline §4.3 table, 04 §5, AI-* rows of 03). End with **improvement proposals** ranked by impact. | owner |
| public | public site, login, signup, forgot / reset password, verify e-mail page, public help centre, legal pages, public tracking page, public account-deletion page (form only), language switch, RTL | visitor |
| home | Home (all cards, links, KPI tiles), Queue, Notifications (list, filters, read / unread, preferences link) | owner |
| products | products list (filters, sort, search, bulk, quick edit), product form (create, edit, variants, images, validation, leave guard), duplicate, archive / restore, import (file preview, errors), export, categories, units, services | owner |
| stock | Stock page, inventory sessions, movements, adjustments, suppliers, purchases (create, receive, pay, edit), stock alerts | owner |
| sales-cash | counter sales (new, draft, finish, refund, ticket), cash register (journal, manual rows, closing, export, filters) | owner |
| clients | clients list, client page, tags, notes, block / unblock, report, filters « À relancer », export | owner |
| orders | orders list (filters, export), new order (all fields, wilaya / commune, fees), order page (status changes, payments, edit, address, history, print slip, callbacks), import | owner |
| delivery | Delivery overview / tabs / filters, couriers page (forms only, saves blocked), fee grid (edit, reset, copy) | owner |
| agents | agents list, wizard (all steps), agent page (overview, configuration, versions / diff / restore, insights), playground (≤ 15 messages: prices, stock, order, greeting twice, Arabic, Darija), generate from page (blocked parts noted) | owner |
| channels-inbox | Pages (list, page detail, AI tab, history, analysis), connect explainer (Meta calls blocked), Inbox and conversation screens (empty / existing states) | owner |
| analytics | Analytics tabs and periods, Reports (each report, export), Recommendations | owner |
| settings | Profile, Workspace, Members (invite @test.djaber.local, resend, revoke), Notifications prefs, Quick replies, System messages, Security (sessions; 2FA screens only), Stock mode (dialog only), Credits, Billing (checkout blocked), Integrations (API keys, webhooks to example.invalid, Sheets connect blocked), Danger zone (dialogs only) | owner |
| roles | the same main screens as admin and as operator: what is hidden / greyed and why, 403 pages, read-only states | admin, operator |
| help | in-app Help hub, articles, contact form, support tickets (create one « QA help ticket », reply, attachment) | owner |
| admin | platform admin, all menu pages (read, filters, sheets, dialogs up to submit); actions on shops are blocked except on « Boutique Test Équipe » | superadmin |
| mobile-a11y | 390 px phone layout of the main screens, RTL layout in Arabic, keyboard only (Tab / Enter / Esc), focus visible, labels of icon buttons | owner |
