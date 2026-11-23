# Client project manager's list (Boutique de Lalla, sheet shared 22/11) — retest 23/11

She tested last week and counts 22 fixed / 56 still failing. Every open line of her sheet is below, numbered by its row (L02 = row 2).
**Owner H = Houssem** (needs a real Facebook / Messenger account, a phone, e-mail, time, or a second member) — **mandatory, before the B / N / RETEST parts of HOUSSEM-PLAN.md**.
**Owner C = Claude** (screens and data, checked by the direction's Claude Code).

## Rules for Houssem (no exception)

- Reproduce in **your** shop « test's shop H-07 » (page « Test dsqezadsq »), never in Boutique de Lalla. Set up what the line needs first (variants, out-of-stock product with « accepter les commandes en rupture », digital/service product, product with 3 photos, quantity limit on the agent…).
- **No OK without proof.** Every status line carries the proof:
  `QA-STATUS | L29 | OK / BUG / BLOCKED | <what you saw> | proof: <time of your Messenger message HH:MM> + <order number or screenshot file>`
  The direction checks each Messenger test in the database (message, reply, reply time, order) — a status that does not match the database is sent back.
- One line = one test. Do them in the order of the table. A BUG gets a UX number (from UX-066) in your log with the exact customer message and the exact AI answer.

## H — Houssem (real Messenger / Facebook / phone / e-mail / time)

| Id | Her note (short) | What to do / expected |
|---|---|---|
| L06 | Add a Facebook page: « Aucune page trouvée sur ce compte Meta » | Channels › connect Facebook with an account that manages a page. The page list shows the pages. |
| L07 | Two pages chosen, only one added | Choose 2 pages in the Meta window. Both are connected. |
| L03 | Session expires every 5–15 min | Work 45 min without signing out (keep the tab open, go idle 20 min once). Never « Session expirée » while active. Note the times. |
| L04 / L27 | Reply after 7 s although the agent waits 3 s | Agent delay = 3 s. Send 5 messages; note each send time. Reply ≤ delay + ~5 s. |
| L28 / L29 / L30 | Only the first photo; « je vous envoie les photos » then nothing; photos added later not used | Product with 3 photos: ask « je veux voir les photos » / « حبيت نشوف الصور ». All photos arrive, or no promise. Add a 4th photo, wait 5 min, ask again: it is used. |
| L31 | « الجزائر العاصمة » not understood, « Alger » is | Give the wilaya in Arabic, in French and in arabizi (« dzayer »). Fee given each time. |
| L42 | Customer said Alger, order saved Adrar | Order with wilaya « Alger », « الجزائر », « 16 ». The order shows Alger. |
| L40 | Stop-desk fee sometimes 0, sometimes 250 | Choose stop-desk twice in 2 conversations. Same fee as Delivery settings. |
| L41 / L92 | Language not followed (« Slt » → English; « ماهي المنتجات اللي عندكم » no answer) | « Slt », « salam ch7al », « ماهي المنتجات اللي عندكم », « hello ». Answer in the customer's language; never silence. |
| L55 / L93 | Product list misses products (backorder, digital, restocked) | Ask « quels produits vous avez ? ». Every active product of the agent is offered (incl. backorder, digital, just restocked). |
| L94 / L45 | Proposes out-of-stock alternatives; says « rupture » at every step for a backorder product | Out-of-stock product not accepted → not proposed. Backorder product → can be ordered, delay said once, not at every message. |
| L51 | Digital / service product: asks quantity / address | Order the service product. No delivery address asked; quantity only if it makes sense. |
| L37 / L38 | « Change the quantity of my order » → a second order is created | After an order, ask to change the quantity. No duplicate order; stock reserved once. |
| L39 | Quantity above the limit → team; the customer lowers it → no answer; after « reprendre » the AI apologises for « ma réponse précédente » | Agent limit 10, order 50, then « ok 5 ». Clear path, no silence, no apology for an earlier message. |
| L48 | Customer confirms, receives nothing; order « Non délivré — Service indisponible » | Every confirmation reaches Messenger. Note any « Non délivré ». |
| L89 / L90 | AI offers to cancel an active order; address change → « mon message précédent contenait des erreurs » | Ask to cancel, then (new order) to change the address. Correct action, no apology about earlier messages. |
| L88 | « couldn't find any order under this number » | Ask the status of your order with your phone number. The order is found. |
| L56 | Same photo as the product, not recognised | Send the product's own photo. Product named with price. |
| L59 | Voice note: no answer, not in the queue; later a reply in Russian | Send a voice note in darija. Today voice is off: the customer must get a polite written answer or the conversation must appear « to handle » — never silence, never another language. |
| L61 / L91 | A 2nd agent for one category takes the whole page; an active agent does not answer | Create agent 2 for one category on the same page; note what the screen says, then write to the page. Every message gets an answer from an agent. |
| L95 | Confirm (call) an order with quantity > stock after restocking: « Ajustez le stock par variante » | Restock the variant, then confirm the order. Confirmation works. |
| L97 | An « admin » member can buy a pack (billing should be owner only) | With the member invited in B2 as admin: Billing / buy pack must be refused. |
| L21 | Fill with AI from a photo: limit 3 per day | Use « remplir avec l'IA » 4 times. Clear message at the 4th, no technical code. |

## C — Claude (screens and data)

L02 small grey sub-titles · L12 / L13 category dialogs in English · L19 main product image cannot be changed · L23 product import from Excel · L26 playground: Arabic question not answered · L44 order detail without the variant · L57 « mode simple » text vs variants · L58 variant details only through « modifier » · L60 filter « Utilisé par un agent » empty · L65 / L66 product sheet: category and alert threshold missing · L67 / L68 « Agents & canaux » / « Voir dans Agent IA » titles · L69 link a product to an agent does not stick · L71 product back « en attente » after a title / photo change · L73 archived products list · L74 stock reason « Alimentation » missing · L75 / L76 stock adjustment with negative stock / backorder product · L77 export misses stock-tracking / backorder fields · L78 re-import of the exported file (duplicate SKU, variants, negative stock) · L80 order import keeps today's date · L81 imported order cannot be cancelled · L82 import products from a connected page (AI_PROVIDER_ERROR) · L85 report filters show one element · L86 recommendations « ignorer » · L87 search fields: clicking a suggestion does nothing · S2 super admin sees AI-filtered products.
