-- Journey J01r-3 (18/11): the seeded help guides « Configurer votre agent IA » and « Gérer votre stock » named wrong wizard
-- steps and a wrong stock rule. Data only, idempotent: a locale row is updated only while it still holds the first seeded
-- text (an edit made in the admin CMS is kept; a second run changes nothing). No other CMS row is touched.
UPDATE "CmsEntryLocale" AS l SET "body" = $new$L’assistant de création vous guide en 5 étapes : Identité, Connaissances, Comportement, Canaux, puis Test & activation. À la dernière étape, testez votre agent dans le bac à essai (« Tester moi-même ») avant de l’activer : les tests ne consomment pas de crédits et ne touchent ni vos clients ni vos commandes.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-ai-agent' AND e."type" = 'help' AND l."locale" = 'fr' AND l."body" = $old$L’assistant de création vous guide en 5 étapes : identité, catalogue, politiques, horaires et activation. Testez-le dans le bac à sable avant de l’activer.$old$;
UPDATE "CmsEntryLocale" AS l SET "body" = $new$يرشدك معالج الإنشاء في 5 خطوات: الهوية، المعارف، السلوك، القنوات، ثم الاختبار والتفعيل. في الخطوة الأخيرة جرّب وكيلك في ساحة التجربة (« أختبر بنفسي ») قبل تفعيله: لا تستهلك الاختبارات أي رصيد ولا تمسّ زبائنك ولا طلباتك.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-ai-agent' AND e."type" = 'help' AND l."locale" = 'ar' AND l."body" = $old$يرشدك معالج الإنشاء في 5 خطوات: الهوية، الكتالوج، السياسات، الأوقات والتفعيل. جرّبه في بيئة الاختبار قبل تفعيله.$old$;
UPDATE "CmsEntryLocale" AS l SET "body" = $new$The creation wizard guides you in 5 steps: Identity, Knowledge, Behaviour, Channels, then Test & activation. At the last step, try your agent in the playground (“Test myself”) before turning it on: tests use no credits and never reach your customers or your orders.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-ai-agent' AND e."type" = 'help' AND l."locale" = 'en' AND l."body" = $old$The creation wizard guides you in 5 steps: identity, catalogue, policies, hours and activation. Try it in the playground before turning it on.$old$;
UPDATE "CmsEntryLocale" AS l SET "body" = $new$Une nouvelle commande réserve le stock (« Réservé » sur la fiche produit) ; quand vous la confirmez, les unités sortent du stock (mouvement « sortie »). Les ajustements et inventaires sont tracés dans Mouvements. Fixez un stock minimum pour recevoir une alerte.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-stock' AND e."type" = 'help' AND l."locale" = 'fr' AND l."body" = $old$Chaque commande confirmée réserve le stock ; les ajustements et inventaires sont tracés dans Mouvements. Fixez un stock minimum pour recevoir une alerte.$old$;
UPDATE "CmsEntryLocale" AS l SET "body" = $new$يحجز كل طلب جديد المخزون (« محجوز » في بطاقة المنتج)؛ وعند تأكيده تخرج الوحدات من المخزون (حركة « خروج »). وتُسجَّل التعديلات والجرد في الحركات. حدد حدًا أدنى للمخزون لتلقي تنبيه.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-stock' AND e."type" = 'help' AND l."locale" = 'ar' AND l."body" = $old$كل طلب مؤكد يحجز المخزون؛ وتُسجَّل التعديلات والجرد في الحركات. حدد حدًا أدنى للمخزون لتلقي تنبيه.$old$;
UPDATE "CmsEntryLocale" AS l SET "body" = $new$A new order reserves the stock (“Reserved” on the product page); when you confirm it, the units leave the stock (an “out” movement). Adjustments and counts are logged in Movements. Set a minimum stock to get an alert.$new$, "updatedAt" = now()
FROM "CmsEntry" AS e
WHERE l."entryId" = e."id" AND e."key" = 'help-stock' AND e."type" = 'help' AND l."locale" = 'en' AND l."body" = $old$Every confirmed order reserves stock; adjustments and counts are logged in Movements. Set a minimum stock to get an alert.$old$;
