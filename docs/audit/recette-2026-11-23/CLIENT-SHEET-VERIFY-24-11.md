# Client sheet (Boutique de Lalla) — every line still « Neg » checked by hand — 24/11

The client's project manager says the lines below are **not resolved**. Our own tests say most are fixed, but only a line **seen working by you, with proof**, counts. This file comes **before** blocks 1, 3 and 4 of `HOUSSEM-PLAN-24-11.md`.

Order of the day: finish B1 (started) → **block 0** of the plan (R1–R8) → **this file, parts A to D** → B2 + L97 → the rest of the plan if time is left.

Rules: your shop « test's shop H-07 » only. One `QA-STATUS | L<n> | OK / BUG / BLOCKED | what you saw | proof` line per row. A row that fails gets a UX number (from UX-083) with the exact steps. When a row is OK, take one screenshot named `L<n>-ok.png`: the direction sends them to the client.

## A — AI rows already re-fixed last night (= block 0, do not do twice)

L51 (service order) = R3 · L55 / L93 (product list) = R2 · L90 (address change) = R1 · L56 (photo n° 3) = R6.

## B — screen rows fixed on 23/11, never seen by a person (17 rows)

| Row | Her remark | Do this | Expected |
|---|---|---|---|
| L2 | Sub-titles too small and grey (orders table, order detail, other tables) | Open Orders (table), one order, Products (table), in French. | The small labels (column heads, « PAYÉ · RESTE », meta lines) are readable: 10–11 px, not pale grey on white. If one is still hard to read, screenshot it. |
| L19 | The main image of a product cannot be changed | Product with 3 photos › product page › photos. On photo 2: « Set as main ». | Photo 2 becomes the main one on the page, in the products table, and in the Messenger card (ask the AI for the product). |
| L26 | Test chat: « ما هي المنتجات المتوفرة من فضلك » → « L'IA n'a pas répondu » | AI agents › your agent › test chat. Send that sentence. | An answer in Arabic with the products, in less than 10 s. |
| L44 | The ordered variant is missing in the order detail | Messenger: order a product **with a variant** (« Satin dress rouge »). Open the order, in simple and in advanced stock mode. | The variant is written under the product name in the order detail, and in the orders table line. |
| L57 | Simple stock mode text says « no variants » but variants can be created | Settings › Stock mode. | The text of the simple mode no longer says there are no variants. |
| L58 | Variant details only through « Edit » | Products table › a product with variants › Actions › « Manage variants ». | It opens the product page on the variants table (names, prices, stock). |
| L60 | Filter « Used by an agent » gives an empty list | Products › Filters › « Used by an agent » (and « By no agent »). | The products your agents sell are listed; « By no agent » shows the others. |
| L65 | Product page: category missing | Open a product that has a category. | The category is shown in the Information block. |
| L66 | Product page: alert threshold missing | Same product, alert threshold set (e.g. 5). | The threshold is shown in the Stock block. |
| L67 / L68 | Titles « Agents & canaux » / « Voir dans Agent IA » | Product page, in French. | Block title « Agents IA »; the link says « Voir les agents IA qui le vendent » and opens the agents that sell it. |
| L69 | Linking a product to an AI agent does not hold | Agent set to « by categories » (one category). Add to it a product of **another** category. Reopen the agent, then the product page. Ask the agent's test chat for that product. | The product is still linked after reopening; the product page lists the agent; the agent sells the product. |
| L74 | Stock adjustment: reason « Alimentation » missing | Products › Adjust stock › reasons. | « Restock (reception) » / « Alimentation (réception) » is the first reason. |
| L75 | Negative stock (-15, option « accept orders when out of stock » off): cannot adjust | Product with stock -15 (make it with backorder ON + an order, then turn the option OFF). Adjust › « In » +20, then « Set » to 10. | Both are accepted (stock 5, then 10). Only an « Out » below zero is refused. |
| L77 | Product export misses stock tracking, backorder… | Products › Export (XLSX). Open the file. | Columns for stock tracking, « sell when out of stock », description, weight, keywords; each product followed by its variants. |
| L78 | Re-importing the exported file fails (duplicate SKU, negative stock) | Import the **same** exported file (Products › Import). | Preview without « duplicate SKU » or « negative stock » errors; products with their variants. Do not confirm the import if it would duplicate your data: the preview is the proof. |
| L80 | Imported orders take today's date | Orders › Import with a file that has a « Date » column (e.g. 15/11/2026). | The imported order is dated 15/11/2026. |
| L82 | Import products from a connected page: AI_PROVIDER_ERROR | Products › Import from a page › « Test dsqezadsq » › analyse. | The analysis ends with proposed products (or « no product found in the posts »), no error code. |
| L85 / L87 | Report filters show one element; clicking an article does nothing | Reports › Sales by category / by product › filters Category and Product. Pick one of each. | The whole list opens (sub-categories too); the picked product is shown in the filter and the report filters on it. |

## C — rows we answered « already there » or « works as intended »: show it, or log it

| Row | Her remark | Do this | Expected / to report |
|---|---|---|---|
| L73 | Archived products are not listed | Archive a product. Products › Filters › Status › « Archived ». | The archived product is listed and can be restored. |
| L71 | A product goes « pending » when its title or an image changes | Change the title of an approved product. While it is « pending », ask the AI for it on Messenger. | The AI still sells the last approved version (old title). If the AI no longer offers it: BUG. |
| L76 | « Insufficient stock » on a manual « Out » for a backorder product | Backorder product at stock 2 › Adjust › « Out » 5. | Refused with a clear sentence (works as intended: only orders may go below zero). Write the exact sentence. |
| L81 | An imported order cannot be cancelled | Cancel the order imported in L80. | Cancelled. If refused, write the exact message. |
| L86 | Ignored recommendations cannot be found again | Recommendations › ignore one › « History » tab (or Status › « Ignored »). | The ignored one is there. |
| S2 | Super admin: products filtered by the AI must be visible | Super Admin › Moderation › « Rejected » tab. | « Recette H-19 armes », « drogue »… are listed with the reason. |

## D — rows nobody tested yet

| Row | Her remark | Do this | Expected |
|---|---|---|---|
| L4 / L27 | Reply after 7 s although the agent is set to 3 s | New conversation, 5 short messages one at a time (« salam », « quels produits vous avez », « ch7al le prix », « livraison Alger ? », « merci »). Note the time of each message and reply from the Inbox. | Each reply within about 8 s. Give the five times. |
| L61 / L91 | Several agents (one per category) on the same page; « agent active but does not answer » | Create a 2nd agent for one category, add the page « Test dsqezadsq » to it. Write to the page about a product of that category, then of another. | Write exactly what the screen says about the first agent, and whether each message gets an answer. |
| L95 | Order with quantity > stock: after restocking, confirmation still refused (« Ajustez le stock par variante ») | (a) Variant at stock 1. Phone order of 3 (Orders › New). Restock the variant +5. Confirm the order. (b) Product WITHOUT variants, stock 1, order of 3; then add variants to the product, restock a variant, confirm the order. | (a) Confirmed. (b) Refused with « « <product> » a maintenant des variantes : modifiez la commande et choisissez la variante de cette ligne. »; after editing the line with its variant, confirmed. Write the exact message if it is anything else. |
| L97 | An admin can buy a pack (she expects owner only) | After B2: sign in as a member with the **admin** role › Settings › Credits and Settings › Plan. Open Settings › Members › « Voir les rôles ». | By the role rules an admin MAY buy a credit pack and pay an invoice, and may NOT change or cancel the plan (refused or hidden). The « Rôles » panel now says it: Admin « peut acheter des packs de crédits et payer les factures ; ne change pas le plan ». OK = the three points match. |
| L21 | « Fill with AI »: limit 3 analyses per day | Product › « Fill with AI » from a photo, 4 times. | The 4th says clearly the daily limit is reached, without a technical code. |
| L7 | Two Facebook pages chosen, only one added | Retry creating a 2nd Facebook page; connect both in one go. | Both connected. Facebook refuses the page again → BLOCKED with the screenshot. |
