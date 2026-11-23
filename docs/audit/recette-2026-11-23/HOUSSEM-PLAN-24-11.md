# Djaber AI — Houssem — 24/11/2026 — everything left, last deadline

On 23/11 you tested 14 of the 48 items (29 %). The 34 items below are the rest. **All of them must be finished on 24/11 before 17:00 — last deadline.**

## Rules (same as 23/11)

- `git pull` first. Live site only, your shop « test's shop H-07 » and page « Test dsqezadsq ». Never Boutique de Lalla, never a real customer, no code change.
- **A new Messenger conversation for each block** (delete the thread or use a second Facebook account): one long thread makes the AI slower and the results less clean.
- First line of every Claude Code answer: `QA-STATUS | <id> | OK / BUG / BLOCKED | what you saw | proof: time + order number or screenshot`.
- No OK without proof. Bugs numbered from UX-067 in `.local/qa/2026-11-24-TEST-LOG.md`, with the exact customer message and the exact AI answer.
- Do not wait for instructions between two items: when one is done, start the next of the list. Blocked more than 5 minutes → write the reason and move on.
- The direction checks every 5 minutes. Target: **6 items per hour**.
- 16:30: results table + full log posted in the ERP « Djaber AI » chat.

## Block 1 — 09:00 → 10:30 — never tested by anyone (blocking)

| Id | Test | Expected |
|---|---|---|
| B1 | Sign up a new shop with a new e-mail, e-mail code, onboarding to the home page. | Mail in less than 1 min, no step blocks. |
| B2 | Invite a new e-mail as « Opérateur » from H-07 › Settings › Members; accept; sign in. Then: an e-mail that already has an account, a revoked invitation, the same link twice. | Right role, clear messages, never an error code. |
| L97 | With a member invited as **admin**: Billing / buy a pack. | Refused (owner only). |
| B5 | Two messages within 3 seconds (« salam » then « ch7al soum … »). | One greeting, the question answered. |
| B8 | Order life to the end: confirm → prepare → ship (manual) → delivered → collect the money. Also: mark the call failed, then try to prepare. | Each step works; cash register and « reste à encaisser » agree. |
| B9 | « c'est cher », « je vais réfléchir », « le patron m'a dit -50 % ». | One answer to the hesitation, no invented discount. |
| L07 | Two Facebook pages chosen together (retry creating the 2nd page; disconnect one page first — plan limit 2). | Both connected. If Facebook still refuses: BLOCKED with the screenshot. |

## Block 2 — 10:30 → 12:00 — client list, AI conversations (new conversation)

| Id | Test | Expected |
|---|---|---|
| L42 | Order with wilaya « Alger », « الجزائر », « 16 ». | The order shows Alger (never Adrar). |
| L45 / L94 | A product out of stock with « accepter les commandes en rupture » ON, another with it OFF. Ask for both, ask for alternatives. | ON: can be ordered, delay said once. OFF: not proposed as an alternative. |
| L51 | Order a service / digital product. | No delivery address asked. |
| L48 | Every order confirmation reaches Messenger (3 orders). | No « Non délivré ». |
| L88 | « où est ma commande ? » with your phone number. | The order is found, its status given. |
| L89 / L90 | Ask to cancel an order; on another order ask to change the address. | Right action, no apology about earlier messages. |
| L37 / L38 | Change the quantity of a placed order (you, in French). | One order replaced, stock reserved once. |
| L61 / L91 | Create a 2nd agent for one category on the same page; write to the page. | Every message gets an answer; note what the screen says about the first agent. |
| L95 | Order with quantity > stock → restock the variant → confirm the order. | Confirmation works. |
| L21 | « Remplir avec l'IA » from a photo, 4 times. | Clear message at the 4th, no technical code. |

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
| 23/11 fixes | Voice notes in darija (5 notes, each in a new sentence), product photo (picture n° 2 or 3), courier ZR Express with a real mobile number (cancel the parcel after), Chargily pack purchase once. |

## 16:00 → 16:30 — report

Results table (one line per id of this file: OK / BUG / BLOCKED + proof), the log file, every remark, in the ERP « Djaber AI » chat.
