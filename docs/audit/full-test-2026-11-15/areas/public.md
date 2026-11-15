# Area public — tested 15/11/2026 22:15–23:10 (Africa/Algiers)

Visitor (not signed in), live https://djaber.vercel.app. Screens: landing, features, pricing, help centre, legal pages, status, login, signup, forgot / reset password, verify e-mail, invitation, public tracking, account-deletion page, Meta data-deletion status, shared playground link, language switch, RTL, 390 px.

Sign-ups made: 1 account `qa-public-1@test.djaber.local` (workspace created by sign-up, onboarding left at step « Bienvenue »). Account-deletion request sent for `qa-public-nodel@test.djaber.local` (no account). Status subscription `qa-public-status@test.djaber.local` (not confirmed). Forgot-password requests only for `*@test.djaber.local`.

### PUBLIC-01 — Canonical, hreflang, og:url, sitemap.xml and robots.txt all point to http://localhost:3010
- Page: every public page (/fr, /fr/pricing, /fr/features, /fr/help-center, /fr/legal/*), /robots.txt, /sitemap.xml (visitor, fr / ar / en)
- Severity: Major
- Type: Bug
- Steps: 1. `curl https://djaber.vercel.app/fr/pricing` and read `<head>`. 2. Open https://djaber.vercel.app/robots.txt and /sitemap.xml.
- Expected: absolute URLs on the live origin https://djaber.vercel.app (or the production domain).
- Actual: `<link rel="canonical" href="http://localhost:3010/fr/pricing"/>`, `<link rel="alternate" hrefLang="ar" href="http://localhost:3010/ar/pricing"/>`, `<meta property="og:url" content="http://localhost:3010/fr/pricing"/>`; robots.txt ends with `Sitemap: http://localhost:3010/sitemap.xml` and every `<loc>` of sitemap.xml is `http://localhost:3010/…`. Search engines are told that the real page is on localhost (the site cannot be indexed) and every link shared on Facebook / WhatsApp gets a localhost og:url.
- Likely cause: apps/web/src/lib/seo.ts:8 — `SITE_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:3010'`; `PUBLIC_WEB_URL` is not set for the Vercel build.
- Evidence: HTML head of /fr/pricing, /robots.txt, /sitemap.xml (curl)

### PUBLIC-02 — Every legal document is one placeholder sentence (Terms, Privacy, Cookies, Content rules, Account deletion)
- Page: /fr/legal/terms, /fr/legal/privacy, /fr/legal/cookies, /fr/legal/content_rules, /fr/legal/account_deletion (visitor, fr / ar / en, 1440)
- Severity: Major
- Type: Spec gap
- Steps: 1. Open the footer links « Conditions », « Confidentialité », « Cookies », « Règles de contenu ». 2. Switch the FR · AR · EN tabs.
- Expected: real published legal documents with sections (12 §27 « published (version + date, sections, language tabs) »). The Privacy policy is the URL given to Meta App Review and Google Play; the sign-up form says « En continuant vous acceptez les Conditions et la Politique de confidentialité ».
- Actual: each document « v1 · en vigueur depuis le 14 oct. 2026 » is one sentence, e.g. Terms = « En utilisant Djaber, vous acceptez d'utiliser le service conformément à la loi et aux présentes conditions. », Privacy = « Djaber traite les données de votre boutique et de vos clients uniquement pour fournir le service. » (same in AR / EN). No data controller, no list of data collected, no retention, no contact, no applicable law. Only « Suppression des données » has a usable paragraph. A store / Meta reviewer will reject this privacy policy, and users « accept » terms that do not exist.
- Evidence: API: GET /cms/terms?lang=fr → 200 (one-sentence body)

### PUBLIC-03 — No Content-Security-Policy / frame protection on the web app: the login page can be framed (clickjacking)
- Page: /fr/login (and every page) (visitor)
- Severity: Minor
- Type: Security
- Steps: 1. `curl -I https://djaber.vercel.app/fr/login`.
- Expected: 07-non-functional §security (line « Helmet defaults + CSP for web (`default-src 'self'; … frame-src …`) ») — a CSP with `frame-ancestors` (or `X-Frame-Options: DENY`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- Actual: only `Strict-Transport-Security` is sent; no `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`. Any site can embed the login / sign-up / account-deletion pages in an iframe.
- Evidence: response headers of GET /fr/login

### PUBLIC-04 — Every public page ships the whole i18n catalogue in its HTML (≈ 620–720 KB, 165 KB gzipped, incl. 1 200 admin texts)
- Page: /fr, /fr/login, /ar/signup, /fr/s/… (visitor)
- Severity: Minor
- Type: Performance
- Steps: 1. `curl https://djaber.vercel.app/fr/login | wc -c`.
- Expected: a public page / the login page carries only the texts it shows (07-non-functional performance budget; most visitors are on mobile data in Algeria).
- Actual: HTML size /fr 649 579 B, /fr/pricing 648 141 B, /fr/login 616 177 B, /ar/signup 724 011 B, /fr/s/… 619 085 B (≈ 164–174 KB gzipped) before any JS; the login HTML contains keys such as `orders.calls` and 1 203 `admin.*` keys. The public tracking page opened by customers from an SMS / QR code downloads all of it.
- Evidence: curl sizes (Accept-Encoding gzip: 163 890 B for /fr/login)

### PUBLIC-05 — A mistyped URL shows the in-app 404 « appartient à un autre espace » with no site header, and its button sends the visitor to the login page
- Page: /fr/nope-page, /ar/nope-page (visitor, fr / ar)
- Severity: Minor
- Type: UX
- Steps: 1. As a visitor, open any unknown URL, e.g. https://djaber.vercel.app/fr/nope-page. 2. Click « Retour à l'accueil ».
- Expected: the public 404 (12 §27 « Landing / features / help: published · 404 with search »), as /fr/legal/nope and /fr/help/nope-guide already show: header, « Page introuvable — Cette page n'existe pas ou n'est plus publiée. », links Accueil · Aide · Statut, footer.
- Actual: bare page « Introuvable ou accès refusé — Cet élément n'existe pas ou appartient à un autre espace. » (merchant wording about workspaces), no header / footer / language switch, and « Retour à l'accueil » goes to /fr/home, which redirects a visitor to /fr/login.
- Likely cause: apps/web/src/app/[locale]/not-found.tsx:7 — the locale-level 404 always renders the app `Page404` with `homeHref=/${locale}/home`, also for visitors.
- Evidence: HTTP 404 page text (crawl run)

### PUBLIC-06 — Public tracking page: a returned parcel shows « Pas encore d'événement », and the courier name « LIVRAISON PROPRE » is not translated
- Page: /fr/s/Ue3ERzRhYyZhOtO4 (order #CMD-1026), same in /ar and /en (visitor)
- Severity: Minor
- Type: Bug
- Steps: 1. Open the tracking link of a parcel the shop marked « Retournée » by hand (own delivery). 2. Look at « Historique ». 3. Switch to AR / EN.
- Expected: the history lists at least the event that made the parcel « Retournée » (12 §27 « Public tracking page: timeline »); the courier label is translated like the rest of the page.
- Actual: status pill « RETOURNÉE », the timeline reaches « Retournée », but « HISTORIQUE — Pas encore d'événement. » (CMD-1023, returned later, does have its event). The line « LIVRAISON PROPRE · ALGER » stays in French in AR (« LIVRAISON PROPRE · الجزائر ») and EN.
- Likely cause: apps/api/src/modules/orders/order-workflow.service.ts:100 — the manual « retourné » path creates the Shipment directly with `status: 'returned'` and no ShipmentEvent; the `manual` provider label is a fixed French string.
- Evidence: API: GET /track/Ue3ERzRhYyZhOtO4 → 200

### PUBLIC-07 — Public tracking page on a phone: long pickup-point text runs off the screen (horizontal scroll) and there is no language switch
- Page: /ar/s/wnsMFrft_gkPKCWe (order #CMD-1023), /fr/s/… (visitor, ar / fr, 390 × 844)
- Severity: Minor
- Type: Bug
- Steps: 1. On a 390 px phone open the tracking link of a stop-desk parcel whose desk name is long (here « تتبع QA 😀 XXXX… », written by another area). 2. Swipe sideways. 3. Look for FR · AR · EN.
- Expected: the subtitle wraps inside the card, no horizontal scroll (README rule 5, 390 px; 12 §0 RTL); the customer who opens the SMS / QR link can switch language as on the other public pages (landing / pricing / deletion show FR · AR · EN in the footer on a phone).
- Actual: page width 461 px for a 390 px screen: `SPAN.ts-label-micro` « LIVRAISON PROPRE · وهران · مكتب الاستلام · تتبع QA 😀 XXX… » and its `BDI` span start at x = −71 (RTL) and push the page sideways. At 390 px the header FR · AR · EN buttons are hidden, the « Menu » panel has no language entry, and the tracking page has no footer: no language switch at all on a phone.
- Evidence: .local/qa/campaign/public/ar-390-track-overflow.png · scrollWidth 461 / clientWidth 390

### PUBLIC-08 — Test content is published on the public site: a guide named « test » and two « test » incidents on the status page
- Page: /fr/help-center, /fr/help/test, /fr/status (visitor, fr / ar / en)
- Severity: Minor
- Type: Text
- Steps: 1. Open Aide › « Tous les guides ». 2. Open /status, scroll to « Historique des incidents ».
- Expected: only real guides and real incidents are public.
- Actual: guide « test » (« Une spécification de test contient des informations détaillées sur ce qui doit être testé », mis à jour le 21 oct. 2026) is listed second in « Tous les guides » and has its own page /fr/help/test. The status page shows « 21 OCT. 16:03 → 16:04 — RÉSOLU · test · SIGNALÉ 16:03 : TEST · MISE À JOUR 16:04 : TEST » and « 21 OCT. 15:54 → 16:03 — RÉSOLU · test ».
- Evidence: API: GET /status → incidents[].title = "test" · GET /help/articles → slug "test"

### PUBLIC-09 — The free plan is called « Gratuit pro max » on the French pricing page
- Page: /fr/pricing (visitor, fr, 1440)
- Severity: Minor
- Type: Text
- Steps: 1. Open Tarifs in French.
- Expected: « Gratuit » (as AR « مجاني » and EN « Free »).
- Actual: the first card title is « Gratuit pro max ». The plan name was edited in the admin (data, not code): GET /plans → `{"slug":"free","name":"Gratuit pro max", …}`; the same name shows wherever the FR plan name is used. Also `trialDays` of the free plan is 30 while the whole site promises « Essai gratuit 14 j ».
- Evidence: API: GET /plans → 200 `name: "Gratuit pro max"`

### PUBLIC-10 — Sign-up « plan choisi » note never names the plan, is shown for unknown plans, and reads oddly for Pro
- Page: /fr/signup?plan=pro&cycle=yearly, /fr/signup?plan=bogus&cycle=weird (visitor, fr)
- Severity: Minor
- Type: Text
- Steps: 1. Tarifs › Annuel › « Essai gratuit 14 j » on Pro. 2. Read the note above the form. 3. Open /fr/signup?plan=bogus&cycle=weird.
- Expected: the note names the chosen plan and cycle (`auth.signup.planIntent`, 12 §17 « sign-up from /pricing shows the chosen plan note »), and an unknown plan / cycle is ignored (as `plan=free` already is).
- Actual: « Plan choisi (annuel) : vous commencez par 14 jours d'essai Pro gratuits, puis vous passerez à ce plan depuis Plan & facturation quand vous voulez. » — no plan name, and for Pro it tells the visitor to switch from the Pro trial to « ce plan » (Pro). With `plan=bogus&cycle=weird` the same note appears as « Plan choisi (mensuel) ».
- Evidence: signup page text (04-signup run)

### PUBLIC-11 — Invalid links are all called « expired »: verify-email, shared agent test link, invitation
- Page: /fr/verify-email?token=abcdef0123456789, /fr/agent-test/bad, /fr/invitations/bad, /fr/account/deletion?token=badtoken (visitor, fr / ar)
- Severity: Minor
- Type: Text
- Steps: 1. Open each page with a made-up token.
- Expected: an unknown / mistyped token shows an « invalide » state (as /reset-password does: « Lien invalide ») and only a really expired token the « expiré » state (12 §17 Vérification e-mail « expiré (`AUTH_VERIFY_TOKEN_EXPIRED`) »; route map /agent-test « expired link (410) »).
- Actual: verify-email → API 410 `AUTH_VERIFY_TOKEN_EXPIRED` for a random token → « Lien de vérification expiré — Ce lien n'est valable que 24 h. »; agent-test → API 404 `NOT_FOUND` but page « Lien expiré — Lien de test expiré (24 h) »; invitation → API 404 but « Invitation expirée — Cette invitation a expiré (7 jours) ou a été révoquée »; /account/deletion?token=badtoken → « Ce lien a expiré (24 h). » (spec 12 §27 has separate « LIEN EXPIRÉ » and « partial deletion link » states). Same in AR. A user who mistyped the link is given the wrong reason.
- Evidence: API: POST /auth/verify-email → 410 · GET /agent-test/bad → 404 · GET /invitations/bad → 404

### PUBLIC-12 — Every public page calls POST /auth/refresh for a visitor and logs a 401 console error
- Page: every public / auth page (visitor, fr / ar / en)
- Severity: Cosmetic
- Type: Performance
- Steps: 1. Open any public page without being signed in, look at the console / network.
- Expected: no failing call for a plain visitor, clean console.
- Actual: `POST /auth/refresh → 401 UNAUTHORIZED « Session expirée, reconnectez-vous. »` on every page load (an extra API round trip), shown as « Failed to load resource: … 401 » in the console.
- Evidence: kit log of every run · API: POST /auth/refresh → 401

### PUBLIC-13 — Signed-in users still see « Se connecter / Essai gratuit 14 j » on the public pages, and the pricing buttons send them to sign-up
- Page: /fr, /fr/pricing, /fr/help-center (owner signed in, and the new account qa-public-1, fr, 1440)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Sign in. 2. Open https://djaber.vercel.app/fr (or click the logo from a help guide). 3. Click « Essai gratuit 14 j » on the Pro card of /fr/pricing.
- Expected: the header offers « Ouvrir Djaber » as /status already does, and the pricing buttons lead a signed-in owner to Plan & facturation (`/settings/billing?change=<slug>&cycle=`, route map /pricing).
- Actual: header « Se connecter · Essai gratuit 14 j »; « Se connecter » / « Essai gratuit » / pricing CTA `/fr/signup?plan=pro&cycle=monthly` bounce the signed-in user to /fr/home (or to onboarding), the chosen plan is lost.
- Evidence: page text of 03-login / 16-newacct runs

### PUBLIC-14 — Forgot / reset password, verify e-mail and invitation pages have no FR · AR · EN switch
- Page: /fr/forgot-password, /fr/reset-password?token=…, /fr/verify-email?token=…, /fr/invitations/… (visitor, any width)
- Severity: Cosmetic
- Type: UX
- Steps: 1. Open « Mot de passe oublié ? » from the login page. 2. Look for the language switch.
- Expected: the same FR · AR · EN switch as /login and /signup (same AuthLayout, 12 §17 « language FR/AR/EN switch »), so a user who opens an e-mail link in the wrong language can change it.
- Actual: no language control on these four pages (the login page shows FR · AR · EN under the card).
- Evidence: page text of the crawl (fr / ar)

### PUBLIC-15 — Empty e-mail field says « E-mail invalide » instead of « Champ requis »
- Page: /fr/login, /fr/signup, /fr/forgot-password, /fr/account/deletion, /fr/status (subscribe dialog) (visitor, fr)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Submit the form with every field empty.
- Expected: « Champ requis » for an empty required field (as the password / name / checkbox fields of the same forms show).
- Actual: the empty e-mail field shows « E-mail invalide » while the empty password shows « Champ requis ».
- Evidence: login text « E-MAIL | E-mail invalide | MOT DE PASSE | Champ requis »

### PUBLIC-16 — Legal version history row is missing a space: « v1 · 14 oct. 2026· en vigueur »
- Page: /fr/legal/terms (and every legal page, fr / ar / en)
- Severity: Cosmetic
- Type: Text
- Steps: 1. Open a legal page, look at « Historique des versions ».
- Expected: « v1 · 14 oct. 2026 · en vigueur ».
- Actual: « v1 · 14 oct. 2026· en vigueur » (AR « 14 أكتوبر 2026· ساري », EN « 14 Oct 2026· in force »).
- Evidence: page text of the crawl runs

## Coverage
- **Landing /, /features** — fr / ar / en, 1440 + 390 (fr, ar): text, every header / footer link (all 200), CTAs « Essai gratuit » / « Voir les fonctionnalités », phone « Menu » panel (opens, Esc closes), title / meta / canonical / hreflang (PUBLIC-01), HTML weight (PUBLIC-04), security headers (PUBLIC-03).
- **Pricing** — fr / ar / en, 1440 + 390: Mensuel / Annuel toggle (radios, `?cycle=yearly` kept in URL and on F5), yearly price 4 083 DA / mois · facturé 49 000 DA / an, CTA URLs per cycle, FAQ accordion (5 items open), plan names (PUBLIC-09).
- **Help centre /help-center, /help/[slug]** — fr / ar / en, 390: 8 category cards, `?category=` (F5 keeps it, unknown category ignored), search (results, no result, Arabic, `<script>` text rendered as text, spaces only, « Effacer les filtres »), every guide page (all 200), unknown slug → public 404, visitor `/help?article=help-stock` → /help/help-stock. Search quality / one-sentence guides already reported as HELP-01 / HELP-02 (same API), not repeated.
- **Legal pages** terms / privacy / account_deletion / content_rules / cookies / data-deletion — fr / ar / en interface × FR · AR · EN document tabs (`?lang=`), version + « en vigueur depuis », history row, unknown key → 404 (PUBLIC-02, PUBLIC-16).
- **Status /status** — fr / ar / en, 390: components, 90-day %, incident history (PUBLIC-08), « S'abonner aux incidents » dialog: empty, bad e-mail, valid `qa-public-status@test.djaber.local` → 202 « Un e-mail de confirmation a été envoyé… », Esc; /status/confirm/bad and /status/unsubscribe/bad → « lien n'est plus valide ».
- **Login** — fr / ar / en, 390: empty, wrong format, unknown account (`AUTH_INVALID_CREDENTIALS` at form level, password kept), show-password button, « Mot de passe oublié ? » carries the typed e-mail, « Créer un compte » keeps a safe `returnTo` and drops `//evil.example`, visitor on /orders → /login?returnTo=%2Forders, `reason=expired` notice, external `returnTo=https://example.invalid` ignored after a real sign-in (→ /fr/home), signed-in user on /login and /signup redirected, e-mail with upper-case + spaces accepted.
- **Sign-up** — fr / ar: empty, 1-char names, spaces-only names, 300-char names (« Trop long (80 max) »), wrong e-mail, weak passwords (letters only, digits only, 3 chars), e-mail taken (409 `AUTH_EMAIL_TAKEN` with Se connecter · Mot de passe oublié links carrying the e-mail), plan intent `?plan=pro|free|bogus&cycle=` (PUBLIC-10), double-click submit → one `POST /auth/register` (201). Real account created in Arabic with Arabic + emoji names → /ar/onboarding/welcome, F5 keeps the session, sign-in again lands on onboarding.
- **Forgot password** — fr / ar: empty, wrong, unknown and existing (`qa-public-1`) e-mail give the same « Si un compte existe… » text, 60 s cooldown counter with disabled « Renvoyer », `?email=` prefill.
- **Reset password** — no token / fake token → « Lien invalide » + resend form (sent state + cooldown). **Verify e-mail** — no token, fake long token (PUBLIC-11), short token, signed-in variant (« Renvoyer un lien »).
- **Invitation** /invitations/bad — fr / ar / en (PUBLIC-11).
- **Public tracking /s/[code]** — two real parcels of the test shop (CMD-1026, CMD-1023) + unknown code, fr / ar / en, 1440 + 390 (PUBLIC-06, PUBLIC-07); no recipient name / phone shown (OK); « Signaler ce vendeur » dialog opened in fr and ar: 5 reasons, details, e-mail, robot check, empty submit (« Champ requis », « Cochez la case… »), Esc closes — **not submitted** (pre-existing shop records).
- **Account deletion /account/deletion** — fr / ar / en, 390: steps text, empty, bad e-mail, unchecked « Je comprends » (Champ requis), valid no-account address `qa-public-nodel@test.djaber.local` → 200 « Vérifiez votre boîte e-mail… » + « Utiliser une autre adresse », `?token=badtoken` state.
- **Meta data-deletion /meta/data-deletion/xyz** (INTROUVABLE), **shared playground /agent-test/bad** — fr / ar / en.
- **Language switch** — FR → AR → EN on pricing (with `?cycle`), help (with `?q`), legal (with `?lang`), login (with `returnTo`), signup (with `plan`), tracking, deletion, status: path and query kept, `dir=rtl` in AR, `dir=ltr` in FR / EN. RTL: email input stays LTR; no horizontal scroll at 390 in AR except PUBLIC-07.
- **Unknown URLs** /fr/nope-page (PUBLIC-05), /fr/legal/nope (public 404 OK), robots.txt / sitemap.xml (PUBLIC-01).
- Kit text-leak scan (placeholders, codes, snake_case, undefined / null, ISO dates, i18n keys) on every page above in fr / ar / en: **no leak found**. Console errors: only the visitor `POST /auth/refresh` 401 (PUBLIC-12) and the expected 404s of unknown tokens.

## Blocked by safety
- None (no visitor call matched the kit's block list; the « Signaler ce vendeur » report was deliberately not submitted).

## Not tested
- Login rate limit / 2FA step / « trop d'essais » countdown: the test machine shares one IP with all the other agents and the four shared accounts; triggering `RATE_LIMITED` would lock them out. 2FA cannot be enabled on a shared account (kit rule).
- Real reset-password, verify-email, account-deletion confirm / cancel and status-subscription confirm links: mail to `@test.djaber.local` is not delivered, so no real token is available.
- Invitation pages with a real token (logged-out / logged-in variants) and a valid shared playground link: tokens are only in e-mails / created by a merchant action on other areas' records.
- Meta data-deletion status with a real code (none exists).
- The second sign-up account was not needed (one account covered the flow).
