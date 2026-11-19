---
key: help-purchases
type: help
category: stock
pages: [purchases, purchases/new, suppliers]
sortOrder: 42
locale: en
title: Supplier purchases and stock receipts
---
A purchase records what you order from a supplier; stock only goes up when you receive it. Each receipt recomputes the product's average cost price.

## Steps of a purchase
- Create the supplier if needed (Suppliers › “+ New supplier”).
- Purchases › “+ New purchase”: pick the supplier, the products or variants, the quantities and unit costs. The purchase is a “Draft”.
- “Order” moves it to “Ordered”: the amount becomes due to the supplier.
- “Receive”: type the quantities actually received, the date and, if you want, the “Supplier invoice no.” and a “Payment on receipt (DA)”. The purchase becomes “Part received” or “Received”.

Each receipt creates one entry movement (“Purchase received”) per line. A received quantity above the ordered one is accepted and completes the purchase order. Services and products without stock tracking cannot be purchased.

## Cost price
On each receipt, the cost price of the product (or variant) becomes the weighted average of the stock already there and the units received, rounded to the dinar. As long as no cost was typed or received, the cost price is unknown and no margin is computed.

## Pay the supplier
“Pay the balance” records a payment; each payment leaves the cash register on an automatic row. The balance due stays visible on the purchase and on the supplier card.

## Cancel or delete
- “Cancel the purchase” works as long as the purchase is not fully received. When part of it was received, those units stay in stock and stay due; only the unreceived rest is cancelled.
- A purchase can only be deleted while it is a “Draft” or “Ordered” and unpaid.
- To correct units already received, use a stock adjustment.

A deactivated supplier gets no new purchase: reactivate it first. Purchases are for the owner and the admins, in “Advanced” mode.
