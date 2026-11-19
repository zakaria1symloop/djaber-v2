---
key: help-orders-delivery
type: help
category: orders_delivery
pages: [orders, orders/new]
sortOrder: 30
locale: en
title: Confirm and ship an order
---
Every order goes through a confirmation with the customer, then preparation and shipping. Djaber updates the stock, the cash register and the customer card at each step.

## Order statuses
An order goes from “New” to “Confirmed”, “Preparing”, “Shipped” and then “Delivered”. It can also end “Cancelled” or “Returned”. The “Actions” menu only offers the moves allowed from the current status.

## Confirm by phone
- Open the order and choose “Call to confirm” in “Actions”.
- REVIEW step: check the items, the phone and the address. Wilaya, commune and address (or stop-desk) are required; otherwise click “Complete the address”.
- CALL step: call the customer, then pick the outcome: “Confirmed”, “No answer”, “Busy”, “Voicemail”, “Call back later”, “Refused” or “Wrong number”.
- RESULT step: a confirmed order offers the next step, “Prepare” or “Send to courier”.

“Refused” and “Wrong number” cancel the order as long as no parcel has left; “Wrong number” also flags the customer as “risk”. After 3 calls without answer, Djaber offers to cancel or to “Schedule a reminder”. To record a call outside the confirmation, use “Log a call”.

## After an unanswered call
While the last call went unanswered or a call back is planned, the order cannot move to preparing, shipped or delivered: “The customer has not confirmed yet: confirm the order first.” Confirm it with an answered call, or with “Mark confirmed” when the customer confirmed another way (by message, for example).

## Stock
A new order reserves the stock (“Reserved” on the product page) without any movement. On confirmation the units leave the stock (an “Order confirmed” movement). Cancelling releases the reservation or puts the units back in stock.

## Ship and deliver
- With a courier: “Send to courier”. When automatic send is on, a confirmed order goes to the default courier by itself: follow the parcel in the order's Delivery block.
- With your own delivery people: “Mark shipped (manual)” (tracking number optional), then “Mark delivered (self-delivery)”.
- On delivery, the amount collected offered is what is still due (deposit deducted). It enters the cash register on a locked automatic row.
