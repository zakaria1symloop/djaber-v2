# Content drafts — legal texts (PUBLIC-02) and help guides (HELP-02)

Drafts written on 19/11/2026 for the full test of 15/11 (`docs/audit/full-test-2026-11-15/areas/public.md` PUBLIC-02, `areas/help.md` HELP-02). **Nothing here is published.** The texts describe only what the code does on branch `deploy/tester-fixes-2026-10-22` (data collected, processors, retention, deletion flows, cookies); every place that needs the owner's details or a legal decision is marked:

- `⟦À COMPLÉTER : …⟧` — information only the owner has (company, RC, NIF, address, e-mails, DPO, ANPDP number, hosting provider, court…).
- `⟦À VÉRIFIER : …⟧` — a point to confirm (legal choice for the lawyer, or a product fact that the code and the spec do not agree on — see "Findings" below).

Before publishing a file: fill or delete every `⟦…⟧`, delete the first line « Brouillon — à faire relire par un juriste avant publication » (legal files), and paste only what is under the front matter (`---` block).

## File format

```
---
key: <CmsEntry.key>
type: legal | help
legalDocKey: <LegalDocKey or none>   (legal files only)
category: <HELP_CATEGORIES value>     (help files only)
pages: [<context keys of the « ? » panel>]  (help files only → CmsEntry.target.pages)
sortOrder: <CmsEntry.sortOrder>       (help files only)
locale: fr | ar | en
title: <CmsEntryLocale.title>
---
<CmsEntryLocale.body>
```

The body uses the light Markdown the renderer understands (`articleBlocks` in `apps/web/src/features/help/logic.ts`, also used by `/legal/*`): `## ` headings, paragraphs separated by a blank line, a block made only of `- ` lines = a bullet list. Bold, links, tables, numbered lists and HTML are **not** rendered (they would show as raw characters), so the drafts do not use them. Limits: title ≤ 300 characters, body ≤ 100 000 (`cmsLocaleInput`, `packages/shared/src/schemas/admin.ts`). For help guides the first paragraph becomes the 200-character excerpt shown in lists and search.

## Legal documents — `docs/content-drafts/legal/`

| File (fr / ar / en) | CMS entry key (type `legal`) | Public page | `LegalDocument` key | Who must accept |
|---|---|---|---|---|
| `terms.*.md` | `terms` | `/legal/terms` | `terms` | every user (sign-up, then re-acceptance on a major version) |
| `privacy.*.md` | `privacy` | `/legal/privacy` (URL given to Meta App Review and Google Play) | `privacy` | every user |
| `content_rules.*.md` | `content_rules` | `/legal/content_rules` | `content_rules` | Owners and Admins |
| `account_deletion.*.md` | `account_deletion` | `/legal/account_deletion` | `account_deletion` | nobody (informational, never prompts) |
| `cookies.*.md` | `cookies` | `/legal/cookies` | — (CMS page only) | — |
| `data-deletion.*.md` | `data-deletion` | `/legal/data-deletion` (the « Data deletion instructions URL » of the Meta app) | — (CMS page only) | — |

Sources used: `docs/specs/04-business-rules.md` §9, §12–16, `docs/specs/03-functional-modules.md` (MSG-08, DEL-01…05, PUB-05/06, PFS-04, SAFE, MOD), `docs/specs/02-actors-roles.md` §5–6 (plans, trial, credits), `apps/api/src/modules/messaging/data-lifecycle.service.ts` (12-month message purge, Meta deletion, 7-day inbound events, 90-day placeholder clients), `apps/api/src/modules/auth/account-deletion.service.ts`, `apps/api/src/modules/workspace/workspace-deletion.service.ts`, `apps/api/src/modules/auth/session.service.ts` (cookie `djaber_rt`), next-intl 3.26 middleware (cookie `NEXT_LOCALE`), `.env.example` / `config.schema.ts` (processors: Vercel, Meta, Anthropic / OpenAI / Google / Groq, ZR Express / EcoTrack / Yalidine, Chargily, Google Sheets, FCM, Google Play / App Store, SMTP or Resend, S3 or local storage, Cloudflare Turnstile; the SMS driver has no real provider, so SMS is not listed). The site sets no analytics or advertising tag (checked: no `gtag`, pixel, Vercel Analytics, Sentry… in `apps/web`).

### Placeholders the owner fills (legal)

- Company: raison sociale + forme juridique, capital social, RC, NIF, adresse du siège.
- Contacts: e-mail de contact (support), e-mail « données personnelles », DPO (nom ou fonction) — the DPO e-mail is also a platform setting (Admin › Paramètres plateforme › Documents légaux, `legal_contacts.dpoEmail`), keep both identical.
- ANPDP: numéro et date du récépissé de déclaration / autorisation ; autorisation de transfert hors d'Algérie (pays des prestataires).
- Prestataires: hébergeur du serveur (nom, pays), stockage des fichiers (serveur ou S3 — nom, pays), service d'envoi des e-mails (SMTP actuel ou Resend), liste exacte des fournisseurs d'IA actifs (Admin › Fournisseurs IA).
- Terms: politique de remboursement, clause de responsabilité, juridiction compétente, prix TTC ou HT, engagement de disponibilité, délai de réponse aux demandes de données.
- Lawyer: bases légales (loi 18-07), cookies strictement nécessaires sans bandeau, âge minimum, obligations de la loi 18-05 pour les boutiques, limite de responsabilité pour les réponses de l'IA, conditions API des fournisseurs d'IA (pas d'entraînement), cookies éventuels de Turnstile.

## Help guides — `docs/content-drafts/help/`

30 guides × fr / ar / en = 90 files. Each one is a `CmsEntry(type = help)`: `key` = CMS key (also the public URL `/help/<key>`), `category` = one of the 8 `HELP_CATEGORIES` cards, `pages` = `target.pages` (the « ? » panel matches the first two path segments of the app route without the locale, `contextKey()` in `apps/web/src/features/help/logic.ts`; ids are dropped, so `/products/<id>/edit` → `products/edit`), `sortOrder` = order inside the lists. « seed » = the key exists already (rewrite of the one-sentence text); « new » = to create.

| key | category (card) | pages | sortOrder | title (fr) | status |
|---|---|---|---|---|---|
| help-getting-started | getting_started | home | 0 | Démarrer avec Djaber | seed |
| help-first-product | getting_started | products/new, products/import | 1 | Ajouter votre premier produit | new |
| help-connect-page | pages_instagram | channels, channels/connect | 10 | Connecter une page Facebook ou Instagram | seed |
| help-meta-approval | pages_instagram | channels | 11 | Approbation Meta : une page « EN ATTENTE META » | new |
| help-page-reconnect | pages_instagram | channels, channels/history | 12 | Reconnecter une page « À RECONNECTER » | new |
| help-24h-window | pages_instagram | inbox, channels/messages, queue | 13 | La fenêtre de 24 h de Messenger et Instagram | new |
| help-ai-agent | ai_agent | agents, agents/new, agents/playground | 20 | Configurer votre agent IA | seed |
| help-agent-knowledge | ai_agent | agents/new, agents/configuration | 21 | Ce que l'agent sait : catalogue, règles de la boutique et FAQ | new |
| help-agent-handoff | ai_agent | agents/configuration, queue, inbox, settings/system-messages | 22 | Transfert à un humain : quand l'agent passe la main | new |
| help-agent-languages-media | ai_agent | agents/new, agents/configuration, agents/playground | 23 | Langues, photos et notes vocales | new |
| help-orders-delivery | orders_delivery | orders, orders/new | 30 | Confirmer et expédier une commande | seed |
| help-couriers | orders_delivery | delivery/couriers, delivery/fees | 31 | Connecter ZR Express, EcoTrack ou Yalidine | new |
| help-delivery-tracking-returns | orders_delivery | delivery | 32 | Suivre les colis, les échecs et les retours | new |
| help-google-sheets | orders_delivery | settings/integrations | 33 | Envoyer vos commandes dans Google Sheets | new |
| help-saved-views | orders_delivery | orders, delivery, products, clients, sales, purchases, cash, movements, agents | 34 | Filtres et vues enregistrées | new |
| help-stock | stock | products, stock, movements, inventory | 40 | Gérer votre stock | seed |
| help-stock-variants | stock | products, products/new, products/edit | 41 | Produits à variantes (taille, couleur…) | new |
| help-purchases | stock | purchases, purchases/new, suppliers | 42 | Achats fournisseurs et réception du stock | new |
| help-cash-register | stock | cash, sales, sales/new | 43 | Caisse, ventes comptoir et clôture de la journée | new |
| help-reports | stock | reports | 44 | Rapports et exports | new |
| help-credits-billing | credits_billing | settings/credits, settings/billing | 50 | Crédits : coût par action et packs | seed |
| help-plan-subscription | credits_billing | settings/billing | 51 | Changer de plan, payer et renouveler l'abonnement | new |
| help-invoices | credits_billing | settings/billing | 52 | Factures et informations de facturation (NIF) | new |
| help-mobile-app | mobile_app | settings/notifications | 60 | L'application mobile Djaber | seed — hold until the store release |
| help-notifications | mobile_app | settings/notifications, notifications | 61 | Notifications : application, e-mail et push | new — web part publishable now, mobile part held |
| help-mobile-offline-update | mobile_app | — | 62 | Application mobile : hors ligne et mises à jour | new — hold until the store release |
| help-security-data | security_data | settings/security, settings/profile | 70 | Sécuriser votre compte : mot de passe, 2FA et sessions | seed |
| help-members-roles | security_data | settings/members | 71 | Inviter votre équipe et choisir les rôles | new |
| help-password-reset | security_data | settings/security | 72 | Mot de passe oublié | new |
| help-account-deletion | security_data | settings/profile, settings/danger | 73 | Exporter vos données et supprimer votre compte ou votre espace | new |

Notes on the guides:

- The seed key `help-getting-started` had the context `onboarding`; it was dropped because the onboarding pages have no « ? » panel.
- Labels are quoted from `packages/shared/src/i18n/messages/app.{fr,ar,en}.json`; the `ORDER_CONFIRMATION_REQUIRED` sentence comes from the error catalogue. The guides follow the 18/11 fixes (5-step wizard, « Tester moi-même » with no credits, stock reserved by a new order and taken out at confirmation, an order whose call failed must be confirmed before preparing, closed cash day reopen, saved views).
- Numbers come from the code: credit cost text 1 · photo 5 · voice 3 · AI order 0 (`CREDIT_COST`, platform-versioned, so the guides say "current rates"); deletion grace 30 days (`deletionGraceDays`; the screens also write « 30 jours »). Pack prices and plan names are not written (platform data; PUBLIC-09 still open).
- Roles follow the code: only the Owner changes the plan, invites members and edits roles; packs, invoices and billing details are open to Owner and Admins; purchases, cash register, counter sales and reports are Owner / Admin only and appear only in « Avancé » stock mode.
- FAQ file import: DOCX and TXT only (the wizard button says so; PDF is still a carry-over).
- The personal data export exists only inside the account-deletion flow (deactivated-account screen, public deletion page, confirmation e-mail); shop data is exported with the « Exporter » buttons of lists and reports. The guides say it that way.
- The Arabic texts name the product « Djaber » (as the Arabic interface does), not « جابر » (old seed).

### Placeholders the owner fills (help)

- `help-mobile-app` (fr / ar / en): ⟦À COMPLÉTER : liens Google Play et App Store⟧, plus ⟦À VÉRIFIER⟧ — there is no mobile app in this repo; the text follows `docs/specs/14-mobile-app.md`.
- `help-notifications`: ⟦À VÉRIFIER⟧ on the « Sur mobile » part (the web notifications page says push is « bientôt disponible »); cut that part to publish the web part now.
- `help-mobile-offline-update`: ⟦À VÉRIFIER⟧, publish only with the app.
- `help-plan-subscription`: ⟦À VÉRIFIER⟧ — whether merchants can ask for a bank transfer / CCP payment (finance can record it on the invoice, but no merchant screen explains how to ask) and how.

## How to publish (admin screens)

Needs a platform account with `admin.cms.write` (super admin). Never on the live server from a script: these are manual steps in the admin.

Legal document already seeded (`terms`, `privacy`, `content_rules`, `account_deletion`, `cookies`, `data-deletion`) and help guide already seeded (the 8 keys of `packages/db/seeds/ops-support.ts`):

1. Admin › Contenu (`/admin/cms`), tab « Pages légales » or « Aide », open the entry by its key (`Actions ⌄` › « Modifier »).
2. In the editor, replace the title and the body of **each** language FR, AR and EN with the text of the matching file, then save. Saving a language puts it back to « BROUILLON »: the public page stops showing that language (French fallback) until the entry is published again, so do the three languages in one go.
3. `Actions ⌄` › « Aperçu (lien signé 24 h) » to read the page before it goes live.
4. « Publier » (a reason ≥ 10 characters is required). The entry gets version N+1; `/legal/<key>` shows « vN+1 · en vigueur depuis … », the version history and the v(N) → v(N+1) diff.

New help guide (keys that are not in the seed, see the table above):

1. « + Nouvelle entrée » (dialog « Nouvelle entrée CMS ») → type « Aide », slug = the `key` of the file, French title; tick « Créer les 3 langues ».
2. Fill FR / AR / EN in the editor, then « Publier ».
3. Limitation of the admin screen: the dialog and the editor do not set `category`, `target.pages` or `sortOrder`. Without `category` the guide is not counted under any of the 8 category cards (it still appears in « Tous » and in search); without `target.pages` it never appears in the « ? » panel. These three fields are accepted by the API (`POST /admin/cms` and `PATCH /admin/cms/:id`, `AdminCreateCmsSchema`), so for a complete guide either send them through the API, or use the seed / data-migration path below. Careful: changing « Cible » in the editor sends `target: { scope }` and would erase `target.pages` of a help guide.

Making users accept the new legal texts: publishing the CMS entry only changes the text shown. The version users accept is a separate `LegalDocument` row (currently v1 for each key, accepted at sign-up against the placeholder sentence). To make every user read and accept the real Terms / Privacy / Content rules, a new `LegalDocument` version with `isMajor: true` must be published: `POST /api/v1/admin/legal-documents/<key>/publish { version: 2, isMajor: true, cmsEntryId: <id of the CMS entry>, reason }` (`apps/api/src/modules/admin-ops/settings/settings.controller.ts`, `admin.cms.write`). Effect: `requiresReacceptance`, notification `legal_reacceptance_required` to every concerned user, `403 LEGAL_REACCEPT_REQUIRED` until they accept (interstitial). **No admin screen calls this endpoint today** (Admin › Paramètres plateforme, panel « Documents légaux (versionnés) », only lists versions and acceptance % and links to the CMS with « Gérer dans Contenu (CMS) »), so it is done with an authenticated API call by a super admin — or a small admin button to add first. `account_deletion` never prompts.

## Idempotent code path (alternative — described, not run)

The repo already has the pattern for shipping CMS text with a deploy:

- `packages/db/seeds/ops-support.ts` (`ARTICLES`) and `packages/db/seeds/public-pages.ts` / `packages/db/seeds/index.ts` (`legal()`) create an entry **only when its key does not exist** (`findUnique` → `continue`); they never overwrite an edited entry. New help guide keys could be added to `ARTICLES` with their `category`, `pages` and `sortOrder`; `pnpm --filter db seed` would then create only the missing ones (published, version 1). The VPS deploy (`tools/deploy/vps-update.sh`) runs `migrate:deploy` only, not the seed.
- For entries that already exist, the data migration `packages/db/prisma/migrations/20261118120000_help_guides_wizard_stock/migration.sql` is the model: `UPDATE "CmsEntryLocale" … WHERE e."key" = '…' AND l."locale" = '…' AND l."body" = $old$<seeded text>$old$` — it changes a locale only while it still holds the first seeded text (an admin edit is kept; a second run changes nothing) and runs with `migrate:deploy`. That migration did not add a `CmsEntryVersion` row nor bump `currentVersion`; a migration for the legal texts should also insert the version snapshot and bump `currentVersion` so the public page shows « v2 » and its history, and then publish the `LegalDocument` v2 (above) for re-acceptance.

Nothing of this has been run: no seed, no migration, no API call, no commit.

## Findings while drafting (product facts that the texts had to work around)

Items 1–4 were fixed after drafting (2026-11-19) and the drafts updated; items 5–7 are open. Where code and spec still differ the texts carry a ⟦À VÉRIFIER⟧.

1. ~~**Meta data deletion keeps the customer card with orders as it is.**~~ **Fixed 2026-11-19.** `DataLifecycleService.runDeletion` now deletes a card without orders / sales and anonymises a card with orders / sales (`« Client supprimé »`, phones, e-mail, notes, tags, addresses removed, archived); its orders / sales lose name, phones, address and note, amounts / payments / invoices unchanged (MSG-08, 04 §9, AT-MSG-07). The `data-deletion` drafts describe it; the status page strings `dataDeletion.done` / `dataDeletion.legalNote` are now true.
2. ~~**Meta callback id vs. messaging id.**~~ **Fixed 2026-11-19.** The `meta-data-deletion` job resolves the app-scoped `user_id` to page-scoped ids through the Meta port (`ids_for_pages`, fake adapter in dev / tests; still to confirm on the live app at App Review, carry-overs M3); nothing matched ⇒ status `no_data` (« AUCUNE DONNÉE » + support e-mail, never « TERMINÉ »). E-mail requests: `POST /admin/data-deletion-requests` (support / super admin, no screen yet — procedure in `docs/implementation/07-non-functional.md` §4). The drafts no longer carry ⟦À VÉRIFIER⟧ on this.
3. ~~**Invoices are deleted with a purged workspace.**~~ **Fixed 2026-11-19.** The purge keeps `Invoice`, `BillingPayment` (+ proof) and `CreditPackPurchase` on a `purged` workspace stub (same id, billing identity only), 10 years (DEL-03, 07 §4, AT-DEL-06). The drafts state 10 years.
4. ~~**Retention purges not implemented.**~~ **Fixed 2026-11-19.** `sched-retention` now also purges audit rows > 24 months, closed reports and lifted blocks > 2 years, payment events > 5 years (no longer dropped after 7 days), redacts AI tool arguments after 12 months, deletes AI runs after 24 months and finished jobs after 90 days (AT-RET-01). The privacy drafts give these periods.
5. **No screen publishes a `LegalDocument` version** (see "Making users accept the new legal texts" above): re-acceptance of the real texts needs an API call today.
6. **The CMS dialog / editor cannot set a help guide's `category`, `target.pages`, `sortOrder`**, and changing « Cible » overwrites `target.pages` (see "New help guide" above).
7. **No mobile app in this repo**, while the privacy policy, terms (IAP packs) and three guides mention it. Mentions are marked ⟦À VÉRIFIER⟧ so they can be removed until the app is published.
