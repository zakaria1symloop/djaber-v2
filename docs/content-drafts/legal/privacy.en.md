---
key: privacy
type: legal
legalDocKey: privacy
locale: en
title: Privacy policy
---
Brouillon — à faire relire par un juriste avant publication

This policy explains which data Djaber processes, why, who it is shared with, how long it is kept and how to exercise your rights. It applies to the website, the web app, the mobile app ⟦À VÉRIFIER : remove the mentions of the mobile app, Google Play / App Store and Firebase if the app is not published yet⟧ and the AI agents that answer on Messenger and Instagram for the shops that use Djaber.

## 1. Who we are

Djaber is a service published by ⟦À COMPLÉTER : company name and legal form⟧, registered in the trade register under no. ⟦À COMPLÉTER : RC⟧, tax id (NIF) ⟦À COMPLÉTER : NIF⟧, registered office ⟦À COMPLÉTER : full address⟧, Algeria.

Contact for any question about your data: ⟦À COMPLÉTER : personal data contact e-mail⟧. Data protection officer or person in charge: ⟦À COMPLÉTER : DPO name or role⟧.

The processing described here is subject to Algerian Law no. 18-07 of 10 June 2018 on the protection of natural persons in the processing of personal data. Declaration / authorisation with the National Authority for the Protection of Personal Data (ANPDP): ⟦À COMPLÉTER : ANPDP receipt number and date⟧.

## 2. Two different roles

- For the accounts of merchants and their teams (sign-up, login, billing), Djaber is the data controller.
- For the data of a shop's customers (Messenger / Instagram messages, orders, delivery addresses), the shop is the data controller and Djaber acts as its processor: we process this data only to provide the service to the shop and according to its settings.

If you are a customer of a shop, the shop is your first point of contact. You can also write to us: we will forward your request to the shop concerned.

## 3. Data we process

Merchant account and team members:

- first name, last name, e-mail address, password (stored only in an irreversible encrypted form), phone and profile picture if you add them, preferred language;
- two-factor authentication if you turn it on (secret and recovery codes, encrypted);
- login sessions: IP address, browser or device, dates; notification tokens of the mobile app;
- acceptance of the legal documents (version, date, IP address, web or mobile);
- audit log of sensitive actions (who did what and when, IP address).

Shop:

- name, logo, phone, address, shipping wilaya, billing details (company name, tax id, address, VAT);
- products, prices, stock, purchases, sales, cash register, suppliers;
- connected Facebook pages and Instagram accounts: page ids and Meta access tokens (encrypted);
- credentials of the services you connect (couriers, Google Sheets), encrypted;
- subscription, invoices, payments and credit usage.

The shop's customers:

- Messenger / Instagram display name and profile picture, the page-scoped Meta id;
- content of the conversations: texts, photos and voice messages sent to the page, replies of the AI agent and of the team, internal notes;
- order details: name, phone, address, wilaya and commune, products, amounts, delivery status, confirmation calls and their outcome;
- history useful to the shop: number of orders, returns, uncollected parcels, risk level, a possible block.

Website visitors: only the data strictly needed to run the site (see the Cookie policy), and your e-mail address if you subscribe to incidents on the Status page or report a seller from a tracking page.

Support: messages, attachments and the technical context you choose to attach to a ticket (workspace, plan, browser, page, last error). Your customers' messages are never attached automatically.

We do not collect bank details: CIB / Edahabia card payments are entered directly on Chargily's payment page.

## 4. Why we process it

- To provide the service: receive the messages of your pages, let the AI agent answer, create and track orders, manage stock, send parcels to couriers, sync Google Sheets, send notifications.
- To manage accounts, security (login, two-factor authentication, abuse detection) and support.
- To bill the subscription and the credit packs.
- To review products before the AI offers them (moderation) and handle reports.
- To meet our legal obligations (accounting, answers to the authorities).

Basis: the contract with the merchant, the shop's instructions for its customers' data, consent where it is required, and our legal obligations. ⟦À VÉRIFIER : legal bases to be validated by the lawyer under Law 18-07⟧

We do not sell data and we do not use it for advertising. The website contains no advertising tracker and no third-party audience measurement tool.

## 5. The AI agent

To answer a customer, Djaber sends the AI provider the message received (text, photo or voice message), the recent history of the conversation and the shop information needed for the answer (approved products, prices, delivery, the agent's instructions). The answer is generated automatically: it may contain mistakes, and the agent hands over to the shop's team in the cases set in its settings. The AI only creates an order after the customer has explicitly confirmed the recap.

⟦À VÉRIFIER : confirm, for each AI provider used, that its API terms exclude the use of the data sent for training its models, and the country of processing⟧

## 6. Recipients and processors

The data is available to the shop's members according to their role (Owner, Admin, Operator), and to the authorised Djaber team (support, moderation, finance) within the limits of its task; a support access to a workspace is read-only, time-limited and logged.

Providers used to run the service:

- Hosting of the servers and the database: ⟦À COMPLÉTER : hosting provider name and server country⟧.
- Vercel Inc.: hosting and delivery of the web app.
- File storage (product pictures, attachments): ⟦À COMPLÉTER : on the server or S3 storage service — name and country⟧.
- Meta Platforms (Facebook, Messenger, Instagram): receiving and sending the messages of the connected pages.
- AI providers: ⟦À COMPLÉTER : exact list of the active providers — today Anthropic (Claude); depending on the platform configuration: OpenAI, Google (Gemini), Groq⟧.
- Couriers chosen by the shop: ZR Express, EcoTrack, Yalidine — receive the name, phone, address, commune, parcel content and amount to collect.
- Google (Google Sheets): only if the shop connects a sheet; orders are written into the shop's own sheet.
- Chargily: online payment of the subscription and packs (amount and invoice reference).
- Google Play and the App Store: purchase of credit packs in the mobile app.
- Firebase Cloud Messaging (Google): push notifications of the mobile app.
- E-mail sending: ⟦À COMPLÉTER : mail server used or Resend⟧.
- Cloudflare Turnstile: anti-bot check on some public forms, when it is turned on.
- The addresses the shop configures itself (webhooks, API keys) receive the data the shop chose.

## 7. Transfers outside Algeria

Some of the providers listed above process data outside Algeria. ⟦À COMPLÉTER : countries concerned and reference of the transfer authorisation issued by the ANPDP, or the safeguards adopted⟧

## 8. Retention periods

- Conversation messages and attachments: 12 months, then deleted automatically; the emptied conversation is anonymised.
- A conversation deleted by the shop: can be restored for 30 days.
- Technical events received from Meta and couriers: 7 days; payment events (Chargily, Google Play, App Store): 5 years.
- Customer cards created automatically that never got an order or a conversation: deleted after 90 days.
- Orders, sales, stock and customer cards with orders: as long as the shop exists; a customer card with orders is archived, not deleted.
- Deleted shop: permanently deleted 30 days after the request (can be cancelled during that time), except its subscription and pack invoices and payments, kept with its billing details only (see Invoices).
- Deleted account: 30-day grace period, then irreversible anonymisation (name replaced by "Membre supprimé" (deleted member), e-mail, phone, picture and two-factor authentication erased).
- Login sessions: 7 days, renewed on each use.
- Invoices, payments and pack purchases: 10 years (accounting obligation), also after the shop is deleted or an account is anonymised, with the shop's billing details only.
- Audit log: 24 months. Reports: 2 years after their decision (an open report is kept). Blocks: 2 years after they were lifted (an active block is kept as long as it applies).
- Technical history of the AI replies: 24 months; the personal data passed to the AI tools (name, phone, address of an order) is masked after 12 months.
- Technical tasks (imports, exports, analyses): 90 days after they end.
- A customer's deletion request (Facebook or e-mail): conversations deleted, customer card deleted or anonymised, see "Data deletion".

## 9. Security

Passwords irreversibly encrypted, access tokens (Meta, couriers, Google) encrypted, two-factor authentication available to everyone and mandatory for the Djaber team, role-based access, audit log, personal data masked in technical logs and in the Djaber team's screens.

## 10. Your rights

Under Law no. 18-07 you have a right to information, access, rectification and objection, and you can ask for the erasure of data that is inaccurate, incomplete or processed unlawfully.

- Merchants: you edit your profile in Settings › Profile; you can export your data (JSON + CSV) and delete your account from Settings › Profile or Danger zone, or from the public "Delete my account" page.
- Customers of a shop: contact the shop, or follow the "Data deletion" page for your Facebook / Instagram data; you can also write to us at the address below, in particular if the request made from Facebook shows "NO DATA FOUND".
- For any other request: ⟦À COMPLÉTER : personal data contact e-mail⟧. We answer within ⟦À COMPLÉTER : response time⟧.

You can lodge a complaint with the ANPDP.

## 11. Minors

The service is reserved for professionals and adults. ⟦À VÉRIFIER : minimum age⟧

## 12. Changes

Every new version is published on this page with its number and effective date; the version history stays available at the bottom of the page. For a significant change, you will be asked to read and accept the new version at your next login.
