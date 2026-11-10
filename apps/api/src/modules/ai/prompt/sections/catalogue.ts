// §3.5 Catalogue (D34) — the only source of product names, prices and stock the model may use.
import type { CatalogueProduct } from '../../catalogue.service';
import { systemLocale } from '../../language';
import type { PromptContext } from '../prompt.types';

/**
 * recette 09/11 (Badro: « AI agent still gives the quantity of the product's stock to the client »): the prompt carries
 * no stock count any more — only « in stock » / « out of stock » — so no count can reach a customer. The exact number
 * comes back only from create_order when the customer asks for more than is left (ORDER_INSUFFICIENT_STOCK).
 */
export const stockWord = (stock: number | null, sellOutOfStock = false): string => (stock === null ? 'service' : stock > 0 ? 'in stock' : sellOutOfStock ? 'out of stock (orderable)' : 'out of stock');

export const productBlock = (p: CatalogueProduct, n: number, descriptionMax: number): string => {
  // a product with variants is sold through one of them only: its price is the variants' range, never the base price
  const prices = p.variants.map((v) => v.price);
  const [min, max] = [Math.min(...prices), Math.max(...prices)];
  const price = !p.hasVariants ? `${p.price} DA${p.oldPrice ? ` (was ${p.oldPrice} DA)` : ''}` : !prices.length ? 'no variant available' : min === max ? `${min} DA` : `${min}-${max} DA by variant`;
  const lines = [`#${n} ${p.name} [ID:${p.id}] SKU:${p.sku} PRICE:${price} STOCK:${stockWord(p.stock, p.sellOutOfStock)}`];
  const description = (p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, descriptionMax);
  if (description) lines.push(description);
  if (p.variants.length) lines.push(`VARIANTS: ${p.variants.map((v) => `${v.name} [VID:${v.id}] ${v.price} DA ${stockWord(v.stock, p.sellOutOfStock)}`).join('; ')}`);
  if (p.hasVariants) lines.push('VARIANT REQUIRED: the customer chooses one of the VARIANTS; never offer this product without a variant or at another price.');
  if (p.stock === null) lines.push('SERVICE: present it as a service (what is done, how, when), never as a product in stock or a parcel.');
  // PV 22/10: the merchant takes orders for it at zero stock
  // PV 09/11 « il valide la commande seulement quand le produit est à 0 stock »: the line only came at STOCK 0, so with
  // STOCK 2 and 5 asked the model refused on its own although the shop takes such orders
  if (p.sellOutOfStock && p.stock !== null) lines.push('ORDERABLE BEYOND STOCK: take the order whatever the quantity, even out of stock (do not use OUT_OF_STOCK); when create_order says part of it is beyond the stock (beyondStock), say that part may take a little longer to deliver.');
  for (const a of p.also) lines.push(`ALSO: ${a.name} [ID:${a.id}] ${a.price} DA — ${a.reason?.trim() || 'often bought together'}`);
  return lines.join('\n');
};

export const catalogueSection = (c: PromptContext): string => {
  const { catalogue } = c;
  const head = catalogue.full
    ? `CATALOGUE (${catalogue.count} products — the complete list; never mention a product, a variant, a price or a stock that is not below)`
    : `CATALOGUE: ${catalogue.count} products. Use search_products before naming any product.`;
  const blocks = catalogue.products.map((p, i) => productBlock(p, i + 1, c.descriptionMax));
  const sentence = c.workspace.systemMessages.out_of_stock?.[systemLocale(c.lang, c.locale)] ?? c.workspace.systemMessages.out_of_stock?.fr ?? '';
  const rules: string[] = [];
  // tester log 26/10 UX-038: a product or variant waiting for Djaber's review is absent from this list (and from the tools);
  // the customer naming it, an older message or a page post never makes it available
  rules.push(
    catalogue.full
      ? 'NOT_LISTED: a product or a variant (colour, size, model…) that is not in this list is not available, even when the customer names it or an earlier message mentioned it: say it is not available, offer what is listed, never confirm it, show it or take an order for it'
      : 'NOT_LISTED: a product or a variant (colour, size, model…) that search_products / get_product does not return is not available, even when the customer names it or an earlier message mentioned it: say it is not available, never confirm it, show it or take an order for it',
  );
  rules.push(
    'STOCK_PRIVATE: never tell the customer how many units are in stock or left (no « il en reste 5 », « we have 12 », « 3 pièces disponibles »), even when they ask: say it is available or not. Only when they ask for more than is left does create_order give the number you may offer (ORDER_INSUFFICIENT_STOCK).',
  );
  if (sentence) rules.push(`OUT_OF_STOCK_SENTENCE: "${sentence}"`);
  // tester notes 25/10: the shop's sentence word for word (it was paraphrased, so an edit seemed not applied)
  const say = sentence ? 'write OUT_OF_STOCK_SENTENCE word for word ({product} = the product name; translate it only when the customer writes another language), never a sentence of your own' : 'say the product is out of stock';
  rules.push(c.agent.outOfStockBehavior === 'suggest_alternative' ? `OUT_OF_STOCK: ${say}, then suggest an alternative from the same category` : `OUT_OF_STOCK: ${say}, nothing else about it`);
  if (c.agent.showMissingVariants) rules.push('MISSING_VARIANT: say which sizes remain');
  return [head, ...(catalogue.count === 0 ? ['(no product available: do not invent any)'] : blocks), ...rules].join('\n');
};
