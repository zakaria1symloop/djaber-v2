# Fix status — full-test 15/11 campaign

Batch 1 (commit 1044e42, 16/11) fixed:
AI-CHAT-01, AI-CHAT-02, AI-CHAT-03, AI-CHAT-04 (playground language), AI-CHAT-06, ORDERS-01, ORDERS-02, ORDERS-03, ORDERS-04,
ORDERS-05, ORDERS-06, PRODUCTS-01, PRODUCTS-02, PRODUCTS-03, DELIVERY-01, DELIVERY-02, STOCK-01, STOCK-02, SETTINGS-01,
SETTINGS-02, SETTINGS-03, SETTINGS-09, SALES-CASH-01, SALES-CASH-02, SALES-CASH-03, SALES-CASH-04, SALES-CASH-05,
SALES-CASH-07, ROLES-01, ROLES-02, HELP-05, ADMIN-01, ADMIN-02, ADMIN-03, PUBLIC-01, PUBLIC-03, ANALYTICS-01, ANALYTICS-02,
ANALYTICS-03, CLIENTS-01, AGENTS-01, AGENTS-02, AGENTS-03, AGENTS-04, ONBOARDING-01, MOBILE-A11Y-02.

Needs owner: PUBLIC-02 (legal texts are CMS content), AGENTS-06 (archive the platform's test presets in Admin › Préréglages).

Batch 2 (16/11, 4 fix agents — per-ID reports kept in `.local/qa/fix/*-report.md`): every other ID of the 18 areas is fixed,
except:
- **Not fixed:** PUBLIC-04 (split of the i18n catalogue per route
  group — needs a visual check of every public page), AGENTS-08 / AI-CHAT-11 partly (see agents-report).
- **Needs owner / live data:** PUBLIC-02 (legal texts), HELP-02 (help guides), PUBLIC-08 (« test » guide and incidents),
  PUBLIC-09 (free plan name « Gratuit » + trialDays), AGENTS-06 (archive the test presets), DELIVERY-09 (cached rates and fake
  parcels of the test shop), MOBILE-A11Y-05 (Figma muted-text variable → #8a8a8a).
- **Decisions to confirm:** ROLES-05 (operators read / export stock movements — spec aligned on the code), ROLES-07 (Admin may buy
  credit packs — spec aligned on the code).
- AI proposals 2–13 implemented except proposal 7 history markers and the two new step-5 scenarios of proposal 12 (schema enum).

18/11 (saved views): **ORDERS-22 fixed** — `GET|POST|PATCH|DELETE /me/saved-views` + `POST /me/saved-views/:id/share`, the
`?view=<id>` expansion of every list of 05 §16, and the « Vues ⌄ » panel (REF « Vues enregistrées ») on orders, products,
clients, delivery, movements, agents, purchases, sales and cash (inbox, channels, notifications: no URL list state yet).
