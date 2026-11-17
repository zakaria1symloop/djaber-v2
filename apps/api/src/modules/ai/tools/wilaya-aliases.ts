// 04-ai-pipeline §4.2 `quote_delivery` — common darija / arabizi / English spellings of wilaya names → wilaya id.
// The official names (`Wilaya.nameFr | nameAr`) are matched first; this table only adds what customers really type.
/**
 * journey retest R12-1 (17/11): the script-neutral part of every fold that compares a model's argument with the customer's text —
 * compatibility forms decomposed (full-width letters / digits / punctuation, Arabic presentation forms and ligatures: NFKD),
 * Latin accents, Arabic tashkil and hamza marks dropped, the tatweel « \u0640 » dropped, Arabic-Indic digits ⇒ Latin, the hamza seats
 * and « ٱ » ⇒ « ا », « ة » ⇒ « ه », « ى » ⇒ « ي », lower case. Punctuation is kept (see `foldText`).
 */
export const foldBase = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064a')
    .toLowerCase();
/**
 * `foldBase`, then every character that is no letter and no digit — the punctuation of every script (« ، ؛ ؟ » Arabic, « , ; ? »,
 * « ‚ », quotes « » “ ” ' ’, full-width forms, dashes, brackets), symbols and emoji — becomes one space. R12-1: the Arabic comma
 * of « البليدة، بوفاريك، … » stayed glued to the wilaya (`[^a-z0-9\u0600-ۿ]` kept all of U+0600–U+06FF) and the wilaya the customer wrote
 * was refused as « never written by the customer ».
 */
export const foldText = (s: string): string => foldBase(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** journey retest R12-1: the Arabic article (with a clitic « و ف ب ك » or « لل ») at the start of every Arabic word, and the Latin « el / al / l » words, dropped from a folded text — « … بوفاريك، البليدة » names « بليده » mid-text too. */
export const articleless = (folded: string): string =>
  folded
    .split(' ')
    .map((w) => w.replace(/^(?:[وفبك]?ال|لل)(?=\S{3})/u, ''))
    .filter((w) => w && w !== 'el' && w !== 'al' && w !== 'l')
    .join(' ');
// 04-ai-pipeline §4.2 `quote_delivery` — the folded form a wilaya name is compared in: `foldText`, then a leading « wilaya » and
// the leading article dropped — a separate word in Latin script ("El Oued"), attached in Arabic ("الوادي") — never the "Al" of "Alger"
export const fold = (s: string) =>
  foldText(s)
    .replace(/^(wilaya|ولايه)\s+/, '')
    .replace(/^(el|al)\s+/, '')
    .replace(/^ال/, '');

const RAW: Record<string, number> = {
  alger: 16, algiers: 16, dzair: 16, djazair: 16, 'alger centre': 16, 'الجزاير': 16, 'العاصمه': 16, 'دزاير': 16,
  oran: 31, wahran: 31, wahrane: 31, 'وهران': 31,
  constantine: 25, qsantina: 25, ksentina: 25, 'قسنطينه': 25,
  annaba: 23, '3annaba': 23, bone: 23, 'عنابه': 23,
  setif: 19, stif: 19, 'سطيف': 19,
  blida: 9, 'البليده': 9, 'بليده': 9,
  'tizi ouzou': 15, tizi: 15, 'تيزي وزو': 15,
  bejaia: 6, bgayet: 6, bougie: 6, 'بجايه': 6,
  tlemcen: 13, 'تلمسان': 13,
  batna: 5, 'باتنه': 5,
  chlef: 2, 'الشلف': 2,
  biskra: 7, 'بسكره': 7,
  'sidi bel abbes': 22, sba: 22, 'بلعباس': 22,
  mostaganem: 27, mosta: 27, 'مستغانم': 27,
  boumerdes: 35, 'بومرداس': 35,
  tipaza: 42, tipasa: 42, 'تيبازه': 42,
  ghardaia: 47, 'غردايه': 47,
  ouargla: 30, wargla: 30, 'ورقله': 30,
  djelfa: 17, 'الجلفه': 17,
  medea: 26, 'المديه': 26,
  msila: 28, "m'sila": 28, 'المسيله': 28,
  skikda: 21, 'سكيكده': 21,
  jijel: 18, 'جيجل': 18,
  'bordj bou arreridj': 34, bba: 34, 'برج بوعريريج': 34,
  'oum el bouaghi': 4, 'ام البواقي': 4,
  'ain defla': 44, 'عين الدفلي': 44,
  'ain temouchent': 46, 'عين تموشنت': 46,
  // loi 26-06: the 11 wilayas 59–69 (official names are matched from `Wilaya`; these are what customers type)
  aflou: 59, aflo: 59, 'افلو': 59,
  barika: 60, brika: 60, bri9a: 60, 'بريكه': 60,
  kantara: 61, qantara: 61, guentra: 61, '9antra': 61, 'القنطره': 61,
  'bir el ater': 62, 'bir elater': 62, 'bir later': 62, 'bir al ater': 62, 'bir el atar': 62, 'bir l3ater': 62, 'بير العاتر': 62, 'بئر العاتر': 62,
  aricha: 63, laricha: 63, '3richa': 63, 'العريشه': 63,
  'ksar chellala': 64, 'ksar chlala': 64, 'qsar chellala': 64, 'ksar echellala': 64, 'ksar chellal': 64, 'قصر الشلاله': 64, 'قصر شلاله': 64,
  'ain oussera': 65, 'ain oussara': 65, 'ain ouessara': 65, 'ain wessara': 65, 'ain wassara': 65, '3in wessara': 65, 'عين وساره': 65, 'عين وسارا': 65,
  messaad: 66, mesaad: 66, mes3ad: 66, messa3d: 66, 'مسعد': 66,
  'ksar el boukhari': 67, 'ksar boukhari': 67, 'ksar el bokhari': 67, 'qsar el boukhari': 67, boukhari: 67, bokhari: 67, 'قصر البخاري': 67, 'البخاري': 67,
  'bou saada': 68, boussaada: 68, bousaada: 68, 'bou sa3da': 68, bousa3da: 68, 'bou saâda': 68, 'بوسعاده': 68, 'بو سعاده': 68,
  'abiodh sidi cheikh': 69, 'el abiodh sidi cheikh': 69, 'labiodh sidi cheikh': 69, 'abiod sidi cheikh': 69, 'labiod sidi cheikh': 69, labiodh: 69, labiod: 69, 'الابيض سيدي الشيخ': 69, 'الأبيض سيدي الشيخ': 69, 'الابيض سيد الشيخ': 69,
};
/** Keyed by the folded spelling (what `fold` returns for the customer's text). */
export const WILAYA_ALIASES: Record<string, number> = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [fold(k), v]));
