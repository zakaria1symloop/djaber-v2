// §3.5 Catalogue (D34) — the only source of product names, prices and stock the model may use.
import type { CatalogueProduct } from '../../catalogue.service';
import { systemLocale } from '../../language';
import type { PromptContext } from '../prompt.types';

export const productBlock = (p: CatalogueProduct, n: number, descriptionMax: number): string => {
  // a product with variants is sold through one of them only: its price is the variants' range, never the base price
  const prices = p.variants.map((v) => v.price);
  const [min, max] = [Math.min(...prices), Math.max(...prices)];
  const price = !p.hasVariants ? `${p.price} DA${p.oldPrice ? ` (was ${p.oldPrice} DA)` : ''}` : !prices.length ? 'no variant available' : min === max ? `${min} DA` : `${min}-${max} DA by variant`;
  const lines = [`#${n} ${p.name} [ID:${p.id}] SKU:${p.sku} PRICE:${price} STOCK:${p.stock === null ? 'service' : p.stock}`];
  const description = (p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, descriptionMax);
  if (description) lines.push(description);
  if (p.variants.length) lines.push(`VARIANTS: ${p.variants.map((v) => `${v.name} [VID:${v.id}] ${v.price} DA stock ${v.stock}`).join('; ')}`);
  if (p.hasVariants) lines.push('VARIANT REQUIRED: the customer chooses one of the VARIANTS; never offer this product without a variant or at another price.');
  if (p.stock === null) lines.push('SERVICE: present it as a service (what is done, how, when), never as a product in stock or a parcel.');
  // PV 22/10: the merchant takes orders for it at zero stock
  if (p.sellOutOfStock && (p.stock === 0 || p.variants.some((v) => v.stock <= 0))) lines.push('ORDERABLE AT ZERO STOCK: take the order even when STOCK is 0 (do not use OUT_OF_STOCK); say it may take a little longer to deliver.');
  for (const a of p.also) lines.push(`ALSO: ${a.name} [ID:${a.id}] ${a.price} DA — ${a.reason?.trim() || 'often bought together'}`);
  return lines.join('\n');
};

export const catalogueSection = (c: PromptContext): string => {
  const { catalogue } = c;
  const head = catalogue.full
    ? `CATALOGUE (${catalogue.count} products — the complete list; never mention a product, a price or a stock that is not below)`
    : `CATALOGUE: ${catalogue.count} products. Use search_products before naming any product.`;
  const blocks = catalogue.products.map((p, i) => productBlock(p, i + 1, c.descriptionMax));
  const sentence = c.workspace.systemMessages.out_of_stock?.[systemLocale(c.lang, c.locale)] ?? c.workspace.systemMessages.out_of_stock?.fr ?? '';
  const rules: string[] = [];
  if (sentence) rules.push(`OUT_OF_STOCK_SENTENCE: "${sentence}"`);
  // tester notes 25/10: the shop's sentence word for word (it was paraphrased, so an edit seemed not applied)
  const say = sentence ? 'write OUT_OF_STOCK_SENTENCE word for word ({product} = the product name; translate it only when the customer writes another language), never a sentence of your own' : 'say the product is out of stock';
  rules.push(c.agent.outOfStockBehavior === 'suggest_alternative' ? `OUT_OF_STOCK: ${say}, then suggest an alternative from the same category` : `OUT_OF_STOCK: ${say}, nothing else about it`);
  if (c.agent.showMissingVariants) rules.push('MISSING_VARIANT: say which sizes remain');
  return [head, ...(catalogue.count === 0 ? ['(no product available: do not invent any)'] : blocks), ...rules].join('\n');
};
