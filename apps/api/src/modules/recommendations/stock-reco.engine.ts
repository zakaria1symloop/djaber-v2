// GDS-10 rule engine (FIG GDS-10 "Règles sur vos données (ventes, stock, délais) — aucune IA, aucun crédit"; D18, D69).
// Pure: the service loads the figures, this file decides which cards fire and writes their texts in fr / ar / en.
import { formatMoney, STOCK_RECO_RULES, type Priority3Name, type StockRecoActionKind, type StockRecoRuleKey, type StockRecoTypeName } from '@djaber/shared';

type L = { fr: string; ar: string; en: string };
export type RecoCandidate = {
  ruleKey: StockRecoRuleKey;
  type: StockRecoTypeName;
  priority: Priority3Name;
  productId: string | null;
  variantId: string | null;
  supplierId: string | null;
  agentId: string | null;
  title: L;
  body: L;
  suggestedAction: { kind: StockRecoActionKind; params: Record<string, unknown> };
  estimatedValue: number | null;
};
export const recoKey = (c: Pick<RecoCandidate, 'ruleKey' | 'productId' | 'variantId' | 'supplierId' | 'agentId'>) => [c.ruleKey, c.productId ?? '', c.variantId ?? '', c.supplierId ?? '', c.agentId ?? ''].join('|');

/** One stock holder: a tracked product without variants, or an active variant. */
export type StockLineFacts = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  stock: number;
  minStock: number;
  costPrice: number | null;
  units30d: number;
  units7d: number;
  /** last purchase supplier of this product (if any) */
  supplier: { id: string; name: string; leadDays: number | null } | null;
};
export type ProductFacts = { productId: string; name: string; price: number; costPrice: number | null; hasVariants: boolean; trackStock: boolean; stock: number; lastSoldAt: Date | null; createdAt: Date; lastPurchaseNumber: string | null };
export type SupplierFacts = { supplierId: string; name: string; deliveries: number; late: number; avgDelayDays: number };
export type AgentTopicFacts = { agentId: string; agentName: string; topic: string; count: number };
export type EngineInput = { lines: StockLineFacts[]; products: ProductFacts[]; suppliers: SupplierFacts[]; topics: AgentTopicFacts[]; targetMarginPct: number; now: Date };

/** Default supplier lead time when nothing is known (days). */
export const DEFAULT_LEAD_DAYS = 7;
export const DEAD_STOCK_DAYS = 60;
export const DEAD_STOCK_MIN_QTY = 5;
export const STOCKOUT_MAX_QTY = 1;
export const STOCKOUT_MIN_SALES_7D = 3;
export const SUPPLIER_LATE_PCT = 50;
export const SUPPLIER_MIN_DELIVERIES = 2;
export const AGENT_TOPIC_MIN = 10;
const DAY_MS = 86_400_000;
const money = (n: number) => formatMoney(n);
/** « 33,8 » — the decimal comma of French and Arabic texts (rule 11) */
const comma = (n: number) => String(n).replace('.', ',');
const full = (l: { name: string; variantName: string | null }) => (l.variantName ? `${l.name} · ${l.variantName}` : l.name);
const same = (s: string): L => ({ fr: s, ar: s, en: s });
const meta = (k: StockRecoRuleKey) => STOCK_RECO_RULES[k];

/** Price giving the target margin on the true cost, rounded to the nearest 100 DA (FIG "Passer de 41 000 à 44 600 DA"). */
export const priceForMargin = (cost: number, targetPct: number) => Math.round(cost / (1 - targetPct / 100) / 100) * 100;

export function runStockRules(i: EngineInput): RecoCandidate[] {
  const out: RecoCandidate[] = [];
  const stockout = new Set<string>();

  // RUPTURE IMMINENTE — "STOCK VARIANTE ≤ 1 ET VENTES 7 J ≥ 3"
  for (const l of i.lines) {
    if (!l.variantId || l.stock > STOCKOUT_MAX_QTY || l.units7d < STOCKOUT_MIN_SALES_7D) continue;
    stockout.add(`${l.productId}|${l.variantId}`);
    const qty = Math.max(1, Math.ceil((l.units30d || l.units7d * 4) - l.stock));
    out.push({
      ruleKey: 'stockout_variant',
      ...meta('stockout_variant'),
      productId: l.productId,
      variantId: l.variantId,
      supplierId: l.supplier?.id ?? null,
      agentId: null,
      title: same(full(l)),
      body: {
        fr: `Variante à ${l.stock} u, ${l.units7d} ventes / semaine. L'agent IA répondra « indisponible » à la rupture.`,
        ar: `المتغيّر بـ ${l.stock} وحدة، ${l.units7d} مبيعات في الأسبوع. سيجيب وكيل الذكاء الاصطناعي « غير متوفر » عند النفاد.`,
        en: `Variant at ${l.stock} u, ${l.units7d} sales / week. The AI agent will answer "unavailable" when it runs out.`,
      },
      suggestedAction: { kind: 'create_purchase', params: { productId: l.productId, variantId: l.variantId, quantity: qty, supplierId: l.supplier?.id ?? null, unitCost: l.costPrice } },
      estimatedValue: l.costPrice !== null ? qty * l.costPrice : null,
    });
  }

  // RÉAPPROVISIONNER — "STOCK / VITESSE < DÉLAI FOURNISSEUR"
  for (const l of i.lines) {
    if (stockout.has(`${l.productId}|${l.variantId}`) || l.units30d <= 0) continue;
    const perDay = l.units30d / 30;
    const daysLeft = Math.max(0, l.stock) / perDay;
    const lead = l.supplier?.leadDays ?? DEFAULT_LEAD_DAYS;
    if (daysLeft >= lead) continue;
    const qty = Math.max(1, Math.ceil(perDay * 30));
    const d = Math.floor(daysLeft);
    const sup = l.supplier ? ` (${l.supplier.name})` : '';
    out.push({
      ruleKey: 'restock_lead_time',
      ...meta('restock_lead_time'),
      productId: l.productId,
      variantId: l.variantId,
      supplierId: l.supplier?.id ?? null,
      agentId: null,
      title: same(full(l)),
      // full-test 15/11 ANALYTICS-11: a product already at 0 (or below) is out of stock now, not « dans ~0 jours »
      body:
        l.stock <= 0
          ? {
              fr: `En rupture${l.stock < 0 ? ` (${-l.stock} u vendues sans stock)` : ''} · ventes ${l.units30d} / 30 j. Délai fournisseur moyen ${lead} j${sup}.`,
              ar: `نفد المخزون${l.stock < 0 ? ` (${-l.stock} وحدة بيعت دون مخزون)` : ''} · المبيعات ${l.units30d} / 30 يومًا. متوسط مهلة المورّد ${lead} أيام${sup}.`,
              en: `Out of stock${l.stock < 0 ? ` (${-l.stock} u sold without stock)` : ''} · sales ${l.units30d} / 30 d. Average supplier lead time ${lead} d${sup}.`,
            }
          : {
              fr: `Stock ${l.stock} · ventes ${l.units30d} / 30 j → rupture dans ~${d} ${d > 1 ? 'jours' : 'jour'}. Délai fournisseur moyen ${lead} j${sup}.`,
              ar: `المخزون ${l.stock} · المبيعات ${l.units30d} / 30 يومًا → نفاد خلال ~${d} أيام. متوسط مهلة المورّد ${lead} أيام${sup}.`,
              en: `Stock ${l.stock} · sales ${l.units30d} / 30 d → out of stock in ~${d} ${d === 1 ? 'day' : 'days'}. Average supplier lead time ${lead} d${sup}.`,
            },
      suggestedAction: { kind: 'create_purchase', params: { productId: l.productId, variantId: l.variantId, quantity: qty, supplierId: l.supplier?.id ?? null, unitCost: l.costPrice } },
      estimatedValue: l.costPrice !== null ? qty * l.costPrice : null,
    });
  }

  for (const p of i.products) {
    // PROMOUVOIR — "0 VENTE > 60 J ET STOCK > 5"
    const since = p.lastSoldAt ?? p.createdAt;
    const idle = Math.floor((i.now.getTime() - since.getTime()) / DAY_MS);
    if (p.trackStock && p.stock > DEAD_STOCK_MIN_QTY && idle > DEAD_STOCK_DAYS) {
      const value = p.costPrice !== null ? p.stock * p.costPrice : null;
      const tied = value !== null ? ` (${money(value)} immobilisés)` : '';
      out.push({
        ruleKey: 'dead_stock',
        ...meta('dead_stock'),
        productId: p.productId,
        variantId: null,
        supplierId: null,
        agentId: null,
        title: same(p.name),
        body: {
          fr: `Aucune vente depuis ${idle} jours · ${p.stock} u en stock${tied}.`,
          ar: `لا مبيعات منذ ${idle} يومًا · ${p.stock} وحدة في المخزون${value !== null ? ` (${money(value)} مجمّدة)` : ''}.`,
          en: `No sale for ${idle} days · ${p.stock} u in stock${value !== null ? ` (${money(value)} tied up)` : ''}.`,
        },
        suggestedAction: { kind: 'create_promo', params: { productId: p.productId, discountPct: 15 } },
        estimatedValue: value,
      });
    }
    // PRIX — "MARGE < CIBLE" (Workspace.targetMarginPct, default 35 %)
    if (!p.hasVariants && p.costPrice !== null && p.price > 0) {
      const margin = Math.round(((p.price - p.costPrice) * 1000) / p.price) / 10;
      if (margin < i.targetMarginPct) {
        const next = priceForMargin(p.costPrice, i.targetMarginPct);
        if (next > p.price) {
          const after = p.lastPurchaseNumber ? ` après #${p.lastPurchaseNumber}` : '';
          out.push({
            ruleKey: 'margin_below_target',
            ...meta('margin_below_target'),
            productId: p.productId,
            variantId: null,
            supplierId: null,
            agentId: null,
            title: same(p.name),
            body: {
              // ANALYTICS-09: the decimal comma in French and Arabic (« 33,8 % »), the point in English
              fr: `Marge ${comma(margin)} % < objectif ${comma(i.targetMarginPct)} %. Coût moyen ${money(p.costPrice)}${after}.`,
              ar: `الهامش ${comma(margin)} % < الهدف ${comma(i.targetMarginPct)} %. متوسط التكلفة ${money(p.costPrice)}${p.lastPurchaseNumber ? ` بعد #${p.lastPurchaseNumber}` : ''}.`,
              en: `Margin ${margin} % < target ${i.targetMarginPct} %. Average cost ${money(p.costPrice)}${p.lastPurchaseNumber ? ` after #${p.lastPurchaseNumber}` : ''}.`,
            },
            suggestedAction: { kind: 'update_price', params: { productId: p.productId, from: p.price, price: next } },
            estimatedValue: null,
          });
        }
      }
    }
  }

  // FOURNISSEUR — "RETARDS ≥ 50 %"
  for (const s of i.suppliers) {
    if (s.deliveries < SUPPLIER_MIN_DELIVERIES || (s.late * 100) / s.deliveries < SUPPLIER_LATE_PCT) continue;
    out.push({
      ruleKey: 'supplier_late',
      ...meta('supplier_late'),
      productId: null,
      variantId: null,
      supplierId: s.supplierId,
      agentId: null,
      title: same(s.name),
      body: {
        fr: `${s.late} ${s.late > 1 ? 'réceptions' : 'réception'} en retard sur ${s.deliveries} (moy. +${comma(s.avgDelayDays)} j). Pensez à commander plus tôt.`,
        ar: `${s.late} استلامات متأخرة من ${s.deliveries} (متوسط +${comma(s.avgDelayDays)} أيام). فكّر في الطلب مبكرًا.`,
        en: `${s.late} late ${s.late === 1 ? 'delivery' : 'deliveries'} out of ${s.deliveries} (avg +${s.avgDelayDays} d). Consider ordering earlier.`,
      },
      suggestedAction: { kind: 'open_supplier', params: { supplierId: s.supplierId, advanceDays: s.avgDelayDays } },
      estimatedValue: null,
    });
  }

  // AGENT IA — "INTENTS PRODUIT INCONNU ≥ 10 / 7 J"
  for (const t of i.topics) {
    if (t.count < AGENT_TOPIC_MIN) continue;
    out.push({
      ruleKey: 'agent_unknown_product',
      ...meta('agent_unknown_product'),
      productId: null,
      variantId: null,
      supplierId: null,
      agentId: t.agentId,
      title: same(t.agentName),
      body: {
        fr: `${t.count} conversations ont demandé « ${t.topic} » (introuvable) cette semaine.`,
        ar: `${t.count} محادثات طلبت « ${t.topic} » (غير موجود) هذا الأسبوع.`,
        en: `${t.count} conversations asked for "${t.topic}" (not found) this week.`,
      },
      suggestedAction: { kind: 'open_insights', params: { agentId: t.agentId, topic: t.topic } },
      estimatedValue: null,
    });
  }
  return out;
}

/** INV-02: "écarts inventaire > 10 % à vérifier" — one card per counted line above the threshold. */
export const inventoryVarianceCandidate = (l: { productId: string; variantId: string | null; name: string; variantName: string | null; expected: number; counted: number; pct: number; number: string; inventoryId: string }): RecoCandidate => ({
  ruleKey: 'inventory_variance',
  ...meta('inventory_variance'),
  productId: l.productId,
  variantId: l.variantId,
  supplierId: null,
  agentId: null,
  title: same(full(l)),
  body: {
    fr: `Inventaire #${l.number} : attendu ${l.expected}, compté ${l.counted} (écart ${l.pct} %). À vérifier.`,
    ar: `الجرد #${l.number}: المتوقع ${l.expected}، المعدود ${l.counted} (فرق ${l.pct} %). يجب التحقق.`,
    en: `Count #${l.number}: expected ${l.expected}, counted ${l.counted} (variance ${l.pct} %). To check.`,
  },
  suggestedAction: { kind: 'open_product', params: { productId: l.productId, variantId: l.variantId, inventoryId: l.inventoryId } },
  estimatedValue: null,
});

export const RULE_LABELS: Record<StockRecoRuleKey, L> = {
  restock_lead_time: { fr: 'STOCK / VITESSE < DÉLAI FOURNISSEUR', ar: 'المخزون / السرعة < مهلة المورّد', en: 'STOCK / VELOCITY < SUPPLIER LEAD TIME' },
  stockout_variant: { fr: 'STOCK VARIANTE ≤ 1 ET VENTES 7 J ≥ 3', ar: 'مخزون المتغيّر ≤ 1 والمبيعات 7 أيام ≥ 3', en: 'VARIANT STOCK ≤ 1 AND 7-DAY SALES ≥ 3' },
  dead_stock: { fr: '0 VENTE > 60 J ET STOCK > 5', ar: '0 مبيعات > 60 يومًا والمخزون > 5', en: '0 SALES > 60 D AND STOCK > 5' },
  margin_below_target: { fr: 'MARGE < CIBLE', ar: 'الهامش < الهدف', en: 'MARGIN < TARGET' },
  supplier_late: { fr: 'RETARDS ≥ 50 %', ar: 'التأخيرات ≥ 50 %', en: 'LATE ≥ 50 %' },
  agent_unknown_product: { fr: 'INTENTS PRODUIT INCONNU ≥ 10 / 7 J', ar: 'طلبات منتج غير معروف ≥ 10 / 7 أيام', en: 'UNKNOWN PRODUCT INTENTS ≥ 10 / 7 D' },
  inventory_variance: { fr: 'ÉCART INVENTAIRE > 10 %', ar: 'فرق الجرد > 10 %', en: 'INVENTORY VARIANCE > 10 %' },
};

/** Label of the primary button of a card (FIG GDS-10). */
export const actionLabel = (c: { suggestedAction: { kind: StockRecoActionKind; params: Record<string, unknown> } }, lang: 'fr' | 'ar' | 'en'): string => {
  const p = c.suggestedAction.params;
  const L: Record<StockRecoActionKind, L> = {
    create_purchase: { fr: `Commander ${p.quantity ?? ''} u`.trim(), ar: `اطلب ${p.quantity ?? ''} وحدة`.trim(), en: `Order ${p.quantity ?? ''} u`.trim() },
    create_promo: { fr: `Remise ${p.discountPct ?? 15} %`, ar: `تخفيض ${p.discountPct ?? 15} %`, en: `${p.discountPct ?? 15} % off` },
    update_price: { fr: `Passer à ${money(Number(p.price ?? 0))}`, ar: `تغيير السعر إلى ${money(Number(p.price ?? 0))}`, en: `Set price to ${money(Number(p.price ?? 0))}` },
    open_supplier: { fr: 'Voir le fournisseur', ar: 'عرض المورّد', en: 'View supplier' },
    open_insights: { fr: 'Voir les insights', ar: 'عرض الملاحظات', en: 'View insights' },
    open_product: { fr: 'Ouvrir le produit', ar: 'فتح المنتج', en: 'Open product' },
  };
  return L[c.suggestedAction.kind][lang];
};
