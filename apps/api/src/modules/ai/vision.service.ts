// 04-ai-pipeline §9 — vision.
//   customer photo (AI-06), two passes: (1) the vision model describes the photo → `search_products` top 10 inside the
//     agent's scope; (2) the model compares the photo with ≤ 10 candidate primary images → { productId, confidence }.
//   caption at upload (CAT-02, `media / caption-image`) and "create from photo" (CAT-07, `POST /products/ai-fill`):
//     the two providers of the catalogue module, bound here to the AI port (carry-over of M2).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CREDIT_COST } from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { StorageService } from '../../core/storage/storage.service';
import { AppException } from '../../core/errors/app.exception';
import type { ImageCaptionProvider, ProductVisionProvider, VisionPhoto, VisionSuggestion } from '../catalog/ai.providers';
import { CreditService } from '../credits/credit.service';
import { CAPTION_MAX, VISION_CANDIDATES, VISION_CONFIDENCE_MIN, VISION_MAX_BYTES } from './ai.constants';
import { CatalogueService, type AgentScope, type CatalogueProduct } from './catalogue.service';
import { AI_GATEWAY, AiProviderError, withInput, type AiGateway, type AiPart, type AiUsage } from './provider/ai.gateway';
import { RoutingService } from './routing.service';
import { parseJsonObject } from './structured-output';

const DescribeSchema = z.object({ category: z.string().default(''), colors: z.array(z.string()).default([]), text: z.string().default(''), description: z.string().default(''), keywords: z.array(z.string()).default([]), multipleProducts: z.boolean().default(false), quality: z.enum(['ok', 'blurry']).default('ok') });
const MatchSchema = z.object({
  productId: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  alternatives: z.array(z.string()).default([]),
  // one-pass answers (small catalogues) also say what the customer photo shows
  seen: z.string().default(''),
  multipleProducts: z.boolean().default(false),
  quality: z.enum(['ok', 'blurry']).catch('ok').default('ok'),
});
/** Pictures compared per candidate product, and in one call (client list L56 — a photo equal to a product's 2nd picture was not recognised). */
export const VISION_PHOTOS_PER_PRODUCT = 3;
export const VISION_PHOTOS_MAX = 12;
const ProductSchema = z.object({ name: z.string().default(''), description: z.string().default(''), categoryName: z.string().nullable().default(null), unitName: z.string().nullable().default(null), attributes: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]) });

/** The §3.8 note injected next to `[image]` in the customer turn. */
export type VisionNote =
  | { kind: 'match'; productId: string; confidence: number; name: string; alternatives: string[] }
  | { kind: 'unsure'; candidates: string[]; seen?: string }
  | { kind: 'multiple'; seen?: string }
  | { kind: 'blurry' }
  | { kind: 'unavailable' };
export type VisionResult = { note: VisionNote; /** pass 2 answered: the image credits are due */ matched: boolean; usage: AiUsage };

// owner 23/11 (« image recognition didn't work », zakaria's shop 13:57): with no product to match, the AI only said « je n'arrive pas à
// identifier le produit » — it never knew what the photo showed. The note now says it (`photo shows`), so the reply can name what the
// customer is looking for and say whether the shop sells it.
const seenText = (s?: string) => (s?.trim() ? ` — photo shows: "${s.trim().replace(/"/g, "'").slice(0, 160)}"` : '');
export const visionNoteText = (n: VisionNote): string =>
  n.kind === 'match'
    ? `IMAGE RESULT: ${JSON.stringify({ productId: n.productId, confidence: n.confidence, name: n.name })}`
    : n.kind === 'unsure'
      ? `IMAGE RESULT: unsure${n.candidates.length ? ` (closest products: ${n.candidates.join(', ')})` : ' (no product of the shop looks like it)'}${seenText(n.seen)}`
      : n.kind === 'multiple'
        ? `IMAGE RESULT: multiple${seenText(n.seen)}`
        : `IMAGE RESULT: ${n.kind}`;

// PV 28/10: the description came back in English and the catalogue (French / Arabic names) was searched with it — no
// candidate, so the photo was never compared. `keywords` are the search words, in the three languages of the shops.
const DESCRIBE =
  'Describe the product in this photo: category, colours, visible text/brand, shape. Reply as JSON { "category": string, "colors": string[], "text": string, "description": string, "keywords": string[], "multipleProducts": boolean, "quality": "ok"|"blurry" }. "keywords": 6 to 15 short search words for the product (its type, colour, material, brand), each given in French, then in Arabic, then in English — e.g. ["robe", "فستان", "dress", "satin", "ساتان", "bordeaux", "burgundy"].';
const MATCH =
  'The first image is a customer photo. The next images are the photos of candidate products of the shop, in the order of the candidates list — each candidate gives how many photos it has (`photos`; 0 = no photo, judge it by its name). Which candidate is the product of the customer photo (the same article, also when the customer photo is another of its photos or another angle)? Reply as JSON { "productId": string|null, "confidence": number 0-1, "alternatives": string[] }. Use null when none matches.';
// Houssem live 23/11 (H-07 15:12 / 15:17: 12.6 s and 13.8 s for a photo): a shop whose pictured products all fit in one call is asked once —
// the match and what the photo shows together — instead of a describe call then a match call.
const MATCH_ONE =
  'The first image is a customer photo sent to a shop. The next images are the photos of the shop\'s products, in the order of the candidates list — each candidate gives how many photos it has (`photos`). Is the customer photo one of these products (the same article, also when it is another of its photos or another angle)? Reply as JSON { "productId": string|null, "confidence": number 0-1, "alternatives": string[], "seen": string, "multipleProducts": boolean, "quality": "ok"|"blurry" }. "seen": what the customer photo shows, in one short sentence. "multipleProducts": true when the customer photo shows several different articles and none is singled out. "alternatives": ids of the other candidates that look close. Use productId null when none matches.';
const CAPTION = 'Caption this product image in one sentence for search: type, colour, material, notable text';
const PRODUCT = 'You help a shop owner create a product from photos. Reply as JSON { "name": string, "description": string, "categoryName": string|null, "unitName": string|null, "attributes": [{ "name": string, "values": string[] }] }. Never give a price. Pick categoryName and unitName only from the lists provided.';

// R23 (22/11): the Claude 5 models think inside max_tokens — at the default effort the describe call spent its 400 tokens
// thinking and answered nothing (no description, so no match: « je n'arrive pas à confirmer la photo »). Room for both.
export const VISION_MAX_TOKENS = 1500;
export const PRODUCT_VISION_MAX_TOKENS = 2500;

@Injectable()
export class VisionService {
  private readonly log = new Logger(VisionService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly catalogue: CatalogueService,
    private readonly storage: StorageService,
  ) {}

  private async ask(purpose: 'vision_describe' | 'vision_match' | 'caption' | 'product_vision', system: string, parts: AiPart[], usage: AiUsage, maxTokens = VISION_MAX_TOKENS) {
    const r = await this.routing.call('vision', (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose, system, messages: [{ role: 'user', content: parts }], temperature: 0, maxTokens, timeoutMs }));
    usage.inputTokens += r.value.usage.inputTokens;
    usage.outputTokens += r.value.usage.outputTokens;
    return r.value.text;
  }

  /** The most pictured products a shop may have for the one-call match (tests of the two-pass path set it to 0). */
  static onePassMax = VISION_CANDIDATES;

  /** The pictures of the candidates, in order: up to `VISION_PHOTOS_PER_PRODUCT` each (the primary first), `VISION_PHOTOS_MAX` in all. */
  private async photosOf(candidates: CatalogueProduct[]): Promise<{ c: CatalogueProduct; imgs: Buffer[] }[]> {
    let left = VISION_PHOTOS_MAX;
    // every candidate gets its primary picture first, then the other pictures while room is left
    const keys = candidates.map((c) => (c.imageKeys?.length ? c.imageKeys : c.imageKey ? [c.imageKey] : []).slice(0, VISION_PHOTOS_PER_PRODUCT));
    const take = keys.map(() => 0);
    for (let round = 0; round < VISION_PHOTOS_PER_PRODUCT && left > 0; round++) for (let i = 0; i < keys.length && left > 0; i++) if (keys[i]!.length > round) {
          take[i]!++;
          left--;
        }
    return Promise.all(
      candidates.map(async (c, i) => ({ c, imgs: (await Promise.all(keys[i]!.slice(0, take[i]).map((k) => this.storage.get(k).then((f) => f.body, () => null)))).filter((b): b is Buffer => !!b) })),
    );
  }

  /** The verdict of a match answer: a match above the threshold, else unsure with the closest names (and what the photo shows). */
  private verdict(m: z.output<typeof MatchSchema>, candidates: CatalogueProduct[], seen: string | undefined, usage: AiUsage): VisionResult {
    const hit = m.productId ? candidates.find((c) => c.id === m.productId) : undefined;
    const names = (ids: string[]) => ids.map((id) => candidates.find((c) => c.id === id)?.name).filter((x): x is string => !!x).slice(0, 3);
    if (!hit || m.confidence < VISION_CONFIDENCE_MIN) return { note: { kind: 'unsure', candidates: names([...(hit ? [hit.id] : []), ...m.alternatives]), ...(seen ? { seen } : {}) }, matched: true, usage };
    return { note: { kind: 'match', productId: hit.id, confidence: Math.round(m.confidence * 100) / 100, name: hit.name, alternatives: m.alternatives.filter((id) => candidates.some((c) => c.id === id)) }, matched: true, usage };
  }

  /**
   * AI-06. `image` = the customer photo as stored by the `media` job. Provider failures propagate (`AiProviderError`):
   * the reply run then follows F-6 and nothing is charged.
   */
  async analyse(agent: AgentScope, image: { body: Buffer; mime: string } | null): Promise<VisionResult> {
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    if (!image || !image.body.length || image.body.length > VISION_MAX_BYTES) return { note: { kind: 'unavailable' }, matched: false, usage };
    const photo: AiPart = { type: 'image', image: image.body, mime: image.mime };
    // a small catalogue (every pictured product fits in one call): one call gives the match and what the photo shows
    const pictured = await this.catalogue.withImages(agent, VISION_CANDIDATES + 1);
    if (pictured.length && pictured.length <= VisionService.onePassMax) {
      const shots = await this.photosOf(pictured);
      const list = shots.map((x) => ({ id: x.c.id, name: x.c.name, photos: x.imgs.length }));
      const parts: AiPart[] = [photo, ...shots.flatMap((x) => x.imgs.map((img): AiPart => ({ type: 'image', image: img, mime: 'image/webp' }))), { type: 'text', text: withInput(MATCH_ONE, { candidates: list }) }];
      const one = parseJsonObject(await this.ask('vision_match', MATCH_ONE, parts, usage), MatchSchema);
      const m = one.ok ? one.value : MatchSchema.parse({});
      const seen = m.seen.trim().slice(0, 160) || undefined;
      if (m.quality === 'blurry' && !m.productId) return { note: { kind: 'blurry' }, matched: false, usage };
      if (m.multipleProducts && !m.productId) return { note: { kind: 'multiple', ...(seen ? { seen } : {}) }, matched: true, usage };
      return this.verdict(m, pictured, seen, usage);
    }
    // pass 1
    const described = parseJsonObject(await this.ask('vision_describe', DESCRIBE, [photo, { type: 'text', text: 'Describe the photo.' }], usage), DescribeSchema);
    const d = described.ok ? described.value : DescribeSchema.parse({});
    if (d.quality === 'blurry') return { note: { kind: 'blurry' }, matched: false, usage };
    // what the photo shows, in a few words (the model's description, else its type and colours)
    const seen = (d.description || [d.category, ...d.colors, d.text].filter(Boolean).join(', ')).trim().slice(0, 160) || undefined;
    if (d.multipleProducts) return { note: { kind: 'multiple', ...(seen ? { seen } : {}) }, matched: false, usage };
    // the search words first (all of them, not the first 8 of an English sentence), then the rest of the description
    const keywords = [...d.keywords, d.text, d.category, ...d.colors].map((w) => w.trim()).filter(Boolean);
    const query = [...keywords, d.description].join(' ').slice(0, 200);
    const found = query ? await this.catalogue.search(agent, query, VISION_CANDIDATES, { maxWords: 24 }) : [];
    // the photo is always compared with pictures: the text matches first, then the shop's other pictured products
    const candidates = [...found, ...(await this.catalogue.withImages(agent, VISION_CANDIDATES - found.length, found.map((c) => c.id)))];
    if (!candidates.length) return { note: { kind: 'unsure', candidates: [], ...(seen ? { seen } : {}) }, matched: false, usage };
    // pass 2
    // client list L56: every candidate is compared with its pictures (up to 3 each), not its first one only
    const shots = await this.photosOf(candidates);
    const pictures = shots.filter((x) => x.imgs.length);
    const list = (pictures.length ? pictures : shots).map((x) => ({ id: x.c.id, name: x.c.name, photos: x.imgs.length }));
    const parts: AiPart[] = [photo, ...pictures.flatMap((x) => x.imgs.map((img): AiPart => ({ type: 'image', image: img, mime: 'image/webp' }))), { type: 'text', text: withInput(MATCH, { description: query, candidates: list }) }];
    const matched = parseJsonObject(await this.ask('vision_match', MATCH, parts, usage), MatchSchema);
    return this.verdict(matched.ok ? matched.value : MatchSchema.parse({}), candidates, seen, usage);
  }

  // --- catalogue providers (M2 carry-over) -----------------------------------------------------------------------------------
  /** CAT-02: `ProductImage.aiCaption` (≤ 200 chars, 0 credits). A provider failure leaves the caption empty. */
  async caption(input: { image: Buffer; mime: string; productName: string; locale: string }): Promise<string | null> {
    try {
      const text = await this.ask('caption', CAPTION, [{ type: 'image', image: input.image, mime: input.mime }, { type: 'text', text: withInput(CAPTION, { productName: input.productName }) }], { inputTokens: 0, outputTokens: 0 }, 120);
      const clean = text.replace(/\s+/g, ' ').replace(/^["'«\s]+|["'»\s]+$/g, '').trim();
      return clean ? clean.slice(0, CAPTION_MAX) : null;
    } catch (e) {
      if (e instanceof AiProviderError || e instanceof AppException) {
        this.log.warn({ kind: e instanceof AiProviderError ? e.kind : e.code }, 'image caption unavailable');
        return null;
      }
      throw e;
    }
  }

  /** CAT-07: never a price; `503 IMAGE_ANALYSIS_UNAVAILABLE` when no vision model answers, `422 IMAGE_ANALYSIS_FAILED` on an unusable answer. */
  async describeProduct(input: { photos: VisionPhoto[]; locale: string; categories: string[]; units: string[] }): Promise<VisionSuggestion> {
    const first = input.photos[0]!;
    const parts: AiPart[] = [
      ...input.photos.map((p): AiPart => ({ type: 'image', image: p.buffer, mime: p.mime })),
      { type: 'text', text: withInput(`Write the name and the description in ${input.locale === 'ar' ? 'Arabic' : input.locale === 'en' ? 'English' : 'French'}.`, { fileName: first.fileName, photos: input.photos.length, locale: input.locale, categories: input.categories, units: input.units }) },
    ];
    let text: string;
    try {
      text = await this.ask('product_vision', PRODUCT, parts, { inputTokens: 0, outputTokens: 0 }, PRODUCT_VISION_MAX_TOKENS);
    } catch (e) {
      if (e instanceof AiProviderError || (e instanceof AppException && e.code === 'AGENT_MODEL_UNAVAILABLE')) throw new AppException('IMAGE_ANALYSIS_UNAVAILABLE');
      throw e;
    }
    const parsed = parseJsonObject(text, ProductSchema);
    if (!parsed.ok || !parsed.value.name.trim()) throw new AppException('IMAGE_ANALYSIS_FAILED');
    const v = parsed.value;
    return { name: v.name.trim(), description: v.description.trim(), category: v.categoryName, unit: v.unitName, attributes: Object.fromEntries(v.attributes.map((a) => [a.name, a.values.join(', ')])) };
  }
}

/** `IMAGE_CAPTION_PROVIDER` of the catalogue module. */
@Injectable()
export class RoutedImageCaptionProvider implements ImageCaptionProvider {
  constructor(private readonly vision: VisionService) {}
  caption(input: { image: Buffer; mime: string; productName: string; locale: string }) {
    return this.vision.caption(input);
  }
}

/**
 * `PRODUCT_VISION_PROVIDER` of the catalogue module (`POST /products/ai-fill`, 06 §8.6: 5 credits). The analysis is one
 * `AiRun(kind = vision)`: 5 credits reserved, debited when the model answered, released on any failure.
 */
@Injectable()
export class RoutedProductVisionProvider implements ProductVisionProvider {
  constructor(
    private readonly vision: VisionService,
    private readonly routing: RoutingService,
    private readonly credits: CreditService,
  ) {}

  async describe(input: { photos: VisionPhoto[]; locale: string; categories: string[]; units: string[] }) {
    const workspaceId = TenantContext.workspaceId();
    const route = await this.routing.route('vision').catch(() => null);
    if (!route) throw new AppException('IMAGE_ANALYSIS_UNAVAILABLE');
    const started = Date.now();
    const run = await prisma.aiRun.create({ data: { workspaceId, kind: 'vision', modelId: route.primary.id, providerId: route.primary.providerId } });
    const ref = { id: run.id, workspaceId };
    const close = (status: 'ok' | 'error', error: string | null) => prisma.aiRun.updateMany({ where: { id: run.id, status: 'running' }, data: { status, error, finishedAt: new Date(), latencyMs: Date.now() - started } });
    if (!(await this.credits.reserve(ref, CREDIT_COST.image))) {
      await close('error', 'INSUFFICIENT_CREDITS');
      throw new AppException('INSUFFICIENT_CREDITS');
    }
    try {
      const suggestion = await this.vision.describeProduct(input);
      await close('ok', null);
      await this.credits.settle(ref, 'image_recognition');
      return suggestion;
    } catch (e) {
      await close('error', e instanceof AppException ? e.code : 'internal_error');
      await this.credits.release(ref);
      throw e;
    }
  }
}
