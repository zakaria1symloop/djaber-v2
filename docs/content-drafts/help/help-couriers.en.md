---
key: help-couriers
type: help
category: orders_delivery
pages: [delivery/couriers, delivery/fees]
sortOrder: 31
locale: en
title: Connect ZR Express, EcoTrack or Yalidine
---
Connect your courier account in Delivery & tracking › Couriers to create parcels straight from your orders. You can also deliver with your own people (self-delivery).

## Add a courier
- Open Delivery & tracking › Couriers and click “+ Add a courier”.
- Pick ZR Express, EcoTrack or Yalidine and paste the credentials from your courier account: ZR Express new platform (zrexpress.app) = API key + tenant ID; former platform (Procolis) = token + key; EcoTrack = instance URL + token; Yalidine = ID + token.
- Fill in the sender: name, phone, pickup address and departure wilaya.
- Click “Test”: Djaber calls the courier (10 seconds at most). “OK”: the account is recognised. “Refused”: check the credentials. “Unreachable”: try again later; you can still save without a test.

Credentials are stored encrypted and never shown again. With the former Procolis platform, neither the label nor the cancellation goes through the API: Djaber prints its own label and a parcel is cancelled in your ZR Express account.

## Default courier and automatic send
- “Set as default” picks the courier offered when sending.
- “Automatic send to the courier”: every confirmed order goes to the default courier with no further click. Leave it off if you want to check each order before it is sent.
- “Deactivate” stops new sends; parcels in progress are still tracked.

## Self-delivery
Your own delivery people need no account: from a confirmed order, choose “Mark shipped (manual)”. The Djaber label can be printed and the status is updated by hand.

## Fee grid
The customer always pays your grid (Delivery & tracking › Fee grid): per wilaya, a HOME, STOP-DESK and RETURN price. “Copy from a courier” takes its rates after a preview of the differences. “Free delivery from” applies to the subtotal after discount, for home delivery only. The AI tells the customer when a wilaya is not served. Courier rates are only used to compute your cost and margin.

Wilayas 59 to 69 are sent to couriers under the code of their former parent wilaya, with the real commune name.

Couriers and the grid are set by the owner and the admins; every member can send parcels.
