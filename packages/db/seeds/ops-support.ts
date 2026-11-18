// M10 (D38, D46) — reference data of the support area: the 5 canned replies of HELP-05 and the help center articles
// (`CmsEntry(type=help)`, one per HELP-01 category, fr / ar / en). Idempotent: existing rows are left untouched (edited in
// `/admin/support/canned-replies` and the CMS). Journey J01r-3 (18/11): the « agent » and « stock » guides follow the real
// wizard steps and the 04 stock rule; rows already seeded with the first text are corrected by the data migration
// `20261118120000_help_guides_wizard_stock` (run by `migrate:deploy`, only where the text was never edited).
import { rawPrisma as db } from '../src/client';

type L = { fr: string; ar: string; en: string };
const l = (fr: string, ar: string, en: string): L => ({ fr, ar, en });

const CANNED: { key: string; title: string; category: string; body: L }[] = [
  {
    key: '/sheets-reconnect',
    title: 'Reconnecter Google Sheets',
    category: 'integrations',
    body: l(
      'Bonjour, l’accès Google a expiré. Ouvrez Paramètres › Intégrations › Google Sheets puis « Reconnecter » : vos commandes reprendront leur synchronisation automatiquement.',
      'مرحبًا، انتهت صلاحية وصول Google. افتح الإعدادات › التكاملات › Google Sheets ثم « إعادة الربط »: ستستأنف مزامنة طلباتك تلقائيًا.',
      'Hello, the Google access has expired. Open Settings › Integrations › Google Sheets then “Reconnect”: your orders will sync again automatically.',
    ),
  },
  {
    key: '/meta-reconnect',
    title: 'Reconnecter la page Facebook / Instagram',
    category: 'meta_connection',
    body: l(
      'Bonjour, Meta a révoqué l’accès de votre page. Ouvrez Pages connectées, choisissez la page puis « Reconnecter » et acceptez toutes les autorisations demandées.',
      'مرحبًا، ألغت Meta وصول صفحتك. افتح الصفحات المتصلة، اختر الصفحة ثم « إعادة الربط » ووافق على كل الأذونات المطلوبة.',
      'Hello, Meta revoked your page access. Open Connected pages, pick the page then “Reconnect” and accept every requested permission.',
    ),
  },
  {
    key: '/credits-explained',
    title: 'Fonctionnement des crédits',
    category: 'credits',
    body: l(
      'Bonjour, chaque réponse de l’IA consomme des crédits (texte 1, photo et vocal davantage). Les crédits du plan se renouvellent chaque mois ; les packs achetés n’expirent jamais et sont utilisés après ceux du plan.',
      'مرحبًا، كل رد من الذكاء الاصطناعي يستهلك أرصدة (النص 1، والصورة والرسالة الصوتية أكثر). تتجدد أرصدة الخطة كل شهر؛ أما الحزم المشتراة فلا تنتهي صلاحيتها وتُستعمل بعد أرصدة الخطة.',
      'Hello, every AI reply uses credits (text 1, photo and voice more). Plan credits renew every month; purchased packs never expire and are used after the plan credits.',
    ),
  },
  {
    key: '/courier-setup',
    title: 'Configurer un transporteur',
    category: 'delivery',
    body: l(
      'Bonjour, ouvrez Livraison › Transporteurs, choisissez ZR Express, EcoTrack ou Yalidine, collez vos identifiants puis « Tester ». Une fois le test réussi, vous pouvez envoyer vos commandes en un clic.',
      'مرحبًا، افتح التوصيل › شركات التوصيل، اختر ZR Express أو EcoTrack أو Yalidine، الصق بيانات الدخول ثم « اختبار ». بعد نجاح الاختبار يمكنك إرسال طلباتك بنقرة واحدة.',
      'Hello, open Delivery › Couriers, pick ZR Express, EcoTrack or Yalidine, paste your credentials then “Test”. Once the test passes you can send your orders in one click.',
    ),
  },
  {
    key: '/invoice-copy',
    title: 'Copie de facture',
    category: 'billing',
    body: l(
      'Bonjour, toutes vos factures sont téléchargeables en PDF dans Paramètres › Plan & facturation › Factures. Pensez à renseigner votre NIF dans les informations de facturation.',
      'مرحبًا، يمكن تنزيل جميع فواتيرك بصيغة PDF من الإعدادات › الخطة والفوترة › الفواتير. لا تنس إدخال رقم التعريف الجبائي في معلومات الفوترة.',
      'Hello, every invoice can be downloaded as a PDF in Settings › Plan & billing › Invoices. Remember to fill in your tax id in the billing details.',
    ),
  },
];

const ARTICLES: { key: string; category: string; pages: string[]; title: L; body: L }[] = [
  {
    key: 'help-getting-started',
    category: 'getting_started',
    pages: ['home', 'onboarding'],
    title: l('Démarrer avec Djaber', 'البدء مع جابر', 'Getting started with Djaber'),
    body: l(
      'Connectez votre page Facebook ou Instagram, ajoutez vos produits puis activez votre agent IA. Il répond à vos clients et crée les commandes pour vous.',
      'اربط صفحتك على فيسبوك أو إنستغرام، أضف منتجاتك ثم فعّل وكيل الذكاء الاصطناعي. سيرد على زبائنك وينشئ الطلبات نيابة عنك.',
      'Connect your Facebook or Instagram page, add your products then turn on your AI agent. It answers your customers and creates orders for you.',
    ),
  },
  {
    key: 'help-connect-page',
    category: 'pages_instagram',
    pages: ['channels'],
    title: l('Connecter une page Facebook ou Instagram', 'ربط صفحة فيسبوك أو إنستغرام', 'Connect a Facebook or Instagram page'),
    body: l(
      'Ouvrez Pages connectées, cliquez sur « Connecter une page » et acceptez les autorisations Meta. Instagram nécessite un compte professionnel lié à une page Facebook.',
      'افتح الصفحات المتصلة، انقر على « ربط صفحة » ووافق على أذونات Meta. يتطلب إنستغرام حسابًا احترافيًا مرتبطًا بصفحة فيسبوك.',
      'Open Connected pages, click “Connect a page” and accept the Meta permissions. Instagram needs a professional account linked to a Facebook page.',
    ),
  },
  {
    key: 'help-ai-agent',
    category: 'ai_agent',
    pages: ['agents', 'inbox'],
    title: l('Configurer votre agent IA', 'إعداد وكيل الذكاء الاصطناعي', 'Set up your AI agent'),
    body: l(
      'L’assistant de création vous guide en 5 étapes : Identité, Connaissances, Comportement, Canaux, puis Test & activation. À la dernière étape, testez votre agent dans le bac à essai (« Tester moi-même ») avant de l’activer : les tests ne consomment pas de crédits et ne touchent ni vos clients ni vos commandes.',
      'يرشدك معالج الإنشاء في 5 خطوات: الهوية، المعارف، السلوك، القنوات، ثم الاختبار والتفعيل. في الخطوة الأخيرة جرّب وكيلك في ساحة التجربة (« أختبر بنفسي ») قبل تفعيله: لا تستهلك الاختبارات أي رصيد ولا تمسّ زبائنك ولا طلباتك.',
      'The creation wizard guides you in 5 steps: Identity, Knowledge, Behaviour, Channels, then Test & activation. At the last step, try your agent in the playground (“Test myself”) before turning it on: tests use no credits and never reach your customers or your orders.',
    ),
  },
  {
    key: 'help-orders-delivery',
    category: 'orders_delivery',
    pages: ['orders', 'delivery'],
    title: l('Confirmer et expédier une commande', 'تأكيد طلب وشحنه', 'Confirm and ship an order'),
    body: l(
      'Appelez le client depuis la page de la commande, enregistrez le résultat puis envoyez la commande à votre transporteur. Le suivi se met à jour automatiquement.',
      'اتصل بالزبون من صفحة الطلب، سجّل النتيجة ثم أرسل الطلب إلى شركة التوصيل. يتحدث التتبع تلقائيًا.',
      'Call the customer from the order page, record the outcome then send the order to your courier. Tracking updates automatically.',
    ),
  },
  {
    key: 'help-stock',
    category: 'stock',
    pages: ['products', 'stock', 'movements'],
    title: l('Gérer votre stock', 'إدارة مخزونك', 'Manage your stock'),
    body: l(
      'Une nouvelle commande réserve le stock (« Réservé » sur la fiche produit) ; quand vous la confirmez, les unités sortent du stock (mouvement « sortie »). Les ajustements et inventaires sont tracés dans Mouvements. Fixez un stock minimum pour recevoir une alerte.',
      'يحجز كل طلب جديد المخزون (« محجوز » في بطاقة المنتج)؛ وعند تأكيده تخرج الوحدات من المخزون (حركة « خروج »). وتُسجَّل التعديلات والجرد في الحركات. حدد حدًا أدنى للمخزون لتلقي تنبيه.',
      'A new order reserves the stock (“Reserved” on the product page); when you confirm it, the units leave the stock (an “out” movement). Adjustments and counts are logged in Movements. Set a minimum stock to get an alert.',
    ),
  },
  {
    key: 'help-credits-billing',
    category: 'credits_billing',
    pages: ['settings/billing', 'settings/credits'],
    title: l('Crédits et facturation', 'الأرصدة والفوترة', 'Credits and billing'),
    body: l(
      'Votre plan inclut des crédits mensuels. Achetez un pack si vous en manquez : les packs n’expirent jamais. Le paiement se fait par Chargily (CIB / Edahabia).',
      'تتضمن خطتك أرصدة شهرية. اشترِ حزمة إذا نفدت: لا تنتهي صلاحية الحزم. يتم الدفع عبر Chargily (CIB / الذهبية).',
      'Your plan includes monthly credits. Buy a pack if you run out: packs never expire. Payment goes through Chargily (CIB / Edahabia).',
    ),
  },
  {
    key: 'help-mobile-app',
    category: 'mobile_app',
    pages: ['settings/notifications'],
    title: l('L’application mobile Djaber', 'تطبيق جابر للهاتف', 'The Djaber mobile app'),
    body: l(
      'Téléchargez l’application sur Google Play ou l’App Store et connectez-vous avec le même compte. Activez les notifications pour ne manquer aucune commande.',
      'حمّل التطبيق من Google Play أو App Store وسجّل الدخول بنفس الحساب. فعّل الإشعارات حتى لا يفوتك أي طلب.',
      'Download the app from Google Play or the App Store and sign in with the same account. Turn on notifications so you never miss an order.',
    ),
  },
  {
    key: 'help-security-data',
    category: 'security_data',
    pages: ['settings/security', 'settings/profile'],
    title: l('Sécurité du compte et données', 'أمان الحساب والبيانات', 'Account security and data'),
    body: l(
      'Activez la double authentification dans Paramètres › Sécurité. Vous pouvez bloquer un client, signaler un abus et demander l’export ou la suppression de vos données.',
      'فعّل المصادقة الثنائية في الإعدادات › الأمان. يمكنك حظر زبون والإبلاغ عن إساءة وطلب تصدير بياناتك أو حذفها.',
      'Turn on two-factor authentication in Settings › Security. You can block a customer, report abuse and ask for an export or deletion of your data.',
    ),
  },
];

export async function seedSupport(adminId: string) {
  let canned = 0;
  for (const c of CANNED) {
    const existing = await db.cannedReply.findUnique({ where: { key: c.key } });
    if (existing) continue;
    await db.cannedReply.create({ data: { key: c.key, title: c.title, body: c.body, category: c.category, createdById: adminId } });
    canned++;
  }
  let articles = 0;
  const locales = ['fr', 'ar', 'en'] as const;
  for (const [i, a] of ARTICLES.entries()) {
    if (await db.cmsEntry.findUnique({ where: { key: a.key } })) continue;
    await db.cmsEntry.create({
      data: {
        key: a.key,
        type: 'help',
        category: a.category,
        target: { pages: a.pages },
        status: 'published',
        currentVersion: 1,
        sortOrder: i,
        createdById: adminId,
        locales: { create: locales.map((locale) => ({ locale, title: a.title[locale], body: a.body[locale], status: 'published' as const, updatedById: adminId })) },
        versions: { create: { version: 1, snapshot: { title: a.title, body: a.body }, createdById: adminId } },
      },
    });
    articles++;
  }
  return { canned, articles };
}
