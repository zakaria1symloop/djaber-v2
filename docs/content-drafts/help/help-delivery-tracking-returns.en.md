---
key: help-delivery-tracking-returns
type: help
category: orders_delivery
pages: [delivery]
sortOrder: 32
locale: en
title: Track parcels, failures and returns
---
Delivery & tracking groups your parcels in tabs and updates them with the courier statuses. Here is how to handle a failed delivery, cancel a parcel and record a return.

## Tabs
“To send”, “In transit”, “Failures”, “No movement” (no news from the courier for more than 5 days), “Returns” and “All”. “Send confirmed orders” sends the confirmed orders in one go. “Labels” prints the labels of the created parcels (thermal 100 × 150 or A6); each label carries a QR code to your customer's tracking page.

## Tracking
Djaber checks with the courier every 2 hours for the first 3 days, then every 12 hours. “Refresh” forces an update, at most once every 5 minutes per parcel. When the courier reports the delivery, the order becomes “Delivered” and the amount collected enters the cash register.

## Failed delivery
From the failed parcel:
- “Retry delivery” asks for a new attempt, when the courier allows it;
- “Fix address → retry” when the address was wrong: an order's address is locked once the parcel exists at the courier, so the parcel must be cancelled before the address can be fixed;
- “Mark returned” when the parcel comes back.

After 3 failures, Djaber suggests the return.

## Cancel a parcel
“Cancel parcel” works as long as the courier has not picked it up. After that the cancellation is refused: record the return when the parcel comes back. With the former ZR Express platform (Procolis), cancel in your ZR Express account. A shipped order cannot be cancelled: mark it “Returned”.

## Record a return
- Choose “Mark returned” on the order or on the parcel.
- Pick the RETURN REASON: “Address error”, “Customer absent / unreachable”, “Refused on delivery”, “Damaged parcel” or “Other”.
- Keep “Put back in stock” ticked when the items come back; unticked, they are counted as lost (a “Loss” movement).
- For a courier parcel, the return fee (the RETURN price of your grid, or the courier's) is recorded in the cash register. For self-delivery nothing is taken from the cash register.

Payments already recorded on the order are removed from the cash register: give the deposit back to the customer if you had collected it. The customer counts one more return and is flagged “risk” from 2 returns. Only the owner or an admin can mark an already delivered order as returned.
