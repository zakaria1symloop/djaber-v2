---
key: help-stock-variants
type: help
category: stock
pages: [products, products/new, products/edit]
sortOrder: 41
locale: en
title: Products with variants (size, colour…)
---
A product with variants has a stock, a price, a cost and an alert threshold per variant. Its total stock is the sum of its variants.

## Create the variants
In the product form, “Variants” section:
- “+ Add a variant” creates one variant by hand;
- “Generate variants” creates every combination at once: write one attribute per line, as “Name : value 1, value 2”, for example “Size : S, M, L, XL” then “Colour : Black, Red” (“+ Attribute” to add one).

The generator shows how many variants will be created, with an automatic SKU, a DEFAULT PRICE and a DEFAULT STOCK. Variants that already exist are kept. A product has at most 100 variants, and two variants of the same product cannot share a name. A SKU is unique across your whole catalogue, products and variants included.

## Edit a variant
On the product page, click a row of the “Variants” table to change its price, cost and threshold. A variant's stock is never edited directly: use “Adjust” on its row, so every change is logged in Movements.

## Stock and orders
- Orders, sales, purchases and stock counts work at variant level.
- An alert threshold can be set per variant.
- A product with variants always tracks stock: to make it a service, delete its variants first.
- A deleted variant is removed from the product and its stock no longer counts; past orders keep their line.

In conversations, the variant the customer names is the one the AI puts in the order recap.
