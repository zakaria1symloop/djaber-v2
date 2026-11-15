# Area help — tested 15/11/2026 21:45–22:25 (Africa/Algiers)

Owner account, shop « Boutique Test Équipe », live https://djaber.vercel.app. Screens: /help, /help/contact, /help/tickets, /help/tickets/[id], « ? » contextual panel, guide reader (`?article=`).
Own test data: support ticket #T-2026-00012 « QA help ticket — test de la campagne QA du 15/11, merci de ne pas traiter… » (category Autre, 3 attachments, 1 reply with 1 attachment, then closed by me → FERMÉ). About 10 orphan uploads (kind ticket_attachment) were created by the attachment tests and never sent. Ticket #T-2026-00011 (« QA admin ticket », admin area) was only opened: its rating stars were clicked but « Envoyer la note » was never pressed.
No Blocker found. What works well: leave guards (contact form, reply), close confirm dialog (ESC / Annuler), guide reader (?article= deep link from any page, F5, Back, ESC), « ? » panel with page context and ?from= carried to the contact form, guide suggestion while typing, internal notes of support never shown to the merchant, fr / ar / en translated, no overflow at 390 px.

### HELP-01 — Help-centre search misses the examples of its own placeholder (« connecter Instagram », « bordereau ZR Express »)
- Page: /fr/help (owner, fr, 1440)
- Severity: Major
- Type: Bug
- Steps: 1. Open Aide. 2. Type the placeholder examples one by one in « Rechercher dans l'aide… ex. « connecter Instagram », « crédits », « bordereau ZR Express » ».
- Expected: « connecter Instagram » finds « Connecter une page Facebook ou Instagram » (HELP-01 search; 12 §25). Words are matched one by one, without accents (« credits » = « crédits »).
- Actual: « connecter Instagram » → « Aucun guide trouvé », while « Instagram » alone finds the guide. Also no result for « credits » (no accent), « facture », « livraison » (although a category is named « Commandes & livraison »), « retour », « mot de passe », « 2FA », « sheets », « bordereau ZR Express ». The search is one raw substring of the whole phrase.
- Likely cause: apps/api/src/modules/admin-ops/support/help.service.ts:54 — `` `${a.title} ${a.body}`.toLocaleLowerCase().includes(needle) `` (whole phrase, no word split, no accent folding).
- Evidence: API: GET /help/articles?q=connecter%20Instagram&lang=fr → 200 `[]`

### HELP-02 — The help centre has 8 one-sentence guides; the category cards promise topics that do not exist
- Page: /fr/help (owner, fr / ar / en)
- Severity: Major
- Type: Spec gap
- Steps: 1. Open Aide. 2. Click each of the 8 categories, open the guide.
- Expected: HELP-01 guides per category covering what the card announces (« CONNECTER UNE PAGE · PREMIER AGENT · PREMIER PRODUIT », « 2FA, MEMBRES, EXPORT, SUPPRESSION DE COMPTE », « COÛT PAR ACTION, PACKS, FACTURES, CIB » …).
- Actual: every card says « 1 GUIDE »; each guide body is the same single sentence as its excerpt (e.g. « Confirmer et expédier une commande » = 1 sentence, version 1 of 14/10). No guide for Google Sheets, couriers, invoices, password, 2FA, returns, etc. The « ? » panel shows « Aucun guide pour cette page » on /settings/integrations and /help, and the Inbox panel shows the AI-agent guide. A merchant cannot solve anything alone, so every question becomes a ticket.
- Evidence: API: GET /help/articles/help-orders-delivery?lang=fr → `body` == `excerpt`

### HELP-03 — Contact form lets 6 attachments through, then the server refuses with only « Vérifiez les champs. »
- Page: /fr/help/contact (owner, fr, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. Contact form, valid message. 2. « Joindre un fichier », select 6 PNG files at once. 3. Envoyer.
- Expected: the 6th file is refused at once with « 5 fichiers maximum » (TICKET_ATTACHMENTS_MAX = 5, `help.contact.attachments.max`), as the reply form of the ticket page does.
- Actual: the 6 files are uploaded (6 × `POST /uploads` → 201) and shown as 6 chips; Envoyer → `POST /support/tickets` → 422 `fields.attachments = validation.length` and the form shows only « Vérifiez les champs. », no word about the attachments.
- Likely cause: apps/web/src/features/help/contact-form.tsx:66 — the loop tests `files.length` (state captured before the loop) instead of a running count (fixed in attachments.tsx:26 but not here); `applyServerErrors` is called with fields `['category','priority','message']` only (contact-form.tsx:104), so `attachments` falls back to the generic text.
- Evidence: .local/qa/campaign/help/fr-create-6files.png · API: POST /support/tickets → 422

### HELP-04 — Arabic (RTL): the ticket title loses its number and Latin messages have their punctuation flipped
- Page: /ar/help/tickets/[id] (owner, ar, 390 and 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. Switch to ar. 2. Open ticket #T-2026-00012 (French subject and messages).
- Expected: the number « #T-2026-00012 » visible at the start of the title; user text shown in its own direction (`dir="auto"` / `<bdi>`, rule 7 « RTL-safe », `<Ltr>` for codes).
- Actual: at 390 px the title reads « …, merci de ne pas traiter. Te# » — the ellipsis eats the start (number and subject) and « # » jumps to the end. In the thread, « Deuxième ligne. » shows as « .Deuxième ligne » and « QA help réponse avec pièce jointe — ردّ تجريبي » is reordered.
- Evidence: .local/qa/campaign/help/ar-390_help_tickets_mine.png

### HELP-05 — Ticket attachments are public: anyone with the link opens them without signing in, cached for a year
- Page: /help/tickets/[id] attachment links (owner)
- Severity: Minor
- Type: Security
- Steps: 1. Copy the link of a ticket attachment. 2. `curl` it with no cookie / token.
- Expected: support screenshots (which may show customers' data) served through short signed links like the other private files (`private/` keys, `exp` + `sig`), as exports and labels are.
- Actual: `GET /api/v1/files/ws/<workspaceId>/ticket_attachment/<uuid>.webp` → 200 with no auth and `Cache-Control: public, max-age=31536000, immutable`. Only the random file name protects it.
- Likely cause: apps/api/src/core/storage/files.controller.ts:30 — only keys under `private/` require a signature, and ticket attachments are stored outside `private/`.
- Evidence: API: GET /files/ws/01a14f0d-…/ticket_attachment/2eaa9547-….webp (no auth) → 200

### HELP-06 — Ticket attachments are listed by their storage name (UUID.webp) instead of the file name
- Page: /fr/help/tickets/[id] (owner, fr; same after reply)
- Severity: Minor
- Type: Text
- Steps: 1. Create a ticket with « qa-help-1.png », « qa-help-export.csv », « qa-help-تقرير.png ». 2. Open the ticket.
- Expected: the chips show the names the merchant picked (no technical text, 12 §19 UX-059).
- Actual: « 87678f4e-07ad-494c-b2d6-6679e0e15523.webp », « 9deb1900-6769-468d-b946-444f94ac093d.csv », « 2091b5db-38da-43ab-b81b-d88c245813aa.webp ». Same for the reply attachment (« 2eaa9547-….webp »). PNG files also come back as WEBP.
- Evidence: .local/qa/campaign/help/fr-ticket-created.png

### HELP-07 — Auto-context message of a ticket shows raw English keys « workspace: / client: / page: »
- Page: /fr/help/tickets/[id] (owner, fr; ar / en the same)
- Severity: Minor
- Type: Text
- Steps: 1. Create a ticket from /help/contact?from=/orders. 2. Open it.
- Expected: the labels of the form (« Espace », « Navigateur », « Page ») in the user's language (12 §19, no raw key).
- Actual: the SYSTÈME message reads « workspace: Boutique Test Équipe / client: web Chrome 156 / page: /orders ».
- Evidence: .local/qa/campaign/help/fr-ticket-created.png

### HELP-08 — A resolved ticket sends a second « Réponse du support » notification although support wrote nothing
- Page: /fr/notifications (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. (admin area) reply then « Résoudre » on #T-2026-00011. 2. Merchant opens Notifications.
- Expected: one « Réponse du support » for the reply; the resolution says what happened (« Demande #T-2026-00011 résolue — donnez votre avis »), HELP-04.
- Actual: two identical rows « Réponse du support · #T-2026-00011 », the second one with key `support_reply:…:resolved:…` (empty body).
- Evidence: API: GET /notifications → 2 × `type: support_reply` for #T-2026-00011

### HELP-09 — Closing my own ticket never asks for the 1–5 satisfaction note
- Page: /fr/help/tickets/[id] › « Clore la demande » (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Open own open ticket #T-2026-00012. 2. « Clore la demande » → confirm.
- Expected: « satisfaction note 1–5 at close » (03 HELP-04; 12 §25 « Mes demandes … + satisfaction »).
- Actual: the ticket goes to FERMÉ with « Demande clôturée : ouvrez-en une nouvelle. · Nouvelle demande »; no rating is offered (the stars only appear when support resolves a ticket, `canRate` = status `resolved`). The confirm dialog, ESC and « Annuler » work.
- Evidence: API: POST /support/tickets/01a1e0fe-…/close → 200 `status: closed`, `satisfaction: null`

### HELP-10 — A malformed ticket address shows « Impossible de charger · Requête invalide · Réessayer » instead of « Introuvable »
- Page: /fr/help/tickets/not-a-uuid (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /fr/help/tickets/not-a-uuid (or a truncated link).
- Expected: the 404 state (« Introuvable … Retour »), as for an unknown UUID.
- Actual: « Impossible de charger · Requête invalide. · Réessayer » — the retry can never work.
- Evidence: API: GET /support/tickets/not-a-uuid → 400 BAD_REQUEST

### HELP-11 — A wrong status in the « Mes demandes » URL breaks the list (« STATUT : BOGUS » + « Vérifiez les champs. »)
- Page: /fr/help/tickets?status=bogus (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /fr/help/tickets?status=bogus (old or hand-edited link).
- Expected: unknown values are dropped from the URL state (as the categories of /help do with `?category=hacker`).
- Actual: chip « STATUT : BOGUS » and the error « Impossible de charger · Vérifiez les champs. · Réessayer ».
- Evidence: API: GET /support/tickets?…&status=bogus → 422 `fields.status.0`

### HELP-12 — Attachment rules disagree: hint « captures, CSV », error « (jpg, png, webp, gif) », and a .txt file is accepted
- Page: /fr/help/contact (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Attach « qa-help-notes.txt » (via the file dialog « Tous les fichiers »). 2. Attach a fake PNG.
- Expected: one rule everywhere (HELP-03 « screenshots, CSV »).
- Actual: the .txt is uploaded (201) and shown as a chip; the fake PNG gives « Format non supporté (jpg, png, webp, gif). » although GIF is not offered by the picker and CSV is allowed.
- Evidence: .local/qa/campaign/help/fr-contact-attach-errors.png · API: POST /uploads (txt) → 201, (fake png) → 415 IMAGE_TYPE_INVALID

### HELP-13 — Small texts and details of the help screens
- Page: /fr/help, /fr/help/contact, /fr/help/tickets, /fr/help/tickets/[id] (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps / Actual:
  1. /help/tickets?status=pending_customer → « Aucun(e) demande ne correspond à « Statut : EN ATTENTE CLIENT ». » (same generic « Aucun(e) » as PRODUCTS-13 / ORDERS-18 / CLIENTS-07; here « Aucune demande »).
  2. /help?article=does-not-exist → guide sheet titled « Guide » with « Introuvable · Cet élément n'existe pas ou appartient à un autre espace. » — guides are shared by every shop, « appartient à un autre espace » makes no sense here (« Ce guide n'existe plus »).
  3. /help/contact shows the title « Contacter le support » twice (page title and card title right under it).
  4. The ticket page title and the list rows cut the subject at « … merci de ne pas traiter. Te… » (subject = first 80 characters of the message, cut in the middle of a word, no way to read the full subject in the header).
  5. Satisfaction stars (resolved ticket): 5 radios « 1 étoile … 5 étoiles », but ← / → do nothing (radio group without arrow keys).
  6. Search with a category selected: the results title shows only the category name (« Pages & Instagram »), not the typed words, although both are applied (`?category=pages_instagram&q=meta`).
- Expected: finished sentences, no generic « (e) », 12 §19.
- Evidence: .local/qa/campaign/help/fr-tickets-filtered-empty.png · fr-article-unknown.png · fr-resolved-rate-ui.png

## Coverage
| Screen / flow | What was tested | fr | ar | en | 390 px |
|---|---|---|---|---|---|
| /help hub | header pill « TOUS LES SERVICES OPÉRATIONNELS », « Bien démarrer » (= category Démarrer), 8 category cards (select, toggle off, counts), search (placeholder examples, 1 char, accents, Arabic, `<script>`, %, no match → « Contacter le support »), category + search, « Effacer les filtres », F5 keeps `?q=` / `?category=`, invalid `?category=` ignored, « Mes demandes » card (3 latest, Voir tout), « État du service » card + « Page de statut publique » link | ✓ | ✓ | ✓ | ✓ fr / ar |
| Guide reader `?article=` | open from results / panel / suggestion, F5, ESC, close button, Back, unknown key (404 state), deep link on /orders | ✓ | ✓ | ✓ | ✓ |
| « ? » contextual panel | /home, /orders, /products, /inbox, /settings/integrations, /agents, /delivery, /stock, /help (context key, empty state, guide opens, « Contacter le support » carries `?from=`) | ✓ | — | — | button present |
| /help/contact | categories (10, default Intégrations), priority, empty / 19 chars / spaces / 5001 chars, guide suggestion (fr, Arabic), attachments (> 5 Mo, .txt, fake PNG, 6 files, Arabic file name, CSV, remove chip), editable context (cleared « plan » is left out), leave guard (Rester), 422 from the server, double-click submit (1 request), success → ticket page | ✓ | ✓ | ✓ | ✓ fr / ar |
| /help/tickets | Mes demandes / Toutes les demandes de l'espace, Statut filter (Fermé), chip, F5 keeps filters, filtered empty, invalid status / page 99, « Nouvelle demande », pagination footer | ✓ | ✓ | ✓ | ✓ fr / ar |
| /help/tickets/[id] (own) | thread, attachments links, empty / spaces reply, maxlength 5000, leave guard, reply with Arabic + emoji + attachment, Clore la demande (ESC, Annuler, then confirmed) → FERMÉ banner + Nouvelle demande, F5, unknown UUID (404), malformed id | ✓ | ✓ | ✓ | ✓ fr / ar |
| Resolved ticket (#11, admin area data) | RÉSOLU pill, support author « (SUPPORT) », internal note not visible, rating panel (stars, button disabled until a star, keyboard) — not submitted | ✓ | — | — | — |
| Notifications | `support_reply` rows and deep link to the ticket | ✓ | — | — | — |

Kit log: no console error, failed call or text leak on the help screens apart from the expected 4xx of the negative tests (422 / 404 / 400 / 415) — the only leak flagged (« cas_001 ») is a product SKU on /products behind the « ? » panel, not in this area.

## Blocked by safety
- None: no call of the help screens is on the kit's block list.

## Not tested
- Sending a satisfaction note: the only resolved ticket (#T-2026-00011) belongs to the admin area, and support-side actions (reply / resolve) are admin writes blocked for this run, so my own ticket could never reach « résolu ». The « RÉPONSE REÇUE » and « EN ATTENTE CLIENT » pills could not be produced for the same reason.
- Operator view (no « Facturation » category, own tickets only, 403 on `scope=workspace`): belongs to the roles area.
- Rate limit of ticket creation and live WS `ticket.updated` refresh (needs a support reply).
- Incident state of the status widget (no incident can be declared: admin write).
- Mobile WebView help (HELP-06): web only.
