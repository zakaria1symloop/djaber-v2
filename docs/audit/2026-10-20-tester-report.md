# Tester report 2026-10-19 / 2026-10-20 — fix tracker

Sources (tester files, merged and de-duplicated): UX-UI test logs of 19/10 (UX-001, UX-002, UX-003, UX-006) and
20/10 (UX-002, UX-003), "Djaber AI test 2", "bugs_and_improvements", module checklist.

Status: `todo` · `done` (commit) · `deferred` (reason).

## Cash register
| # | Issue | Status |
|---|---|---|
| C1 | UX-001 — receipt image uploaded by "Corriger (lié maintenant)" cannot be viewed; the reference's action says "Reçu PDF" and does nothing; not visible in Reports › Caisse | done |
| C2 | Back arrow of a transaction opened from the cash register goes to the list of its type (sales, purchases…) instead of back to the cash register | done |
| C3 | Corrected movements: the time shown in the list does not match the edit time | done |
| C4 | "Ouvrir la référence" unavailable after a movement was corrected | done |

## Reports and exports
| # | Issue | Status |
|---|---|---|
| R1 | UX-006 — download button at the bottom of /reports does nothing | done |
| R2 | CSV / XLSX exports do not download directly: a toast with a "Télécharger" button must be clicked | done |
| R3 | UX-003 — client drawer and Reports › Top clients show orders only, while "DA dépensés" counts orders + sales | done |

## Filters, forms, i18n
| # | Issue | Status |
|---|---|---|
| F1 | UX-002 (19/10) — /en/agents "Origine" filter options have no label in English | done |
| F2 | Date filter inputs reset while typing the year (every date filter) | done |
| F3 | Category image does not show after upload | done |
| F4 | Product CSV import: give a CSV example so the client knows the columns | done |

## Catalog, stock, orders
| # | Issue | Status |
|---|---|---|
| P1 | UX-002 (20/10) — deleting images of an approved product sends it back to moderation and blocks sales | done |
| P2 | Margin in the products table does not change after an expense is added | done |
| P3 | A product gets a stock movement (order) before the order is confirmed by the merchant | done |
| P4 | Product with variants: listed with the base price and stock = sum of variants; the chatbot sells the base product as if it were purchasable | done |
| P5 | UX-003 (20/10) — duplicate suppliers allowed (same phone / email / name); purchase supplier picker shows names only | done |
| P6 | Recommendations: the main action (purchase, change price) marks the recommendation applied and hides it even if the action was not completed | done |
| P7 | Client created by the AI without phone: an order can still be created; "Compléter" opens an empty form instead of the known data | done |

## AI agent / chatbot
| # | Issue | Status |
|---|---|---|
| A1 | Page analysis run more than twice duplicates products | done |
| A2 | Digital services detected as physical products with stock | done |
| A3 | Chatbot sometimes stops answering mid-conversation | done |
| A4 | Customer details lost after the conversation resumes; the bot asks again | done |
| A5 | Owner instructions not followed (e.g. emoji usage) | done |
| A6 | Services presented like products | done |
| A7 | Wilaya and commune with the same name confused; bot asks the commune again | done |
| A8 | Bot can cancel an order already confirmed by the seller | done |
| A9 | Order replacement: bot deletes the order but never creates the replacement | done |

## Delivery
| # | Issue | Status |
|---|---|---|
| D1 | Carrier integration not working (ZR Express) | done — new ZR platform (api.zrexpress.app, API key + tenant id) beside Procolis; to confirm on staging with a real account (05 §2.2b) |

## Workspace
| # | Issue | Status |
|---|---|---|
| W1 | Members: a clear table to choose what each member can see | done |
| W2 | Improvement — search bar at the top of the dashboard | done |
