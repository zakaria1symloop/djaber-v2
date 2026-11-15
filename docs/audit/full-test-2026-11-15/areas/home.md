# Area home — tested 15/11/2026 19:20–19:55 (Africa/Algiers)

Owner account, shop « Boutique Test Équipe », live https://djaber.vercel.app. Screens: /home, /queue, /notifications.
Own test data: product « QA home rupture » (SKU PRD-CGJ89E3Z, 1 000 DA, stock 3, seuil 1). Its stock went 3 → 0 → 3 through « Ajuster le stock » (motif Correction, note « QA home »), which raised one « Rupture : QA home rupture » notification (opened, so now read).
Pre-existing insights and notifications were never submitted. The submit paths of the queue (« Ajouter aux instructions » / FAQ, « Ignorer », « Me l'assigner », « Reprendre l'IA ») and « Tout marquer comme lu » ran against responses faked in the browser (500 / 409 / 422), so nothing reached the server. No Blocker or Major bug found.

### HOME-01 — Queue says « Tout est calme » when the insights request fails, hiding the 21 open problems
- Page: /fr/queue (owner, fr, 1440)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /queue while `GET /agent-insights?status=pending` answers 500 (I faked it in the browser; the conversations call works and returns 0).
- Expected: the GLOBAL error state for the « PROBLÈMES SIGNALÉS » column (« Impossible de charger … Réessayer »), never the empty state (12 §4 Queue: [S] · [E] · list; rule 7 error state).
- Actual: the page shows the empty state « Tout est calme · Aucune conversation n'attend un humain. Les insights apparaissent ici. », and the summary reads « aucun problème signalé par les agents ». The merchant is told there is nothing to do while 21 insights are pending. The opposite case works: a 500 on the conversations call shows « Impossible de charger … (ref. qa-conv) · Réessayer ».
- Likely cause: apps/web/src/features/queue/queue-view.tsx:124 — the empty-state check `rows.length === 0 && problems.length === 0` ignores `insights.isError` (the query also has `retry: false`).
- Evidence: .local/qa/campaign/home/fr-04-queue-insights500-calm.png · API: GET /agent-insights?status=pending&pageSize=25 → 500 (faked)

### HOME-02 — Queue insight card prints the raw cause « malformed_output:no_json »
- Page: /fr/queue › PROBLÈMES SIGNALÉS (owner, fr / ar / en, 1440 and 390)
- Severity: Minor
- Type: Text
- Steps: 1. Open /queue. 2. Scroll to the last card « ERREUR IA · pedro · Test dsqezadsq · IL Y A 27 J · « what products dovu have » ».
- Expected: the cause in words, never a code (UX-059, 12 §19 « never the code »).
- Actual: the line under the quote reads « malformed_output:no_json » in all three languages. The other ERREUR IA cards show « erreur de l'IA ». This is the same root cause as AGENTS-14 (Insights « Ignorés » tab), seen here on the queue.
- Likely cause: apps/web/src/features/agents/insight-detail.ts:16 — a `code:detail` value is treated as free text and shown as the server wrote it.
- Evidence: .local/qa/campaign/home/fr-02-queue-malformed.png

### HOME-03 — AI-order notifications read « Nouvelle commande #CMD-1014 · 12 900 DA DA »
- Page: /fr/notifications?group=orders (owner, fr; same in the bell, push and e-mail titles that use the same template)
- Severity: Minor
- Type: Text
- Steps: 1. Notifications › chip « Commandes IA ».
- Expected: « Nouvelle commande #CMD-1014 · 12 900 DA ».
- Actual: every `order_ai_created` row ends with « DA DA » (#CMD-1013 « 1 600 DA DA », …). The stored `data.total` is already « 12 900 DA », and the template adds « DA » again.
- Likely cause: apps/api/src/modules/orders/order.service.ts:398 (`total: formatMoney(order.total)`) and packages/shared/src/i18n/messages/deck.fr.json:581 (`… · {total} DA`), same in ar / en.
- Evidence: .local/qa/campaign/home/fr-03-notif-dada-serveur.png · API: GET /notifications?group=orders → `title: "Nouvelle commande #CMD-1014 · 12 900 DA DA"`

### HOME-04 — Notifications header shows a design note: « 103 non lues · comptage serveur »
- Page: /fr/notifications (owner, fr / ar « عدّ الخادم » / en « server count »)
- Severity: Minor
- Type: Text
- Steps: 1. Open Notifications and read the line under the title.
- Expected: « 103 non lues ». « Server count » is the developer note of NTF-01 / AT-NTF-03 (« unread count equals server count »). It should not appear on screen (12 §19: developer annotations are never shown).
- Actual: « 103 non lues · comptage serveur ».
- Likely cause: packages/shared/src/i18n/messages/deck.fr.json:609 `notification.unreadServer` (same key in ar / en).
- Evidence: .local/qa/campaign/home/fr-03-notif-dada-serveur.png

### HOME-05 — Notification family chips have no counts
- Page: /fr/notifications (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Open Notifications and look at the chips Commandes IA … Tâches.
- Expected: « family tabs with counts » (12 §18) and « family tabs counts equal server counts » (AT-ST-04).
- Actual: only « Non lues 103 » has a number. The 11 family chips (Commandes IA, À traiter, Problèmes IA, Stock, Colis, Paiements, Pages, Crédits & plan, Membres, Intégrations, Tâches) show none, so « Paiements » (0 rows) looks the same as « Tâches » (100+ rows).
- Evidence: .local/qa/campaign/home/fr-03-notif-dada-serveur.png

### HOME-06 — Home never shows a « fait par … » handled card (full queue; stock is never « handled »)
- Page: /fr/home › À TRAITER (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Product « QA home rupture » stock 3 → 0 (« Ajuster le stock », Définir 0). The home total goes 32 → 33 and « + 4 alertes stock » appears (live through WS, good). 2. Set the stock back to 3. 3. Watch Home, then reload.
- Expected: 12 §18 « À faire card types COLIS / STOCK / PAGE / INSIGHT / CONVERSATION / RAPPEL / TÂCHE (Waiting / Handled greyed 24 h "fait par …") », AT-ST-04 « handled card greyed 24 h with actor ».
- Actual: the card just disappears (total 33 → 32), and `GET /dashboard/home` returns no `handled` item. The server adds handled cards only into free slots (`room > 0`), so a shop with 8 or more open cards (this one has 32) never sees any handled card. Stock replenishment is also not one of the handled kinds (insight, callback, parcel, conversation only).
- Likely cause: apps/api/src/modules/dashboard/home.service.ts:88 (`room > 0`) and the `handled()` list just below it.
- Evidence: API: GET /dashboard/home → `queue.items` has no `handled`, `total: 32` after the replenishment.

### HOME-07 — Queue lists at most 25 insights and has no way to see the rest
- Page: /fr/queue (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /queue. The list call is `GET /agent-insights?status=pending&pageSize=25`. 2. With `meta.total` answered as 40 (faked in the browser; the shop has 21 today), the heading and summary say « 40 problèmes signalés ».
- Expected: every pending insight can be reached from the queue (12 §4 « list = needs-human conversations + pending insights; badge = their sum »): a « Charger plus » button or a link to the full list.
- Actual: at most 25 cards. There is no pagination, no « Charger plus » and no link to the agents' Insights tabs, even though the heading counts all of them. The shop already has 21 pending, so 5 more will reach the limit. The needs-human column is also capped at `limit: 50` with no « more » control.
- Likely cause: apps/web/src/features/queue/api.ts:16 (`pageSize: 25`, no cursor) and api.ts:10 (`limit: 50`).
- Evidence: API: GET /agent-insights?status=pending&pageSize=25 → `meta.total` 21 today (faked 40 → still one page, no control)

### HOME-08 — An overdue callback card says « Rappeler à 15:29 » without the date
- Page: /fr/home › À TRAITER, card RAPPEL « CMD-1005 · Houssem H » (owner, fr / ar / en)
- Severity: Minor
- Type: UX
- Steps: 1. Open Home and read the RAPPEL card.
- Expected: an overdue callback shows its day, for example « Rappel prévu le 22 oct. à 15:29 » or « En retard depuis le 22 oct. », because the time alone reads as « today 15:29 ».
- Actual: « RAPPEL · IL Y A 24 J · CMD-1005 · Houssem H · Rappeler à 15:29 ». The callback was due on 22/10 at 15:29 (`subtitle: 2026-10-22T14:29:00.000Z`). The card links to /orders/…#calls, and the « APPELS » block is scrolled into view (OK).
- Likely cause: apps/web/src/features/home/logic.ts:75 — only the time (`clock`) is shown, whatever the day.
- Evidence: .local/qa/campaign/home/fr-01-callback-card.png

### HOME-09 — « Nom d'agent validé : Amel » is filed under the family « PROBLÈME IA »
- Page: /fr/notifications (owner, fr / ar « مشكلة الذكاء الاصطناعي » / en « AI ISSUE »)
- Severity: Minor
- Type: UX
- Steps: 1. Open Notifications and find « Nom d'agent validé : Amel · Vos clients voient désormais ce nom. ». 2. Chip « Problèmes IA ».
- Expected: a positive moderation result is not labelled as a problem. It belongs with « Produits validés » (family MODÉRATION) or gets a neutral label.
- Actual: red-family pill « PROBLÈME IA », and the row is listed under the chip « Problèmes IA » between the « Nouvel insight » rows. The approved / rejected products are in family « MODÉRATION », which has no chip of its own (reachable only through « Types »).
- Evidence: API: GET /notifications → `{ type: "agent_name_approved", group: "ai" }`

### HOME-10 — Notification plurals: « 1 produits validés aujourd'hui », « Import terminé : 1 produits importés »
- Page: /fr/notifications (owner, fr and en « 1 products imported »)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Open Notifications and scroll to the MODÉRATION and TÂCHE rows.
- Expected: « 1 produit validé aujourd'hui », « 1 produit importé ».
- Actual: « 1 produits validés aujourd'hui » (twice), « Import terminé : 1 produits importés, 2 lignes ignorées ».
- Likely cause: deck.fr.json:588 `notification.product.approved.title` and :573 `notification.job.finished.import.title` have no plural form.

### HOME-11 — Chip « Toutes » does not clear « Non lues »
- Page: /fr/notifications?group=stock&unread=1 (owner, fr)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Click « Stock », then « Non lues ». 2. Click « Toutes ».
- Expected: « Toutes » shows every notification (the chip is drawn as the active « all » state).
- Actual: URL `?unread=1`, list still unread only. « Toutes » has `aria-pressed=true` but is not drawn white, and « Non lues » stays on. Two chips are « pressed » at the same time.
- Likely cause: apps/web/src/features/notifications/notifications-view.tsx:135 (`withGroup(filter, null)` keeps `unread`).

### HOME-12 — Small texts on the À TRAITER cards (negative stock, age formats)
- Page: /home, /queue (owner, fr / ar / en)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Read the STOCK card « casquette ». 2. Compare the age labels of Home and Queue in ar and en.
- Expected: one wording per screen family. A negative stock written in words (for example « Stock −6 (6 en attente de réassort) ») rather than « -6 restants ».
- Actual: « casquette · -6 restants (seuil 0) » (« متبقٍّ -6 », « -6 left »). Home ages read « منذ 26 ي » (abbreviated day, unclear) and « 26 D AGO », while Queue reads « قبل 20 يومًا » and « 20D AGO ».

### HOME-13 — Announcement deep link with a malformed id shows « Impossible de charger · Requête invalide · Réessayer »
- Page: /fr/notifications?announcement=abc (owner, fr)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open /notifications?announcement=abc.
- Expected: the « Introuvable » state, as for an unknown UUID (`…=00000000-…` correctly shows « Introuvable · Cet élément n'existe pas … »).
- Actual: dialog « Annonce · Impossible de charger · Requête invalide. · Réessayer · Fermer ». Retrying can never succeed. This is the same pattern as CLIENTS-11 and ORDERS-20.
- Evidence: API: GET /announcements/abc → 400 BAD_REQUEST

## Coverage
- **Home /home** (fr, ar, en at 1440; fr and ar at 390): greeting, date, part of day; À TRAITER (8 cards, sort urgency then age, « + 3 alertes stock » → /products?lowStock=1 listing the same 10 products, « + 21 insights » → /queue; each STOCK card link; RAPPEL card → /orders/…#calls scrolled to APPELS); a new stock-out of my product added a card live (WS, total 32 → 33 → 32 without reload); KPI tiles cross-checked with /products (41 products, 10 low stock, stock value 834 488 DA at cost) and with /channels (0 active of 3); revenue sub-line « 2 commandes livrées · 10 ventes » (UX-063 OK); the 3 quick actions (/channels, /products/new, /agents); VOS PAGES empty state + « Connecter Facebook »; DÉMARRER 2 / 4 and the 4 step links (agent step stays open because no active agent is linked to an active page — matches the rule); back button and F5; skeleton (shown with a slow API), error state with ref + Réessayer (500 faked), network error, offline banner. No horizontal scroll at 390, RTL mirrored in ar. No console errors and no technical text on /home itself.
- **Queue /queue** (fr, ar, en at 1440; fr at 390): summary line, « Régler le rappel » → /settings/workspace; 21 insight cards; « Ouvrir la conversation » → /inbox/:id; dialog « Résoudre l'insight »: radio Instruction / FAQ / Ignorer, empty and whitespace submit (« Champ requis », no request), 500-character limit, Arabic + emoji text, server 500 (inline error, text kept), 422 with fields, FAQ empty fields, ESC, Annuler, reopen resets the field. « Ignorer »: 409 INSIGHT_ALREADY_RESOLVED toast « Déjà traité. », 500 toast. A needs-human conversation card was injected into the response (the shop has none): label « DEMANDE HUMAIN », preview, « Non assignée », « Me l'assigner » / « Reprendre l'IA » with 409 → « Conversation déjà traitée par un collègue — liste actualisée. », « Répondre » → /inbox/:id. Empty state « Tout est calme », conversations 500 → error state, insights 500 (HOME-01), 40 insights (HOME-07).
- **Notifications /notifications** (fr, ar, en at 1440; fr at 390): every family chip (URL `group=`, toggle off, filtered-empty « Paiements »), Non lues (URL `unread=1`), combination + F5 keeps the filters, back; Types dropdown (57 types; with a group only that family's types), search « zzzz » → « Aucun résultat », two types → « Types 2 » + URL `types=stock_low,stock_out`; invalid URL params ignored; « Charger les 20 suivantes » up to 182 rows with no duplicates; « Ouvrir › » on my own notification: POST /notifications/:id/read, unread 104 → 103, row leaves « Non lues »; « Tout marquer comme lu » with a faked 500 (toast, count kept); Préférences → /settings/notifications; announcement deep link (ended announcement « holla », unknown id, malformed id). Deep link of one notification of each of the 25 types present was opened by URL: all reach their screen, except `shipment_returned` #CMD-1004 → « Introuvable » (the order no longer exists — acceptable 404 state).
- Seen on other areas' screens while following links (not counted here, already reported): ISO date « Rappel : 2026-10-22T14:29:00.000Z » in the order history (ORDERS-03); credits pill wrapping at 390 (settings area); raw `{boutique}` / `{total}` in old inbox messages of « Amrani Mahdi » / « Midou » (left for the channels-inbox area).

## Blocked by safety
- None. No call of this area matched the kit's block list.

## Not tested
- Home cards COLIS, PAGE, CONVERSATION, TÂCHE and the banners (credits 80 % / 100 %, plan, reconnect, approval): the shop has no such data right now (no failed parcel, no connected page, no needs-human conversation, no failed job), and creating them would need a courier, Meta or a plan change.
- VOS PAGES page cards (ACTIF / EN ATTENTE META / RECONNEXION / EN PAUSE, agent CTA): no page is connected in the test shop, so only the empty card was seen.
- Real submits on pre-existing insights and conversations (resolve / ignore / assign / resume) and a real « Tout marquer comme lu »: they would change data and the shared notification state of the owner account. They were run only against faked responses.
- Admin / operator views of these screens (roles area), keyboard-only navigation (mobile-a11y area), and the push / e-mail channels of the notifications.
