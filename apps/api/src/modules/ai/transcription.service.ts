// AI-07 / 04-ai-pipeline §9 "Voice" — `media / transcribe` (job id `stt:<messageId>`), scheduled when the audio file of a
// customer voice note is in our storage. Groq `whisper-large-v3-turbo`, OpenAI `whisper-1` on error (inside one attempt).
// Success ⇒ `Message.transcript` and the reply job is released at once; failure of both ⇒ FL-01 F-5: the fixed text
// `voiceFailed` once per conversation per 24 h and no credits. Safe to run twice (`transcriptStatus`).
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Tx, type Prisma } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { BatchingService } from '../messaging/batching.service';
import { attachmentsOf, contextOf } from '../messaging/messaging.presenter';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from './ai.constants';
import { AI_GATEWAY, AiProviderError, type AiGateway } from './provider/ai.gateway';
import { RoutingService } from './routing.service';

type TranscribeJob = { workspaceId: string; messageId: string };
export type TranscribeOutcome = 'done' | 'failed' | 'unclear' | 'too_long' | 'noop';

const DARIJA_HINT_AR = 'تسجيل صوتي بالدارجة الجزائرية مع كلمات فرنسية: واش كاين عندكم، شحال السومة، نحب نكوموندي، les produits، la livraison، الطلبية تاعي، وين راهي، التوصيل لوهران، الجزائر العاصمة، سطيف، قسنطينة، البليدة، عنابة.';
const DARIJA_HINT_FR = 'Message vocal en darija algérienne mélangée au français : wach kayen 3andkom, ch7al el prix, nheb ncommandi, les produits, la livraison, la commande ta3i, win rahi, livraison l Oran, Alger, Sétif, Constantine, Blida, Annaba.';
const VOICE_FIX =
  'You repair automatic transcriptions of customer voice notes sent to an Algerian online shop. The customer speaks Algerian darija, often mixed with French. You receive several automatic readings of the SAME short voice note (speech recognition is poor at darija: it rewrites it into standard Arabic or French and mishears words — « السومة » (the price) heard as « السيارة », « produits » as « برودوي »). Work out what the customer most probably said, reading the versions phonetically and against each other, in a shop context (products, price, delivery, order, photos). Never add a request, a product, a number or a name that no reading carries. A product name of the shop is written only when a reading clearly sounds like it (same sounds, same numbers): otherwise keep the words as heard, never another name of the list. Customers name the place of delivery: an Algerian wilaya or commune. Speech recognition turns these names into common words (« Oran » into « orange », « Alger » into « الجيد », « Bab Ezzouar » into « بزور »): when a reading sounds like a place of the list given with the readings, write that place, in the spelling of the list; never a place no reading sounds like. Algerian wording only (« تاع », never « ديال »). Reply with ONE line only: the message in Algerian darija written in Arabic script, French words kept in Latin letters — no comment, no explanation, no translation, no quotes. When the readings agree that the customer spoke plain French, reply with that French sentence as it is. If the readings are too different to tell what was said, reply exactly: UNCLEAR. When you can tell the gist but you are not sure of an important word — the readings disagree on the product, the place, the number, or on whether it is a question or a request, or a word appears in one reading only — start your line with « ? » followed by a space: the customer will be asked to confirm. Never add a word (« now », « today », a quantity) that the readings do not share.';
/** Owner 26/11: the repair judged the readings too different to tell what was said — the customer is told, nothing is guessed. */
export const voiceFixUnclear = (text: string | null | undefined): boolean => /^["'«\s]*unclear\.?["'»\s]*$/i.test((text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '');
/** UX-106: the repair is not sure of an important word (its line starts with « ? ») — the agent confirms before acting. */
export const voiceFixUncertain = (text: string | null | undefined): boolean => /^["'«\s]*[?؟]/.test((text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '');
/** The repaired sentence of the model's answer: its last line; nothing when it says UNCLEAR or wrote an explanation only. */
export const voiceFixLine = (text: string | null | undefined): string | null => {
  const line = ((text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '').replace(/^(["'«\s]*)[?؟]\s*/, '$1');
  const clean = line.replace(/^["'«\s]+|["'»\s]+$/g, '');
  return !clean || /^unclear\.?$/i.test(clean) || clean.length > 400 ? null : clean;
};

/**
 * Houssem live 25/11 UX-097: two readings of the same voice note say the same words (case, accents and punctuation aside) — at
 * least 7 words in 10 of the longer one. The automatic reading of darija heard as French (« Les raisons, oran, oran ») and the
 * reading with the darija hint (« livraison l Oran ») share almost none; plain French speech gives twice the same sentence.
 */
export const sameReading = (a: string, b: string): boolean => {
  const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  return [...x].filter((w) => y.has(w)).length / Math.max(x.size, y.size) >= 0.7;
};

/** The languages a customer of an Algerian shop speaks in a voice note (provider names or ISO codes); unknown ⇒ trusted. */
export const spokenHere = (language: string | null | undefined): boolean => !language || /^(ar|fr|en|arabic|french|english)$/i.test(language.trim());

const UNCLEAR = Symbol('unclear');

@Injectable()
export class TranscriptionService implements OnModuleInit {
  private readonly log = new Logger(TranscriptionService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly outbound: OutboundSendService,
    private readonly batching: BatchingService,
  ) {}

  onModuleInit() {
    this.registry.register('media', 'transcribe', (d: TranscribeJob) => this.process(d), { concurrency: 4 });
  }

  /** Transcribes an audio buffer through the transcription route (primary, then fallback). */
  async transcribe(audio: Buffer, mime: string, o: { productNames?: readonly string[]; placeNames?: readonly string[]; conversationLanguage?: string | null } = {}) {
    const r = await this.routing.call('transcription', (m, timeoutMs) => this.gateway.transcribe({ model: m.ref, audio, mime, timeoutMs }));
    const first = { ...r.value, model: r.model, usedFallback: r.usedFallback };
    // English speech is read well as it is — when the customer writes English. Tester 26/11: « Alger, Bab Ezzouar » said in an Arabic
    // conversation came back « Al Jai, that's the war. » (heard as English): there it is rebuilt like a note heard as French
    const heardEnglish = /^(en|english)$/i.test((r.value.language ?? '').trim());
    const otherLanguage = !!o.conversationLanguage && o.conversationLanguage !== 'en';
    const heardFrench = /^(fr|french)$/i.test((r.value.language ?? '').trim()) || (heardEnglish && otherLanguage);
    if ((heardEnglish && !otherLanguage) || !r.value.text.trim()) return first;
    // owner 23/11 (« my voice notes are not well understood »): the speech model is poor at Algerian darija — it rewrites it into standard
    // Arabic, loses the French words and mishears (« السومة » → « السيارة », a 3-second note read as « Azerbaijani »). Arabic (or a language
    // nobody speaks here) ⇒ two more readings of the same audio (Arabic with a darija hint, French with a darija hint), then the text
    // model works out what was said from the three. Any failure keeps the best single reading.
    const reading = (language: string, prompt: string) =>
      this.routing.call('transcription', (m, timeoutMs) => this.gateway.transcribe({ model: m.ref, audio, mime, timeoutMs, language, prompt })).then((x) => x.value.text.trim(), () => '');
    const [darija, french] = await Promise.all([reading('ar', DARIJA_HINT_AR), reading('fr', DARIJA_HINT_FR)]);
    // UX-097 (Houssem live 25/11: 6 of 9 notes wrong — « livraison l Oran » heard as « Les raisons, oran, oran », « bghit ncommandi
    // wa7ed Satin dress rouge » as « Brice, commande 1, Satan, dresse rouge »): darija mixed with French is often heard as « French ».
    // A note heard as French is plain French only when the reading with the darija hint says the same words; otherwise it is
    // rebuilt like an Arabic one, with the shop's product names.
    if (heardFrench && (!french || sameReading(r.value.text, french))) return first;
    const base = spokenHere(r.value.language) ? first : { ...first, text: darija || first.text, language: 'ar' };
    const readings = [spokenHere(r.value.language) ? r.value.text.trim() : '', darija, french].filter(Boolean);
    if (readings.length < 2) return base;
    let uncertain = false;
    const fixed = await this.routing
      .call('text', (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose: 'voice_fix', system: VOICE_FIX, messages: [{ role: 'user', content: [...readings.map((t, i) => `Reading ${i + 1}: ${t}`), ...(o.productNames?.length ? [`Product names of this shop the customer may be saying (keep a name as the shop writes it): ${o.productNames.slice(0, 40).join(' · ')}`] : []), ...(o.placeNames?.length ? [`Places of delivery the customer may be naming (wilayas, then the communes this customer used before): ${o.placeNames.slice(0, 90).join(' · ')}`] : [])].join('\n') }], maxTokens: 800, timeoutMs }))
      .then((x) => ((uncertain = voiceFixUncertain(x.value.text)), voiceFixUnclear(x.value.text) ? UNCLEAR : voiceFixLine(x.value.text)), (e) => (this.log.warn({ err: String(e) }, 'voice note repair unavailable'), null));
    // owner 26/11 (« he has to tell the client "I didn't understand you" »): the readings do not agree and the repair cannot tell
    // what was said — the note is not understood, rather than answered on the best guess
    if (fixed === UNCLEAR) return { ...base, unclear: true };
    if (!fixed) return base;
    // a note heard as French and rebuilt with no Arabic letter is French
    // UX-107 (tester 11:16): clear notes were marked uncertain too — the mark stands only when no two readings say the same words
    const agree = readings.some((x, i) => readings.slice(i + 1).some((y) => sameReading(x, y)));
    return { ...base, text: fixed, ...(uncertain && !agree ? { uncertain: true } : {}), language: heardFrench && !/[\u0600-\u06ff]/.test(fixed) ? (heardEnglish ? 'fr' : first.language) : 'ar' };
  }

  /** The 58 historical wilayas in French, then the communes this customer already gave (addresses, orders). */
  async placeNames(clientId: string | null): Promise<string[]> {
    const wilayas = (await prisma.wilaya.findMany({ where: { id: { lte: 58 } }, select: { nameFr: true }, orderBy: { id: 'asc' } })).map((w) => w.nameFr);
    if (!clientId) return wilayas;
    const [addresses, orders] = await Promise.all([
      prisma.clientAddress.findMany({ where: { clientId }, select: { communeText: true, commune: { select: { nameFr: true } } }, take: 10 }),
      prisma.order.findMany({ where: { clientId }, select: { communeText: true, commune: { select: { nameFr: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const communes = [...addresses, ...orders].map((x) => (x.communeText ?? x.commune?.nameFr ?? '').trim()).filter(Boolean);
    return [...wilayas, ...new Set(communes)];
  }

  async process(d: TranscribeJob): Promise<TranscribeOutcome> {
    const tenant = await this.tenants.forWorker(d.workspaceId);
    return TenantContext.run(tenant, async () => {
      const m = await prisma.message.findFirst({ where: { id: d.messageId }, include: { conversation: true } });
      if (!m || m.direction !== 'in' || (m.transcriptStatus && m.transcriptStatus !== 'pending')) return 'noop';
      const conv = m.conversation;
      const link = await prisma.agentChannel.findUnique({ where: { channelId: conv.channelId }, include: { agent: true } });
      const agent = link?.agent;
      // nobody will answer this voice note with the AI: nothing to transcribe
      if (!agent || agent.status !== 'active' || agent.deletedAt || !agent.voiceTranscription || conv.status === 'needs_human' || conv.aiPaused) return 'noop';
      const audio = attachmentsOf(m).find((a) => a.type === 'audio');
      if (!audio) return 'noop';

      let outcome: TranscribeOutcome = 'failed';
      let transcript: string | null = null;
      let uncertainReading = false;
      if (audio.storageKey && !audio.error) {
        try {
          const file = await this.storage.get(audio.storageKey);
          if (file.body.length > VOICE_MAX_BYTES) outcome = 'too_long';
          else {
            // Houssem live 23/11: « ch7al el prix ta3 QA 23/11 photos » came back as gibberish — the shop's product names help the repair
            const productNames = (await prisma.product.findMany({ where: { deletedAt: null, isActive: true }, select: { name: true }, orderBy: { updatedAt: 'desc' }, take: 40 })).map((p) => p.name);
            // UX-104 (tester 26/11): « Oran » heard as « orange », « Alger, Bab Ezzouar » as « الجيد بزور » — the wilayas, and the
            // communes of this customer's earlier addresses and orders, help the repair the same way
            const r = await this.transcribe(file.body, file.mime || audio.mime || 'audio/mp4', { productNames, placeNames: await this.placeNames(conv.clientId), conversationLanguage: contextOf(conv).lastLanguage ?? null });
            if ((r.durationSec ?? 0) > VOICE_MAX_SECONDS) outcome = 'too_long';
            else if ('unclear' in r && r.unclear) outcome = 'unclear';
            else if (r.text.trim()) {
              transcript = r.text.trim().slice(0, 4000);
              outcome = 'done';
              uncertainReading = 'uncertain' in r && r.uncertain === true;
            }
          }
        } catch (e) {
          if (!(e instanceof AiProviderError)) this.log.warn({ messageId: m.id, err: e instanceof Error ? e.message : String(e) }, 'voice note unreadable');
        }
      }

      const stored = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const r = await tx.message.updateMany({ where: { id: m.id, OR: [{ transcriptStatus: null }, { transcriptStatus: 'pending' }] }, data: { transcript, ...(uncertainReading ? { payload: { ...((m.payload as Record<string, unknown> | null) ?? {}), transcriptUncertain: true } as Prisma.InputJsonValue } : {}), transcriptStatus: outcome === 'done' ? 'done' : outcome === 'too_long' ? 'too_long' : 'failed' } });
        if (!r.count) return false;
        await this.outbox.ws(tx, `ws:${d.workspaceId}`, 'message.updated', { id: m.id, conversationId: m.conversationId, messageId: m.id, deliveryStatus: m.deliveryStatus, transcript, transcriptStatus: outcome === 'done' ? 'done' : outcome === 'unclear' ? 'failed' : outcome }, `message.updated:${m.id}:stt`);
        // F-5 / "> 2 min": fixed platform texts, once per conversation per 24 h, never charged
        if (outcome === 'failed') await this.outbound.sendSystemText(conv.id, 'voiceFailed', {}, { tx, oncePer24h: true });
        // a note that was heard but not understood: said every time (one text per voice note), never charged
        if (outcome === 'unclear') await this.outbound.sendSystemText(conv.id, 'voiceUnclear', {}, { tx });
        if (outcome === 'too_long') await this.outbound.sendSystemText(conv.id, 'unsupportedMedia', {}, { tx, oncePer24h: true });
        return true;
      });
      if (!stored) return 'noop';
      // the reply job was parked for the transcript (≤ 30 s): release it now
      // (a failed voice note without text leaves nothing to answer: the reply job ends on its own)
      await this.batching.schedule({ workspaceId: d.workspaceId, conversationId: conv.id, messageId: m.id, delaySec: 0 });
      return outcome;
    });
  }
}
