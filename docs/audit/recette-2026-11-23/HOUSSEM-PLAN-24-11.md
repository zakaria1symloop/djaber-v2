# Djaber AI — Houssem — 24/11/2026 — everything left, last deadline

On 23/11 you finished 21 of the 48 items of the plan (the client's list: 18 of its 23 rows), plus the courier and Chargily tests, and you logged 17 bugs (UX-066 to UX-082). Most were fixed the same day; block 0 below checks the fixes. The items below are all that is left. **All of them must be finished on 24/11 before 17:00 — last deadline.**

## Rules (same as 23/11)

- `git pull` first. Live site only, your shop « test's shop H-07 » and page « Test dsqezadsq ». Never Boutique de Lalla, never a real customer, no code change.
- **A new Messenger conversation for each block** (delete the thread or use your second Facebook account): one long thread makes the AI slower and the results less clean.
- First line of every Claude Code answer: `QA-STATUS | <id> | OK / BUG / BLOCKED | what you saw | proof: time + order number or screenshot`.
- No OK without proof. New bugs numbered from **UX-083** in `.local/qa/2026-11-24-TEST-LOG.md`, with the exact customer message and the exact AI answer.
- Do not wait for instructions between two items: when one is done, start the next of the list. Blocked more than 5 minutes → write the reason and move on.
- The direction checks every 5 minutes. Target: **6 items per hour**.
- 16:30: the log file attached in the ERP « Djaber AI » group, as on 23/11 (not through « tell symloop admin »: that message is cut at 4 000 characters).

## Block 0 — 09:00 → 09:40 — retest of the fixes of 23/11 evening (new conversation)

| Id | Fix to check | Test | Expected |
|---|---|---|---|
| R1 | UX-081 / L90 | Order with phone A. Order again with phone B. Then « je veux changer l'adresse de ma commande CMD-… : cité 500 logements bâtiment 2 » (the first order). | No handoff, nothing asked again: a new recap with the same product, name, phone A and the new address, « Elle remplacera la commande … ». « oui » → new order, the old one cancelled. |
| R2 | UX-080 / L55 | « quels produits vous avez ? », then the same in Arabic. | Every orderable product with its price: in stock, the service, the product « accept orders when out of stock », « Recette H-26 à refuser ». No out-of-stock product. |
| R3 | UX-082 / L51 | « je veux commander le service Website Development », give name and phone. | No wilaya, no address asked. Recap: the service, « Total : 30 000 DA. » — no « Livraison », no « à payer à la livraison ». « oui » → order without delivery (order page: no address). |
| R4 | UX-079 | After talking about a product: « slt », later « hello ». | A greeting and « comment puis-je vous aider ? » — no product, no price, no reservation offer, no old recap. |
| R5 | UX-078 | Buy a pack → on Chargily « Cancel » → return. Then once « Fail ». | Cancel: « CANCELLED · Payment cancelled · You cancelled the payment… ». Fail: no code « PAYMENT_FAILED » in the text. Credits unchanged. |
| R6 | UX-077 / L56 | Send picture n° 3, then n° 4 of « QA 23/11 photos », no text. | The product named with its price each time; note the reply time. |
| R7 | UX-070 | Order in Arabic, then ask a new order in French. | Recap and confirmation in French. |
| R8 | UX-072 | Customer already known: « nouvelle commande : 1 QA 23/11 photos, stop-desk à Alger, commune Bab Ezzouar ». | The recap comes at once, without asking for it. |

## Block 1 — 09:40 → 11:00 — never tested by anyone (blocking)

| Id | Test | Expected |
|---|---|---|
| B1 | Sign up a new shop with a new e-mail, e-mail code, onboarding to the home page. | Mail in less than 1 min, no step blocks. |
| B2 | Invite a new e-mail as « Opérateur » from H-07 › Settings › Members; accept; sign in. Then: an e-mail that already has an account, a revoked invitation, the same link twice. | Right role, clear messages, never an error code. |
| L97 | With a member invited as **admin**: Billing / buy a pack. | Refused (owner only). |
| B5 | Two messages within 3 seconds (« salam » then « ch7al soum … »). | One greeting, the question answered. |
| B8 | Order life to the end: confirm → prepare → ship (manual) → delivered → collect the money. Also: mark the call failed, then try to prepare. | Each step works; cash register and « reste à encaisser » agree. |
| B9 | « c'est cher », « je vais réfléchir », « le patron m'a dit -50 % ». | One answer to the hesitation, no invented discount. |
| L07 | Two Facebook pages chosen together (retry creating the 2nd page; disconnect one page first — plan limit 2). | Both connected. If Facebook still refuses: BLOCKED with the screenshot. |

## Block 2 — 11:00 → 12:00 — client list, what is left

| Id | Test | Expected |
|---|---|---|
| L61 / L91 | Create a 2nd agent for one category on the same page; write to the page. | Every message gets an answer; note what the screen says about the first agent. |
| L95 | Order with quantity > stock → restock the variant → confirm the order. | Confirmation works. |
| L21 | « Remplir avec l'IA » from a photo, 4 times. | Clear message at the 4th, no technical code. |

Already done on 23/11 (not to redo): L03, L06, L28–30, L31, L37 / L38, L39, L40, L41 / L92, L42, L45 / L94, L48, L56, L59, L88, L89.

## Block 3 — 13:00 → 14:30 — new features

| Id | Test | Expected |
|---|---|---|
| N1 | Saved views « Vues » on orders, products, clients: save, reopen, share, delete, `?view=` link. | Filters come back; bad link = normal list. |
| N2 | Public page `/fr/account/deletion`: request with an e-mail, twice. | One e-mail per address. |
| N3 | Change a sale's payment method; same on a closed cash day. | Payments follow; closed day refused with a sentence. |
| N4 | Reports › Paiements + XLSX export. | « Encaissé » and « Payé » separate, totals rows. |
| N5 | Number fields (price, fee grid, threshold): empty, « -5 », « 0 », « 12,5 ». | Refused values not saved, reason said. |
| N6 | Public tracking with a wrong code `/fr/s/XXXX`. | A real « not found » page. |
| N7 | A risky client: list and export. | Same risk in both. |
| N8 | Agent screens (test chat, personality, FAQ, « EXCLU ») in fr / ar / en. | No raw code, no `{placeholder}`. |

## Block 4 — 14:30 → 16:00 — retests

| Id | Test |
|---|---|
| UX-058 … UX-065 | Your eight logs of 12/11 (cash export dates, technical codes, disabled reasons, deletion e-mail, STOCK card age, Revenue 30d, failed courier send, « To handle » slots). |
| Voice | 5 voice notes in darija, each a different sentence (price, photos, delivery fee, an order, a product that does not exist). |
| UX-074 | Courier ZR Express with the test phone 0512345678: the refusal reason is readable, without a field name or « {CollectionIndex} ». |

## 16:00 → 16:30 — report

Results table (one line per id of this file: OK / BUG / BLOCKED + proof) and the log file, attached in the ERP « Djaber AI » group.
