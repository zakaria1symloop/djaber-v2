---

UX-007 — Admin overview: the « Sign-ups · activations · churn per day » chart is hard to read — à arbitrer par le fondateur

- Screen: Admin > Overview — chart « Sign-ups · activations · churn per day » (/en/admin?period=7d|30d|90d)
- Type: UX — « à arbitrer par le fondateur »
- Severity: Minor
- Date found: 21/10/2026
- What happens: the chart draws one bar per day (7, 30 or 90 bars) in blue (signed up), green (activated, page connected) and red (churned). Hovering a bar shows a tooltip, e.g. « 18 OCT · SIGNED UP 5 · ACTIVATED (page connected) 0 · CHURNED 0 ». But:
  a. there is no date on the X axis: to find a day, every bar must be hovered one by one (90 thin bars in « 90 d »);
  b. there is no Y axis or scale: without hovering, a bar of 1 and a bar of 100 cannot be told apart;
  c. there are no totals for the period (e.g. « 19 sign-ups · 2 activations · 0 churned ») and no activation rate (share of sign-ups that connected a page), which is what the platform owner needs;
  d. activations are stacked on top of sign-ups: on 14 Oct the bar is 9 high for 8 sign-ups + 1 activation (tooltip « SIGNED UP 8 · ACTIVATED 1 »), so the height suggests 9 new shops, whereas an activation is often a shop that already signed up.
     The Figma frame « ADM-01 — Platform admin — overview » draws neither axis nor totals; the spec only says « signups / activations / churn chart » (08, 12 §26).
- What we expected (to decide):
  - dates on the X axis (at least every few days) and a Y scale;
  - period totals above the chart: sign-ups, activations, churn, activation rate;
  - sign-ups, activations and churn drawn side by side or as lines, not stacked.
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Overview, period « 30 d ». 3. Try to find the 14 Oct bar without hovering, then hover it: 8 sign-ups + 1 activation, bar height 9. 4. Switch to « 90 d »: 90 bars, no dates.

---

UX-016 — Admin Workspaces: the « Status » filter and the « Status » column do not show the same status

- Screen: Admin > Workspaces — « Status » filter chip and « STATUS » column (/en/admin/workspaces)
- Type: UX
- Severity: Minor
- Date found: 22/10/2026
- What happens: the « Status » filter offers « ACTIVE », « SUSPENDED » and « DELETION D+30 » (workspace status), while the « STATUS » column of the table shows the subscription status (« TRIAL » for all 16 workspaces today). Filtering on « ACTIVE » (?status=active) returns the 16 workspaces, every row labelled « TRIAL ». The subscription states (trial, active, dunning, expired, cancelled) can only be filtered through « Filters › Subscription ».
- What we expected: the « STATUS » column is renamed « SUBSCRIPTION », the same name as the filter that holds these values.
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces. 3. Open the « Status » filter: ACTIVE / SUSPENDED / DELETION D+30. 4. Tick « ACTIVE »: 16 workspaces are listed, all with the pill « TRIAL ». 5. Open « Filters »: the trial / active / expired states are under « SUBSCRIPTION ».

---

UX-017 — Admin Workspaces: the « WILAYA » filter chip is in capitals, unlike the other filters

- Screen: Admin > Workspaces — filter bar (/en/admin/workspaces)
- Type: UI
- Severity: Cosmetic
- Date found: 22/10/2026
- What happens: in the filter bar, the chips read « Plan », « Status », « Credits », « Created », « Filters », but the wilaya chip reads « WILAYA » in capitals. The chip reuses the shared label common.wilaya, written « WILAYA » in French and English (packages/shared/src/i18n/messages/deck.fr.json:223 and deck.en.json:223) because it is used for upper-case column headers. The filter itself works.
- What we expected: the chip reads « Wilaya », like the other filters (a title-case label for the chip; the column headers can keep « WILAYA »).
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces. 3. Look at the filter bar: « WILAYA » is the only chip in capitals.

---

UX-018 — Admin Workspaces: a free trial is shown as « Pro monthly · 0 DA » in the workspace sheet

- Screen: Admin > Workspaces — detail sheet, « Summary » tab (line « SUBSCRIPTION ») and « Subscription » tab (line « CYCLE ») (/en/admin/workspaces?sheet=…)
- Type: UI
- Severity: Minor
- Date found: 22/10/2026
- What happens: « teest's shop » is on the free Pro trial (status « TRIAL », no payment). Its workspace sheet shows « Pro monthly · 0 DA · trial until 02 Jan » in « Summary », and « CYCLE: Monthly » in the « Subscription » tab, which reads as a monthly paid subscription at 0 DA. A trial has no billing cycle (billingCycle=none, 04 §14 / 02 §5). Admin > Subscriptions & invoices shows the same shop correctly, with « — » in the « Cycle » column. The sheet turns « none » into « monthly » (apps/web/src/features/admin/workspaces/sheet.tsx:126 and :218); every shop on the Free plan (also billingCycle=none) will show the same way.
- What we expected: for a trial, the sheet shows « Pro · trial until 02 Jan » and « CYCLE: — », the same as Subscriptions & invoices.
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces and open the sheet of a workspace on trial (e.g. « teest's shop »). 3. Read the « SUBSCRIPTION » line in « Summary »: « Pro monthly · 0 DA ». 4. Open the « Subscription » tab: « CYCLE: Monthly ». 5. Open Admin > Subscriptions & invoices, filter « TRIAL »: the same shop has « — » in « Cycle ».

---

UX-019 — Admin Workspaces: credits can only be added, a mistaken grant cannot be corrected — à arbitrer par le fondateur

- Screen: Admin > Workspaces — row « Actions › Add credits » / sheet « Add credits » (/en/admin/workspaces)
- Type: Feature gap — « à arbitrer par le fondateur »
- Severity: Minor
- Date found: 22/10/2026
- What happens: the only credit action available to the super admin is « Add credits ». Per the code, the amount must be a whole number from 1 to 1 000 000 (packages/shared/src/schemas/billing.ts:131), so a negative amount is refused, and no « remove / adjust credits » action exists in the admin. If an admin grants too many credits by mistake (e.g. 100 000 instead of 1 000), the grant cannot be corrected from the admin; the credits stay on the shop until they are consumed or the plan period resets. The data model already has a ledger action adjustment (05-data-model §CreditLedger) and the credits service can write a negative adjustment (apps/api/src/modules/credits/credit.service.ts:219), but neither is reachable from the admin. The specs only describe adding credits (PRM-03, ADM-02, POST /admin/workspaces/:id/credits).
- What we expected (to decide): an « Adjust / Remove credits » action for finance and super admin, with a mandatory reason (≥ 10 characters), written as a CreditLedger row action=adjustment, kind=debit, audited, and shown in the shop's credits history.
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces, open « Actions » on a workspace. 3. Look for a way to remove credits: only « Add credits » exists. 4. In « Add credits », the amount accepts 1 to 1 000 000 only (per the code).

---

### UX-020 — Admin Workspaces: extending a trial does not inform the merchant (no e-mail, no notification) — à arbitrer par le fondateur
- Screen: Admin > Workspaces — « Actions › Extend trial / period » / Merchant workspace (notifications) / owner's mailbox
- Type: UX / Notification gap — « à arbitrer par le fondateur »
- Severity: Minor
- Date found: 22/10/2026
- What happens: when the super admin extends a shop's trial (+7 d, +30 d or a date, with a reason), the new end date is saved and audited (`SUBSCRIPTION.TRIAL_EXTEND`), but the owner receives no e-mail and no in-app notification. This matches the spec: decision D60 only says « Admin "Prolonger l'essai" (+7 d / +30 d / date, reason, audited) », and the notification catalogue (03 §15) has no « trial extended » type (code: apps/api/src/modules/admin-core/workspaces.service.ts:442-445, audit + live refresh only). The merchant only sees the new date if they open Paramètres > Plan & facturation. Other admin actions on a shop do inform the owner: « Add credits » sends an e-mail (apps/api/src/modules/billing/admin-billing.service.ts:90), « Suspend » sends an e-mail and an in-app notification when « notify owner » is ticked (workspaces.service.ts:366).
- What we expected (to decide): extending a trial sends the owner an e-mail and an in-app notification (« Votre essai a été prolongé jusqu'au … », link to Paramètres > Plan & facturation).
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces, « Actions › Extend trial / period » on a workspace in trial, choose +7 d and a reason, confirm. 3. On the merchant side, open the notifications (bell): nothing about the extension. 4. Check the owner's mailbox: no e-mail. 5. Open Paramètres > Plan & facturation: the new trial end date is shown.

---

### UX-021 — Admin Workspaces: adding credits sends an e-mail but no in-app notification to the merchant — à arbitrer par le fondateur
- Screen: Admin > Workspaces — « Actions › Add credits » / Merchant workspace (notifications)
- Type: UX / Notification gap — « à arbitrer par le fondateur »
- Severity: Minor
- Date found: 22/10/2026
- What happens: when the super admin adds credits to a shop (amount + reason), the grant is written to the credits history (« GESTE » row) and an e-mail is sent to the owner (apps/api/src/modules/billing/admin-billing.service.ts:88-94), but the merchant gets no in-app notification: nothing appears in the bell. This matches the spec: PRM-03 only asks for « e-mail to the Owner » (03 §36), and AT-PRM-03 only checks the e-mail. A merchant who does not read that mailbox only notices the credits by opening Paramètres > Crédits. By comparison, buying a pack shows an in-app notification « Pack de {credits} crédits ajouté », and « Suspend » sends an e-mail and an in-app notification.
- What we expected (to decide): adding credits also sends the owner an in-app notification (« {n} crédits ajoutés par Djaber · motif … », link to Paramètres > Crédits), in addition to the e-mail.
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Workspaces, « Actions › Add credits » on a workspace, enter an amount and a reason, confirm. 3. On the merchant side, open the notifications (bell): nothing about the grant. 4. Open Paramètres > Crédits: the « GESTE » row and the new balance are shown.

---


### UX-022 — Platform settings: entering an impersonation duration below 5 min shows only « Check the fields », without saying what is wrong
- Screen: Admin > Platform settings — limits & defaults, field « impersonation duration (min) » (`/en/admin/settings`)
- Type: UI / Validation
- Severity: Minor
- Date found: 22/10/2026
- What happens: entering « 2 » in the impersonation duration and saving is refused with the generic message « Check the fields », with no message under the field and no hint of the allowed range. The allowed range is 5 to 240 minutes (packages/shared/src/schemas/admin-ops.ts:381). With 5, the save works.
- What we expected: the error is shown under the field with the allowed range, e.g. « Entre 5 et 240 minutes » (errors are shown inline at the field, 11 §10), and the range is visible before saving (hint or min/max on the input).
- Steps to reproduce: 1. Log in as super admin. 2. Open Admin > Platform settings, limits & defaults. 3. Set the impersonation duration to 2 and save: only « Check the fields » appears. 4. Set 5 and save: accepted.


---

### UX-023 — Platform settings: the impersonation duration setting has no effect, sessions always last 30 min
- Screen: Admin > Platform settings — field « impersonation duration (min) » / Admin > Workspaces — « Log in as »
- Type: Bug
- Severity: Major (the setting is saved and audited but ignored)
- Date found: 22/10/2026
- What happens: the impersonation duration is set to 5 min in Platform settings and saved. A new « Log in as » session on « teest's shop » starts with the red banner « You are acting as teest's shop · read-only · 30 min ». The setting is editable (apps/web/src/features/admin-ops/settings-page.tsx:36, range 5–240), but the session is created with a fixed constant `IMPERSONATION_MINUTES = 30` (packages/shared/src/schemas/admin.ts:33, used in apps/api/src/modules/admin-core/viewers.service.ts:146 and :155 for the session expiry and the token lifetime). The specs make it a platform setting: PFS-07 « impersonation window (30 min) » and 04 §15 `impersonationMinutes=30` (default, versioned and audited).
- What we expected: a new « Log in as » session lasts the duration set in Platform settings (here 5 min): `expiresAt` and the token lifetime use `impersonationMinutes`, and the red banner starts at « 5 min ».
- Steps to reproduce: 1. Log in as super admin. 2. Admin > Platform settings: set the impersonation duration to 5 min and save. 3. Admin > Workspaces > « teest's shop » > Actions > « Log in as », give a reason. 4. The red banner shows « 30 min » instead of « 5 min ».


---

### UX-024 — Impersonation: the shop shows the « READ_ONLY_MEMBER: plan at its member limit » banner, a wrong reason that exposes an internal code
- Screen: Merchant app during an admin « Log in as » session (any page of the shell)
- Type: UI / Wording
- Severity: Minor
- Date found: 22/10/2026
- What happens: during a « Log in as » session, under the red impersonation banner, the shell also shows the yellow banner « Read-only — your access is limited (READ_ONLY_MEMBER: plan at its member limit). Ask an admin. ». The reason is wrong (the plan is not at its member limit; the view is read-only because it is an impersonation) and it shows the internal code READ_ONLY_MEMBER. Cause: impersonation builds a fake membership with `readOnly: true` (apps/web/src/lib/session.tsx:98), and the shell then pushes the generic member-limit banner `banner.readOnly` (apps/web/src/components/shell/merchant-shell.tsx:242; text in packages/shared/src/i18n/messages/deck.en.json:143).
- What we expected: during impersonation only the red banner « Vous agissez en tant que … · lecture seule · {mm} min · Quitter » is shown (D21-bis, 04:228), with no member-limit banner and no internal codeshown to the user.
- Steps to reproduce: 1. Log in as super admin. 2. Admin > Workspaces > « teest's shop » > Actions > « Log in as », give a reason. 3. In the shop, look under the red banner: the yellow « READ_ONLY_MEMBER: plan at its member limit » banner is shown.


### UX-025 — Content (CMS): « Preview (signed link 24 h) » on an announcement opens a 404 page
- Screen: Admin > Content (CMS) > Announcements > row Actions > « Preview (signed link 24 h) »
- Type: Bug
- Severity: Minor
- Date found: 22/10/2026
- What happens: on the announcement « Retest UX-005 : nouvelle facturation », the action gives a link `/preview/cms/retest-ux005-facturation?preview=…` that redirects (307) to `/fr/legal/retest-ux005-facturation?preview=…`, which answers 404 « Introuvable ou accès refusé ». The server builds `/preview/cms/<key>` for every type other than legal / help (apps/api/src/modules/admin-core/cms.service.ts:268), that page sends any unknown key to `/legal/<key>` (apps/web/src/app/[locale]/preview/cms/[key]/page.tsx), and `/legal/<key>` only shows legal / help / page entries. The server itself says announcements have no public page (apps/api/src/modules/public-site/cms-public.service.ts, PUBLIC_TYPES).
- What we expected: per spec the signed 24 h link is for public pages only (03 PUB-03 :507, 12 :319 « unpublished 404 (+ signed preview for admins) »); the preview of an announcement is the « preview banner » (12 :306). So the action is not offered on announcements (and other types without a public page: e-mails, plan texts, system messages — not tested), or it opens the banner preview.
- Steps to reproduce: 1. Log in as super admin. 2. Admin > Content (CMS) > Announcements. 3. On any announcement, Actions > « Preview (signed link 24 h) ». 4. Open the link: it lands on `/fr/legal/<slug>` with a 404.

### UX-026 — Content (CMS): the announcement « Link » accepts any value; a wrong path is published and leads clients to a 404 — à arbitrer par le fondateur
- Screen: Admin > Content (CMS) > announcement editor, field « LINK »; client banner / public site « En savoir plus »
- Type: UX / Spec gap
- Severity: Minor
- Date found: 22/10/2026
- What happens: the link `/billing` was accepted, published, and « En savoir plus » leads to `/fr/billing`, a 404 (the billing page is `/settings/billing`). The field has no hint and no check. From the code (apps/web/src/features/announcements/links.ts), only an app path starting with « / » or an http(s) address is used; any other value is dropped silently and « En savoir plus » does not show (not tested live). The same link is used on the public site, where an app page does not work for a logged-out visitor. The specs only list `link?` (05-data-model.md:276): no purpose, format or rule.
- What we expected: the founder decides what the link is for and what it accepts (app path, external URL, or both; what a public-site visitor gets); then the editor shows a hint with an example and refuses a value that will not work, instead of publishing it.
- Steps to reproduce: 1. Admin > Content (CMS) > « + New entry », type Announcement, create. 2. In the editor set channels Banner + Public web, link `/billing`, publish. 3. Open the public site (logged out) or the client dashboard and click « En savoir plus »: 404.


### UX-027 — Specs: the announcement channel « Public web » exists in the app but is missing from the data model spec
- Screen: Admin > Content (CMS) > announcement editor, « CHANNELS » (« Public web »); public site, banner under the header
- Type: Spec / Process
- Severity: Minor
- Date found: 22/10/2026
- What happens: the announcement editor offers 5 channels: Banner, In-app, E-mail, Mobile push, Public web. The code accepts `banner, in_app, email, push, web` (packages/shared/src/schemas/admin.ts:644) since M10 (commit 0b9a603, 13/10). The data model spec still lists 4 channels for `CmsEntry.channels`: banner / in_app / email / push (05-data-model.md:276). The UX-005 fix (commit 6033cde, branch deploy/tester-fixes-2026-10-22) made « Public web » work (banner under the public site header, only for « All workspaces » announcements) and mentions it in 06-api.md:263 and docs/implementation/assumptions-log.md:710, but 05-data-model.md was not updated. Rule 7 of the work method: code and spec are updated in the same PR.
- What we expected: 05-data-model.md:276 lists the « web » channel with its rule (public site banner, only for announcements targeting « All workspaces »), so the spec matches the app.
- Steps to reproduce: 1. Open docs/specs/05-data-model.md:276 on branch deploy/tester-fixes-2026-10-22: channels banner / in_app / email / push. 2. Admin > Content (CMS) > open an announcement: the « CHANNELS » box also offers « Public web ».


### UX-028 — Credits & promos: editing a promo code moves its start date back one day on each « Save »
- Screen: Admin > Credits & promos > Promo codes > row Actions > « Edit ✎ » (`/en/admin/credits`)
- Type: Bug
- Severity: Major (the code becomes valid earlier than set, one more day at each save, without the admin changing anything)
- Date found: 22/10/2026
- What happens: the code « RETEST-20 » is created with validity 22/10/2026 → 29/10/2026; the list shows « 22 Oct → 29 Oct ». Opening « Edit ✎ » shows the start date as 21/10/2026 (end date correct, 29/10/2026). Clicking « Save » without changing anything saves the start as 21 Oct: on the test code « RETEST-CRED » the list went from « 22 Oct → 29 Oct » to « 21 Oct → 29 Oct » after one Save. Cause: the server stores a start date « 22/10 » as midnight Algiers time = 2026-10-21T23:00Z (apps/api/src/modules/admin-core/billing-admin.service.ts:705-708), and the Edit dialog fills the date field with the first 10 characters of that UTC value, « 2026-10-21 » (apps/web/src/features/admin/credits/parts.tsx:142). The end date is not affected because it is stored as 23:59:59 Algiers = 22:59Z, still the same day.
- What we expected: the Edit dialog shows the dates as they were entered (22/10/2026 → 29/10/2026), and saving without changes keeps them. Dates are read in Africa/Algiers time (04-business-rules.md:120 « Africa/Algiers for "today", periods … stored UTC »).
- Steps to reproduce: 1. Log in as super admin. 2. Admin > Credits & promos > « + Promo code », validity 22/10/2026 → 29/10/2026, « Create the code »: the list shows « 22 Oct → 29 Oct ». 3. Actions > « Edit ✎ »: the start date shows 21/10/2026. 4. Click « Save » without changes: the list shows « 21 Oct → 29 Oct ». 5. Repeat: the start goes back one more day each time.

Step 5 (« one more day each time ») follows from the code. On the live site I've only seen one Save, on RETEST-CRED. If you click « Save » twice on RETEST-20 and the start goes 22 → 21 → 20, that confirms it, and I keep the sentence. If not, I remove it.


### UX-029 — Plan & billing: « Pay 4 900 DA (CIB / Edahabia) » opens a raw NOT_FOUND error page; no plan can be paid on the live site
- Screen: Settings > Plan & billing > « Upgrade to Pro » / « Change plan » dialog > « Pay 4 900 DA (CIB / Edahabia) » (`/en/settings/billing`)
- Type: Bug (deployment configuration)
- Severity: Blocker (no subscription can be paid; blocks the retest of UX-011 step 3 and every payment flow)
- Date found: 22/10/2026
- What happens: as the Owner of « teest's shop » (Pro trial), the « Change plan » dialog (Pro trial → Pro, Monthly 4 900 DA) shows « Pay 4 900 DA (CIB / Edahabia) ». Clicking it opens `https://djaber.72-60-190-211.sslip.io/api/v1/dev-payments/01fakeea6c549a3ca241dfb093`, a raw JSON page: {"error":{"code":"NOT_FOUND","message":"Introuvable ou accès refusé.", …}}. The client is stuck on the API host with no way back to the app. Cause: the live API runs with NODE_ENV=staging, which the code treats as production (apps/api/src/core/config/config.service.ts:58-59), and no Chargily gateway is configured, so the default PAYMENT_DRIVER=fake is used (config.schema.ts:68). The fake gateway sends the browser to its simulator page /api/v1/dev-payments/:id (apps/api/src/modules/billing/gateway/gateway.provider.ts:18), but that page answers 404 in production / staging (apps/api/src/modules/billing/dev-billing.service.ts:44). Nothing stops the API from starting with the fake driver in staging / production (gateway.provider.ts only guards the real driver in development).
- What we expected: on the live test site, « Pay » opens a working checkout: Chargily in test mode (PAYMENT_DRIVER=chargily, CHARGILY_MODE=test), or the payment simulator if the founder wants it on this site. If no gateway is usable, the API refuses to start with the fake driver in staging / production, or the « Pay » button is replaced by a clear message in the app, instead of sending the client to a JSON error.
- Steps to reproduce: 1. Log in as the Owner of a workspace on trial (e.g. « teest's shop »). 2. Settings > Plan & billing > « Upgrade to Pro ». 3. In « Change plan », keep Monthly 4 900 DA and click « Pay 4 900 DA (CIB / Edahabia) ». 4. The browser opens …/api/v1/dev-payments/<id> with a NOT_FOUND JSON.


### UX-030 — Subscriptions & invoices: a partially paid invoice looks unpaid in the Invoices list; nothing shows the amount already received — à arbitrer par le fondateur
- Screen: Admin > Subscriptions & invoices > « Invoices » tab (`/en/admin/subscriptions?tab=invoices`)
- Type: UX
- Severity: Minor
- Date found: 22/10/2026
- What happens: invoice F-2026-00001 (« teest's shop », Renouvellement Pro — mensuel, 4 900 DA, UPCOMING) received a manual payment of 2 450 DA (CCP transfer, ref. CCP-RETEST-007-A); the « Manual payments » tab lists it. Back in the « Invoices » tab, the row still reads « 4 900 DA · UPCOMING »: no amount paid, no amount left, no « partial » badge. The admin has to open the « Manual payments » tab or start a new manual payment to learn that half is already paid. This follows the spec: `Invoice` has no paid-amount field and its statuses are upcoming / unpaid / paid / void / refunded (05-data-model.md:37); a partial manual payment leaves the invoice status unchanged and only returns the warning INVOICE_PARTIAL_PAYMENT {remaining} (04-business-rules.md:190, 06-api.md:197).
- What we expected: the founder decides whether the Invoices list (and the invoice detail) shows what was already received on an invoice, e.g. « 2 450 / 4 900 DA paid » or a « Partial » badge with the amount left, so a partly paid invoice is not mistaken for an unpaid one.
- Steps to reproduce: 1. Log in as super admin. 2. Admin > Subscriptions & invoices > « + Manual payment », pick a workspace with an open invoice (here F-2026-00001, 4 900 DA), « Continue ». 3. Enter an amount lower than the total (2 450 DA), a reference, a date, and save. 4. « Manual payments » tab: the 2 450 DA payment is listed. 5. « Invoices » tab: the invoice still shows « 4 900 DA · UPCOMING », with nothing about the 2 450 DA received.