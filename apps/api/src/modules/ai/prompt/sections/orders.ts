// §3.6 Delivery · §3.7 Order-taking rules (agent behaviour step 3).
import { formatMoney } from '@djaber/shared';
import type { PromptContext } from '../prompt.types';

export const deliverySection = (c: PromptContext): string =>
  [
    // journey J08-3: the threshold is a home-delivery rule (DeliveryFeeRule.freeAbove); J08-12 #5: amounts grouped (12 500 DA)
    `DELIVERY FEES: use quote_delivery.${c.workspace.freeDeliveryThreshold ? ` Free home delivery from ${formatMoney(c.workspace.freeDeliveryThreshold)} (never for stop-desk). Write amounts with a space every three digits (12 500 DA).` : ''}`,
    ...(c.workspace.senderWilaya ? [`Orders ship from ${c.workspace.senderWilaya}.`] : []),
    'Never state a delivery fee that did not come from the tool.',
  ].join('\n');

const FIELD_TEXT: Record<string, string> = {
  product: 'product+variant',
  quantity: 'quantity',
  name: 'name',
  phone: 'phone (10 digits, 05/06/07)',
  wilaya: 'wilaya',
  commune: 'commune',
  address: 'address or stop-desk',
  phone2: 'secondPhone',
  note: 'note',
};
const DEFAULT_REQUIRED = ['product', 'quantity', 'name', 'phone', 'wilaya', 'commune', 'address'];

/** A4: what is already known of the customer — never asked again. */
const knownCustomerLines = (c: PromptContext): string[] => {
  const k = c.customer;
  if (!k) return [];
  const parts = [k.name && `name=${k.name}`, k.phone && `phone=${k.phone}`, k.phone2 && `secondPhone=${k.phone2}`, k.wilaya && `wilaya=${k.wilaya}`, k.commune && `commune=${k.commune}`, k.address && `address=${k.address}`].filter(Boolean);
  return parts.length ? [`KNOWN CUSTOMER (already given — confirm it in the recap, do not ask again): ${parts.join(' · ')}`] : [];
};

/**
 * full-test 15/11 AI-CHAT-05 (proposal 6): what the customer chose for the order being taken, from `context.chosen` —
 * printed like KNOWN CUSTOMER so a message with only a name or a wilaya can no longer make the model forget the product.
 */
const currentOrderLines = (c: PromptContext): string[] => {
  const items = (c.chosen ?? []).flatMap((i) => {
    const p = c.catalogue.products.find((x) => x.id === i.productId);
    if (!p) return [];
    const v = i.variantId ? p.variants.find((x) => x.id === i.variantId) : null;
    return [`${i.quantity ?? '?'} × ${p.name}${v ? ` (${v.name}) [VID:${v.id}]` : ''} [ID:${p.id}]`];
  });
  return items.length ? [`CURRENT ORDER (chosen by the customer — keep it while you collect the other fields; change it only when they change it; « ? » = quantity still to ask): ${items.join(' · ')}`] : [];
};

export const orderRulesSection = (c: PromptContext): string => {
  const fields = c.agent.orderFields;
  const required = fields.length ? fields.filter((f) => f.required).map((f) => f.key as string) : DEFAULT_REQUIRED;
  const optional = fields.length ? fields.filter((f) => !f.required).map((f) => f.key as string) : ['phone2', 'note'];
  const order = Object.keys(FIELD_TEXT);
  const list = (keys: string[]) => order.filter((k) => keys.includes(k)).map((k) => FIELD_TEXT[k]);
  return [
    'ORDER TAKING',
    `Required fields, in this order: ${list(required).join(' → ')}`,
    ...(optional.length ? [`Optional fields: ${list(optional).join(', ')}`] : []),
    // PV 28/10 (« l'agent IA limite les commandes à 10 »): an empty limit is no limit, as the agent page shows it (∞)
    ...(c.agent.maxQtyPerOrder ? [`MAX_QTY_PER_ORDER=${c.agent.maxQtyPerOrder}`] : []),
    ...(c.agent.maxAmountPerOrder ? [`MAX_AMOUNT=${c.agent.maxAmountPerOrder} DA`] : []),
    c.agent.maxQtyPerOrder || c.agent.maxAmountPerOrder
      ? `An order above ${c.agent.maxQtyPerOrder && c.agent.maxAmountPerOrder ? 'one of these limits' : 'this limit'} is never created: hand off (status=HANDOFF, statusDetail=order_limits).${c.agent.maxQtyPerOrder ? '' : ' There is no quantity limit.'}${c.agent.maxAmountPerOrder ? '' : ' There is no amount limit.'}`
      : 'There is no quantity or amount limit: never refuse or hand off an order because of its size (the stock still applies).',
    `RISKY_CLIENT_POLICY=${c.agent.riskyClientBehavior ?? 'take_and_flag'}`,
    `RECAP=${c.agent.recapMode ?? 'always'}`,
    ...knownCustomerLines(c),
    ...currentOrderLines(c),
    'Ask one field at a time; never invent a value; re-ask an invalid value with an example (0555123456). Never ask again for a value the customer already gave (KNOWN CUSTOMER or earlier messages): reuse it in the recap.',
    // recette 09/11 (Badro): the product was asked again after the wilaya, and a returning customer got an order with fields never asked
    'The product, variant and quantity the customer chose stay chosen while you collect the other fields (a message with only a wilaya, a phone or a name does not cancel them): never ask for them again unless the customer changes them.',
    'A KNOWN CUSTOMER value is confirmed in the recap, never used silently; a required field that is neither known nor given in this conversation is asked before the recap. create_order answers VALIDATION with missing=true for a required field still missing: ask for it.',
    'Report in "customer" the order details the customer has given so far (name, phone, phone2, wilaya, commune, address), and in "cart" the product(s), variant and quantity they chose for this order.',
    // retest 12/11 (Badro: « the bot blocked after the phone number, again after the address »)
    'A message with only a phone number, a name, a wilaya, a commune or an address while you take an order is the value you asked for: record it, never treat it as UNCLEAR, as a request for a call or as a reason to hand off, and ask the next missing field (or show the recap).',
    'A place that is both a wilaya and a commune (Blida, Médéa, Sétif, Oran…) given once is that wilaya AND its commune of the same name, unless the customer says another commune: do not ask for the commune again.',
    // full-test 15/11 AI-CHAT-01: the recap and the confirmation are checked by the server
    'When every required field is known, call create_order: the first call only returns CONFIRMATION_REQUIRED with the recap (items, quantities, prices, delivery fee, total, name, phone, address) — show that recap and ask the customer to confirm. Nothing is ordered until the customer answers yes in their NEXT message; then call create_order again with the same values. Never use create_order to check a price, the stock, a fee or a phone number, and never with a value the customer did not give (no « Client », no 0555000000, no wilaya they did not name): a phone with the wrong number of digits is re-asked by you, with no tool.',
    // journey 16/11 J04-4: a change's recap written by the model alone needed « oui » twice
    'Every recap goes through create_order — the first order AND a change of an order already placed: never write a recap yourself without calling create_order first.',
    // PV 09/11: the model refused orders on its own reading of STOCK; the tool knows the stock, the reservations and the shop's « sell out of stock » choice
    // full-test 15/11 proposal 2: check_availability answers stock / quantity questions — create_order is never a probe
    'Never refuse an order yourself because of STOCK, and never promise a quantity you did not check: to know whether a quantity can be sold, call check_availability (productId, variantId, quantity). available=false gives `availableQuantity` and `otherVariants`: offer that quantity, and when the customer wants more, propose to complete it with the other variants. create_order is only for a full recap; if it still answers ORDER_INSUFFICIENT_STOCK, offer `available` (never more than availableAllVariants in total). A stock shortage is never a reason to hand off (retest 11/11).',
    'Call create_order only once per confirmed recap. If the tool says the order already exists (duplicateOf, ORDER_ALREADY_PLACED), confirm that order instead of creating another one. Once an order is placed, the platform sends the customer its confirmation (number, items, total, delay): never cancel or re-create it unless the customer asks in a later message.',
    'To cancel: cancel_order works only on an order the shop has NOT confirmed yet (ask which one when there are several). ORDER_CONFIRMED_BY_SELLER ⇒ never promise a cancellation or a change: say the shop will contact them, then hand off (status=HANDOFF, statusDetail=customer_request).',
    'To change an order already placed (product, size, quantity, address): call create_order with the new values and replacesOrder=<its number> — it returns the new recap (CONFIRMATION_REQUIRED): show it, wait for the confirmation, then call it again with the same values; the new order is created first, then the old one is cancelled. Never cancel an order to replace it. replaced=null in the result ⇒ hand off.',
    'Payment is cash on delivery unless a payment link tool is available.',
    // PV 28/10 « ajout du tracking via le chatbot »
    'Where is my order / tracking: call lookup_order, then give the status in plain words, the courier, the tracking number, the trackingUrl link when there is one and the last courier event (place, date). Never invent a status, a date or a delay. Nothing found ⇒ ask for the phone number the order was placed with (or the parcel tracking number) and call lookup_order with it.',
    // recette 09/11 (Badro: « when asked about the status of the order the AI bot stops and sends the request to a team member »)
    'A question about an order (its status, where it is, when it arrives, whether it shipped) is answered by you with lookup_order — it is never a reason to hand off, even when nothing is found (then ask for the phone number or the tracking number) or the order is not shipped yet (say it is being prepared). Hand off only when the customer reports a real problem with it (complaint) or asks for a human.',
  ].join('\n');
};
