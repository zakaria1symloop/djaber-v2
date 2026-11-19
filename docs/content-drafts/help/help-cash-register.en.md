---
key: help-cash-register
type: help
category: stock
pages: [cash, sales, sales/new]
sortOrder: 43
locale: en
title: Cash register, counter sales and closing the day
---
The cash register is the journal of the money coming in and going out. Automatic rows come from sales, paid or delivered orders and paid purchases; every evening you can close the day.

## Automatic and manual rows
- Automatic rows (counter sales, order payments, paid purchases) are locked. To correct one, use “Correct an automatic row”: a correction row is added and the original stays.
- “+ Manual movement” adds money in or out (with a photo of the receipt if you want). Its author or an admin can edit or delete it for 24 hours, as long as the day is not closed.
- “COD” is the money collected at the door when an order is delivered; a deposit or a payment received before delivery shows as cash.

## Counter sales
Sales › “+ New sale”: products, an optional discount and the payment method. A sale can stay a draft: a draft moves no money. “Validate the sale” takes the stock out and collects the amount received. A partly paid sale must be linked to a client; “Collect the rest” completes the payment. A validated sale cannot be edited: to correct it, “Cancel the sale” (within 7 days, with a reason), then make it again. Cancelling puts the stock back and refunds the payments in the cash register.

## Close the day
- “Close the day” shows the “Theoretical balance (cash)”: the previous closing plus the day's cash in and out.
- Type the amount “Counted in the drawer (DA)”. When there is a gap, the note is required and a CORRECTION row is created.
- The day is then locked: nothing can be added or changed on that date. The counted amount becomes the next day's opening balance.

## Reopen a closed day
While a day is closed, every money movement on that date is refused, today included: a paid sale, “Collect the rest”, a refund, a supplier payment, an order marked delivered or paid. An admin sees the link “Reopen the day (Cash register)”; another member reads “Ask an admin to reopen the day.”

“Reopen the day” is for admins only, asks for a reason and is logged; the correction row of the closing is reversed. Close the day again once you are done.

The cash register and counter sales are for the owner and the admins, in “Advanced” mode.
