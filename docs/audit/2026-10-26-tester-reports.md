# Tester reports 22/10 – 26/10 — fix tracker

Sources (in `docs/audit/inputs/`): UX-UI test log of 22/10 (`2026-10-22-ux-ui-test-log.md`, prefix **L22**), UX-UI test log of
25/10 (`2026-10-25-ux-ui-test-log.md`, prefix **L25** — its numbers restart at UX-001), tester notes of 25/10
(`2026-10-25-djaber-test.md`, prefix **T25**, numbered in reading order), meeting PV of 26/10 (`2026-10-26-pv-reunion-djaber.md`,
prefix **PV26**) and the developer's own report of 26/10 (prefix **AI**).

Status: `todo` · `done` (commit) · `deferred` (reason).

## AI
| # | Issue | Status |
|---|---|---|
| AI-1 | The AI still stops after one or two answers; « IA indisponible · AI_PROVIDER_ERROR » banner | done (4334b10) |

## Payments, credits, billing
| # | Issue | Status |
|---|---|---|
| L22-UX-029 | « Payer 4 900 DA (CIB / Edahabia) » opens a raw NOT_FOUND page on the live site | done |
| T25-9 | Buying a credit pack gives NOT_FOUND | done |
| T25-10 | Deleting the workspace says an invoice is unpaid when nothing was ever due | done |
| L22-UX-030 | A partly paid invoice looks unpaid in the Invoices list | done |
| L22-UX-018 | A trial is shown « Pro mensuel · 0 DA » and « CYCLE : Mensuel » in the workspace sheet | done |
| L22-UX-019 | Credits can only be added; a mistaken grant cannot be corrected | done |
| L22-UX-021 | Adding credits sends an e-mail but no in-app notification | done |
| L22-UX-020 | Extending a trial does not inform the merchant | done |
| L22-UX-028 | Editing a promo code moves its start date back one day on each save | done |

## Superadmin
| # | Issue | Status |
|---|---|---|
| L22-UX-007 | Overview chart « Inscriptions · activations · churn » has no dates, no scale, no totals; activations stacked on sign-ups | done |
| L22-UX-016 | Workspaces: « Statut » filter and « STATUT » column show different statuses | done |
| L22-UX-017 | Workspaces: the « WILAYA » chip is in capitals | done |
| L22-UX-022 | Impersonation duration below 5 min: only « Vérifiez les champs » | done |
| L22-UX-023 | The impersonation duration setting has no effect (always 30 min) | done |
| L22-UX-024 | Impersonation shows the « READ_ONLY_MEMBER: plan at its member limit » banner | done |
| L22-UX-025 | CMS: « Aperçu (lien signé 24 h) » of an announcement opens a 404 | done |
| L22-UX-026 | CMS: the announcement link accepts any value and a wrong path leads to a 404 | done |
| L22-UX-027 | Spec: the « Site public » announcement channel is missing from 05-data-model | done |

## Moderation and catalogue
| # | Issue | Status |
|---|---|---|
| L25-UX-001 | Adding an image in « Modifier le produit » sends a moderation request before the product is saved | done |
| L25-UX-003 | Editing a variant does not send the product to moderation | done |
| L25-UX-007 | Moderation requests are triggered inconsistently (adding a variant does not) | done |
| L25-UX-006 | The chatbot talks about products / variants pending moderation | done |
| L25-UX-005 | Moderation: the ✕ button behaves like « Ouvrir la revue » | done |
| PV26-P4 | Products with variants: the variant price is shown but the margin uses the base price | done |

## Merchant app
| # | Issue | Status |
|---|---|---|
| T25-1 | Invited as admin of another shop while owning one ⇒ « Cet e-mail est déjà utilisé » | done |
| T25-2 | Quick replies: {boutique} / {total} not replaced; language shown inconsistently, switches to French when an order is confirmed | done |
| T25-3 | System messages: the edited texts are not the ones the bot sends | done |
| T25-4 | Notifications: no low-stock sound; the low-stock e-mail is sent only the first time | done |
| T25-5 | Blocked numbers: meaning of the « sources », remove the useless ones | done |
| T25-6 | Integrations › Google Sheets: « Connecter Google » gives NOT_FOUND | done |
| T25-7 | Integrations › « Documentation API » shows only « openapi.json · Postman collection » | done |
| T25-8 / PV26-F2 | Date filters: the « au » date is cut, a horizontal scroll bar appears | done |
| L25-UX-002 | Help tickets: no attachment on a reply | todo |
| L25-UX-009 | ZR Express: the orders do not appear in ZR Express | done (code; live mode = server .env) |
