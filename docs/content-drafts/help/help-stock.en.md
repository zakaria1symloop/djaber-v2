---
key: help-stock
type: help
category: stock
pages: [products, stock, movements, inventory]
sortOrder: 40
locale: en
title: Manage your stock
---
Stock only moves through logged movements: confirmed orders, sales, received purchases, returns, adjustments and stock counts. A new order reserves the units without taking them out of stock.

## Reserved, available, out
- A new order reserves the stock: the product page shows it under “RESERVED (orders not confirmed yet)” and “AVAILABLE TO THE AI” goes down by the same amount.
- When you confirm the order, the units leave the stock (an “Order confirmed” movement).
- A cancelled order releases its reservation, or puts the units back in stock if they had already left (an “Order cancelled” movement).
- A received return puts the units back in stock (an “Order returned” movement).

An order is refused when the available stock is not enough, except for a product with “Accept orders when out of stock” ticked: it can still be ordered at stock 0, the stock may go below zero and the AI tells the customer that delivery may take a little longer.

## Adjust stock
Stock only moves through adjustments: “Adjust stock” (product page or Movements), with a positive or negative quantity and a reason. This action is for the owner and the admins. For a service or a digital product, untick “Track stock”: no quantity is tracked then.

## Movements
The Movements page lists every entry and exit with its reason. A movement is never edited or deleted: “Reverse” creates the opposite movement.

## Alert threshold
Set an “ALERT THRESHOLD” on the product (or per variant): you get an alert when the stock reaches it or goes below. The “Low stock / out of stock” report lists the products and variants concerned.

## Stock counts
- Open Stock counts, then “Start a stock count”: all the stock, one category or the products on alert. You can “Block counter sales during the count”; orders and the AI are not affected.
- Count, on the printable count sheet or by typing the quantities. A note is required for any gap above 10 %.
- “Validate the count” (owner or admin) creates one “Inventory” movement per gap. Only one count can be in progress at a time.

## Archive a product
When archiving, tick the option to release the remaining stock (an “Archiving” movement).

Movements, Stock counts, Purchases, Sales and Cash register only show in “Advanced” mode (Settings › Stock mode). Switching to “Simple” mode deletes nothing.
