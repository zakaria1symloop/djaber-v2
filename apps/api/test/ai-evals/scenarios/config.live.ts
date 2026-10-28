// Live chatbot scenarios — a shop that uses the agent settings: owner rules (no emoji, « vous »), catalogue limited to two
// categories, own system texts, out-of-stock without alternative, handoff keywords and own handoff rule, lower order
// limits, second phone required, own product-card template and closing, out of hours, risky clients on handoff — plus
// the platform gates: blocked number, credits exhausted, manual reply pausing the AI, message bursts, photo, voice note.
import { rawPrisma as db } from '@djaber/db';
import { reply, work } from '../../support/m3';
import { setCredits } from '../../support/m4';
import { closeShop, expectOrder, handedOff, never, noOrder, openShop, play, said, writeSummary, type Chat, type Result, type Scenario, type Shop } from './harness';

let s: Shop;
const TEXTS = {
  handoff: 'Une conseillère de Lina Fashion prend le relais très vite.',
  out_of_stock: 'Désolé, {product} est épuisé pour le moment.',
  out_of_hours: 'Notre boutique est fermée pour le moment, mais Lina continue de prendre vos commandes.',
};
beforeAll(async () => {
  s = await openShop();
  const ws = s.owner.workspaceId;
  const cats = await db.category.findMany({ where: { workspaceId: ws, name: { in: ['Robes', 'Accessoires'] } } });
  const w = await db.workspace.findUniqueOrThrow({ where: { id: ws } });
  const stored = (w.systemMessages ?? {}) as Record<string, Record<string, string>>;
  await db.workspace.update({ where: { id: ws }, data: { systemMessages: { ...stored, ...Object.fromEntries(Object.entries(TEXTS).map(([k, fr]) => [k, { ...(stored[k] ?? {}), fr }])) } } });
  const agent = await db.agent.findUniqueOrThrow({ where: { id: s.agentId } });
  await db.agent.update({
    where: { id: s.agentId },
    data: {
      customInstructions: `${agent.customInstructions}\n- N'utilise jamais d'emoji.\n- Vouvoie toujours le client.`,
      catalogScope: 'categories',
      scopeCategoryIds: cats.map((c) => c.id),
      sellAllProducts: false,
      outOfStockBehavior: 'say_unavailable',
      showMissingVariants: false,
      handoffKeywords: ['avocat', 'police'],
      humanHandoffRules: 'Toute commande en gros (plus de 20 pièces) ou toute demande de revendeur est transmise à l’équipe.',
      maxQtyPerOrder: 3,
      maxAmountPerOrder: 10_000,
      productCardTemplate: '{name} à {price} DA seulement',
      closingInstructions: 'Après une commande confirmée, remercie le client et rappelle que la livraison prend 2 à 5 jours ouvrables.',
      businessHours: { from: '03:00', to: '03:01', days: [0, 1, 2, 3, 4, 5, 6] },
      riskyClientBehavior: 'handoff',
      orderFields: [
        { key: 'product', required: true, locked: true },
        { key: 'quantity', required: true, locked: true },
        { key: 'name', required: true, locked: true },
        { key: 'phone', required: true, locked: true },
        { key: 'wilaya', required: true, locked: true },
        { key: 'commune', required: false },
        { key: 'address', required: true },
        { key: 'phone2', required: true },
        { key: 'note', required: false },
      ],
    },
  });
  await db.client.create({ data: { workspaceId: ws, name: 'Client risqué', phone: '0777000111', riskLevel: 'high', riskSetManually: true } });
});
afterAll(async () => {
  writeSummary('config');
  if (s) await closeShop(s);
});

const EMOJI = /\p{Extended_Pictographic}/u;
const handoff = (r: Result) => (handedOff(r) ? [] : ['no handoff']);
const systemSaid = (r: Result, text: string, what: string) => (r.turns.some((t) => t.bot.some((b) => b.author === 'system' && b.text.includes(text))) ? [] : [`system message « ${what} » not sent`]);
const aiSaidNothingLast = (r: Result) => (r.turns.at(-1)!.bot.some((b) => b.author === 'ai') ? ['the AI answered'] : []);

const SCENARIOS: Scenario[] = [
  { id: 'K01', title: 'Consignes du propriétaire : pas d’emoji, vouvoiement · message « hors horaires »', lang: 'latin', steps: ["Salut, t'as des robes ? 😍"], check: (r) => [...(EMOJI.test(r.aiText) ? ['an emoji was used'] : []), ...systemSaid(r, TEXTS.out_of_hours.slice(0, 30), 'hors horaires')], review: () => ['doit vouvoyer (« vous »)'] },
  { id: 'K02', title: 'Catalogue limité à Robes + Accessoires : pas de basket ni de jogging', lang: 'latin', steps: ['Vous avez des baskets ou un ensemble jogging ?'], check: (r) => [...never(r, /7\s?500|3\s?900|4\s?200/, 'a price of an out-of-scope product'), ...(r.turns.flatMap((t) => t.bot.flatMap((b) => b.cards)).some((c) => /basket|jogging/i.test(c)) ? ['card of an out-of-scope product'] : [])] },
  { id: 'K03', title: 'Phrase de rupture de la boutique, sans alternative', lang: 'latin', steps: ["Je veux l'écharpe en laine grise"], check: (r) => said(r, /épuisé pour le moment/i, 'the shop’s out-of-stock sentence'), review: () => ['ne doit pas proposer d’alternative (say_unavailable)'] },
  { id: 'K04', title: 'Mot-clé de transfert (« avocat ») + texte de transfert de la boutique', lang: 'latin', steps: ["Si ma commande n'arrive pas demain j'appelle mon avocat"], check: (r) => [...handoff(r), ...systemSaid(r, TEXTS.handoff.slice(0, 30), 'transfert')] },
  { id: 'K05', title: 'Règle de transfert de la boutique (revendeuse, 30 robes)', lang: 'latin', steps: ['Je suis revendeuse, je veux 30 robes satin pour ma boutique, vous faites un prix ?'], check: (r) => [...handoff(r), ...noOrder(r)] },
  { id: 'K06', title: 'Quantité maximum de l’agent (3) — 4 hijabs', lang: 'latin', steps: ['Je veux 4 hijabs soie', { sim: 'Tu es Samia Lounis, en français. Tu veux 4 « Hijab soie », Alger, Kouba, 9 rue Garidi, téléphone 0550 12 13 14, second téléphone 0661 12 13 14. Tu confirmes si on te montre un récapitulatif.', max: 8 }], check: (r) => [...noOrder(r), ...handoff(r)] },
  { id: 'K07', title: 'Montant maximum de l’agent (10 000 DA) — robe + sac', lang: 'latin', steps: [{ sim: 'Tu es Farida Ait Ali, en français. Tu veux la « Robe satin bordeaux » ET le « Sac cuir noir », Alger, Kouba, 9 rue Garidi, téléphone 0550 22 33 44, second téléphone 0661 22 33 44. Tu confirmes si on te montre un récapitulatif.', max: 8 }], check: (r) => [...noOrder(r), ...handoff(r)] },
  { id: 'K08', title: 'Modèle de fiche produit de la boutique', lang: 'latin', steps: ['Le prix du sac cuir noir ?'], check: (r) => said(r, /6\s?200 DA seulement/i, 'the card template « … à 6200 DA seulement »') },
  {
    id: 'K09',
    title: 'Commande avec second téléphone obligatoire + consigne de clôture',
    lang: 'latin',
    steps: [{ sim: 'Tu es Houda Ziani, en français. Tu veux 1 « Robe satin bordeaux », livraison à domicile à Alger, commune Hussein Dey, adresse : 30 rue Tripoli. Téléphone 0555 70 80 90. Second téléphone (si on te le demande) : 0661 70 80 90. Tu confirmes le récapitulatif (4500 + 400 = 4900 DA).' }],
    check: async (r) => {
      const f = expectOrder(r, { items: [['Robe satin bordeaux', null, 1]], fee: 400, total: 4900, wilayaId: 16 });
      const o = await db.order.findFirst({ where: { number: r.orders[0]?.number ?? '-', workspaceId: s.owner.workspaceId } });
      if (o && o.clientPhone2 !== '0661708090') f.push(`second phone ${o.clientPhone2 ?? 'missing'}`);
      return [...f, ...said(r, /2 à 5 jours/i, 'the closing reminder (2 à 5 jours)')];
    },
  },
  {
    id: 'K10',
    title: 'Numéro bloqué par la boutique → pas de commande, équipe',
    lang: 'latin',
    steps: [{ act: async (sh) => void (await sh.owner.post('/safety/blocks', { phone: '0555666666', reason: 'fraud' }).expect(201)) }, { sim: 'Tu es Karim Fraudeur, en français. Tu veux 1 « Sac cuir noir », Alger, Kouba, 1 rue Garidi, téléphone 0555 66 66 66, second téléphone 0661 66 66 66. Tu confirmes le récapitulatif.', max: 8 }],
    check: (r) => [...noOrder(r), ...handoff(r)],
  },
  { id: 'K11', title: 'Client à risque (politique : transférer) → pas de commande, équipe', lang: 'latin', steps: [{ sim: 'Tu es Mourad Risque, en français. Tu veux 1 « Robe satin bordeaux », Alger, Kouba, 2 rue Garidi, téléphone 0777 00 01 11, second téléphone 0661 00 01 11. Tu confirmes le récapitulatif.', max: 8 }], check: (r) => [...noOrder(r), ...handoff(r)] },
  {
    id: 'K12',
    title: 'Crédits épuisés → aucune réponse IA, puis reprise',
    lang: 'latin',
    steps: [{ act: async (sh) => setCredits(sh.app, sh.owner.workspaceId, 0) }, 'Bonjour, la robe satin est disponible ?', { act: async (sh) => setCredits(sh.app, sh.owner.workspaceId, 5000) }],
    // credits are checked at intake: no reply job, the « assistant indisponible » text, the thread goes to the team
    check: (r) => [...aiSaidNothingLast(r), ...(r.turns.at(-1)!.bot.some((x) => x.author === 'system') ? [] : ['no system message to the customer'])],
  },
  {
    id: 'K13',
    title: 'Réponse manuelle de l’équipe → l’IA se met en pause',
    lang: 'latin',
    steps: [
      'Bonjour, la robe satin est dispo en bordeaux ?',
      { act: async (sh: Shop, chat: Chat) => { await reply(sh.owner, chat.conversationId!, { text: 'Bonjour, oui elle est disponible, je m’occupe de vous.' }).expect(201); await work(sh.app, [sh.owner.workspaceId]); } },
      'Super merci, je la prends',
    ],
    check: async (r) => [...aiSaidNothingLast(r), ...(r.aiPaused ? [] : ['AI not paused after the manual reply'])],
  },
  {
    id: 'K14',
    title: 'Trois messages à la suite → une seule réponse qui couvre tout',
    lang: 'latin',
    steps: [{ send: [{ text: 'Bonjour' }, { text: "la robe satin c'est combien ?" }, { text: 'et la livraison pour Oran ?' }], label: 'Bonjour / la robe satin c’est combien ? / et la livraison pour Oran ? (rafale)' }],
    check: (r) => [...(r.turns[0]!.runs.length === 1 ? [] : [`${r.turns[0]!.runs.length} AI runs for one burst`]), ...said(r, /4\s?500/, 'the dress price'), ...said(r, /700|450/, 'the Oran fee')],
  },
  { id: 'K15', title: 'Photo sans rapport avec le catalogue', lang: 'latin', steps: [{ send: [{ text: 'Vous avez ça ?', attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/photo-inconnue.jpg' } }] }], label: 'Vous avez ça ? [photo : image verte unie]' }], check: (r) => noOrder(r), review: () => ['ne doit pas affirmer un produit ni un prix pour une photo non reconnue ; demande une précision'] },
  { id: 'K16', title: 'Note vocale sans transcription disponible', steps: [{ send: [{ attachments: [{ type: 'audio', payload: { url: 'https://fake.meta.local/vocal-1.mp3' } }] }], label: '[note vocale]' }], review: () => ['doit demander d’écrire le message (pas d’erreur, pas de réponse inventée)'] },
];

describe('live scenarios — agent settings and platform gates', () => {
  it.each(SCENARIOS.map((x) => [x.id, x] as const))('%s', async (_id, sc) => {
    const { failures } = await play('config', s, sc);
    expect(failures).toEqual([]);
  });
});
