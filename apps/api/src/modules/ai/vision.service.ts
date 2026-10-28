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
const MatchSchema = z.object({ productId: z.string().nullable().default(null), confidence: z.number().min(0).max(1).default(0), alternatives: z.array(z.string()).default([]) });
const ProductSchema = z.object({ name: z.string().default(''), description: z.string().default(''), categoryName: z.string().nullable().default(null), unitName: z.string().nullable().default(null), attributes: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]) });

/** The §3.8 note injected next to `[image]` in the customer turn. */
export type VisionNote =
  | { kind: 'match'; productId: string; confidence: number; name: string; alternatives: string[] }
  | { kind: 'unsure'; candidates: string[] }
  | { kind: 'multiple' }
  | { kind: 'blurry' }
  | { kind: 'unavailable' };
export type VisionResult = { note: VisionNote; /** pass 2 answered: the image credits are due */ matched: boolean; usage: AiUsage };

export const visionNoteText = (n: VisionNote): string =>
  n.kind === 'match' ? `IMAGE RESULT: ${JSON.stringify({ productId: n.productId, confidence: n.confidence, name: n.name })}` : n.kind === 'unsure' ? `IMAGE RESULT: unsure${n.candidates.length ? ` (closest products: ${n.candidates.join(', ')})` : ''}` : `IMAGE RESULT: ${n.kind}`;

// PV 28/10: the description came back in English and the catalogue (French / Arabic names) was searched with it — no
// candidate, so the photo was never compared. `keywords` are the search words, in the three languages of the shops.
const DESCRIBE =
  'Describe the product in this photo: category, colours, visible text/brand, shape. Reply as JSON { "category": string, "colors": string[], "text": string, "description": string, "keywords": string[], "multipleProducts": boolean, "quality": "ok"|"blurry" }. "keywords": 6 to 15 short search words for the product (its type, colour, material, brand), each given in French, then in Arabic, then in English — e.g. ["robe", "فستان", "dress", "satin", "ساتان", "bordeaux", "burgundy"].';
const MATCH = 'The first image is a customer photo. The next images are candidate products of the shop, in the order of the candidates list. Which candidate is the product of the customer photo? Reply as JSON { "productId": string|null, "confidence": number 0-1, "alternatives": string[] }. Use null when none matches.';
const CAPTION = 'Caption this product image in one sentence for search: type, colour, material, notable text';
const PRODUCT = 'You help a shop owner create a product from photos. Reply as JSON { "name": string, "description": string, "categoryName": string|null, "unitName": string|null, "attributes": [{ "name": string, "values": string[] }] }. Never give a price. Pick categoryName and unitName only from the lists provided.';

@Injectable()
export class VisionService {
  private readonly log = new Logger(VisionService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly catalogue: CatalogueService,
    private readonly storage: StorageService,
  ) {}

  private async ask(purpose: 'vision_describe' | 'vision_match' | 'caption' | 'product_vision', system: string, parts: AiPart[], usage: AiUsage, maxTokens = 400) {
    const r = await this.routing.call('vision', (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose, system, messages: [{ role: 'user', content: parts }], temperature: 0, maxTokens, timeoutMs }));
    usage.inputTokens += r.value.usage.inputTokens;
    usage.outputTokens += r.value.usage.outputTokens;
    return r.value.text;
  }

  private async primaryImage(p: CatalogueProduct): Promise<Buffer | null> {
    if (!p.imageKey) return null;
    return this.storage.get(p.imageKey).then((f) => f.body, () => null);
  }

  /**
   * AI-06. `image` = the customer photo as stored by the `media` job. Provider failures propagate (`AiProviderError`):
   * the reply run then follows F-6 and nothing is charged.
   */
  async analyse(agent: AgentScope, image: { body: Buffer; mime: string } | null): Promise<VisionResult> {
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    if (!image || !image.body.length || image.body.length > VISION_MAX_BYTES) return { note: { kind: 'unavailable' }, matched: false, usage };
    const photo: AiPart = { type: 'image', image: image.body, mime: image.mime };
    // pass 1
    const described = parseJsonObject(await this.ask('vision_describe', DESCRIBE, [photo, { type: 'text', text: 'Describe the photo.' }], usage), DescribeSchema);
    const d = described.ok ? described.value : DescribeSchema.parse({});
    if (d.quality === 'blurry') return { note: { kind: 'blurry' }, matched: false, usage };
    if (d.multipleProducts) return { note: { kind: 'multiple' }, matched: false, usage };
    // the search words first (all of them, not the first 8 of an English sentence), then the rest of the description
    const keywords = [...d.keywords, d.text, d.category, ...d.colors].map((w) => w.trim()).filter(Boolean);
    const query = [...keywords, d.description].join(' ').slice(0, 200);
    const found = query ? await this.catalogue.search(agent, query, VISION_CANDIDATES, { maxWords: 24 }) : [];
    // the photo is always compared with pictures: the text matches first, then the shop's other pictured products
    const candidates = [...found, ...(await this.catalogue.withImages(agent, VISION_CANDIDATES - found.length, found.map((c) => c.id)))];
    if (!candidates.length) return { note: { kind: 'unsure', candidates: [] }, matched: false, usage };
    // pass 2
    const withImages = (await Promise.all(candidates.map(async (c) => ({ c, img: await this.primaryImage(c) })))).filter((x): x is { c: CatalogueProduct; img: Buffer } => !!x.img);
    const list = (withImages.length ? withImages.map((x) => x.c) : candidates).map((c) => ({ id: c.id, name: c.name }));
    const parts: AiPart[] = [photo, ...withImages.map((x): AiPart => ({ type: 'image', image: x.img, mime: 'image/webp' })), { type: 'text', text: withInput(MATCH, { description: query, candidates: list }) }];
    const matched = parseJsonObject(await this.ask('vision_match', MATCH, parts, usage), MatchSchema);
    const m = matched.ok ? matched.value : MatchSchema.parse({});
    const hit = m.productId ? candidates.find((c) => c.id === m.productId) : undefined;
    const names = (ids: string[]) => ids.map((id) => candidates.find((c) => c.id === id)?.name).filter((x): x is string => !!x).slice(0, 3);
    if (!hit || m.confidence < VISION_CONFIDENCE_MIN) return { note: { kind: 'unsure', candidates: names([...(hit ? [hit.id] : []), ...m.alternatives]) }, matched: true, usage };
    return { note: { kind: 'match', productId: hit.id, confidence: Math.round(m.confidence * 100) / 100, name: hit.name, alternatives: m.alternatives.filter((id) => candidates.some((c) => c.id === id)) }, matched: true, usage };
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
      text = await this.ask('product_vision', PRODUCT, parts, { inputTokens: 0, outputTokens: 0 }, 700);
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
