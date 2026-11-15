# Area channels-inbox — tested 15/11/2026 19:23–19:45 (Africa/Algiers)

Owner account, shop « Boutique Test Équipe », live https://djaber.vercel.app. The shop's 3 Facebook pages (Luna Shturm,
Golden D, Test dsqezadsq) are all DÉCONNECTÉ; the inbox holds 3 pre-existing conversations (Houssem H, Badreddine bendief,
Amrani Mahdi, all on « Test dsqezadsq », all > 24 h old). No « QA channels-inbox » record could be created: conversations only
come from Meta. So every mutation on these pre-existing conversations / pages was answered **locally** by my scripts
(extra route guard returning 418, same as the kit) — the UI path up to the request and the error handling were tested, the
server was never reached. Test texts used « QA channels-inbox … ».

### CHANNELS-INBOX-01 — « Analyse de la page » tab of a disconnected page shows « Introuvable » (404) instead of a page state
- Page: /fr/channels/<id>/analysis (owner, fr / ar / en, 1440 and 390 px) — all 3 pages
- Severity: Major
- Type: Bug
- Steps: 1. /channels › Test dsqezadsq › Configurer. 2. Click the tab « Analyse de la page ».
- Expected: one of the CHN-08 states (12 §10 / §22: idle · permission required + reconnect · …); for a disconnected page a clear « page déconnectée, reconnectez-la » state with « Reconnecter » — or no tab at all (the row menu already hides « Analyse » for a disconnected page, use-channel-actions.tsx:88).
- Actual: the tab is offered, then the content reads « Introuvable — Cet élément n'existe pas ou appartient à un autre espace. » under the page header that shows the page exists. The other tabs of the same page work.
- Evidence: API: GET /channels/01a15370-9138-72f5-a604-c2faefef33b4/analysis → 404 NOT_FOUND (same for Luna Shturm) · Likely cause: apps/api/src/modules/agents/page.service.ts:136 `channelOrNotFound` filters `status: { not: 'disconnected' }`, so a disconnected page is « not found ».

### CHANNELS-INBOX-02 — Disconnected page: conversation banner says « seul un message modèle est possible » while the composer says the channel is inactive (no template button)
- Page: /fr/inbox/<id> for the 3 conversations (owner, fr / ar / en, 1440 and 390 px)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Inbox › open Houssem H (page « Test dsqezadsq » is DÉCONNECTÉ).
- Expected: 12 §23 banner priority: RECONNEXION REQUISE / canal inactif comes before HORS FENÊTRE 24 H; composer CANAL INACTIF = « `REPLY_CHANNEL_INACTIVE` + Reconnecter ».
- Actual: top banner « HORS FENÊTRE 24 H — Le dernier message du client date de plus de 24 h : seul un message modèle est possible (Messenger). » but there is no « Envoyer un message modèle » anywhere; the composer at the bottom reads « CANAL INACTIF · Page en pause ou déconnectée. » with « OUVRIR LA PAGE » (not « Reconnecter »). Two contradicting messages on one screen.
- Evidence: .local/qa/campaign/channels-inbox/fr-thread-houssem.png

### CHANNELS-INBOX-03 — Page history shows a raw technical event text « invalid:send:190 »
- Page: /fr/channels/01a15370-9138-72f5-a604-c2faefef33b4/history (owner, fr / ar / en)
- Severity: Minor
- Type: Text
- Steps: 1. Pages connectées › Test dsqezadsq › Historique › period « 30 j ».
- Expected: no technical text on shop screens (12 « No technical text on merchant screens », UX-059): a sentence such as « Jeton Meta refusé lors d'un envoi ».
- Actual: the row of 19 oct. 2026 15:15 reads « invalid:send:190 · Système » in fr, ar and en.
- Evidence: .local/qa/campaign/channels-inbox/02.txt · Likely cause: apps/web/src/features/channels/channel-page/history.tsx:131 prints `e.description` (raw server string) before the translated `channels.event.<kind>`.

### CHANNELS-INBOX-04 — « Déconnecter la page » greyed with the wrong reason « Modifié entre-temps, rechargez. »
- Page: /fr/channels (card Actions ⌄) and /fr/channels/<id> (header Actions ⌄ + « Zone de danger ») (owner, fr)
- Severity: Minor
- Type: Text
- Steps: 1. /channels › Actions ⌄ on any card. 2. Hover « Déconnecter la page ».
- Expected: a reason that explains why (the page is already disconnected), e.g. « Page déjà déconnectée. » (UX-060: disabled reasons are true, finished sentences).
- Actual: « Déconnecter la page : Modifié entre-temps, rechargez. » — reloading changes nothing. Same text on the « Déconnecter la page » button of the « ZONE DE DANGER » block.
- Evidence: .local/qa/campaign/channels-inbox/03.txt / 02.txt

### CHANNELS-INBOX-05 — Technical labels « ADMIN · SOFT » / « Admin+ · suppression douce » in the conversation menu and delete dialog
- Page: /fr/inbox and /fr/inbox/<id> — row « … » menu, header « Actions ⌄ », dialog « Supprimer la conversation ? » (owner, fr / en)
- Severity: Minor
- Type: Text
- Steps: 1. Inbox › Actions ⌄ on a conversation. 2. Click « Supprimer la conversation ».
- Expected: no internal / spec jargon on shop screens (UX-059).
- Actual: menu item « Supprimer la conversation ADMIN · SOFT » (en: « Delete the conversation ADMIN · SOFT »); dialog subtitle « Admin+ · suppression douce ». Same kind of text in « Bloquer ce client »: « Opérateur : bloquer / signaler ; seul admin/propriétaire : débloquer et règles automatiques. » and in the bulk bar: « Résultat par conversation (erreur si canal inactif) — jamais tout ou rien. »
- Evidence: .local/qa/campaign/channels-inbox/fr-conv-menu.png · 08.txt · 11.txt

### CHANNELS-INBOX-06 — « Bloquer ce client » with « Aucun motif » sends the motif « Autre »
- Page: /fr/inbox/<id> › Actions › Bloquer ce client (owner, fr)
- Severity: Minor
- Type: Bug
- Steps: 1. Open the block dialog. 2. Leave MOTIF (FACULTATIF) on « Aucun motif ». 3. Bloquer (request answered locally).
- Expected: the block is recorded without a motif (the field is optional and offers « Aucun motif »).
- Actual: request body `{"reason":"other","note":"QA channels-inbox raison"}` — the block will read « Autre » in Settings › Sécurité and in reports.
- Evidence: API: POST /conversations/01a15393-…/block (intercepted) · Likely cause: apps/web/src/features/safety/dialogs.tsx:60 `reason: reason || 'other'` (the server schema `packages/shared/src/schemas/inbox.ts:105` makes `reason` required for a conversation block; either make it optional there or drop « Aucun motif » from this dialog).

### CHANNELS-INBOX-07 — Channel page « Messages » tab says it has the inbox tabs and filters, but shows a bare list
- Page: /fr/channels/01a15370-9138-72f5-a604-c2faefef33b4/messages (owner, fr)
- Severity: Minor
- Type: Spec gap
- Steps: 1. Pages connectées › Test dsqezadsq › tab « Messages 3 ».
- Expected: 12 §22 « Messages (inbox filtered, same tabs) »; route map: list · filters · [E].
- Actual: three rows only, no tab, no filter, no search; under them the page states « Mêmes onglets et filtres que la boîte (Tous · Actifs · À traiter · Terminés), avec la page fixée. » — describes controls that are not there. Only « Ouvrir dans la boîte » leads to the real filtered list.
- Evidence: .local/qa/campaign/channels-inbox/02.txt

### CHANNELS-INBOX-08 — Unsaved internal note is lost without warning when switching conversation
- Page: /fr/inbox/<id> › Note (client panel « NOTES INTERNES ») (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Amrani Mahdi › Note. 2. Type « QA channels-inbox unsaved » (do not add it). 3. Click Houssem H in the list.
- Expected: GLOBAL leave guard (CLAUDE.md rule 7, 12 GLOBAL catalogue) or the draft kept per conversation.
- Actual: the thread switches immediately, no dialog; back on Amrani Mahdi the note field is empty.
- Evidence: .local/qa/campaign/channels-inbox/15.txt

### CHANNELS-INBOX-09 — « Créer un agent » stays active on a disconnected page and the page is then silently not linked
- Page: /fr/channels/<id>/ai (owner, fr)
- Severity: Minor
- Type: UX
- Steps: 1. Test dsqezadsq (DÉCONNECTÉ) › IA & agent. 2. « Rattacher un agent » is greyed « Page déconnectée : reconnectez-la d'abord. » 3. Click « Créer un agent ».
- Expected: 12 §22 « "Créer un agent" on a page without agent ⇒ /agents/new?channel=<id> » and « ?channel=<id> ⇒ step 1 says the page will be linked »; on a disconnected page the button should be greyed with the same reason as « Rattacher ».
- Actual: the wizard opens with `?channel=01a15370-9138-…`, but step 1 never mentions the page (the param is dropped for a disconnected page, apps/web/src/features/agents/wizard/wizard.tsx:146) — the merchant believes the new agent will answer on this page.
- Evidence: .local/qa/campaign/channels-inbox/16.txt

### CHANNELS-INBOX-10 — « Synchroniser les infos de page » greyed « Page déconnectée par Meta » for a page the merchant disconnected
- Page: /fr/channels/<id> and card menu (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Test dsqezadsq › hover « Synchroniser les infos de page ».
- Expected: a reason true for this page: its own history says « 09 nov. 2026 · Page déconnectée · Karim P. » (a member, not Meta).
- Actual: « Page déconnectée par Meta, reconnectez-la. » on all 3 pages.
- Evidence: .local/qa/campaign/channels-inbox/02.txt

### CHANNELS-INBOX-11 — Empty search sentence: « Aucun(e) conversation ne correspond à « « zzzzqa » ». »
- Page: /fr/inbox?q=zzzzqa (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Inbox › search « zzzzqa ».
- Expected: « Aucune conversation ne correspond à « zzzzqa ». »
- Actual: « Aucun(e) conversation ne correspond à « « zzzzqa » ». » — generic « Aucun(e) » and doubled quotes.
- Evidence: .local/qa/campaign/channels-inbox/10.txt

### CHANNELS-INBOX-12 — « Détail du tour IA » shows the raw intent « OTHER »
- Page: /fr/inbox/<id> › « … » on an AI message › Détail du tour IA (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Houssem H › « … » on the last AI reply › Détail du tour IA.
- Expected: translated intent (the inbox filter sheet uses Vente / Info / Suivi / Réclamation / Salutation).
- Actual: « INTENTION — OTHER · confiance 0,90 ».
- Evidence: .local/qa/campaign/channels-inbox/08.txt

### CHANNELS-INBOX-13 — Arabic: assignee chip shows « .KARIM P » (period moved to the wrong side)
- Page: /ar/inbox/<id> (owner, ar, 1440 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. /ar/inbox › open Amrani Mahdi. 2. Look at the assignee chip in the thread header.
- Expected: Latin names isolated (`<Ltr>` / `<bdi>`, CLAUDE.md rule 7): « KARIM P. ».
- Actual: « .KARIM P ». (Also seen on the shared header of every page: « 6 / 5 000 · 5 / 0 باقات » for « packs 0 / 5 » — numbers reversed; belongs to the shell, noted for mobile-a11y.)
- Evidence: .local/qa/campaign/channels-inbox/ar-thread.png

### CHANNELS-INBOX-14 — Connect explainer shows raw Meta permission names, and an Instagram scope on the Facebook tab
- Page: /fr/channels › Connecter Facebook / Connecter Instagram (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Pages connectées › Connecter Facebook. 2. Read PERMISSIONS DEMANDÉES. 3. Switch to « Instagram (DM) ».
- Expected: plain-language permission list (12 §10 « explainer with permission list »), no snake_case identifiers (UX-059).
- Actual: « Lire et répondre aux messages de la page (pages_messaging) », « … (pages_read_engagement) », a bare line « Instagram : instagram_manage_messages »; Instagram tab: « (instagram_business_basic) », « (instagram_business_manage_messages) » and the sentence « Approbation Meta de l'app en cours » pages IG en attente. » (stray « » » instead of an arrow / colon).
- Evidence: .local/qa/campaign/channels-inbox/03.txt (kit leaks « snake_case value » × 5)

### CHANNELS-INBOX-15 — Page overview: tile « PRODUITS VENDUS SUR CETTE PAGE 0 » next to « COMMANDES IA (30 J) 9 »; two blocks titled « Message d'accueil »
- Page: /fr/channels/01a15370-9138-72f5-a604-c2faefef33b4 and …/ai (owner, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Test dsqezadsq › Aperçu. 2. IA & agent.
- Expected: labels that say what is counted; one title per block.
- Actual: the tile counts the agent's product scope (`counts.productsInScope`, hint « Aucun agent ») but reads « PRODUITS VENDUS SUR CETTE PAGE · 0 » while the next tile says 9 AI orders were created on this page. On « IA & agent », the Messenger icebreaker field (0 / 300, Enregistrer) and the workspace welcome system message are both titled « Message d'accueil ». Header also says « 0 abonnés » while the Meta block says ABONNÉS « — » (unavailable).
- Evidence: .local/qa/campaign/channels-inbox/02.txt

## Coverage
- **Pages connectées /channels** (fr, ar, en, 390 px): summary line, platform tabs Toutes / Facebook / Instagram, 3 cards (all DÉCONNECTÉ, SANS IA), quick links Boîte / Stock / Configurer, card « Actions ⌄ » (Reconnecter, Ouvrir la page, Synchroniser greyed, Voir les conversations, Déconnecter greyed — reasons read), state strip « Reconnecter » (blocked, popup closed, error toast), no horizontal overflow at 390 px, RTL ok.
- **Connect explainer** « Connecter Facebook » / « Connecter Instagram »: both tabs, permission lists, plan line, Annuler / ESC, « Continuer avec Facebook » ⇒ pop-up + waiting dialog « Connexion à Meta… » + Annuler (the facebook.com navigation was aborted by my script).
- **Connect return** /channels/connect/return with `connectError=OAUTH_CANCELLED` (toast « Connexion annulée »), `OAUTH_STATE_INVALID` (dialog « Connexion expirée » + Recommencer), unknown `connectReport` (« Introuvable ou accès refusé. »), no query.
- **Page detail** /channels/[id] for Test dsqezadsq, Luna Shturm, Golden D: header pills / meta line, Aperçu (Djaber counters, Meta statistics unavailable state, agent none, connection health, permissions, recent activity, danger zone), Messages tab, IA & agent (no-agent card, Rattacher greyed, Créer un agent ⇒ wizard, icebreaker field greyed, welcome message preview + link), Historique (type filter multi-select, 7 / 30 / 90 j / Tout, filters in the URL and kept on F5, back button), Analyse (404, bug 01), unknown id ⇒ « Introuvable » + Retour. fr / ar / en / 390 px.
- **Inbox list** /inbox (fr, ar, en, 390 px): tabs Tous / Actifs / À traiter (« Tout est calme ») / Terminés / Archivés (empty state) with `?tab=` kept on F5; search by name, lower case, phone, message text, Arabic, special characters, no result (bug 11), `?q=` kept on F5; filter sheet (all groups read, intent filter applied, `?intent=` kept on F5, Réinitialiser); channel switcher (4 rows with counts / states) ⇒ `?channel=` empty state; row « … » menu (14 items); selection mode + bulk bar (Archiver intercepted ⇒ error shown); keyboard ↑ / ↓ moves between threads; unknown id ⇒ Introuvable + Retour; malformed id ⇒ « Impossible de charger — Requête invalide. ».
- **Conversation** /inbox/[id] for the 3 conversations: header (assignee chip, Assigner popover, Note, Résoudre / Rouvrir), banner HORS FENÊTRE 24 H, composer CANAL INACTIF, Messages précédents (pagination), message types present (customer text, AI reply with product cards, human reply with name, failed send « Non délivré — Service indisponible. » + Réessayer ⇒ blocked, handoff system line), AI badge, « … » per message ⇒ Détail du tour IA (dialog) and Signaler une réponse IA incorrecte, client panel (card, risk pill FIABLE, orders, Nouvelle commande ⇒ /orders/new?clientId&conversationId and Annuler returns to the conversation, notes panel: empty, spaces, 5 000 chars ⇒ length error, Arabic + emoji, Ctrl+Entrée ⇒ intercepted error shown, text kept).
- **Conversation menu / Signaler**: Mettre l'IA en pause, M'assigner, Marquer traitée, Archiver, Marquer non lue (one-click, not clicked except Marquer non lue / Résoudre / Assigner intercepted ⇒ error toast, state unchanged), Fiche client, Commandes de ce client, Insights IA de ce fil, **Marquer « risque »** (one-click, intercepted `POST /clients/:id/risk {"riskLevel":"high"}`), **Bloquer ce client** (dialog: motif select, note max 500, ESC / Annuler, submit intercepted ⇒ inline error, content kept; bug 06), **Signaler à Djaber** (5 motifs, details max 2 000, « Bloquer aussi ce client », empty submit ⇒ « Champ requis », Arabic + emoji text, submit intercepted ⇒ inline error, content kept; en dialog checked), **Signaler une réponse IA incorrecte** (3 motifs, default « Réponse IA incorrecte », submit intercepted ⇒ inline error), Supprimer la conversation (dialog, submit intercepted).
- Console: no JavaScript error; only expected HTTP errors (`/insights` 422 INBOX_INSIGHTS_UNAVAILABLE on disconnected pages, Facebook avatar CDN 403 with icon fallback, `/analysis` 404 = bug 01). The kit's leak detector also flagged `{boutique}` / `{total}` inside Karim P.'s messages of 25 oct. in Amrani Mahdi's thread: old stored messages sent before the quick-reply variable fix (apps/web/src/features/inbox/logic.ts:353 now substitutes them) — not reported as a new bug.

## Blocked by safety
- `POST /channels/01a15370-9924-…/reconnect` (Reconnecter on Luna Shturm, card strip and card menu) — kit, × 3.
- `https://www.facebook.com/v21.0/dialog/oauth?…` (pop-up after « Continuer avec Facebook ») — aborted by my script.
- My own guard (pre-existing pages / conversations / client, never sent to the server): `POST /safety/reports` × 3 (customer + AI message), `POST /conversations/:id/block` × 2, `POST /clients/:id/risk`, `POST /conversations/:id/unread`, `PATCH /conversations/:id` (assign, resolve), `POST /conversations/:id/notes`, `POST /conversations/:id/messages` (Réessayer of a failed send), `POST /conversations/bulk/archive`, `DELETE /conversations/:id`.

## Not tested
- Every state that needs a live page or a live customer: active / paused / needs-reconnect / pending-Meta / paused-by-plan cards, Déconnecter dialog (greyed on all 3 pages), Réactiver et échanger, Rapport de connexion rows, Synchroniser l'historique dialog and job progress, analysis states (idle, job, review grid, import) — all pages are disconnected and Meta calls are forbidden.
- Composer states (sending, image attached / too large, too long, HUMAN_AGENT note, « Envoyer un message modèle », quick replies popover « / », first-reply tooltip), WS « reconnexion… » pill, live message arrival, audio / video / location / sticker bubbles, banners AI paused / À traiter / credits exhausted / blocked customer: the only conversations are > 24 h old on a disconnected page and replies to real customers are forbidden.
- Real server outcome of block / report / risk / resolve / assign / notes / delete / bulk: no « QA channels-inbox » conversation can exist (they only come from Meta), so every submit was intercepted; the server side of « Signaler à Djaber » is not verified.
- Operator / admin views of these screens (area « roles »).
