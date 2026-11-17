# 02 — Actors, roles, plans, credits

## 1. Tenancy

**Decision (D7):** one tenant = one **Workspace** (the merchant business). Every business record has a non-null `workspaceId` FK. V1 mixed `pageId`/`userId` scoping with nullable columns and missing FKs — removed entirely.

- A **User** is a login identity. Sign-up creates the user **and** its one owned workspace — except sign-up through an invitation link, which creates no workspace (D30). A user can additionally be a member of other workspaces only through invitations; an invited-only user may create their own workspace later (`POST /workspaces`, one per user). Exactly one Owner per workspace at any time; the Owner cannot be removed or demoted by anyone else (`OWNER_IMMUTABLE`); the Owner may transfer ownership to an Admin of the same workspace with `POST /workspaces/:id/transfer-ownership { newOwnerUserId, password, totpCode? }` (D51, 04 §16) — the old Owner becomes Admin in the same transaction.
- Every API request resolves the active workspace (`X-Workspace-Id`; default = the user's owned workspace, or last used). All queries are filtered by it in a guard; cross-workspace access returns `404 NOT_FOUND`.
- The workspace switcher is shown only when the user has > 1 membership.

## 2. Actors

| Actor | Where | Description | Source |
|---|---|---|---|
| End customer | Messenger / Instagram | Asks, sends photos/voice, orders, pays | CDC §4.1 |
| **Owner** | Workspace | Created the workspace; billing, members, deletion | V1 user |
| **Admin** | Workspace | Runs the shop: catalogue, orders, agents, pages, delivery, reports | CDC "Admin principal" |
| **Operator** | Workspace | Inbox and escalations; orders day-to-day | CDC "Opérateur" |
| **Super Admin** | Platform | Symloop staff | CDC, V1 `isAdmin` |
| **API client** | Machine | Third-party system with a scoped key | CDC §8.2 |

## 3. Permission matrix (source of truth for `@RequirePermission` keys)

`●` full · `R` read · `—` none. Keys in code are `<group>.<action>`.

| Group / action | Owner | Admin | Operator |
|---|---|---|---|
| **inbox**: read, reply, read-mark, pause/resume AI, resolve, reopen, archive, assign, notes | ● | ● | ● |
| **inbox**: delete conversation | ● | ● | — |
| **channels**: read | ● | ● | R |
| **channels**: connect, reconnect, pause, disconnect, sync, analyse, import products | ● | ● | — |
| **agents**: read | ● | ● | R |
| **agents**: create, edit, pause, delete, generate | ● | ● | — |
| **agents**: test playground | ● | ● | ● (shared 60 turns/h limit) |
| **insights**: resolve, dismiss, add to instructions | ● | ● | ● |
| **catalog**: read (products, categories, units, services, recommendations) | ● | ● | R |
| **catalog**: create/edit/archive, images, variants, import, export, AI from photo | ● | ● | — |
| **stock**: adjust, reverse a movement | ● | ● | — |
| **stock**: movements read, export (`stock.read`), inventory count (`stock.count`) | ● | ● | ● |
| **clients**: read, create, edit | ● | ● | ● |
| **clients**: delete, export | ● | ● | — |
| **orders**: read, create, edit contact/notes, status change, call log, bulk status, print | ● | ● | ● |
| **orders**: edit delivery fee/discount, delete, export | ● | ● | — |
| **delivery**: send/bulk send, track, labels | ● | ● | ● |
| **delivery**: couriers, fee grid, free-delivery rule | ● | ● | — |
| **gds**: suppliers, purchases (+receive), sales, cash register | ● | ● | — |
| **reports**: read, export | ● | ● | — |
| **analytics**: read | ● | ● | R |
| **notifications**: own list, own preferences | ● | ● | ● |
| **workspace**: profile, logo, language, stock mode, target margin, system messages (handoff / out_of_hours / out_of_stock / welcome), quick replies, auto-pause setting | ● | ● | — |
| **members**: invite, remove, change role | ● | — | — |
| **workspace**: transfer ownership | ● | — | — |
| **integrations**: API keys, outbound webhooks, Google Sheets | ● | ● | — |
| **billing**: plans (change, cancel, renewal) | ● | R | — |
| **billing**: credit packs checkout, invoice payment, billing info (`billing.write`), invoices and credits ledger read | ● | ● | — |
| **workspace**: delete | ● | — | — |

Footnote: `delivered → returned`, delivery-fee and discount edits are **Admin+** (04 §1.2) even though Operators may change other statuses.

Platform roles (`User.platformRole ∈ read | support | moderator | finance | super_admin`, matrix in 06 §9) have `admin.*` keys and **no** merchant keys: they cannot act inside a workspace. Super admin and support may open a read-only impersonation session (D21-bis: reason ≥ 10 chars, 30 min, every request audited, every non-GET request ⇒ `403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION`); the cross-workspace viewers (ADM-17) are read-only.

## 4. Security per role `[CDC §11.2]`

| Role | 2FA (TOTP) |
|---|---|
| Super Admin | Mandatory |
| Owner / Admin / Operator | Optional (D8) |
| API client | N/A — key scopes (06 §5) |

## 5. Plans, subscriptions, limits `[V1][FIG Plan Card]`

Plan fields (V1 + v2): `slug, name, description, priceMonthly, priceYearly (DZD), trialDays, maxPages, maxAgents, maxProducts, maxConversationsPerMonth, maxMembers, maxApiKeys, maxWebhooks, syncHistoryDays, monthlyCredits, features[], isActive, isFeatured, isVisible, sortOrder, version`. `-1` = unlimited.

Seed plans (D68): **free** 0 DA — 100 credits, 1 page, 1 agent, 1 member, 50 products, 200 conversations/month; **starter** 1 900 DA/month · 19 000 DA/year — 1 500 credits, 2 pages, 2 agents, 3 members, 500 products, 2 000 conversations/month, features `voice_notes, image_recognition, couriers, google_sheets`; **pro** 4 900 DA/month · 49 000 DA/year — 5 000 credits, 5 pages, 5 agents, 10 members, unlimited products and conversations, features `voice_notes, image_recognition, couriers, google_sheets, api_keys, webhooks, advanced_stock, scheduled_reports, instagram, priority_support`. Plan names and prices are data (`Plan`), editable by the platform (D63).

**Trial (D60)**: sign-up and `POST /workspaces` create `Subscription(status=trial, plan=pro, billingCycle=none, provider=none, currentPeriodEnd=trialEndsAt=+14 d)` plus a 300-credit grant (`CreditLedger action=grant, kind=credit, bucket=plan`); at `trialEndsAt` the daily job applies the single expiry rule below (free plan). Every workspace has exactly one current `Subscription` (partial unique on `workspaceId` where `status ∈ trial|active|dunning`); the free subscription has `provider=none`; the credit period anniversary = the subscription's `currentPeriodStart` day-of-month.

Statuses: `trial, active, dunning, expired, cancelled`. Renewal = new Chargily checkout before `currentPeriodEnd` (no card on file, no recurring charge); dunning per 04 §14 (J−7 reminder, J0 unpaid invoice + payment link, J+3 reminder, J+7 ⇒ `expired` ⇒ free plan). Upgrade = immediate, web only (mobile shows "Gérer sur le web"): same cycle ⇒ the prorata of the price difference for the days left is paid now and the period end is kept (credits difference added at once); from a trial / the free plan / an expired plan, or a cycle change upward, a new period starts today (a running paid period's unused value is deducted) — 03 §37 BIL, api-contract `CheckoutPreviewDto.prorataDays`. Downgrade/cancel = effective at period end (`cancelAtPeriodEnd=true`). A workspace is **suspended** only by an admin action (`Workspace.status=suspended`), never by non-payment.

### Limit enforcement (server-side, inside the creating transaction)

| Limit | Checked on | Over the limit |
|---|---|---|
| `maxPages` | connect / reconnect | extra pages skipped with `PLAN_LIMIT{resource:pages}` in the connect report |
| `maxAgents` | agent activation (drafts never count; counted = agents with `status ∈ active|paused`) | `403 PLAN_LIMIT {resource: agents}` |
| `maxProducts` | product create, import commit, analysis import, variant create | `403 PLAN_LIMIT`; import preview shows "n rows exceed your plan" |
| `maxMembers` | invite | `403 PLAN_LIMIT` |
| `maxConversationsPerMonth` | first inbound message of a conversation in the monthly period | AI stops for new conversations (workspace unavailable message once per conversation), inbox and manual replies continue; Owner notified at 80 % / 100 % (NTF `quota.80` / `quota.100`) |

### Expiry / downgrade (daily job) — single rule

When the daily job finds a Subscription whose paid period is over — a `trial` at `trialEndsAt`, a `cancelled` plan at `currentPeriodEnd`, or a `dunning` plan at `currentPeriodEnd + 7 d` (04 §14) — the Subscription becomes `expired` and a new free Subscription (`provider=none`, `status=active`, `billingCycle=none`) is created the same instant; free-plan limits and credits apply; excess resources are paused per the table below; **no workspace-wide read-only** (the "Plan expiré" banner only explains the paused badges). Nothing is deleted. Channels beyond `maxPages` are set `paused` with `pausedReason=plan` (newest first: messages stored, AI silent, badge "paused by plan"); agents beyond `maxAgents` `paused` (newest first); members beyond `maxMembers` become read-only (newest first); products beyond `maxProducts` stay visible, creation blocked. Reminder 7 d before expiry (`subscription.expiring`, once — 03 §15 / 03-events §5.1, no J−1); at expiry `subscription.expired`. Restoring a plan un-pauses automatically (oldest first, up to the new limits).

## 6. Credits `[V1 credits.service.ts][FIG Credits Pill]` (D17)

| Action | Credits |
|---|---|
| AI text reply (per turn) | 1 |
| Image recognition (per turn with ≥ 1 image) | 5 |
| Voice transcription (per turn with audio) | 3 |
| AI order, test playground, page analysis, FAQ extraction, agent generation, recommendations | 0 (rate-limited: analysis / extraction / generation 3 per day per workspace, playground 60 turns/h) |

- **Credit period = one month** starting on the subscription's `currentPeriodStart` day-of-month — a trial's period ends at `trialEndsAt` (its credits last until the trial ends; the screens say « jusqu'à la fin de l'essai le …, puis plan Gratuit », never « renouvelés le … », journey J12-1) (yearly plans and the free plan = 12 consecutive monthly periods; the `scheduled` job opens the next period at 00:00 Africa/Algiers with a `CreditLedger` row `action=renewal, kind=credit, bucket=plan`). The same monthly period applies to `maxConversationsPerMonth`. Balance = plan part (`monthlyCredits` − Σ plan debits in the current credit period; `-1` = unlimited) + pack part (Σ `bucket=pack` credits − Σ pack debits, never expiring). Debits consume the plan part first, then packs (oldest purchase first). 80 % and "épuisés" notifications are computed on the plan part; the AI stops only when both parts are 0 (D40).
- **Per-turn cost** = the highest applicable of text 1 / voice 3 / image 5 — one charge per turn (V1).
- **Reservation**: at `ai-reply` job start a ledger row `reserved` for the planned cost; settled to `debit` on success (text only if the reply was sent; image/voice if the run succeeded), released on provider error. Idempotent per `aiRunId`.
- 80 % ⇒ notification once per period; 100 % ⇒ FL-01 F-4 (unavailable message once per conversation per 24 h, then silence + `needs_human`), Owner notified daily while at 0.
- Header pill `used / limit` (red when exhausted) `[FIG Credits Pill]`; credit calculator modal (V1) in Settings › Credits.
