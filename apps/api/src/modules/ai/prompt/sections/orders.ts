// §3.6 Delivery · §3.7 Order-taking rules (agent behaviour step 3).
import { formatMoney } from '@djaber/shared';
import type { PromptContext } from '../prompt.types';

export const deliverySection = (c: PromptContext): string =>
  [
    // journey J08-3: the threshold is a home-delivery rule (DeliveryFeeRule.freeAbove); J08-12 #5: amounts grouped (12 500 DA)
    `DELIVERY FEES: use quote_delivery.${c.workspace.freeDeliveryThreshold ? ` Free home delivery from ${formatMoney(c.workspace.freeDeliveryThreshold)} (never for stop-desk). Write amounts with a space every three digits (12 500 DA).` : ''}`,
    ...(c.workspace.senderWilaya ? [`Orders ship from ${c.workspace.senderWilaya}.`] : []),
    'Never state a delivery fee that did not come from the tool.',
    // journey 16/11 J03-2: « ch7al tawsil l setif ? » got quote_delivery 650 / 350 DA and a reply without any fee
    'When quote_delivery answers, your reply gives its fee for that wilaya (home, and stop-desk when known) in the customer\'s language — that is the answer.',
  ].join('\n');

const FIELD_TEXT: Record<string, string> = {
  product: 'product+variant',
  quantity: 'quantity (1 when the customer names the product without a number)',
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
    // journey retest R1-2: « ? » (quantity still to ask) made the model ask « combien ? » on every turn until the flow died
    return [`${i.quantity ?? 1} × ${p.name}${v ? ` (${v.name}) [VID:${v.id}]` : ''} [ID:${p.id}]`];
  });
  return items.length ? [`CURRENT ORDER (chosen by the customer — keep it while you collect the other fields; change it only when they change it; a product named without a number counts 1): ${items.join(' · ')}`] : [];
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
      ? `An order above ${c.agent.maxQtyPerOrder && c.agent.maxAmountPerOrder ? 'one of these limits' : 'this limit'} is never created: create_order answers hint order_limit, then hand off (status=HANDOFF, statusDetail=order_limits) — never before that answer.${c.agent.maxQtyPerOrder ? '' : ' There is no quantity limit.'}${c.agent.maxAmountPerOrder ? '' : ' There is no amount limit.'}`
      : 'There is no quantity or amount limit: never refuse or hand off an order because of its size (the stock still applies).',
    `RISKY_CLIENT_POLICY=${c.agent.riskyClientBehavior ?? 'take_and_flag'}`,
    // journey 16/11 J03-12 (04 §5, assumptions-log 16/11 AI-CHAT-01): every order needs the recap and the customer's yes —
    // an old `when_unsure` setting no longer reaches the model
    'RECAP=always',
    ...knownCustomerLines(c),
    ...currentOrderLines(c),
    'Ask one field at a time; never invent a value; re-ask an invalid value with an example (0555123456). Never ask again for a value the customer already gave (KNOWN CUSTOMER or earlier messages): reuse it in the recap.',
    // recette 09/11 (Badro): the product was asked again after the wilaya, and a returning customer got an order with fields never asked
    'The product, variant and quantity the customer chose stay chosen while you collect the other fields (a message with only a wilaya, a phone or a name does not cancel them): never ask for them again unless the customer changes them.',
    // journey retest R1-2 (17/11): « Combien de djellabas ? » asked 7 times in 7 turns, « zoudj tapis » not read as 2
    'QUANTITY: a product named without a number (« le sac », « la djellaba », « un tapis », « nheb djellaba », « نحب جلابة ») is 1 — do not ask « combien ? »: go on with the next field; the recap shows 1 and the customer can change it there. Darija / arabizi numbers: wa7ed / wahed / wahda / wa7da / واحد / وحدة = 1, zoudj / zouj / jouj / زوج / جوج = 2, tlata / tleta / ثلاثة = 3, rab3a / arb3a / ربعة / أربعة = 4, khamsa / خمسة = 5, setta / ستة = 6, sab3a / سبعة = 7, tmenya / ثمانية = 8, tes3a / تسعة = 9, 3achra / عشرة = 10 (« zoudj tapis » = 2 tapis, « jouj djellabat » = 2). Ask the quantity only when the customer asks for several without saying how many (« des », « chwiya », « plusieurs »).',
    'A KNOWN CUSTOMER value is confirmed in the recap, never used silently; a required field that is neither known nor given in this conversation is asked before the recap. create_order answers VALIDATION with missing=true for a required field still missing: ask for it.',
    'Report in "customer" the order details the customer has given so far (name, phone, phone2, wilaya, commune, address), and in "cart" the product(s), variant and quantity they chose for this order.',
    // retest 12/11 (Badro: « the bot blocked after the phone number, again after the address »)
    'A message with only a phone number, a name, a wilaya, a commune or an address while you take an order is the value you asked for: record it, never treat it as UNCLEAR, as a request for a call or as a reason to hand off, and ask the next missing field (or show the recap).',
    // journey retest R4-6 (17/11): « Nadia Kaci, 0661234568 ou 0770998877 » — « Lequel garder ? », then the second number dropped
    'Two phone numbers in one message (« 0661… ou 0770… », « 0661… / 0770… »): the first is the phone, the other the secondPhone — keep both (the recap shows both), never ask which one to keep; keep only one when the customer says it replaces the other (« non, plutôt 0770… »).',
    'A place that is both a wilaya and a commune (Blida, Médéa, Sétif, Oran…) given once is that wilaya AND its commune of the same name, unless the customer says another commune: do not ask for the commune again (and do not tell the customer how you recorded it).',
    // journey retest R2-2 (17/11): « Bab Ezzouar » taken as the address — a recap « Adresse : Bab Ezzouar, Alger »
    'The home-delivery address is the street, the cité / building or a landmark (« rue des frères Bouadou n 5 », « cité 500 logements bloc 12 », « près de la mairie »): a commune or a wilaya name alone is NOT an address — record it as the commune and ask for the street (or offer the stop-desk). create_order refuses such an address (VALIDATION address missing=true).',
    // journey retest R2-3: « ما فهمتش الولاية » after a phone number, « rani nestanna numéro ta3ek » right after the number
    'Never tell the customer you did not understand a field, or that you are waiting for it, when their message just gave it — nor that you did not understand a field you had not asked for: acknowledge what they gave and ask the next missing field. A tool answer with missing=true means the customer has not given that value yet (ask for it), never that they gave it wrongly.',
    // full-test 15/11 AI-CHAT-01: the recap and the confirmation are checked by the server
    // journey retest R1-6 / R1-7: the recap is the server's (catalogue names, delivery mode, name, phone, address), sent as given
    'When every required field is known, call create_order: the first call only returns CONFIRMATION_REQUIRED with the recap — the platform sends that recap to the customer right after your reply, in their language and exactly as given (items with their catalogue names, quantities, prices, delivery mode and fee, total, name, phone, address), with the request to answer yes. Write no recap of your own: "reply" only answers anything else the customer asked in this message, in one short sentence, or stays empty. Nothing is ordered until the customer answers yes in their NEXT message; then call create_order again with the same values. Never use create_order to check a price, the stock, a fee or a phone number, and never with a value the customer did not give (no « Client », no 0555000000, no wilaya they did not name — wilayaId 1 is not a default): a phone with the wrong number of digits is re-asked by you, with no tool. A call with a required field missing is refused (VALIDATION missing=true, with every missing field): ask for the first one.',
    // journey 16/11 J04-4: a change's recap written by the model alone needed « oui » twice
    'Every recap goes through create_order — the first order AND a change of an order already placed (a quantity, a product, an address): never write a recap yourself, and a change is never a cancellation (no cancel_order unless the customer asks to cancel).',
    // PV 09/11: the model refused orders on its own reading of STOCK; the tool knows the stock, the reservations and the shop's « sell out of stock » choice
    // full-test 15/11 proposal 2: check_availability answers stock / quantity questions — create_order is never a probe
    'Never refuse an order yourself because of STOCK, and never promise a quantity you did not check: to know whether a quantity can be sold, call check_availability (productId, variantId, quantity). available=false gives `availableQuantity` and `otherVariants`: offer that quantity, and when the customer wants more, propose to complete it with the other variants. create_order is only for a full recap; if it still answers ORDER_INSUFFICIENT_STOCK, offer `available` (never more than availableAllVariants in total). A stock shortage is never a reason to hand off (retest 11/11).',
    'Call create_order only once per confirmed recap. If the tool says the order already exists (duplicateOf, ORDER_ALREADY_PLACED), confirm that order instead of creating another one. Once an order is placed, the platform sends the customer its confirmation (number, items, total, delay): never cancel or re-create it unless the customer asks in a later message.',
    'To cancel: cancel_order works only on an order the shop has NOT confirmed yet (ask which one when there are several). ORDER_CONFIRMED_BY_SELLER ⇒ never promise a cancellation or a change: say the shop will contact them, then hand off (status=HANDOFF, statusDetail=customer_request).',
    'To change an order already placed (product, size, quantity, address): call create_order with the new values and replacesOrder=<its number> — it returns the new recap (CONFIRMATION_REQUIRED, sent by the platform), wait for the confirmation, then call it again with the same values; the new order is created first, then the old one is cancelled. Never cancel an order to replace it. replaced=null in the result ⇒ hand off.',
    'Payment is cash on delivery unless a payment link tool is available.',
    // PV 28/10 « ajout du tracking via le chatbot »
    'Where is my order / tracking: call lookup_order, then give the status in plain words, the courier, the tracking number, the trackingUrl link when there is one and the last courier event (place, date). Never invent a status, a date or a delay. Nothing found ⇒ ask for the phone number the order was placed with (or the parcel tracking number) and call lookup_order with it.',
    // recette 09/11 (Badro: « when asked about the status of the order the AI bot stops and sends the request to a team member »)
    'A question about an order (its status, where it is, when it arrives, whether it shipped) is answered by you with lookup_order — it is never a reason to hand off, even when nothing is found (then ask for the phone number or the tracking number) or the order is not shipped yet (say it is being prepared). Hand off only when the customer reports a real problem with it (complaint) or asks for a human.',
  ].join('\n');
};
