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
- **Not fixed:** AGENTS-08 / AI-CHAT-11 partly (see agents-report). (PUBLIC-04: fixed 19/11, see below.)
- **Needs owner / live data:** PUBLIC-02 (legal texts), HELP-02 (help guides), PUBLIC-08 (« test » guide and incidents),
  PUBLIC-09 (free plan name « Gratuit » + trialDays), AGENTS-06 (archive the test presets), DELIVERY-09 (cached rates and fake
  parcels of the test shop), MOBILE-A11Y-05 (Figma muted-text variable → #8a8a8a).
- **Decisions to confirm:** ROLES-05 (operators read / export stock movements — spec aligned on the code), ROLES-07 (Admin may buy
  credit packs — spec aligned on the code).
- AI proposals 2–13 implemented except proposal 7 history markers and the two new step-5 scenarios of proposal 12 (schema enum).

18/11 (saved views): **ORDERS-22 fixed** — `GET|POST|PATCH|DELETE /me/saved-views` + `POST /me/saved-views/:id/share`, the
`?view=<id>` expansion of every list of 05 §16, and the « Vues ⌄ » panel (REF « Vues enregistrées ») on orders, products,
clients, delivery, movements, agents, purchases, sales and cash (inbox, channels, notifications: no URL list state yet).

19/11 (PUBLIC-04): **PUBLIC-04 fixed** — the locale layout sends only the public subset of the catalogue (991 of 9 727 keys,
`apps/web/src/i18n/public-keys.json`, generated from the import graph of (public) / (auth) / s / status / meta by
`apps/web/scripts/public-messages.mjs`, run by the web build); (app) / (admin) / (onboarding) / agent-test / dev add the
rest with `FullMessages`; the browser bundles no longer carry the three-language catalogue of the `@djaber/shared` barrel
(empty stand-in, next.config.ts). Local `next build` + `next start`, API down (error states): HTML /fr 676 640 → 103 868 B
(gz 176 → 27 KB), /fr/pricing 668 696 → 95 742 B, /fr/login 656 441 → 83 175 B, /ar/signup 782 285 → 94 067 B,
/fr/s/… 664 415 → 91 088 B; `admin.*` keys in the login HTML 1 209 → 10 (keys of reachable shared components); First Load
JS /fr and /fr/pricing 813 → 320 kB, /fr/login 831 → 337 kB, /fr/home 832 → 339 kB. Hydrated text of 31 public / auth / app
routes compared before / after in Chromium: identical on 30 / 31 (the 31st, /meta/data-deletion, only differs by loading vs error
state timing with the API down); states that need API data (plan cards, tracking timeline, guides) are covered by the
import-graph test, not by this visual pass.
