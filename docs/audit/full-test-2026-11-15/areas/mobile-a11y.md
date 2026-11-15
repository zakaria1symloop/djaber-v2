# Area mobile-a11y — tested 15/11/2026 21:17–21:45 (Africa/Algiers)

Owner, live https://djaber.vercel.app. Cross-cutting: shell (sidebar / drawer, top bar, user menu, banners), dialogs, menus, toasts at 390 / 768 / 1440 px; RTL mirroring in Arabic; keyboard-only use; focus; icon-button labels; contrast; zoom 200 %. Per-screen phone issues already reported by other areas are not repeated.

13 bugs: 2 Major, 9 Minor, 2 Cosmetic.

### MOBILE-A11Y-01 — Phone / tablet drawer menu (< 1024 px) is not keyboard-usable: hidden links take the first 25 Tab stops, no focus move, no Esc, no focus trap
- Page: every merchant page, e.g. /fr/home and /ar/home (owner, fr + ar, 390 px and 768 px)
- Severity: Major
- Type: Bug
- Steps: 1. Open /fr/home at 390 px (drawer closed). 2. Press Tab from the top of the page. 3. Tab to « Menu » and press Enter. 4. Press Tab, then Esc. 5. Open it again and close it with its « Fermer » ✕.
- Expected: 07-architecture « WCAG 2.1 AA (… keyboard …) ». A closed drawer is out of the Tab order (`inert` / `hidden`); an open drawer is a modal (`role="dialog"` `aria-modal`), the « Menu » button says `aria-expanded`, focus moves into the drawer, Tab stays inside it, Esc closes it, closing returns focus to « Menu ».
- Actual:
  - Drawer closed: the first 25+ Tab stops are the invisible sidebar links off-screen (« Djaber.ai » x = −220, « Fermer » x = −41, « Accueil », « File d'attente », …): the keyboard user sees no focus at all for 25 presses (same in Arabic, off-screen at x = 403–507).
  - « Menu » → Enter opens the drawer but focus stays on « Menu »; the next Tab goes to the top bar and the page content BEHIND the dark overlay (22 stops through the Home cards) before reaching the drawer links; no `aria-expanded` on « Menu », no `role="dialog"` / `aria-modal` on the drawer.
  - Esc does nothing: the drawer stays open (x = 0, focus remains on a drawer link).
  - « Fermer » ✕ closes it but focus stays on the now off-screen ✕ (x = −41): focus is lost.
- Likely cause: apps/web/src/components/shell/sidebar.tsx:78-85 (the drawer is only translated off-screen; no inert, no Escape handler, no focus management); app-shell.tsx:60 (« Menu » IconButton without aria-expanded / aria-controls).
- Evidence: .local/qa/campaign/mobile-a11y/s2-fr-390.json, s2-ar-390.json, s2-fr-768.json (Tab sequences) · fr-drawer-open-390.png

### MOBILE-A11Y-02 — Keyboard focus is invisible on every white (primary) button and link: the focus ring is black on the black page
- Page: every page with a primary button, e.g. /fr/orders « + Nouvelle commande », /fr/home « Connecter Facebook », dialogs « Appliquer » / « Contacter le support » (owner, fr + ar, 390 and 1440 px)
- Severity: Major
- Type: Bug
- Steps: 1. /fr/orders at 1440 px. 2. Press Tab until « + Nouvelle commande » is focused. 3. Same in the « Langue & région » dialog on « Appliquer ».
- Expected: a visible focus indicator (WCAG 2.4.7, 07 « WCAG 2.1 AA (dark contrast, keyboard) »); the design system's ring is `outline-accent-inbound` (blue, as on the user-menu button and the credits pill).
- Actual: computed `outline: solid 2px rgb(0, 0, 0)`, offset 2 px, around a white button on the #000 background: nothing changes on screen when it gets focus. Ghost buttons get a grey ring (rgb(163,163,163), « Aide sur cette page », « Annuler ») and secondary ones a white ring: only buttons that set the ring themselves (user menu, credits pill) get the blue one. The outline colour is the button's text colour (`currentColor`), i.e. the accent colour class is lost.
- Likely cause: packages/ui/src/primitives.tsx:30 `focus-visible:outline-accent-inbound` dropped by `cn()` (tailwind-merge does not know the custom colour and treats it as conflicting with `focus-visible:outline-2`), so the outline falls back to `currentColor`.
- Evidence: .local/qa/campaign/mobile-a11y/fr-focus-primary.png (focused « + Nouvelle commande »: no ring) · s5.json · s3-fr-390.json (dlgTabs « Appliquer » focus=solid 2px rgb(0,0,0))

### MOBILE-A11Y-03 — Closing a dialog or side panel sends keyboard focus to the top of the document (focus not returned to the control that opened it)
- Page: /fr/orders row « Actions » › Supprimer (dialog), user menu › Langue (dialog « Langue & région »), top bar « Aide sur cette page » (side panel) (owner, fr + ar, 390 and 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. /fr/orders, Tab to a row « Actions », Enter, choose « Supprimer ». 2. Press Esc. 3. Press Tab.
- Expected: focus goes back to the row's « Actions » button (it does when the menu itself is closed with Esc), so the keyboard user continues where they were.
- Actual: after Esc `document.activeElement` is `<body>`; the next Tab restarts at the sidebar's first link (25 stops back to the table). Same after closing « Langue & région », after closing the help panel (its trigger is always on screen) and after Esc on the leave guard « Quitter sans enregistrer ? » of /orders/new (opened from a sidebar link with the keyboard).
- Likely cause: dialogs and sheets are opened from controlled state (menu item onSelect, IconButton onClick) without a Radix `Dialog.Trigger`, so Radix has no element to give focus back to (e.g. apps/web/src/features/help/help-panel.tsx:19-22); an `onCloseAutoFocus` that restores the opener is missing.
- Evidence: .local/qa/campaign/mobile-a11y/s4-fr-1440.json (dlgEscFocus BODY; escFocus of the menu itself = « Actions ») · s3-fr-390.json, s3-ar-390.json (dlgEscFocus / helpEscFocus BODY) · s12-fr.json (guardEsc BODY)

### MOBILE-A11Y-04 — Credits pill in Arabic: the two counters are drawn in a different order and « packs 0 / 5 » reads « 5 / 0 »
- Page: top bar of every merchant page, /ar/* (owner, ar, 390 and 1440 px)
- Severity: Minor
- Type: Bug
- Steps: 1. Open /ar/home. 2. Read the credits pill in the top bar.
- Expected: the same numbers as in French (« 6 / 5 000 · packs 0 / 5 »), each « used / total » kept LTR (rule 7 « `<Ltr>` for numbers »), segments in RTL order (month credits first, on the right): visually « 0 / 5 باقات · 6 / 5 000 ⚡ ».
- Actual: visually « 6 / 5 000 · 5 / 0 باقات ⚡ »: the packs counter shows 5 / 0 (« 5 used of 0 ») and the month credits segment is on the left. The aria-label is right (« الأرصدة: 6 / 5 000، الباقات 0 / 5 »). Already noticed by channels-inbox (CHANNELS-INBOX-13 note).
- Likely cause: packages/shared/src/i18n/messages/web-gaps.ar.json:139 `topbar.creditsPacks` « {used} / {limit} · باقات {packUsed} / {packTotal} » rendered as plain text in an RTL span (packages/ui/src/agents.tsx:654 CreditsPill) — the bidi algorithm reorders the « n / m » runs; each ratio needs its own `<bdi dir="ltr">`.
- Evidence: .local/qa/campaign/mobile-a11y/ar-header-390.png

### MOBILE-A11Y-05 — Muted text (#666 on #000 / #0a0a0a) fails AA contrast everywhere, on 8–10.5 px labels
- Page: every merchant page (sidebar group titles, badges, dates, KPI hints, table headers, section titles, field hints) (owner, fr / ar / en, all widths)
- Severity: Minor
- Type: UX
- Steps: 1. Run axe-core 4.13 (WCAG 2 A / AA) on /home, /orders, /inbox, /products, /agents, /delivery, /settings/profile.
- Expected: 07-architecture « WCAG 2.1 AA (dark contrast …) »: 4.5 : 1 for text below 18 px.
- Actual: `color-contrast` is the only axe violation on these pages, but it is everywhere: 21 nodes on /home, 123 on /orders, 50 on /agents, 23 on /products, 18 on /delivery, 12 on /inbox, 6 on /settings/profile. Every hit is `text-text-muted` #666666: 3.44 : 1 on `ink-surface` #0a0a0a, 3.65 : 1 on #000, ~3.2 : 1 on `ink-raised` #141414 — and it is used on the smallest type of the system (`ts-label-micro` 8 px, `ts-label-meta` 9 px, `ts-label-section` 10.5 px): « IA & CANAUX », « ANALYSE », the « 99+ » badge, « il y a 26 j », « 3 sans appel depuis > 2 h », « à confirmer », « Trier par SKU », « VOS AGENTS », « BOÎTE DE RÉCEPTION », « PNG / JPG / WEBP · 5 Mo max », « Changer d'e-mail envoie un lien… ». On a phone in daylight these lines are hard to read.
- Likely cause: packages/ui/src/tokens.css:20 `--text-muted: #666666` (needs ≈ #8a8a8a for 4.5 : 1 on #141414) combined with 8–9 px label sizes (tokens.css:72-73).
- Evidence: .local/qa/campaign/mobile-a11y/s1.json (axe results per page)


### MOBILE-A11Y-06 — Keyboard shortcuts shown in the row « Actions » menu (C, R, E, A) do nothing, and « ? » (shortcuts help) does not exist
- Page: /fr/orders row « Actions ⌄ » (owner, fr, 1440 px); any page for « ? »
- Severity: Minor
- Type: Spec gap
- Steps: 1. /fr/orders?tab=new, Tab to a NOUVELLE order's « Actions », Enter. 2. The menu shows « Appeler pour confirmer  C », « Programmer un rappel  R », « Modifier la commande  E », « Assigner à…  A ». Press C. 3. Close the menu, keep focus on « Actions », press C. 4. Click a page title and type « ? ».
- Expected: 09-code-conventions « row focus + shortcut key fires `onSelect` without opening; `Enter` = primary »; 02-next-route-map §2.1 « `?` opens shortcuts help »; 12 GLOBAL system dialog « Raccourcis clavier (Entrée / Maj+Entrée, Échap, ← →, `/`, C · Entrée · R · M · E · A · P · Suppr, Ctrl+K, ?) ».
- Actual: step 2: C only moves the menu highlight to « Changer le statut » (Radix type-ahead on the first letter), the call dialog does not open; step 3: nothing; step 4: nothing (the i18n key `dialog.shortcuts.title` « Raccourcis clavier » exists but no screen uses it). Only Ctrl+K (focus the list search) and ↑ / ↓ in the inbox work. The hints promise shortcuts that do not exist.
- Evidence: .local/qa/campaign/mobile-a11y/s8.json (afterC: focus « Changer le statut », no dialog) · s7-fr-390.json (« ? » → no dialog; Ctrl+K → list search focused, correct)

### MOBILE-A11Y-07 — No « skip to content » link: 25 sidebar links before the page on every page (desktop)
- Page: every merchant page at ≥ 1024 px, e.g. /fr/home, /fr/orders (owner, fr, 1440 px)
- Severity: Minor
- Type: UX
- Steps: 1. Load /fr/orders. 2. Press Tab repeatedly.
- Expected: WCAG 2.4.1 (Bypass Blocks, level A, part of 07 « WCAG 2.1 AA … keyboard »): a first « Aller au contenu » link to `<main id="main">` (the id already exists).
- Actual: Tab 1 = logo, Tabs 2–25 = every sidebar item, Tab 26 = global search, 27–30 = credits / help / bell / user menu, then the page. On /orders the first row's « Actions » is about Tab 44. Repeated after every navigation.
- Evidence: .local/qa/campaign/mobile-a11y/s1.json (tabFromLoad) · s4-fr-1440.json

### MOBILE-A11Y-08 — Arabic order history: the « before → after » arrow points backwards, English words and raw numbers appear
- Page: /ar/orders/01a1e09e-b2e4-7835-b671-bc43f3cac94f › history (owner, ar, 1440 px; any order with history)
- Severity: Minor
- Type: Bug
- Steps: 1. Open an order in Arabic. 2. Read the history column.
- Expected: in RTL the change reads right-to-left (arrow mirrored, or « ← » in RTL); every word translated; amounts « 1 400 دج » (rule 11).
- Actual: « الحالة : جديد → مُسلَّم » is drawn with « → » pointing from « مُسلَّم » to « جديد », i.e. it reads « delivered → new » for an RTL reader; same on « الدفع : غير مدفوع → مدفوع » and « مدفوع → مُسترَدّ ». Also « الحالة : مُسلَّم → مُرتجَع · refused » (raw English reason), « notes : QA roles note » (raw field name) and « المبلغ المدفوع : 0 → 1400 » (no thousands space, no currency). (ORDERS-03 reported other raw values of the French history; these are the Arabic-only ones.)
- Evidence: .local/qa/campaign/mobile-a11y/ar-history-arrows.png

### MOBILE-A11Y-09 — Phone: close buttons and toast actions are tiny touch targets (14–20 px)
- Page: every dialog, side panel, toast and the phone drawer (owner, fr / ar, 390 px)
- Severity: Minor
- Type: UX
- Steps: 1. At 390 px open user menu › Langue (dialog), the help panel « Aide sur cette page », the drawer « Menu ». 2. Trigger a toast (Mouvements › Exporter CSV).
- Expected: a finger-sized target (WCAG 2.5.8 minimum 24 × 24 px; the design system's own icon buttons are 40 × 40).
- Actual (measured): dialog and side-panel ✕ « Fermer » 16 × 16 px; drawer ✕ 20 × 20 px; toast ✕ 14 × 14 px and toast action « Télécharger » 73 × 12 px; credits pill 20 px high; user menu 32 × 32 px.
- Likely cause: packages/ui/src/overlays.tsx:52 (`DialogPrimitive.Close` with only the 16 px icon, no padding); same pattern for the toast buttons (overlays.tsx ~331) and components/shell/sidebar.tsx:98.
- Evidence: .local/qa/campaign/mobile-a11y/s3-fr-390.json (dlgFocus / helpFocus w=16 h=16) · s2-fr-390.json (focusAfterX w=20) · s7-fr-390.json (toastBtns)

### MOBILE-A11Y-10 — No global search on phones (< 768 px)
- Page: top bar of every merchant page (owner, fr / ar, 390 px)
- Severity: Minor
- Type: UX
- Steps: 1. At 390 px look for « Rechercher une commande, un client, un produit, une page… ».
- Expected: the one search for pages, orders, clients and products (top bar, tester report 2026-10-20) reachable on the phone too (for example an icon that opens it), since « < 1024: usable at 390 » (08-web-screens §2).
- Actual: the input is `display:none` below 768 px (`hidden md:block`) and nothing replaces it, although the top bar at 390 px has room (Menu, credits pill, ?, bell, avatar). A phone user must open the drawer and go to each list to search.
- Likely cause: apps/web/src/components/shell/merchant-shell.tsx:290 `me-auto hidden min-w-0 flex-1 md:block`.
- Evidence: .local/qa/campaign/mobile-a11y/s2-fr-390.json (header: INPUT w=0 h=0 vis=false) · fr-header-390.png

### MOBILE-A11Y-11 — Form errors are not tied to their fields for screen readers; required fields are not announced
- Page: /fr/orders/new (owner, fr, 390 px) — same field pattern in the other forms
- Severity: Minor
- Type: Bug
- Steps: 1. /fr/orders/new, focus « Enregistrer la commande », press Enter with the form empty.
- Expected: each invalid field has `aria-invalid` AND `aria-describedby` pointing to its message; required fields have `required` / `aria-required` (WCAG 3.3.1 / 1.3.1).
- Actual: focus moves to the first invalid field and `aria-invalid="true"` is set (good), the summary « Validation : 3 erreurs » is an alert (good), but no field has `aria-describedby`: « Champ requis » / « Ajoutez au moins un article » are separate alerts not linked to « NOM COMPLET * », « TÉLÉPHONE * », the product search; the asterisk is the only « required » information (no `required` / `aria-required` on any field).
- Evidence: .local/qa/campaign/mobile-a11y/s7-fr-390.json (fields: invalid=true desc=«» req=null)

### MOBILE-A11Y-12 — The notification bell's spoken label contains a design note: « Notifications — 111 non lues · comptage serveur »
- Page: top bar of every merchant page (owner, fr / ar / en)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Read the accessible name of the bell (screen reader, or Tab to it).
- Expected: « Notifications — 111 non lues » (12 GLOBAL « no technical text »).
- Actual: « Notifications — 111 non lues · comptage serveur » (ar « … · عدّ الخادم »). Same key as HOME-04 (notifications page header), but here it is on every page.
- Likely cause: apps/web/src/features/notifications/shell.tsx:76 reuses `notification.unreadServer`.
- Evidence: .local/qa/campaign/mobile-a11y/s1.json (tab 29) · s2-ar-390.json

### MOBILE-A11Y-13 — 320 px (400 % zoom): the Statistiques period chip pushes the page 30 px sideways
- Page: /fr/analytics (owner, fr, 320 px)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open /fr/analytics at 320 px wide (= 1280 px window at 400 % zoom).
- Expected: no horizontal scrolling (WCAG 1.4.10 Reflow); every other main page checked (25 routes) reflows at 320 px.
- Actual: `main` scrolls horizontally (scrollWidth 350 / 320): the chip « 17 OCT. → 15 NOV. 2026 · COMPARÉ À LA PÉRIODE… » is 334 px wide. At 390 px it fits (cut, ANALYTICS-12).
- Evidence: .local/qa/campaign/mobile-a11y/s6-fr-320.json · fr-analytics-320.png

## Coverage
Owner account, live site, 15/11/2026 21:17–21:45 (Africa/Algiers). Tools: Playwright through the kit, axe-core 4.13 (WCAG 2 A / AA + best practice), keyboard only (Tab / Shift+Tab / Enter / Esc / arrows / Ctrl+K / letters), computed styles for focus rings and sizes. No data created or changed (one CSV export job of Mouvements to get a toast; no « QA mobile-a11y » record was needed).

| Check | fr | ar | en | widths |
|---|---|---|---|---|
| Shell: sidebar / phone drawer (open by keyboard, Tab order closed / open, Esc, ✕, focus return, aria) | ✓ | ✓ | — | 390, 768, 1440 |
| Top bar: Menu, global search, credits pill (bidi), help « ? », bell, user menu (Enter, arrows, Esc → focus back ✓), workspace switcher (n/a, 1 membership) | ✓ | ✓ | — | 390, 768, 1440 |
| Dialogs: « Langue & région », order « Supprimer », leave guard « Quitter sans enregistrer ? » (focus on open, focus trap ✓, Esc ✓, focus return ✗), help side panel (full width at 390 ✓) | ✓ | ✓ | — | 390, 1440 |
| Row « Actions ⌄ » menu by keyboard (Enter opens, arrows skip greyed items, reasons listed in the footer, Esc returns focus ✓, shortcut letters ✗) | ✓ | — | — | 1440 |
| Toasts: region `aria-live="polite"` ✓, position at 390 (bottom, full width), button sizes | ✓ | — | — | 390 |
| Banners: offline banner at 390 (role=status, no overflow) | — | ✓ | — | 390 |
| Focus visibility: sidebar links (browser ring ✓), secondary / ghost / filter buttons (white / grey ring ✓), primary buttons ✗, inputs (blue 1 px ring ✓), user menu / credits pill (blue ✓) | ✓ | ✓ | — | 390, 1440 |
| Skip link / bypass blocks | ✓ | — | — | 1440 |
| Keyboard flows: /orders/new empty submit (focus to first error ✓), product search (type → Tab → Enter adds the line ✓), wilaya / commune comboboxes (type, ↓, Enter ✓), leave guard by keyboard ✓, Ctrl+K on lists ✓, « ? » ✗ | ✓ | — | — | 390, 1440 |
| axe sweep of 25 main routes (home, queue, inbox, orders, new order, delivery, fees, clients, stock, products, new product, categories, movements, purchases, sales, cash, agents, channels, analytics, reports, notifications, profile, members, credits, help): page title, `<html lang dir>`, one h1, page-level horizontal overflow, axe violations other than contrast | 320 | 390 | 768 | 320 / 390 / 768 |
| Colour contrast (axe) on home, orders, inbox, products, agents, delivery, profile | ✓ | ✓ | — | 390, 1440 |
| Zoom 200 % (720 × 450): orders list, row menu (scrolls inside, 229 of 911 px visible ✓), delete dialog (fits ✓), new order (sticky footer 65 px ✓) | ✓ | — | — | 720 |
| Zoom 400 % (320 px): 25 routes, only /analytics overflows (MOBILE-A11Y-13) | ✓ | — | — | 320 |
| RTL mirroring: drawer from the right ✓, menus anchored at the avatar ✓, chevrons / back arrows mirrored (`rtl:-scale-x-100`) on home, orders, products, order page ✓, « › » links ✓, text arrows « → » in history ✗ (MOBILE-A11Y-08), credits pill ✗ (MOBILE-A11Y-04) | — | ✓ | — | 390, 1440 |

Observations not counted as bugs: every page has a translated `<title>` « … · Djaber.ai », correct `lang` / `dir` and exactly one h1, except /inbox (no h1, axe `page-has-heading-one`); list pages have two landmarks with the same name (axe best-practice `landmark-unique`); /en/products has 5 images whose alt repeats the product name next to it (`image-redundant-alt`). No page-level horizontal scroll at 390 / 768 px on the 25 routes in any locale. The kit recorded no technical-text leak, no failed API call and no console error apart from 403s on Facebook page pictures on /channels.

## Blocked by safety
None — no blocked call was attempted (`log.blocked` empty in every run).

## Not tested
- Real screen readers (NVDA / TalkBack / VoiceOver): only the accessibility tree (names, roles, aria-*) was checked.
- Real browser zoom and text-only zoom / text spacing: simulated with the viewport sizes above.
- Public site, admin area and mobile app: covered by the public / admin areas and out of the web scope.
- Per-screen phone layouts already reported by other areas (AGENTS-05/17, AI-CHAT-15, ANALYTICS-12, DELIVERY-17/18, SALES-CASH-03, SETTINGS-16, STOCK-11, PRODUCTS-16, ORDERS-17, …) and the « .KARIM P » RTL punctuation (CHANNELS-INBOX-13, STOCK-07, SALES-CASH-23) were not re-reported.
- Workspace switcher (the owner has one membership), impersonation bar, reconnecting pill (needs a dropped WebSocket).
