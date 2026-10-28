// Live chatbot scenarios — order taking end to end: real orders written by `create_order`, changes, cancellations,
// limits, stock, tracking, returning customer. The long flows use a simulated customer (persona + goal).
import { rawPrisma as db } from '@djaber/db';
import { closeShop, expectOrder, handedOff, noOrder, openShop, play, said, usedTool, writeSummary, type Chat, type Scenario, type Shop } from './harness';

let s: Shop;
const senders: Record<string, string> = {};
beforeAll(async () => {
  s = await openShop();
});
afterAll(async () => {
  writeSummary('orders');
  if (s) await closeShop(s);
});

const clientOf = async (chat: Chat) => (await db.conversation.findUniqueOrThrow({ where: { id: chat.conversationId! } })).clientId!;
/** The shop confirms (or ships) the customer's open orders, as a team member would from the Orders screen. */
const shopSets = (data: Record<string, unknown>) => ({
  act: async (_s: Shop, chat: Chat) => {
    await db.order.updateMany({ where: { clientId: await clientOf(chat), status: { in: ['new', 'confirmed'] } }, data });
  },
});

/** One persona, one phone: Djaber recognises a customer by phone, so two scenarios never share one. */
const sarah = (phone = '0555 12 34 56') => `Tu es Sarah Bouaziz et tu écris en français. Tu veux commander 1 « Robe satin bordeaux ». Téléphone : ${phone}. Wilaya : Alger. Commune : Bab Ezzouar. Adresse : Cité 200 logements, bâtiment 4, appartement 12. Livraison à domicile. Tu confirmes le récapitulatif s'il correspond (robe 4500 DA + livraison 400 DA = 4900 DA).`;

const SCENARIOS: Scenario[] = [
  {
    id: 'O01',
    title: 'FR — commande pas à pas (robe, Alger domicile)',
    lang: 'latin',
    steps: ['Bonjour, je voudrais commander la robe satin bordeaux', { sim: sarah() }],
    check: (r) => [...usedTool(r, 'create_order'), ...expectOrder(r, { items: [['Robe satin bordeaux', null, 1]], fee: 400, total: 4900, wilayaId: 16, stopdesk: false, phone: '0555123456', status: 'new' })],
  },
  {
    id: 'O02',
    title: 'Darija arabe — 2 joggings L, Oran stop-desk',
    lang: 'ar',
    steps: [
      'السلام عليكم، نحب نطلب جوج ensemble jogging مقاس L',
      { sim: 'أنت ياسين بوزيد وتكتب بالدارجة الجزائرية بالحروف العربية فقط. تريد 2 قطع من « Ensemble jogging » مقاس L. رقم هاتفك 0661 23 45 67. الولاية: وهران، البلدية: بئر الجير. تحب الاستلام من المكتب (stop-desk) وليس للدار. تؤكد الطلب إذا كان الملخص صحيح (2 × 4200 + 450 = 8850 دج).' },
    ],
    check: (r) => expectOrder(r, { items: [['Ensemble jogging', 'L', 2]], fee: 450, total: 8850, wilayaId: 31, stopdesk: true, phone: '0661234567' }),
  },
  {
    id: 'O03',
    title: 'Arabizi — tout en un message, basket 41, Blida',
    lang: 'latin',
    steps: ['salam nheb nchri basket runner pointure 41 wahda', 'smiti Karim Haddad 0770 11 22 33, Blida, Boufarik, hay 50 logements bloc 3, l dar', { sim: "Nta Karim Haddad, tekteb b darja b l'horouf latin (arabizi) bark. Commande: 1 Basket Runner blanche pointure 41, Blida, Boufarik, hay 50 logements bloc 3, livraison l dar, tel 0770 11 22 33. Ki ywerri lek el récap (7500 + 500 = 8000 DA) confirmi." }],
    check: (r) => expectOrder(r, { items: [['Basket Runner blanche', '41', 1]], fee: 500, total: 8000, wilayaId: 9, stopdesk: false, phone: '0770112233' }),
  },
  {
    id: 'O04',
    title: 'Récapitulatif sans confirmation — aucune commande',
    lang: 'latin',
    steps: ['Bonjour je veux le sac cuir noir', 'Nadia Benali, 0550 98 76 54, Constantine, commune Constantine, 12 rue Larbi Ben Mhidi, à domicile', 'Hmm attendez, je vais réfléchir et je reviens vers vous'],
    check: (r) => noOrder(r),
  },
  {
    id: 'O05',
    title: 'Téléphone invalide puis corrigé (montre, Sétif)',
    lang: 'latin',
    steps: [{ sim: "Tu es Walid Mansouri, tu écris en français. Tu veux 1 « Montre classique dorée », livrée à domicile à Sétif, commune El Eulma, adresse : 15 rue des frères Bouchama. La PREMIÈRE fois qu'on te demande ton téléphone tu donnes « 055512 » (incomplet) ; quand on te le redemande tu donnes 0555 12 99 88. Tu confirmes le récapitulatif (12000 + 650 = 12650 DA)." }],
    check: (r) => expectOrder(r, { items: [['Montre classique dorée', null, 1]], fee: 650, total: 12_650, wilayaId: 19, phone: '0555129988' }),
  },
  {
    id: 'O06',
    title: 'Variante obligatoire, pointure en rupture (42) puis 43',
    lang: 'latin',
    steps: ['Je veux la basket runner', 'en 42 svp', { sim: "Tu es Amine Kaci, en français. Ta pointure 42 n'est pas disponible : tu acceptes la 43. Livraison à domicile à Alger, commune Kouba, adresse : 8 rue Ahmed Ghermoul. Téléphone 0699 45 67 89. Tu confirmes le récapitulatif (7800 + 400 = 8200 DA)." }],
    check: (r) => expectOrder(r, { items: [['Basket Runner blanche', '43', 1]], fee: 400, total: 8200, wilayaId: 16 }),
  },
  {
    id: 'O07',
    title: 'Stock insuffisant — 5 sacs demandés, 3 en stock',
    lang: 'latin',
    steps: ['Bonjour je veux 5 sacs cuir noir pour des cadeaux, livraison Alger'],
    check: (r) => [...(r.orders.some((o) => o.items.some((i) => i.quantity > 3)) ? ['order above the stock'] : []), ...said(r, /\b3\b|trois/i, 'that only 3 are left')],
  },
  {
    id: 'O08',
    title: 'Montant maximum — 5 montres (60 000 DA > 50 000)',
    lang: 'latin',
    steps: ['Bonjour je veux commander 5 montres classiques dorées', { sim: 'Tu es Rachid Ouali, en français. Tu veux 5 « Montre classique dorée », Alger, commune Hydra, 3 rue Sidi Yahia, téléphone 0661 00 11 22. Tu confirmes si on te montre un récapitulatif.', max: 8 }],
    check: (r) => [...noOrder(r), ...(handedOff(r) ? [] : ['no handoff for an order above MAX_AMOUNT'])],
  },
  {
    id: 'O09',
    title: 'Quantité maximum — 12 hijabs (> 10)',
    lang: 'latin',
    steps: ['Salam, je veux 12 hijabs soie pour un mariage', { sim: 'Tu es Imane Saadi, en français. Tu veux 12 « Hijab soie », Blida, Blida, cité 1000 logements bt 2, téléphone 0550 33 44 55. Tu confirmes si on te montre un récapitulatif.', max: 8 }],
    check: (r) => [...noOrder(r), ...(handedOff(r) ? [] : ['no handoff for an order above MAX_QTY'])],
  },
  {
    id: 'O10',
    title: 'Deux articles (robe + sac), Alger',
    lang: 'latin',
    steps: [{ sim: 'Tu es Lina Cherif, en français. Tu veux commander la « Robe satin bordeaux » ET le « Sac cuir noir » (1 de chaque), livraison à domicile à Alger, commune Kouba, adresse : 22 rue Garidi, téléphone 0770 55 66 77. Tu confirmes le récapitulatif (4500 + 6200 + 400 = 11100 DA).' }],
    check: (r) => expectOrder(r, { items: [['Robe satin bordeaux', null, 1], ['Sac cuir noir', null, 1]], fee: 400, total: 11_100, wilayaId: 16 }),
  },
  {
    id: 'O11',
    title: 'Livraison gratuite au-delà de 20 000 DA (5 robes)',
    lang: 'latin',
    steps: [{ sim: 'Tu es Meriem Haddadi, en français. Tu veux 5 « Robe satin bordeaux » (cadeaux pour tes sœurs), livraison à domicile à Alger, commune Chéraga, adresse : 5 rue des Oliviers, villa 3, téléphone 0661 77 88 99. Tu confirmes le récapitulatif (5 × 4500 = 22500 DA, livraison gratuite).' }],
    check: (r) => expectOrder(r, { items: [['Robe satin bordeaux', null, 5]], fee: 0, total: 22_500, wilayaId: 16 }),
  },
  {
    id: 'O12',
    title: 'Modifier une commande (jogging S → L) : nouvelle commande puis annulation',
    lang: 'latin',
    steps: [
      { sim: 'Tu es Sofiane Belkacem, en français. Tu veux 1 « Ensemble jogging » taille S, livraison à domicile à Alger, commune El Biar, adresse : 14 chemin Mackley, téléphone 0555 44 33 22. Tu confirmes le récapitulatif (3900 + 400 = 4300 DA). Dès que la commande est confirmée, tu écris <END>.' },
      'Finalement je préfère la taille L à la place de la S, même adresse',
      { sim: 'Tu es Sofiane Belkacem, en français. Tu as changé ta commande : tu veux la taille L au lieu de la S, même adresse. Tu confirmes le nouveau récapitulatif (4200 + 400 = 4600 DA).', max: 4 },
    ],
    check: (r) => {
      const f = expectOrder(r, { items: [['Ensemble jogging', 'L', 1]], fee: 400, total: 4600, wilayaId: 16, status: 'new' }, { count: 2 });
      if (r.orders[0]?.status !== 'cancelled') f.push(`first order ${r.orders[0]?.status ?? '-'} instead of cancelled`);
      return f;
    },
  },
  {
    id: 'O13',
    title: 'Annuler une commande non confirmée par la boutique',
    lang: 'latin',
    steps: [{ sim: `${sarah('0555 13 13 13')} Dès que la commande est confirmée, tu écris <END>.` }, 'Je veux annuler ma commande svp, je ne suis plus intéressée', { sim: 'Tu veux annuler ta commande. Tu confirmes l’annulation quand on te la demande.', max: 3 }],
    check: (r) => (r.orders.length === 1 && r.orders[0]!.status === 'cancelled' ? [] : [`orders: ${r.orders.map((o) => `${o.number} ${o.status}`).join(', ') || 'none'}`]),
  },
  {
    id: 'O14',
    title: 'Annuler une commande déjà confirmée par la boutique → équipe, pas d’annulation',
    lang: 'latin',
    steps: [{ sim: `${sarah('0555 14 14 14')} Dès que la commande est confirmée, tu écris <END>.` }, shopSets({ status: 'confirmed' }), 'Annulez ma commande svp'],
    check: (r) => [...(r.orders[0]?.status === 'confirmed' ? [] : [`order ${r.orders[0]?.status ?? '-'} instead of still confirmed`]), ...(handedOff(r) ? [] : ['no handoff'])],
  },
  {
    id: 'O15',
    title: 'Suivi de commande (expédiée, en transit)',
    lang: 'latin',
    steps: [{ sim: `${sarah('0555 15 15 15')} Dès que la commande est confirmée, tu écris <END>.` }, shopSets({ status: 'shipped', deliveryStatus: 'in_transit' }), 'Bonjour, elle est où ma commande ?'],
    check: (r) => [...usedTool(r, 'lookup_order'), ...said(r, /transit|route|expédi|en cours/i, 'that the order is on its way')],
  },
  {
    id: 'O16',
    title: 'Double confirmation — une seule commande',
    lang: 'latin',
    steps: [{ sim: `${sarah('0555 16 16 16')} Dès que la commande est confirmée, tu écris <END>.` }, 'oui oui je confirme !', "Ok merci, c'est bien confirmé hein ?"],
    check: (r) => (r.orders.length === 1 ? [] : [`${r.orders.length} orders`]),
  },
  {
    id: 'O17',
    title: 'Client connu — nouvelle commande sans redemander les coordonnées',
    lang: 'latin',
    sender: () => senders.O01!,
    steps: ['Re bonjour ! Je voudrais aussi le sac cuir noir, même adresse que la dernière fois', { sim: 'Tu es Sarah Bouaziz (déjà cliente), en français. Tu veux 1 « Sac cuir noir », même adresse que la dernière fois (Alger, Bab Ezzouar, Cité 200 logements bâtiment 4 appartement 12, 0555 12 34 56). Si on te redemande une information déjà donnée, tu le fais remarquer gentiment. Tu confirmes le récapitulatif (6200 + 400 = 6600 DA).', max: 6 }],
    check: (r) => expectOrder(r, { items: [['Sac cuir noir', null, 1]], fee: 400, total: 6600, wilayaId: 16, phone: '0555123456' }, { count: 2 }),
    review: () => ['ne doit pas redemander nom / téléphone / adresse'],
  },
  {
    id: 'O18',
    title: 'Stop-desk indisponible à Sétif → domicile (hijab × 2, commandable à stock 0)',
    lang: 'latin',
    steps: [{ sim: 'Tu es Khadidja Remili, en français. Tu veux 2 « Hijab soie ». Tu habites Sétif, commune Sétif, et tu préfères le retrait au bureau (stop-desk). Si le stop-desk n’est pas possible, tu acceptes la livraison à domicile : 7 cité Yahiaoui, Sétif. Téléphone 0662 12 12 12. Tu confirmes le récapitulatif (2 × 1500 + 650 = 3650 DA).' }],
    check: (r) => expectOrder(r, { items: [['Hijab soie', null, 2]], fee: 650, total: 3650, wilayaId: 19, stopdesk: false }),
  },
  {
    id: 'O19',
    title: 'Anglais — montre vers Oran',
    lang: 'latin',
    steps: [{ sim: 'You are Nassim Bey and you write in English. You want 1 "Montre classique dorée", home delivery in Oran, commune Es Senia, address: 12 rue de la Paix, phone 0770 98 76 54. Confirm the recap if it matches (12000 + 700 = 12700 DA).' }],
    check: (r) => expectOrder(r, { items: [['Montre classique dorée', null, 1]], fee: 700, total: 12_700, wilayaId: 31 }),
  },
  {
    id: 'O20',
    title: 'Téléphone au format +213 et « Blida » = wilaya + commune',
    lang: 'latin',
    steps: [{ sim: 'Tu es Yasmine Dahmani, en français. Tu veux 1 « Robe satin bordeaux », livraison à domicile à Blida (wilaya et commune Blida), adresse : 3 rue Ben Boulaid. Ton téléphone : +213 661 20 20 20. Tu confirmes le récapitulatif (4500 + 500 = 5000 DA).' }],
    check: (r) => expectOrder(r, { items: [['Robe satin bordeaux', null, 1]], fee: 500, total: 5000, wilayaId: 9, phone: '0661202020' }),
    review: () => ['ne doit pas redemander la commune après « Blida »'],
  },
  {
    id: 'O21',
    title: 'Darija arabe — taille de jogging en rupture (M), choix de S',
    lang: 'ar',
    steps: ['نحب ensemble jogging مقاس M', { sim: 'أنت أمينة بن صالح وتكتبين بالدارجة الجزائرية بالحروف العربية فقط. مقاس M غير متوفر: تقبلين مقاس S. التوصيل للدار في الجزائر العاصمة، بلدية باب الوادي، العنوان: 4 شارع محمد بوراس. الهاتف 0551 22 33 44. تؤكدين الطلب (3900 + 400 = 4300 دج).' }],
    check: (r) => expectOrder(r, { items: [['Ensemble jogging', 'S', 1]], fee: 400, total: 4300, wilayaId: 16 }),
  },
  {
    id: 'O22',
    title: 'Darija arabe — téléphone en chiffres arabes (٠٦٦٢…), Constantine',
    lang: 'ar',
    steps: [{ sim: 'أنت سارة مزيان وتكتبين بالدارجة الجزائرية بالحروف العربية فقط. تريدين 1 « Sac cuir noir ». التوصيل للدار في قسنطينة، بلدية الخروب، العنوان: حي 500 مسكن عمارة 7. تكتبين رقم الهاتف بالأرقام العربية الشرقية: ٠٦٦٢ ٣٣ ٣٣ ٣٣. تؤكدين الطلب (6200 + 600 = 6800 دج).' }],
    check: (r) => expectOrder(r, { items: [['Sac cuir noir', null, 1]], fee: 600, total: 6800, wilayaId: 25, phone: '0662333333' }),
  },
  {
    id: 'O23',
    title: 'Quantité en lettres + adresse en plusieurs messages (« deux montres »)',
    lang: 'latin',
    steps: [{ sim: 'Tu es Djamel Rahmani, en français, tu écris vite avec des fautes. Tu veux « deux » « Montre classique dorée » (écris la quantité en lettres). Livraison à domicile à Oran, commune Bir El Djir, adresse : cité 1000 logements bloc 12 porte 3 (donne l’adresse en deux messages). Téléphone 0770 31 31 31. Tu confirmes le récapitulatif (2 × 12000 + 700 = 24700 DA).' }],
    check: (r) => expectOrder(r, { items: [['Montre classique dorée', null, 2]], fee: 700, total: 24_700, wilayaId: 31, phone: '0770313131' }),
  },
  {
    id: 'O24',
    title: 'Le client change d’avis sur la wilaya avant de confirmer (Alger → Blida)',
    lang: 'latin',
    steps: [{ sim: 'Tu es Nour Benyahia, en français. Tu veux 1 « Sac cuir noir ». Tu dis d’abord livraison à Alger, puis AVANT de confirmer tu corriges : en fait livraison à Blida, commune Ouled Yaïch, adresse : 18 cité des Martyrs. Téléphone 0699 24 24 24. Tu confirmes seulement un récapitulatif avec Blida (6200 + 500 = 6700 DA).' }],
    check: (r) => expectOrder(r, { items: [['Sac cuir noir', null, 1]], fee: 500, total: 6700, wilayaId: 9 }),
  },
];

describe('live scenarios — orders', () => {
  it.each(SCENARIOS.map((x) => [x.id, x] as const))('%s', async (_id, sc) => {
    const { chat, failures } = await play('orders', s, sc);
    senders[sc.id] = chat.sender;
    expect(failures).toEqual([]);
  });
});
