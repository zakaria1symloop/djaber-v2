# Djaber AI — test plan for Houssem — 23/11/2026

Version on line: web `a9c8c67` (djaber.vercel.app), API + AI `8ea005e`. Your last tested version was `5a27849` (12/11): 87 changes since.
**FIRST: the client project manager's list, part H of `CLIENT-LIST-LALLA.md` (same folder) — proof required on every line.** Then **BLOCKING**, then **NEW**, then **RETEST**.

## How to work (Claude Code)

1. In your `djaber-ai` folder: `git pull` (branch `deploy/tester-fixes-2026-10-22`), then tell Claude Code:
   « Read docs/audit/recette-2026-11-23/HOUSSEM-PLAN.md and follow it. Start with B1. »
2. Claude Code tests on the **live site** with Claude in Chrome. You do what it cannot do (Messenger from your phone, e-mails, passwords).
3. **Tracking (mandatory):** the last line of every Claude Code answer is one line of the form
   `QA-STATUS | <test id> | OK / BUG / BLOCKED / IN PROGRESS | <one short sentence>`
   (example: `QA-STATUS | B3 | BUG | the AI asked the wilaya twice — UX-066`). The direction reads these lines live through the ERP bridge.
4. Bugs go in `.local/qa/2026-11-23-TEST-LOG.md` (local file, never committed), same format as your earlier logs, numbered from **UX-066**: page, steps, what happens, what is expected, screenshot.
5. Blocked, or you need an account / an answer: type a prompt that starts with **« pour l'ERP : »** followed by your question. It goes straight to the direction.
6. End of day: send the log file and a short report in the ERP « Djaber AI » chat, like on 12/11.

Rules: live site only. Only your own shops and your own Facebook account. Never write to a real customer's page. Never change Meta or Facebook app settings. Never send a parcel to a real courier account (use manual delivery). No code changes, no commit, no push.

Your shops: « test's shop H-07 » (page « Test dsqezadsq », connected) and « test's shop ». Name every new item « QA 23/11 … ».

## BLOCKING — what a real merchant needs on day 1

| Id | Test | Expected |
|---|---|---|
| B1 | Sign up a new shop with a new e-mail (temporary mail is fine): e-mail code, onboarding steps to the home page. | Mail arrives in less than 1 min, no step blocks, home page shows the shop. |
| B2 | **Invitation (never tested):** from H-07 › Settings › Members, invite a second new e-mail as « Opérateur ». Open the mail, accept, sign in. Then: an invitation to an e-mail that already has an account; a revoked invitation; the same link used twice. | The member joins with the right role and sees only what the role allows; revoked / used links give a clear message, never an error code. |
| B3 | **Real Messenger:** from your own Facebook account, write to the page « Test dsqezadsq ». Full order in French: greeting → ask for a product → price → choose size / colour → name, phone, wilaya, commune, address → recap → « oui ». | Replies in less than ~10 s. One greeting only. All missing details asked together in one message. Product remembered (« celle-là » works). Recap with price + delivery fee. The order appears in Orders with the right items, fees and customer. |
| B4 | Same as B3 in **darija in Latin letters** (« salam, ch7al soum… ») and in **Arabic**. | The AI answers in the customer's language and script; sizes like « S وM » are not cut. |
| B5 | Send **two messages within 3 seconds** (« salam » then « ch7al soum la robe ? »). | One greeting only, the second reply answers the question (fixed 22/11). |
| B6 | **Photo:** add a product with a real photo (from the internet), add it to the agent, then send the same photo in Messenger. | The AI recognises the product and gives its price. |
| B7 | **Voice note** in Messenger. | Voice is not available yet (owner decision pending). Note exactly what the customer receives; it must be a polite message, never silence. |
| B8 | Order life: the B3 order › confirm → prepare → ship (manual) → delivered → collect the money. Also: mark the confirmation call as failed, then try to prepare. | Each step works; after a failed call the order must be confirmed before preparing (clear message). Cash register and « reste à encaisser » agree everywhere. |
| B9 | Hesitation and limits: « c'est cher », « je vais réfléchir », a quantity above the agent's maximum, « le patron m'a dit -50 % ». | One answer to the hesitation (value, cheaper product or cash on delivery), no pushing. Too large a quantity → handed to the team. No invented discount. |

## NEW — features delivered since 12/11

| Id | Test | Expected |
|---|---|---|
| N1 | **Saved views « Vues »** on the list pages (orders, products, clients, stock, sales, purchases…): save a filtered view, reopen it, share it with a member, delete it, open a link with `?view=`. | Same filters come back; shared view visible to the member; deleted view gone; a bad `?view=` link shows the normal list. |
| N2 | **Delete my Djaber account** (public page `/fr/account/deletion`): request with an e-mail, follow the link of the mail. Ask twice with the same e-mail. | One e-mail per address; status page readable in fr / ar / en. |
| N3 | **Sales:** change a sale's payment method; try the same on a day already closed in the cash register. | Payments and cash rows follow the change; a closed day is refused with a clear sentence. |
| N4 | **Reports › Paiements:** « Encaissé » and « Payé » are separate; export XLSX. | Money in and money out are never added together; the XLSX has total rows. |
| N5 | **Number fields** (prices, delivery fee grid, stock threshold): leave empty, type « -5 », « 0 », « 12,5 », click outside. | Empty stays empty while typing; a refused value is not saved and says why; threshold 0 / decimals refused where not allowed. |
| N6 | **Public tracking** with a wrong code (`djaber.vercel.app/fr/s/XXXX`). | A real « not found » page. |
| N7 | **Clients:** a risky client (returns) shows the same risk in the list and in the export. | Same rule in both. |
| N8 | **AI agent screens:** Agents › test chat (playground), personality, FAQ, products « EXCLU » reason. | Every screen in fr / ar / en, no raw code or `{placeholder}`. |

## RETEST — your logs of 12/11 (fixed since)

UX-058 (cash export dates in Algiers time), UX-059 (no technical codes on shop screens), UX-060 (disabled-action reasons as full sentences), UX-061 (one deletion e-mail per address), UX-062 (STOCK card age), UX-063 (Revenue 30d « N orders » line), UX-064 (failed courier send on a delivered order), UX-065 (« To handle » slots and « + N more »).
Status line per log: `QA-STATUS | UX-0xx | OK / BUG | …`.
