// §3.6 Delivery · §3.7 Order-taking rules (agent behaviour step 3).
import { AGENT_DEFAULT_MAX_AMOUNT, AGENT_DEFAULT_MAX_QTY } from '@djaber/shared';
import type { PromptContext } from '../prompt.types';

export const deliverySection = (c: PromptContext): string =>
  [
    `DELIVERY FEES: use quote_delivery.${c.workspace.freeDeliveryThreshold ? ` Free delivery from ${c.workspace.freeDeliveryThreshold} DA.` : ''}`,
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
    `MAX_QTY_PER_ORDER=${c.agent.maxQtyPerOrder ?? AGENT_DEFAULT_MAX_QTY}`,
    `MAX_AMOUNT=${c.agent.maxAmountPerOrder ?? AGENT_DEFAULT_MAX_AMOUNT} DA`,
    'An order above one of these limits is never created: hand off (status=HANDOFF, statusDetail=order_limits).',
    `RISKY_CLIENT_POLICY=${c.agent.riskyClientBehavior ?? 'take_and_flag'}`,
    `RECAP=${c.agent.recapMode ?? 'always'}`,
    ...knownCustomerLines(c),
    'Ask one field at a time; never invent a value; re-ask an invalid value with an example (0555123456). Never ask again for a value the customer already gave (KNOWN CUSTOMER or earlier messages): reuse it in the recap.',
    'Report in "customer" the order details the customer has given so far (name, phone, phone2, wilaya, commune, address).',
    'A place that is both a wilaya and a commune (Blida, Médéa, Sétif, Oran…) given once is that wilaya AND its commune of the same name, unless the customer says another commune: do not ask for the commune again.',
    'Before create_order, show a recap (items, quantities, prices, delivery fee, total, address) and wait for an explicit confirmation of the customer.',
    'Call create_order only once per confirmed recap. If the tool says the order already exists (duplicateOf), confirm that order instead of creating another one.',
    'To cancel: cancel_order works only on an order the shop has NOT confirmed yet (ask which one when there are several). ORDER_CONFIRMED_BY_SELLER ⇒ never promise a cancellation or a change: say the shop will contact them, then hand off (status=HANDOFF, statusDetail=customer_request).',
    'To change an order already placed (product, size, quantity, address): show the new recap, wait for the confirmation, then call create_order with replacesOrder=<its number> — the new order is created first, then the old one is cancelled. Never cancel an order to replace it. replaced=null in the result ⇒ hand off.',
    'Payment is cash on delivery unless a payment link tool is available.',
  ].join('\n');
};
