# Meeting with the Djaber AI team (PV, 22/10/2026) — action tracker

Source: `docs/audit/inputs/2026-10-22-pv-reunion-djaber.md` (compte rendu de réunion, presentation of the platform).

Status: `todo` · `done` (commit) · `exists` (already in the app — where) · `deferred` (reason).

| # | Action (from the PV) | Status |
|---|---|---|
| PV1 | Keyword filtering of undesirable content (list of keywords) | done |
| PV2 | Product validation step in the admin dashboard before publication | done |
| PV3 | Multi-select of products in the admin to validate / manage several at once | exists (ADM-10 checkboxes + bulk approve / reject / assign) |
| PV4 | List of suspect customers (no finalised / no confirmed order) to call them | done |
| PV5 | Order tracking through the delivery provider's API (read / update statuses) | exists (courier tracking sync cron + « Actualiser le suivi » + webhooks; ZR Express direct API) |
| PV6 | Date and time of creation of each order | done |
| PV7 | Per-product option to accept orders when the stock is zero | done |
