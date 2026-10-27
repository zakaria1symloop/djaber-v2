# Djaber ai — UX / UI test log — 26/10/2026



UX-032 — Admin AI providers: an AI model cannot be deleted from the screen, and the delete rules are not in the specs

- Screen: Super Admin › « AI providers » (/admin/ai) › provider card › model › model dialog
- Type: Missing feature + spec gap
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - After a model is added with « + Model », it can't be removed. The model dialog only has « Cancel » and « Save », and there is no delete action anywhere on the page.
  - The only way out is to set « STATE » to « Inactive ». The model then stays on the provider card forever, even when it was added by mistake.
  - Example: we added « Llama 3.3 70B (Groq) ». « Test the keys » then said: « Models this provider does not know with this key: llama-3.3-70b-versatile ». The model can't be removed.
  - The server already has the delete (DELETE /admin/ai-models/:id, ai-admin.service.ts:220-229), with rules written only in the code:
    - The delete is refused while the model is used in a route, with CONFLICT reason MODEL_ROUTED. That code is not in 11-error-catalogue.md.
    - A model that has already answered clients is switched off, not deleted.
    - Otherwise the model is deleted.
  - The web page never calls it: apps/web/src/features/admin/ai/dialogs.tsx:147-148 only creates (POST) and edits (PATCH).
- What we expected:
  - The specs announce « CRUD /admin/ai-models » (06-api.md:199, 02-next-route-map.md:163), so the Super Admin should be able to delete a model from the screen. For example, a « Delete » button in the model dialog with a confirmation.
  - The specs should describe the delete rules (12-screen-states.md:304 only says « model dialog »), as rule 10 requires:
    - refused while the model is used in a route, with a clear message in FR, AR and EN;
    - switched off instead of deleted when the model has already been used;
    - deleted when the model was never used.
  - The new error code should be added to 11-error-catalogue.md.
- Steps to reproduce:
  a. Log in as Super Admin and open « AI providers ».
  b. Click « + Model », add any text model on Groq (e.g. llama-3.3-70b-versatile), and « Save ».
  c. On the Groq card, click the new model.
  d. Look for a way to delete it: the dialog only has « Cancel » and « Save », and the page has no delete action.



UX-034 — Moderation: banned-word variants should be rejected automatically, every new variant should wait for review (à arbitrer par le fondateur)

- Screen: Client › Products › product › Variants · Super Admin › « Product moderation »
- Type: Change request (business rule), à arbitrer par le fondateur
- Severity: Minor
- Date found: 26/10/2026
- What happens: (shop « teest's shop », trust level « STANDARD »)
  - A variant whose name contains a banned word sends the product to the human queue. Example: « Gourde isotherme en inox », AI flag « Banned word (drug) », score 0.45. The Super Admin then has to open it and reject it by hand, although the platform already knows the word is banned.
  - A variant with no banned word is approved at once, with no review by the Super Admin (AI score ≥ 0.9 + standard merchant).
  - Both follow the current spec, 04-business-rules.md §12: the « Pre-screen » rule only flags a banned word, and the « Auto-approval » rule approves at once.
- What we expected: (proposal)
  - A variant, or product, whose text contains a platform banned word is rejected automatically, with the reason given to the merchant. It doesn't go into the human queue, since there is nothing left for the Super Admin to decide.
  - A variant without a banned word appears in « Product moderation » and waits for Super Admin approval.
  - If accepted, 04 §12 (« Pre-screen », « Auto-approval ») and D36 should be updated in the same PR (rule 7). The decision should also say whether the second point applies to all trust levels or only to « Nouveau » (which already sends everything to review).
- Steps to reproduce:
  a. Super Admin: check the trust level of the test shop (Moderation shows « TRUST: STANDARD »).
  b. Client: open an approved product › add a variant whose name contains a banned word (e.g. « drug »), then « Enregistrer ».
  c. Super Admin › « Product moderation »: the product waits in « To review » with « AI: Banned word ». It isn't rejected.
  d. Client: add a variant without a banned word, then « Enregistrer ».
  e. Super Admin › « Product moderation »: nothing waits. The variant was approved automatically.


  UX-035 — Content (CMS): announcements have no « Preview » in their « Actions » menu any more (à arbitrer par le fondateur)

- Screen: Super Admin › « Content (CMS) » › « Announcements » tab › row « Actions »
- Type: Change request (UX), à arbitrer par le fondateur
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - Since the UX-025 fix (df0b5da), the « Actions » menu of an announcement only offers « Edit · Publish · Schedule · Unpublish · Translate with AI from FR · Version history ». The fix removed « Preview (signed link 24 h) » instead of making it work for announcements.
  - Checked on all 5 announcements (« hello », « test », « Retest UX-005 : nouvelle facturation », « testte », « annonce : »).
  - The only preview left is « Banner preview », inside the editor (Actions › « Edit »). The Super Admin can't see from the list how the announcement looks to clients.
  - The server now refuses the link for announcements: cms.service.ts:21 keeps it for legal / help / page only.
  - The « + New entry » dialog still says « Unpublished = 404 publicly; preview via a signed 24 h link. » for every type, including « Announcement » (admin/cms/page.tsx:159, key admin.cms.dialog.note).
- What we expected:
  - Every announcement row has a « Preview » action in « Actions ». It shows the announcement as clients will see it (banner, notification and public site entry, with its « En savoir plus » button), without opening the editor.
  - The « + New entry » note only mentions the signed link for the types that have one.
- Steps to reproduce:
  a. Super Admin › « Content (CMS) » › « Announcements ».
  b. Click « Actions » on any announcement: there is no « Preview ».
  c. Click « + New entry », keep TYPE « Announcement »: the note still promises « a signed 24 h link ».

---

UX-036 — Content (CMS): the announcement « Link » should be a searchable list of pages, not free text (à arbitrer par le fondateur)

- Screen: Super Admin › « Content (CMS) » › announcement › editor › « Link » field
- Type: Change request (UX), à arbitrer par le fondateur
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - « Link » is a free text field. The Super Admin has to know and type the exact address (e.g. /settings/billing). The hint only gives three examples: « A Djaber page (/settings/billing, /orders, /pricing…) or an https://… address ».
  - Since the UX-026 fix, a wrong address is refused (« Invalid link… »), but the Super Admin still has to guess which addresses exist.
  - The accepted list in the code (packages/shared/src/schemas/admin.ts:643-645) isn't shown anywhere on the screen.
  - The list also contains pages that aren't in the client sidebar, such as /queue, /categories, /inventory and /movements.
  - This rule is a developer assumption (assumptions-log.md:734); no spec defines it.
- What we expected:
  - « Link » is a drop-down with autocomplete search (type « fact… » → « Plan & billing »).
  - It lists, by readable name:
    - the pages of the public website (Home, Pricing, Features, Help center, legal pages, Status);
    - the client dashboard sidebar items only: one entry per menu item, e.g. « Products » → /products. Sub-pages like /products/new or /products/<id> are not listed, so the Super Admin doesn't get lost.
  - Optionally, an « External address (https://…) » choice for an outside link.
  - The spec should record the chosen list (rule 10).
- Steps to reproduce:
  a. Super Admin › « Content (CMS) » › « Announcements » › Actions › « Edit ».
  b. Look at the « Link » field (bottom right): free text, no list of pages, no search.

---

UX-037 — Content (CMS): the announcement « End » date can be set before the « Start » date

- Screen: Super Admin › « Content (CMS) » › announcement › editor › « Start » / « End » date pickers
- Type: Bug (form validation)
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - In the date pickers, the Super Admin can choose an « End » date and time that is before the « Start » date. The « End » picker has no lower limit (apps/web/src/features/admin/cms/editor.tsx:159, datetime-local without min).
  - The screen doesn't warn when the date is picked.
  - The server refuses it only when saving: cms.service.ts:127 returns VALIDATION_ERROR with endsAt: validation.range.
  - Not checked live: which message the editor shows at that moment.
- What we expected:
  - In the « End » picker, days and times before the « Start » date are greyed out and can't be chosen (min = start date).
  - If the « Start » date is moved after the « End » date, an inline error shows under « End » right away, before saving.
- Steps to reproduce:
  a. Super Admin › « Content (CMS) » › « Announcements » › Actions › « Edit ».
  b. Set « Start » to 30/10/2026 10:00.
  c. Open the « End » picker: 29/10/2026 and earlier days can be chosen. Choose 29/10/2026 10:00.
  d. No error is shown until « Save the draft » or « Publish ».

---

UX-038 — AI chatbot: products and variants still pending in moderation are sometimes offered to customers, sometimes not

- Screen: Messenger conversation with the shop's AI agent · Super Admin › « Product moderation »
- Type: Bug (AI / moderation)
- Severity: Major (content not approved by the Super Admin reaches customers)
- Date found: 26/10/2026
- What happens:
  - While a new product or a new variant is still waiting in « Product moderation » (not approved yet), the chatbot is not consistent:
    - sometimes it doesn't offer it, as expected;
    - other times, in the same kind of conversation, it offers it to the customer.
  - The result changes from one attempt to the next, so the moderation rule can't be trusted. A product the Super Admin hasn't checked yet can reach customers.
- What we expected:
  - As long as a new product or a new variant is waiting in moderation, the chatbot never offers it, in its replies, product cards or search, whatever the wording of the question. Only the approved products and variants are offered.
  - After the Super Admin approves it, the chatbot offers it every time.
- Steps to reproduce:
  a. Super Admin: set the shop's trust level to « Nouveau », so nothing is approved automatically.
  b. Client: add a new variant to an approved product, and create a brand-new product. Both wait in « Product moderation ».
  c. As a customer on Messenger: ask several times for the new variant and the new product, with different wordings and in new conversations.
  d. Some answers don't mention them, others offer them.


  UX-039 — Products: a picture added with « + Add » or in « Edit » then « Cancel » stays on the product and never goes to moderation

- Screen: Client › Products › product page (e.g. https://djaber.vercel.app/en/products/01a17890-6e0d-7e28-936e-88fcbf0c1264) › pictures « + Add » · « Edit » (product form) · Super Admin › « Product moderation »
- Type: Bug (moderation)
- Severity: Major (a new picture skips the Super Admin's review)
- Date found: 26/10/2026
- What happens: on an approved product, a picture is saved to the product as soon as it's chosen, in both places. Only one path sends it to moderation:
  - Product page, « + Add »: the picture is added at once, with no « Save » button. No moderation request is created, so the Super Admin never sees it.
  - « Edit », add a picture, then « Cancel »: the picture is kept anyway (it's still on the product after « Cancel »), and no moderation request is created.
  - « Edit », add a picture, then « Save »: this is the only case where the product goes to « Product moderation » with the new picture.
  - So a merchant can add any picture to an approved product without review, just by using « + Add » or by clicking « Cancel » instead of « Save ».
- What we expected:
  - Every picture added to a product goes to « Product moderation », whatever the way it was added.
  - In « Edit », a picture is only kept when « Save » is clicked. « Cancel » discards it.
  - « + Add » on the product page also sends the product to moderation (or works like « Edit », with a save step).
  - Until the Super Admin approves it, the new picture is clearly marked as waiting for validation.
- Steps to reproduce:
  a. Client: open an approved product page (e.g. the link above).
  b. Click « + Add » in the pictures area and choose a picture: it's added at once.
  c. Super Admin › « Product moderation »: the product isn't there.
  d. Client: on the same product, click « Edit », add another picture, then click « Cancel ».
  e. Reopen the product: the picture from step 4 is still there. « Product moderation » still has nothing.
  f. Client: « Edit », add a picture, then « Save »: only now does the product appear in « Product moderation ».

  UX-040 — Admin Workspaces: « Remove credits » doesn't tell the client (no notification, no e-mail) (à arbitrer par le fondateur)

- Screen: Super Admin › « Workspaces » › row « Actions » › « Remove credits » · Client › bell (notifications) and owner mailbox
- Type: Change request (notifications), à arbitrer par le fondateur
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - When the Super Admin removes credits from a workspace (« Remove credits », with a reason), the credits are removed, but the client isn't told:
    - no notification in the client's bell;
    - no e-mail to the owner.
  - The only trace on the client side is an « Ajustement » line in Settings › Credits history, which the client only sees by opening that page.
  - « Add credits » does tell the client (notification + e-mail), so the client is warned when credits arrive but not when they're taken away.
- What we expected:
  - When credits are removed, the client gets a notification in the bell and an e-mail to the owner, for example « 500 crédits retirés par Djaber », with the reason given by the Super Admin and a link to the Credits history.
  - The rule should be written in the specs (rule 10).
- Steps to reproduce:
  a. Super Admin › « Workspaces » › Actions › « Remove credits »: 500 credits, reason of 10+ characters, then confirm.
  b. Client (owner of that workspace): open the bell, so there's no notification.
  c. Owner mailbox: no e-mail.
  d. Client › Settings › Credits: only an « Ajustement » line shows the removal.


  UX-041 — Admin Workspaces: the « Status » filter has no matching column in the list (à arbitrer par le fondateur)

- Screen: Super Admin › « Workspaces » (https://djaber.vercel.app/en/admin/workspaces)
- Type: UX (list consistency), à arbitrer par le fondateur
- Severity: Minor
- Date found: 26/10/2026
- What happens:
  - The « Status » filter works. It filters the workspaces by « ACTIVE », « SUSPENDED » or « DELETION D+30 ».
  - But no column of the list shows that status. The columns are « WORKSPACE · OWNER · PLAN · SUBSCRIPTION · CREDITS (MONTH) · PAGES · ORDERS · 30 D · CREATED ».
  - An active workspace shows its status nowhere.
  - A suspended workspace, or one waiting for deletion, only gets an extra pill mixed into the « SUBSCRIPTION » column, next to the subscription state (« TRIAL », « ACTIVE », « DUNNING »…). So two different things share one column.
  - After filtering, the Super Admin can't see on each row why it matches the filter.
- What we expected:
  - A « Status » column showing the workspace status of every row (« Active », « Suspended », « Deletion D+30 »), next to the « Subscription » column, which keeps only the subscription state.
  - Each filter of the list has a column that shows its value.
- Steps to reproduce:
  a. Super Admin › « Workspaces ».
  b. Open the « Status » filter and pick « ACTIVE » (or « SUSPENDED »): the list is filtered.
  c. Look at the columns: there is no « Status » column showing the value used by the filter.