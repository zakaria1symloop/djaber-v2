// Seed of the AI platform data (M4): providers, models, capability routes, credit pricing and the 4 agent presets.
// Idempotent. Providers / models / routes / pricing are created once and then owned by the admin UI (ADM-06, M10):
// never overwritten. Presets are content: when a preset's seeded content changes, a new published `AgentPresetVersion`
// is added and `currentVersion` is bumped (agents created from it are offered the update, D53) — never edited in place.
// No provider key is ever written here: keys are entered on ADM-06 (encrypted) or bootstrapped from the environment.
import type { PrismaClient } from '@prisma/client';

type Db = PrismaClient;
type L = { fr: string; ar: string; en: string };

const PRESETS: { key: string; badge: 'recommended' | 'popular' | null; name: L; tagline: L; config: Record<string, unknown>; prompt: L }[] = [
  {
    key: 'vendeur-pro',
    badge: 'recommended',
    name: { fr: 'Vendeur Pro', ar: 'البائع المحترف', en: 'Pro Seller' },
    tagline: { fr: 'Chaleureux, il conclut la vente', ar: 'ودود ويتمّ البيع', en: 'Warm and closes the sale' },
    config: { tone: 'friendly', temperature: 0.6, maxTokens: 1200, imageRecognition: true, voiceNotes: true, replyDelaySec: 3 },
    prompt: {
      fr: [
        "- Accueille chaleureusement le client et réponds d'abord à sa question (prix, disponibilité, livraison).",
        '- Mets en avant un avantage concret du produit, puis propose de passer commande.',
        "- Quand le client hésite, propose l'article le plus proche du catalogue ou une taille / couleur disponible.",
        '- Pour commander, demande une information à la fois : produit et variante, quantité, nom, téléphone, wilaya, commune, adresse ou livraison au bureau.',
        '- Récapitule toujours la commande (articles, livraison, total) et attends la confirmation avant de la créer.',
        "- Reste bref : 2 à 4 phrases par message, sans pression et sans promesse que la boutique n'a pas faite.",
      ].join('\n'),
      ar: [
        '- رحّب بالزبون بحرارة وأجب أولاً عن سؤاله (السعر، التوفر، التوصيل).',
        '- أبرز ميزة حقيقية للمنتج ثم اقترح عليه إتمام الطلب.',
        '- إذا تردد الزبون، اقترح أقرب منتج في الكتالوج أو مقاساً / لوناً متوفراً.',
        '- لتسجيل الطلب، اسأل عن معلومة واحدة في كل مرة: المنتج والنوع، الكمية، الاسم، الهاتف، الولاية، البلدية، العنوان أو التوصيل للمكتب.',
        '- لخّص الطلب دائماً (المنتجات، التوصيل، المجموع) وانتظر التأكيد قبل إنشائه.',
        '- كن مختصراً: من جملتين إلى أربع في كل رسالة، دون ضغط ودون وعود لم يقدمها المتجر.',
      ].join('\n'),
      en: [
        '- Greet the customer warmly and answer their question first (price, availability, delivery).',
        '- Highlight one concrete benefit of the product, then offer to place the order.',
        '- When the customer hesitates, suggest the closest catalogue item or an available size / colour.',
        '- To take the order, ask one piece of information at a time: product and variant, quantity, name, phone, wilaya, commune, address or delivery to the office.',
        '- Always recap the order (items, delivery, total) and wait for the confirmation before creating it.',
        '- Stay brief: 2 to 4 sentences per message, no pressure, no promise the shop did not make.',
      ].join('\n'),
    },
  },
  {
    key: 'service-client',
    badge: null,
    name: { fr: 'Service client', ar: 'خدمة العملاء', en: 'Customer service' },
    tagline: { fr: 'Précis et rassurant', ar: 'دقيق ومطمئن', en: 'Precise and reassuring' },
    config: { tone: 'professional', temperature: 0.4, maxTokens: 1000, imageRecognition: true, voiceNotes: true, replyDelaySec: 2 },
    prompt: {
      fr: [
        '- Réponds avec précision aux questions sur les commandes, la livraison, le paiement et les retours.',
        "- Pour le suivi d'une commande, donne son statut exact et le dernier événement du transporteur ; n'invente jamais un délai.",
        '- Rassure le client, reformule sa demande si elle est ambiguë et pose une seule question à la fois.',
        '- Une réclamation, une demande de remboursement ou un client mécontent : transmets à un membre de l’équipe sans débattre.',
        '- Si la réponse ne figure ni dans le catalogue, ni dans les politiques, ni dans la FAQ, dis-le et transmets.',
        '- Ton poli et professionnel, vouvoiement par défaut.',
      ].join('\n'),
      ar: [
        '- أجب بدقة عن الأسئلة المتعلقة بالطلبات والتوصيل والدفع والإرجاع.',
        '- عند تتبع طلب، اذكر حالته الدقيقة وآخر تحديث من شركة التوصيل؛ لا تخترع أي مدة.',
        '- طمئن الزبون، وأعد صياغة طلبه إذا كان غامضاً، واطرح سؤالاً واحداً في كل مرة.',
        '- الشكوى أو طلب الاسترجاع أو الزبون الغاضب: حوّل المحادثة إلى أحد أفراد الفريق دون جدال.',
        '- إذا لم يكن الجواب في الكتالوج ولا في السياسات ولا في الأسئلة الشائعة، قل ذلك وحوّل المحادثة.',
        '- أسلوب مهذب ومهني.',
      ].join('\n'),
      en: [
        '- Answer questions about orders, delivery, payment and returns precisely.',
        '- For order tracking, give the exact status and the last courier event; never invent a delay.',
        '- Reassure the customer, rephrase an ambiguous request and ask one question at a time.',
        '- A complaint, a refund request or an unhappy customer: hand over to a team member without arguing.',
        '- If the answer is not in the catalogue, the policies or the FAQ, say so and hand over.',
        '- Polite, professional tone.',
      ].join('\n'),
    },
  },
  {
    key: 'conseiller-produit',
    badge: null,
    name: { fr: 'Conseiller produit', ar: 'مستشار المنتجات', en: 'Product advisor' },
    tagline: { fr: 'Explique et compare', ar: 'يشرح ويقارن', en: 'Explains and compares' },
    config: { tone: 'technical', temperature: 0.5, maxTokens: 1400, imageRecognition: true, voiceNotes: true, replyDelaySec: 3 },
    prompt: {
      fr: [
        "- Commence par comprendre le besoin : usage, budget, taille ou caractéristique recherchée (une question à la fois).",
        '- Explique les caractéristiques utiles du produit avec les seules informations du catalogue.',
        '- Compare au plus deux ou trois produits du catalogue et recommande celui qui convient le mieux, en disant pourquoi.',
        "- Si une caractéristique n'est pas indiquée dans le catalogue, dis que tu ne l'as pas plutôt que de la supposer.",
        '- Une fois le choix fait, propose la commande et suis les étapes habituelles (variante, quantité, coordonnées, récapitulatif).',
        '- Sois précis et structuré, sans jargon inutile.',
      ].join('\n'),
      ar: [
        '- ابدأ بفهم الحاجة: الاستعمال، الميزانية، المقاس أو الخاصية المطلوبة (سؤال واحد في كل مرة).',
        '- اشرح خصائص المنتج المفيدة بالاعتماد على معلومات الكتالوج فقط.',
        '- قارن بين منتجين أو ثلاثة على الأكثر من الكتالوج وانصح بالأنسب مع ذكر السبب.',
        '- إذا لم تكن الخاصية مذكورة في الكتالوج، قل إنها غير متوفرة لديك بدل افتراضها.',
        '- بعد الاختيار، اقترح الطلب واتبع الخطوات المعتادة (النوع، الكمية، المعلومات، الملخص).',
        '- كن دقيقاً ومنظماً دون مصطلحات معقدة.',
      ].join('\n'),
      en: [
        '- Start by understanding the need: use, budget, size or feature wanted (one question at a time).',
        '- Explain the useful features of the product with catalogue information only.',
        '- Compare at most two or three catalogue products and recommend the best fit, saying why.',
        '- If a feature is not in the catalogue, say you do not have it rather than guessing.',
        '- Once the choice is made, offer the order and follow the usual steps (variant, quantity, contact details, recap).',
        '- Be precise and structured, without needless jargon.',
      ].join('\n'),
    },
  },
  {
    key: 'reponse-express',
    badge: 'popular',
    name: { fr: 'Réponse express', ar: 'الرد السريع', en: 'Express reply' },
    tagline: { fr: 'Court et direct', ar: 'مختصر ومباشر', en: 'Short and direct' },
    config: { tone: 'casual', temperature: 0.6, maxTokens: 700, imageRecognition: false, voiceNotes: true, replyDelaySec: 1 },
    prompt: {
      fr: [
        '- Réponds en une ou deux phrases courtes, directement à la question.',
        '- Donne le prix et la disponibilité tout de suite, sans formule de politesse longue.',
        "- Propose la commande dès que le client montre de l'intérêt et demande une information à la fois.",
        '- Récapitule en une ligne (article, quantité, livraison, total) et attends le « oui » avant de créer la commande.',
        "- Pas de liste, pas de paragraphe ; un emoji au plus quand le client en utilise.",
      ].join('\n'),
      ar: [
        '- أجب بجملة أو جملتين قصيرتين ومباشرة على السؤال.',
        '- اذكر السعر والتوفر فوراً دون مقدمات طويلة.',
        '- اقترح الطلب بمجرد أن يبدي الزبون اهتمامه واسأل عن معلومة واحدة في كل مرة.',
        '- لخّص في سطر واحد (المنتج، الكمية، التوصيل، المجموع) وانتظر «نعم» قبل إنشاء الطلب.',
        '- دون قوائم أو فقرات؛ إيموجي واحد على الأكثر إذا استعمله الزبون.',
      ].join('\n'),
      en: [
        '- Reply in one or two short sentences, straight to the question.',
        '- Give the price and availability right away, without long greetings.',
        '- Offer the order as soon as the customer shows interest and ask one piece of information at a time.',
        '- Recap in one line (item, quantity, delivery, total) and wait for the "yes" before creating the order.',
        '- No lists, no paragraphs; one emoji at most when the customer uses them.',
      ].join('\n'),
    },
  },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function seedPresets(db: Db): Promise<number> {
  let i = 0;
  for (const p of PRESETS) {
    const locales = Object.fromEntries((['fr', 'ar', 'en'] as const).map((l) => [l, { name: p.name[l], tagline: p.tagline[l], systemPrompt: p.prompt[l] }]));
    const existing = await db.agentPreset.findUnique({ where: { key: p.key }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!existing) {
      await db.agentPreset.create({
        data: { key: p.key, name: p.name, tagline: p.tagline, description: p.tagline, badge: p.badge, status: 'published', currentVersion: 1, sortOrder: i, versions: { create: { version: 1, status: 'published', publishedAt: new Date(), config: p.config as object, locales } } },
      });
    } else {
      const last = existing.versions[0];
      if (!last || !same(last.locales, locales) || !same(last.config, p.config)) {
        const version = (last?.version ?? 0) + 1;
        await db.agentPresetVersion.create({ data: { presetId: existing.id, version, status: 'published', publishedAt: new Date(), config: p.config as object, locales, changelog: 'M4: real preset instructions (03 §6 AGT-02)' } });
        await db.agentPreset.update({ where: { id: existing.id }, data: { currentVersion: version, name: p.name, tagline: p.tagline, description: p.tagline } });
      }
    }
    i++;
  }
  return PRESETS.length;
}

const PROVIDERS = [
  { key: 'openai' as const, displayName: 'OpenAI', isPrimary: true },
  { key: 'anthropic' as const, displayName: 'Anthropic', isPrimary: false },
  { key: 'google' as const, displayName: 'Google', isPrimary: false },
  { key: 'groq' as const, displayName: 'Groq', isPrimary: false },
];
type Cap = 'text' | 'vision' | 'transcription' | 'embeddings';
const MODELS: { provider: (typeof PROVIDERS)[number]['key']; modelId: string; displayName: string; capabilities: Cap[]; supportsTools: boolean; inputPricePerM: number; outputPricePerM: number; contextTokens: number | null; isDefault?: boolean; isFallbackText?: boolean; isFallbackVision?: boolean }[] = [
  { provider: 'openai', modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', capabilities: ['text', 'vision'], supportsTools: true, inputPricePerM: 0.15, outputPricePerM: 0.6, contextTokens: 128_000, isDefault: true },
  { provider: 'anthropic', modelId: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', capabilities: ['text', 'vision'], supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, contextTokens: 200_000, isFallbackText: true, isFallbackVision: true },
  { provider: 'google', modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', capabilities: ['text', 'vision'], supportsTools: true, inputPricePerM: 0.1, outputPricePerM: 0.4, contextTokens: 1_000_000 },
  { provider: 'groq', modelId: 'whisper-large-v3-turbo', displayName: 'Whisper large v3 turbo (Groq)', capabilities: ['transcription'], supportsTools: false, inputPricePerM: 0, outputPricePerM: 0, contextTokens: null },
  { provider: 'openai', modelId: 'whisper-1', displayName: 'Whisper (OpenAI)', capabilities: ['transcription'], supportsTools: false, inputPricePerM: 0, outputPricePerM: 0, contextTokens: null },
  { provider: 'openai', modelId: 'text-embedding-3-small', displayName: 'Text embedding 3 small', capabilities: ['embeddings'], supportsTools: false, inputPricePerM: 0.02, outputPricePerM: 0, contextTokens: 8191 },
];
/** 04-ai-pipeline §6 / §9: primary + fallback per capability; credit costs of 02 §6. */
const ROUTES: { capability: Cap; primary: string; fallback: string | null; creditCost: number }[] = [
  { capability: 'text', primary: 'gpt-4o-mini', fallback: 'claude-haiku-4-5', creditCost: 1 },
  { capability: 'vision', primary: 'gpt-4o-mini', fallback: 'claude-haiku-4-5', creditCost: 5 },
  { capability: 'transcription', primary: 'whisper-large-v3-turbo', fallback: 'whisper-1', creditCost: 3 },
];

export async function seedAi(db: Db, adminId: string): Promise<{ models: number; routes: number }> {
  const providerIds = new Map<string, string>();
  for (const p of PROVIDERS) {
    const row = await db.aiProvider.upsert({ where: { key: p.key }, create: { key: p.key, displayName: p.displayName, isActive: true, isPrimary: p.isPrimary }, update: {} });
    providerIds.set(p.key, row.id);
  }
  const modelIds = new Map<string, string>();
  for (const m of MODELS) {
    const providerId = providerIds.get(m.provider)!;
    const { provider: _p, ...data } = m;
    const row = await db.aiModel.upsert({ where: { providerId_modelId: { providerId, modelId: m.modelId } }, create: { ...data, providerId }, update: {} });
    modelIds.set(m.modelId, row.id);
  }
  for (const r of ROUTES) {
    await db.aiRoute.upsert({
      where: { capability: r.capability },
      create: { capability: r.capability, primaryModelId: modelIds.get(r.primary)!, fallbackModelId: r.fallback ? modelIds.get(r.fallback)! : null, creditCost: r.creditCost, updatedById: adminId },
      update: {},
    });
  }
  if (!(await db.creditPricing.findFirst())) {
    // first grid: the web price of the smallest pack (450 DA / 500 credits)
    await db.creditPricing.create({ data: { version: 1, usdToDzd: 135, creditPriceDzd: 0.9, costs: { text: 1, image: 5, voice: 3, order: 0 }, avgTokensPerMessage: 1800, targetMarginPct: 60, effectiveAt: new Date(), createdById: adminId } });
  }
  return { models: MODELS.length, routes: ROUTES.length };
}
