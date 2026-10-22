// `AI_DRIVER=fake` — the default adapter of the AI port: no network, same input ⇒ same output.
// Two layers:
//  1. a script (tests): `script('reply', step, step…)` queues answers per purpose — a plain reply, a structured object,
//     tool calls, raw text (malformed output), an error class or a delay; `failModel` makes one model fail on demand.
//  2. a small rule-based "brain" (dev UI, evals): keywords of the last customer message decide the tool call or the
//     answer, tool results are turned into the final structured output. It validates the plumbing, not model quality.
import { createHash } from 'node:crypto';
import { detectLanguage, type AiLanguage } from '../language';
import {
  AiProviderError,
  imagesOf,
  readInput,
  type AiErrorKind,
  type AiGateway,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiMessage,
  type AiPurpose,
  type AiToolCallRequest,
  type AiTranscribeRequest,
  type AiTranscribeResult,
} from './ai.gateway';

export type FakeStep =
  | { reply: string; status?: 'OK' | 'UNCLEAR' | 'UNKNOWN' | 'HANDOFF'; statusDetail?: string; intent?: string; productCards?: string[]; recommendations?: { sourceId: string; recommendedId: string }[]; confidence?: number; language?: string; customer?: Record<string, string> }
  | { object: unknown }
  | { text: string }
  | { toolCalls: { name: string; args: Record<string, unknown>; id?: string }[] }
  | { error: AiErrorKind }
  | { delayMs: number; then: FakeStep };
export type FakeScript = FakeStep | ((req: AiGenerateRequest) => FakeStep | undefined);
type Transcript = { text: string; language?: string | null; durationSec?: number | null } | { error: AiErrorKind };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash6 = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 6);
const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

const T: Record<AiLanguage, Record<string, string>> = {
  fr: {
    greeting: 'Bonjour ! Comment puis-je vous aider ?',
    found: 'Voici ce que nous avons : {list}. Voulez-vous commander ?',
    none: "Désolé, je n'ai pas trouvé ce produit dans notre catalogue.",
    askWilaya: 'Dans quelle wilaya souhaitez-vous être livré ?',
    fee: 'La livraison vers {wilaya} coûte {fee} DA.',
    feeFree: 'La livraison vers {wilaya} est gratuite.',
    notServed: 'Désolé, nous ne livrons pas encore vers cette wilaya.',
    handoff: 'Je transmets votre demande à un conseiller.',
    unclear: "Je n'ai pas bien compris, pouvez-vous préciser ?",
    orders: 'Vos commandes : {list}.',
    noOrders: "Je ne trouve aucune commande en cours à votre nom.",
    askOrder: 'Très bien ! Quel est votre nom complet et votre numéro de téléphone ?',
    ordered: 'Votre commande {number} est enregistrée. Total : {total} DA.',
    whichCancel: 'Quelle commande souhaitez-vous annuler ? {list}',
    cancelled: 'Votre commande {number} est annulée.',
    photoMatch: 'Il me semble que vous cherchez « {name} ». Je vous envoie sa fiche.',
    photoUnsure: "Pouvez-vous me confirmer de quel produit il s'agit ?",
    photoBlurry: 'La photo est floue, pouvez-vous en envoyer une autre ?',
    photoMultiple: 'Je vois plusieurs produits sur la photo, lequel vous intéresse ?',
  },
  en: {
    greeting: 'Hello! How can I help you?',
    found: 'Here is what we have: {list}. Would you like to order?',
    none: 'Sorry, I could not find this product in our catalogue.',
    askWilaya: 'Which wilaya should we deliver to?',
    fee: 'Delivery to {wilaya} costs {fee} DA.',
    feeFree: 'Delivery to {wilaya} is free.',
    notServed: 'Sorry, we do not deliver to this wilaya yet.',
    handoff: 'I am passing your request to a team member.',
    unclear: 'I did not quite understand, could you clarify?',
    orders: 'Your orders: {list}.',
    noOrders: 'I cannot find any open order in your name.',
    askOrder: 'Great! What is your full name and phone number?',
    ordered: 'Your order {number} is registered. Total: {total} DA.',
    whichCancel: 'Which order would you like to cancel? {list}',
    cancelled: 'Your order {number} is cancelled.',
    photoMatch: 'It looks like you are looking for "{name}". Here is its card.',
    photoUnsure: 'Could you confirm which product this is?',
    photoBlurry: 'The photo is blurry, could you send another one?',
    photoMultiple: 'I can see several products in the photo, which one do you mean?',
  },
  ar: {
    greeting: 'مرحبا! كيفاش نقدر نعاونك؟',
    found: 'هذا واش عندنا: {list}. تحب تطلب؟',
    none: 'سمحلي، ما لقيتش هذا المنتوج في الكتالوج.',
    askWilaya: 'لأي ولاية تحب التوصيل؟',
    fee: 'التوصيل إلى {wilaya} بـ {fee} دج.',
    feeFree: 'التوصيل إلى {wilaya} مجاني.',
    notServed: 'سمحلي، ما نوصلوش لهذه الولاية حاليا.',
    handoff: 'راني نحوّل الطلب تاعك لواحد من الفريق.',
    unclear: 'ما فهمتش مليح، تقدر توضح؟',
    orders: 'الطلبيات تاعك: {list}.',
    noOrders: 'ما لقيت حتى طلبية مفتوحة باسمك.',
    askOrder: 'مليح! واش هو الاسم الكامل ورقم الهاتف؟',
    ordered: 'الطلبية {number} تسجلت. المجموع: {total} دج.',
    whichCancel: 'أي طلبية تحب تلغي؟ {list}',
    cancelled: 'الطلبية {number} تلغات.',
    photoMatch: 'يبان لي راك تحوس على «{name}». هاهي البطاقة تاعو.',
    photoUnsure: 'تقدر تأكد لي أي منتوج هذا؟',
    photoBlurry: 'الصورة ماشي واضحة، ابعث صورة أخرى من فضلك.',
    photoMultiple: 'كاين بزاف منتوجات في الصورة، أي واحد تحب؟',
  },
  arabizi: {
    greeting: 'Salam! Kifach n9der n3awnek?',
    found: 'Hada wach 3andna: {list}. T7eb tcommandi?',
    none: 'Sm7li, ma l9itch had lproduit f catalogue.',
    askWilaya: 'L ay wilaya t7eb tawsil?',
    fee: 'Tawsil l {wilaya} b {fee} DA.',
    feeFree: 'Tawsil l {wilaya} batel.',
    notServed: 'Sm7li, ma nwasslouch l had lwilaya.',
    handoff: 'Rani n7awel talab ta3ek l wa7ed men lfari9.',
    unclear: 'Ma fhemtch mli7, t9der twade7?',
    orders: 'Les commandes ta3ek: {list}.',
    noOrders: 'Ma l9it 7ta commande b ismek.',
    askOrder: 'Mli7! Wach howa ismek w numéro ta3 téléphone?',
    ordered: 'La commande {number} tsejlet. Total: {total} DA.',
    whichCancel: 'Ama commande t7eb tannuler? {list}',
    cancelled: 'La commande {number} tannulat.',
    photoMatch: 'Yban li rak t7awes 3la "{name}". Hahi la fiche ta3o.',
    photoUnsure: 'T9der t2akedli ama produit hada?',
    photoBlurry: 'Tswira machi wad7a, b3at wa7da okhra.',
    photoMultiple: 'Kayen bzaf produits f tswira, ama wa7ed t7eb?',
  },
  mixed: {},
};
T.mixed = T.fr;
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ''));

const RX = {
  human: /(humain|conseiller|un agent|quelqu'un|human|real person|إنسان|انسان|موظف|insan|bnadem)/i,
  refund: /(rembours|refund|rajja3|استرجاع|رجعولي|ترجعولي)/i,
  anger: /(arnaque|voleur|scandal|honte|nul à chier|scam|سراقين|حشومة عليكم|7chouma)/i,
  cancel: /(annul|cancel|نلغي|الغاء|إلغاء|nelghi)/i,
  tracking: /(où est|ou est|suivi|tracking|where is my|وين الطلبية|وين راهي|win rahi|win la commande|win commande)/i,
  delivery: /(livraison|tawsil|توصيل|delivery|shipping|livrer)/i,
  order: /(je commande|commander|ncommandi|n7eb nechri|نطلب|نشري|i want to order|place an order)/i,
  confirm: /(je confirme|confirm|نعم|n3am|oui c'est bon|أكد)/i,
  greeting: /^(salam|salem|slm|bonjour|bonsoir|salut|hello|hi|hey|cc|سلام|السلام عليكم|مرحبا|اهلا)[\s!.,?]*$/i,
  price: /(prix|combien|chhal|ch7al|bch7al|شحال|بشحال|price|how much|avez|kayen|kayn|كاين|3andkom|عندكم|cherche|dispo|n7awes|نحوس)/i,
};

export class FakeAiGateway implements AiGateway {
  readonly driver = 'fake' as const;
  /** every generate call, oldest first */
  readonly calls: AiGenerateRequest[] = [];
  readonly transcriptions: AiTranscribeRequest[] = [];
  private readonly scripts = new Map<AiPurpose, FakeScript[]>();
  private readonly modelFailures = new Map<string, { kind: AiErrorKind; left: number }>();
  private readonly transcripts: Transcript[] = [];

  // --- scripting (tests) ----------------------------------------------------------------------------------------------
  /** Queues answers for the next calls of a purpose (one entry per model step). */
  script(purpose: AiPurpose, ...steps: FakeScript[]) {
    const q = this.scripts.get(purpose) ?? [];
    q.push(...steps);
    this.scripts.set(purpose, q);
    return this;
  }
  /** Makes every call to `modelId` fail (`times` calls; default: until `reset`). */
  failModel(modelId: string, kind: AiErrorKind = 'provider_error', times = Number.POSITIVE_INFINITY) {
    this.modelFailures.set(modelId, { kind, left: times });
    return this;
  }
  /** Queues transcription results (text or an error class), consumed in order. */
  transcript(...items: (string | Transcript)[]) {
    this.transcripts.push(...items.map((i) => (typeof i === 'string' ? { text: i } : i)));
    return this;
  }
  callsOf(purpose: AiPurpose) {
    return this.calls.filter((c) => c.purpose === purpose);
  }
  reset() {
    this.calls.length = 0;
    this.transcriptions.length = 0;
    this.scripts.clear();
    this.modelFailures.clear();
    this.transcripts.length = 0;
  }

  private failing(modelId: string, provider: AiGenerateRequest['model']['provider']) {
    const f = this.modelFailures.get(modelId);
    if (!f || f.left <= 0) return;
    f.left -= 1;
    throw new AiProviderError(f.kind, provider, `${provider} ${f.kind} (fake)`, f.kind === 'provider_rejected' ? 401 : 500);
  }

  // --- port -----------------------------------------------------------------------------------------------------------
  async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
    // a snapshot: the caller keeps appending tool rounds to its own array
    this.calls.push({ ...req, messages: [...req.messages] });
    this.failing(req.model.modelId, req.model.provider);
    const queue = this.scripts.get(req.purpose);
    let step: FakeStep | undefined;
    while (queue?.length && !step) {
      const next = queue.shift()!;
      step = typeof next === 'function' ? next(req) : next;
    }
    step ??= this.brain(req);
    return this.resolve(req, step);
  }

  private async resolve(req: AiGenerateRequest, step: FakeStep): Promise<AiGenerateResult> {
    if ('delayMs' in step) {
      // honours the caller's timeout the way a real adapter does
      if (step.delayMs >= req.timeoutMs) {
        await sleep(Math.min(req.timeoutMs, 50));
        throw new AiProviderError('timeout', req.model.provider, `${req.model.provider} timeout (fake)`);
      }
      await sleep(step.delayMs);
      return this.resolve(req, step.then);
    }
    if ('error' in step) throw new AiProviderError(step.error, req.model.provider, `${req.model.provider} ${step.error} (fake)`, step.error === 'provider_rejected' ? 401 : 500);
    const input = approxTokens(req.system) + req.messages.reduce((n, m) => n + approxTokens(typeof (m as { content?: unknown }).content === 'string' ? ((m as { content: string }).content) : JSON.stringify((m as { result?: unknown }).result ?? '')), 0);
    if ('toolCalls' in step) {
      const toolCalls: AiToolCallRequest[] = step.toolCalls.map((c, i) => ({ id: c.id ?? `call_${this.calls.length}_${i}`, name: c.name, args: c.args }));
      return { text: '', toolCalls, usage: { inputTokens: input, outputTokens: 12 * toolCalls.length }, finishReason: 'tool-calls' };
    }
    const text =
      'text' in step
        ? step.text
        : 'object' in step
          ? JSON.stringify(step.object)
          : JSON.stringify({
              reply: step.reply,
              status: step.status ?? 'OK',
              ...(step.statusDetail ? { statusDetail: step.statusDetail } : {}),
              intent: step.intent ?? 'INFO',
              productCards: step.productCards ?? [],
              recommendations: step.recommendations ?? [],
              confidence: step.confidence ?? 0.9,
              ...(step.language ? { language: step.language } : {}),
              ...(step.customer ? { customer: step.customer } : {}),
            });
    return { text, toolCalls: [], usage: { inputTokens: input, outputTokens: approxTokens(text) }, finishReason: 'stop' };
  }

  async transcribe(req: AiTranscribeRequest): Promise<AiTranscribeResult> {
    this.transcriptions.push(req);
    this.failing(req.model.modelId, req.model.provider);
    const next = this.transcripts.shift();
    if (next && 'error' in next) throw new AiProviderError(next.error, req.model.provider, `${req.model.provider} ${next.error} (fake)`, 500);
    if (next) return { text: next.text, language: next.language ?? detectLanguage(next.text) ?? null, durationSec: next.durationSec ?? 4 };
    // default: a "voice note" whose bytes are UTF-8 text says that text (dev simulator); anything else is a fixed sentence
    const asText = req.audio.length < 2000 ? req.audio.toString('utf8') : '';
    const binary = [...asText].some((ch) => ch === '�' || ch.charCodeAt(0) < 9);
    // (the fake Meta adapter "downloads" a placeholder for simulated voice notes)
    const text = asText && !binary && asText !== 'fake-audio' ? asText.trim() : 'Bonjour';
    return { text, language: detectLanguage(text) ?? null, durationSec: 4 };
  }

  // --- the default brain ------------------------------------------------------------------------------------------------
  private brain(req: AiGenerateRequest): FakeStep {
    switch (req.purpose) {
      case 'reply':
        return this.replyBrain(req);
      case 'vision_describe': {
        const img = imagesOf(req)[0];
        const raw = img ? img.toString('utf8', 0, Math.min(img.length, 400)) : '';
        // dev / test convention: an "image" whose bytes start with `FAKE-IMAGE:` describes itself
        const m = /^FAKE-IMAGE:(.*)$/s.exec(raw);
        const d = (m?.[1] ?? '').trim();
        return { object: { category: '', colors: [], text: '', description: m ? d.replace(/\|(blurry|multiple)/g, '').trim() : `photo ${img ? hash6(img) : 'vide'}`, multipleProducts: /\|multiple/.test(d), quality: /\|blurry/.test(d) ? 'blurry' : 'ok' } };
      }
      case 'vision_match': {
        const input = readInput<{ description?: string; candidates: { id: string; name: string }[] }>(req);
        const imgs = imagesOf(req);
        const [photo, ...rest] = imgs;
        const candidates = input?.candidates ?? [];
        // same bytes as a candidate's primary image ⇒ sure match; a candidate named in the description ⇒ likely match
        const same = photo ? rest.findIndex((b) => b.equals(photo)) : -1;
        const named = candidates.find((c) => input?.description && input.description.toLowerCase().includes(c.name.toLowerCase()));
        const hit = same >= 0 ? candidates[same] : named;
        return { object: hit ? { productId: hit.id, confidence: same >= 0 ? 0.96 : 0.85, alternatives: candidates.filter((c) => c.id !== hit.id).slice(0, 2).map((c) => c.id) } : { productId: null, confidence: 0.2, alternatives: candidates.slice(0, 2).map((c) => c.id) } };
      }
      case 'caption': {
        const input = readInput<{ productName: string }>(req);
        return { text: `Photo du produit ${input?.productName ?? ''}`.trim() };
      }
      case 'product_vision': {
        const input = readInput<{ fileName: string; photos: number; locale: string; categories: string[]; units: string[] }>(req);
        const img = imagesOf(req)[0] ?? Buffer.alloc(0);
        const digest = createHash('sha256').update(img).digest();
        const base = (input?.fileName ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
        const name = base ? base.charAt(0).toUpperCase() + base.slice(1) : `Produit ${digest.toString('hex').slice(0, 6).toUpperCase()}`;
        const n = input?.photos ?? 1;
        const text: Record<string, string> = {
          fr: `${name} — description générée à partir de ${n} photo(s). Vérifiez-la avant de publier.`,
          ar: `${name} — وصف مُولَّد من ${n} صورة. راجعه قبل النشر.`,
          en: `${name} — description generated from ${n} photo(s). Review it before publishing.`,
        };
        const cats = input?.categories ?? [];
        return { object: { name, description: text[input?.locale ?? 'fr'] ?? text.fr, categoryName: cats.length ? cats[digest[0]! % cats.length] : null, unitName: input?.units?.[0] ?? null, attributes: [{ name: 'photos', values: [String(n)] }] } };
      }
      case 'page_post': {
        const input = readInput<{ caption: string | null }>(req);
        const caption = (input?.caption ?? '').trim();
        const price = /(\d[\d\s.,]{1,9})\s*(da|dzd|دج|dinars?)/i.exec(caption);
        const first = caption.split(/\n|[-–—|:]/)[0]?.trim() ?? '';
        const name = first.replace(/(\d[\d\s.,]{1,9})\s*(da|dzd|دج|dinars?)/i, '').trim().slice(0, 120);
        return { object: { isProduct: !!name && (!!price || imagesOf(req).length > 0) && !/^(merci|bonne|joyeux|عيد)/i.test(name), name, description: caption.slice(0, 500) || null, price: price ? Number(price[1]!.replace(/[^\d]/g, '')) : null, category: null } };
      }
      case 'agent_generation':
      case 'faq_extract': {
        const input = readInput<{ conversations: { messages: { from: 'customer' | 'page'; text: string }[] }[] }>(req);
        const convs = input?.conversations ?? [];
        const counts = new Map<string, { question: string; count: number; answer: string }>();
        const langs = new Map<string, number>();
        let customerMessages = 0;
        for (const c of convs) {
          c.messages.forEach((m, i) => {
            if (m.from !== 'customer' || !m.text.trim()) return;
            customerMessages++;
            const l = detectLanguage(m.text) ?? 'fr';
            langs.set(l, (langs.get(l) ?? 0) + 1);
            if (!/[?؟]/.test(m.text)) return;
            const key = m.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
            const answer = c.messages.slice(i + 1).find((x) => x.from === 'page')?.text ?? '';
            const row = counts.get(key) ?? { question: m.text.trim().slice(0, 300), count: 0, answer };
            row.count++;
            if (!row.answer && answer) row.answer = answer;
            counts.set(key, row);
          });
        }
        const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
        const faq = top.filter((t) => t.answer).map((t) => ({ q: t.question, a: t.answer.slice(0, 500) }));
        if (req.purpose === 'faq_extract') return { object: { faq } };
        return {
          object: {
            summary: `${convs.length} conversation(s) analysée(s), ${customerMessages} message(s) client.`,
            languages: [...langs.entries()].map(([code, n]) => ({ code, pct: Math.round((n / Math.max(1, customerMessages)) * 100) })),
            topQuestions: top.map((t) => ({ question: t.question, count: t.count })),
            tone: 'friendly',
            proposedInstructions: top.length ? `Questions fréquentes à traiter en priorité :\n${top.map((t) => `- ${t.question}`).join('\n')}` : 'Répondre de façon chaleureuse et proposer les produits du catalogue.',
            proposedFaq: faq,
            proposedPolicies: {},
          },
        };
      }
      default:
        return { text: '' };
    }
  }

  private lastUser(messages: AiMessage[]) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'user') return typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    }
    return '';
  }

  private replyBrain(req: AiGenerateRequest): FakeStep {
    const user = this.lastUser(req.messages);
    // the customer's own words (pipeline notes such as `IMAGE RESULT: …` are bracketed lines)
    const said = user
      .split('\n')
      .map((l) => l.replace(/^\[voice note transcript\]:\s*/i, ''))
      .filter((l) => !/^\[image\]|^IMAGE RESULT:/.test(l))
      .join(' ')
      .trim();
    // a turn without words (a photo alone): the language the pipeline detected for the conversation
    const told = /DETECTED_LANGUAGE of the last customer message: (Arabic|Latin-script|French|English|mixed)/.exec(req.system)?.[1];
    const fromPrompt: AiLanguage = told === 'Arabic' ? 'ar' : told === 'Latin-script' ? 'arabizi' : told === 'English' ? 'en' : 'fr';
    const lang: AiLanguage = (said ? detectLanguage(said) : undefined) ?? fromPrompt;
    const t = T[lang];
    const out = (reply: string, o: Partial<Extract<FakeStep, { reply: string }>> = {}): FakeStep => ({ reply, language: lang, ...o });
    const tools = new Set((req.tools ?? []).map((x) => x.name));
    const last = req.messages[req.messages.length - 1]!;

    // --- a tool just answered: turn its result into the final output ---------------------------------------------------
    if (last.role === 'tool') {
      const r = (last.result ?? {}) as Record<string, any>;
      switch (last.name) {
        case 'search_products': {
          const products = (r.products ?? []) as { id: string; name: string; price: number; stock: number | null }[];
          if (!products.length) return out(t.none!, { status: 'UNKNOWN', statusDetail: 'off_catalogue', intent: 'INFO', confidence: 0.4 });
          const shown = products.slice(0, 3);
          return out(fill(t.found!, { list: shown.map((p) => `${p.name} — ${p.price} DA`).join(', ') }), { intent: 'SALE', productCards: shown.map((p) => p.id) });
        }
        case 'get_product':
          return r.ok === false ? out(t.none!, { status: 'OK', intent: 'INFO' }) : out(fill(t.found!, { list: `${r.name} — ${r.price} DA` }), { intent: 'SALE', productCards: [String(r.id)] });
        case 'quote_delivery':
          return r.ok === false ? out(t.notServed!, { intent: 'INFO' }) : out(fill(r.free ? t.feeFree! : t.fee!, { wilaya: r.wilayaName, fee: r.fee }), { intent: 'INFO' });
        case 'lookup_order': {
          const orders = (r.orders ?? []) as { number: string; status: string; deliveryStatus: string }[];
          return orders.length ? out(fill(t.orders!, { list: orders.map((o) => `${o.number} (${o.deliveryStatus !== 'not_sent' ? o.deliveryStatus : o.status})`).join(', ') }), { intent: 'TRACKING' }) : out(t.noOrders!, { intent: 'TRACKING' });
        }
        case 'cancel_order': {
          if (r.ok && r.cancelled) return out(fill(t.cancelled!, { number: r.cancelled.number }), { intent: 'OTHER' });
          const c = (r.candidates ?? []) as { number: string }[];
          if (r.ok && c.length) return out(fill(t.whichCancel!, { list: c.map((x) => x.number).join(', ') }), { intent: 'OTHER' });
          return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'customer_request', intent: 'COMPLAINT' });
        }
        case 'create_order':
          return r.ok ? out(fill(t.ordered!, { number: r.number, total: r.total }), { intent: 'SALE' }) : out(t.handoff!, { status: 'HANDOFF', statusDetail: String(r.hint ?? r.error?.code ?? 'other'), intent: 'SALE' });
        case 'handoff_to_human':
          return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'customer_request', intent: 'COMPLAINT' });
        default:
          return out(t.greeting!, { intent: 'OTHER' });
      }
    }

    // --- a customer turn ---------------------------------------------------------------------------------------------------
    const image = /IMAGE RESULT: (\{.*\}|unsure|multiple|blurry|unavailable)/.exec(user);
    if (image) {
      if (image[1] === 'blurry') return out(t.photoBlurry!, { status: 'UNCLEAR', intent: 'INFO', confidence: 0.4 });
      if (image[1] === 'multiple') return out(t.photoMultiple!, { intent: 'INFO', confidence: 0.5 });
      try {
        const res = JSON.parse(image[1]!) as { productId: string; confidence: number; name?: string };
        if (res.productId && res.confidence >= 0.7) return out(fill(t.photoMatch!, { name: res.name ?? '' }), { intent: 'SALE', productCards: [res.productId], confidence: res.confidence });
      } catch {
        // fall through to the confirmation question
      }
      return out(t.photoUnsure!, { intent: 'INFO', confidence: 0.5 });
    }
    if (RX.refund.test(said)) return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'refund', intent: 'COMPLAINT' });
    if (RX.anger.test(said)) return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'angry', intent: 'COMPLAINT' });
    if (RX.human.test(said)) return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'customer_request', intent: 'OTHER' });
    const keyword = /HANDOFF_KEYWORDS: (.+)/.exec(req.system)?.[1]?.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) ?? [];
    if (keyword.some((k) => said.toLowerCase().includes(k))) return out(t.handoff!, { status: 'HANDOFF', statusDetail: 'keyword', intent: 'OTHER' });
    if (RX.cancel.test(said) && tools.has('cancel_order')) return { toolCalls: [{ name: 'cancel_order', args: { customerConfirmed: false } }] };
    if (RX.tracking.test(said) && tools.has('lookup_order')) return { toolCalls: [{ name: 'lookup_order', args: {} }] };
    if (RX.confirm.test(said) && tools.has('create_order')) {
      const productId = /\[ID:([0-9a-f-]{36})\]/.exec(req.system)?.[1];
      const phone = /(?:\+213|0)\s?[5-7](?:[\s.-]?\d){8}/.exec(req.messages.map((m) => (m.role === 'user' && typeof m.content === 'string' ? m.content : '')).join(' '))?.[0];
      if (productId && phone) return { toolCalls: [{ name: 'create_order', args: { clientName: 'Client Messenger', clientPhone: phone.replace(/[\s.-]/g, ''), wilayaId: 16, address: 'Adresse communiquée par message', items: [{ productId, quantity: 1 }], customerConfirmed: true } }] };
    }
    if (RX.order.test(said)) return out(t.askOrder!, { intent: 'SALE' });
    if (RX.delivery.test(said) && tools.has('quote_delivery')) {
      const rest = said.replace(RX.delivery, ' ').replace(/\b(pour|vers|à|a|la|le|l|to|for|combien|prix|chhal|bch7al|coûte|coute|est|de|wilaya|how much|is)\b/gi, ' ').replace(/[?؟!.,]/g, ' ').replace(/\s+/g, ' ').trim();
      return rest.length >= 3 ? { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: rest } }] } : out(t.askWilaya!, { intent: 'INFO' });
    }
    if (RX.greeting.test(said)) return out(t.greeting!, { intent: 'GREETING' });
    if ((said.match(/[\p{L}]/gu) ?? []).length < 3) return out(t.unclear!, { status: 'UNCLEAR', intent: 'OTHER', confidence: 0.3 });
    if (tools.has('search_products')) {
      const query = said.replace(RX.price, ' ').replace(/[?؟!.,]/g, ' ').replace(/\b(le|la|les|un|une|des|du|de|est|ce|que|vous|the|a|of|do|you|have|wach|f|ta3)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      return { toolCalls: [{ name: 'search_products', args: { query: query || said, limit: 5 } }] };
    }
    return out(t.greeting!, { intent: 'OTHER' });
  }
}

