# 11 — Error catalogue

Single source for API error codes (`packages/shared/errors`). Every error: HTTP status, code, message fr / ar / en (shown to merchants), **UI behaviour** (how web & mobile present it) and **recovery** (what the user can do). Codes reuse V1 names where they existed (`errors/catalog.*.ts`). Field-level validation errors come as `fields: { field: key }` with keys from 04 §2 and are always rendered **inline next to the field, inside the dialog**.

UI behaviour legend: **inline** (field), **toast** (transient, auto-dismiss 5 s, with action), **dialog** (blocking, needs acknowledgement), **banner** (persistent until condition clears), **state** (replaces screen content), **silent** (logged only).

## 1. Generic

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 400 | `BAD_REQUEST` | Requête invalide. | طلب غير صالح. | Invalid request. | toast | retry; report if persists |
| 400 | `WORKSPACE_REQUIRED` | Choisissez un espace de travail. | اختر مساحة عمل. | Choose a workspace. | state (workspace picker) | pick a workspace (`X-Workspace-Id`) |
| 500 | `INTERNAL` {ref} | Erreur interne (réf. {ref}). Réessayez. | خطأ داخلي (مرجع {ref}). أعد المحاولة. | Internal error (ref. {ref}). Retry. | toast with Réessayer + ref | retry; support ticket with ref |
| 401 | `UNAUTHORIZED` | Session expirée, reconnectez-vous. | انتهت الجلسة، سجّل الدخول من جديد. | Session expired, please sign in. | state → login (return URL kept) | silent refresh first |
| 403 | `FORBIDDEN` | Vous n'avez pas la permission. | ليست لديك الصلاحية. | You don't have permission. | toast (action hidden normally) | ask Owner/Admin |
| 403 | `READ_ONLY_MEMBER` | Accès en lecture seule (limite du plan). | وصول للقراءة فقط (حد الخطة). | Read-only access (plan limit). | banner | Owner upgrades |
| 403 | `PLAN_LIMIT` {resource, limit, current} | Limite du plan atteinte ({current}/{limit} {resource}). | بلغت حد الخطة ({current}/{limit} {resource}). | Plan limit reached ({current}/{limit} {resource}). | dialog with Upgrade | upgrade or free a slot |
| 402 | `INSUFFICIENT_CREDITS` | Crédits épuisés. | نفدت الأرصدة. | Credits exhausted. | banner (global) + state in thread | upgrade; wait for period |
| 404 | `NOT_FOUND` | Introuvable ou accès refusé. | غير موجود أو الوصول مرفوض. | Not found or no access. | state (404 page / "removed" in list) | back |
| 409 | `CONFLICT` | Modifié entre-temps, rechargez. | تم التعديل في هذه الأثناء، أعد التحميل. | Changed meanwhile, please reload. | dialog "Reload" (keeps draft) | reload and redo |
| 422 | `VALIDATION_ERROR` + fields | Vérifiez les champs. | تحقق من الحقول. | Check the fields. | inline | fix fields |
| 422 | `IDEMPOTENCY_MISMATCH` | Requête en double différente. | طلب مكرر مختلف. | Duplicate request with different content. | silent + toast | retry with new key |
| 429 | `RATE_LIMITED` {retryAfter} | Trop de tentatives, réessayez dans {retryAfter}s. | محاولات كثيرة، أعد المحاولة بعد {retryAfter} ث. | Too many attempts, retry in {retryAfter}s. | inline (auth) / toast | wait |
| 503 | `PROVIDER_UNAVAILABLE` {provider} | Service {provider} indisponible. | خدمة {provider} غير متاحة. | {provider} unavailable. | toast with retry | retry later |
| 0 | `NETWORK_ERROR` | Pas de connexion. | لا يوجد اتصال. | No connection. | banner (offline) | auto-retry GETs |
| 400 | `IDEMPOTENCY_KEY_MISSING` | Clé d'idempotence manquante. | مفتاح التكرار مفقود. | Missing idempotency key. | silent (client bug) | — |
| 403 | `WORKSPACE_SUSPENDED` | Espace suspendu, contactez le support. | المساحة موقوفة، تواصل مع الدعم. | Workspace suspended, contact support. | state (full page) | support |
| 413 | `UPLOAD_TOO_LARGE` {max} | Fichier trop volumineux (max {max}). | الملف كبير جدًا (الحد {max}). | File too large (max {max}). | inline | smaller file |
| 415 | `UPLOAD_TYPE_INVALID` | Format non supporté. | صيغة غير مدعومة. | Unsupported format. | inline | — |

## 2. Auth & account

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `AUTH_EMAIL_TAKEN` | Cet e-mail est déjà utilisé. | هذا البريد مستخدم مسبقًا. | This email is already used. | inline + links login / forgot | login |
| 401 | `AUTH_INVALID_CREDENTIALS` | E-mail ou mot de passe incorrect. | البريد أو كلمة المرور غير صحيحة. | Incorrect email or password. | inline (form level) | retry / forgot |
| 401 | `AUTH_2FA_REQUIRED` | Code de vérification requis. | رمز التحقق مطلوب. | Verification code required. | state (2FA step) | enter code |
| 401 | `AUTH_2FA_INVALID` | Code invalide. | رمز غير صالح. | Invalid code. | inline | retry / recovery code |
| 422 | `AUTH_PASSWORD_WEAK` | 8 caractères min, lettre et chiffre. | 8 أحرف على الأقل، حرف ورقم. | Min 8 chars, letter and digit. | inline | — |
| 422 | `AUTH_CURRENT_PASSWORD_INCORRECT` | Mot de passe actuel incorrect. | كلمة المرور الحالية غير صحيحة. | Current password incorrect. | inline | — |
| 410 | `AUTH_RESET_TOKEN_EXPIRED` | Lien expiré, demandez-en un nouveau. | انتهت صلاحية الرابط، اطلب رابطًا جديدًا. | Link expired, request a new one. | state (reset page) | resend |
| 400 | `AUTH_RESET_TOKEN_INVALID` | Lien invalide. | رابط غير صالح. | Invalid link. | state | resend |
| 410 | `AUTH_VERIFY_TOKEN_EXPIRED` | Lien de vérification expiré. | انتهت صلاحية رابط التحقق. | Verification link expired. | state | resend |
| 403 | `AUTH_EMAIL_UNVERIFIED` | Vérifiez votre e-mail pour continuer. | تحقق من بريدك للمتابعة. | Verify your email to continue. | dialog with resend | verify |
| 503 | `MAIL_NOT_CONFIGURED` | Envoi d'e-mail indisponible. | إرسال البريد غير متاح. | Email sending unavailable. | toast | contact support |
| 422 | `ACCOUNT_OWNS_WORKSPACE` | Supprimez votre espace d'abord. | احذف مساحتك أولًا. | Delete your workspace first. | dialog | go to danger zone |
| 403 | `TWO_FA_REQUIRED_FOR_ROLE` | La 2FA est obligatoire pour ce rôle. | المصادقة الثنائية إلزامية لهذا الدور. | 2FA is mandatory for this role. | toast | — |
| 401 | `AUTH_MFA_TOKEN_EXPIRED` | Vérification expirée, reconnectez-vous. | انتهت صلاحية التحقق، سجّل الدخول مجددًا. | Verification expired, sign in again. | state → login | — |
| 401 | `AUTH_REFRESH_REUSED` | Session révoquée par sécurité, reconnectez-vous. | أُلغيت الجلسة لأسباب أمنية، سجّل الدخول من جديد. | Session revoked for security, sign in again. | state → login (all sessions of the family revoked) | sign in again |
| 422 | `DEVICE_LIMIT` {max} | {max} appareils max. | {max} جهازًا كحد أقصى. | Max {max} devices. | toast (mobile) | remove a device in Sessions |
| 410 | `INVITATION_EXPIRED` | Invitation expirée. | انتهت صلاحية الدعوة. | Invitation expired. | state | ask new invite |
| 409 | `MEMBER_ALREADY_EXISTS` | Déjà membre. | عضو بالفعل. | Already a member. | inline | — |
| 422 | `OWNER_IMMUTABLE` | Le propriétaire ne peut être retiré ni rétrogradé. | لا يمكن إزالة المالك أو تخفيض دوره. | The owner can't be removed or demoted. | toast (action hidden) | — |

## 3. Channels & Meta

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 400 | `OAUTH_STATE_INVALID` | Connexion expirée, recommencez. | انتهت محاولة الربط، أعد المحاولة. | Connection attempt expired, start again. | dialog | retry connect |
| 400 | `OAUTH_CANCELLED` | Connexion annulée. | تم إلغاء الربط. | Connection cancelled. | toast | — |
| — | `PAGE_ACCESS_TOKEN_MISSING` | Page sans jeton d'accès (droits insuffisants). | الصفحة بدون رمز وصول (صلاحيات ناقصة). | Page has no access token (insufficient rights). | row in connect report | grant rights on Meta |
| — | `PAGE_MESSAGING_PERMISSION_MISSING` | Vous n'êtes pas autorisé à gérer les messages de cette page. | لست مخوّلًا لإدارة رسائل هذه الصفحة. | You can't manage messages for this page. | row | ask page admin |
| 409 | `PAGE_ALREADY_CONNECTED_ELSEWHERE` | Page déjà connectée à un autre espace. Déconnectez-la là-bas d'abord. | الصفحة مرتبطة بمساحة أخرى. افصلها هناك أولًا. | Page connected to another workspace. Disconnect it there first. | row / dialog | other workspace or support |
| — | `PAGE_WEBHOOK_SUBSCRIBE_FAILED` | Abonnement aux messages échoué, nouvel essai automatique. | فشل الاشتراك في الرسائل، سيُعاد تلقائيًا. | Message subscription failed, retrying automatically. | row (warning) | auto-retry; reconnect |
| 403 | `PAGE_INSTAGRAM_PENDING_APPROVAL` | Instagram en attente d'approbation Meta. | إنستغرام في انتظار موافقة ميتا. | Instagram pending Meta approval. | state on connect | wait; instructions |
| 403 | `PAGE_ANALYSIS_PERMISSION_REQUIRED` | Reconnectez la page avec la permission "contenu". | أعد ربط الصفحة مع صلاحية "المحتوى". | Reconnect the page with the "content" permission. | state + Reconnect | reconnect |
| 401 | `PAGE_TOKEN_EXPIRED` | Page déconnectée par Meta, reconnectez-la. | فصلت ميتا الصفحة، أعد ربطها. | Page disconnected by Meta, reconnect it. | banner + card state | reconnect |
| 409 | `CHANNEL_PAUSED_BY_PLAN` | Page en pause (limite du plan). | الصفحة متوقفة (حد الخطة). | Page paused (plan limit). | badge + banner | upgrade |
| 503 | `META_UNAVAILABLE` | Meta ne répond pas, réessayez. | ميتا لا تستجيب، أعد المحاولة. | Meta is not responding, retry. | toast | retry |
| 422 | `REPLY_OUTSIDE_WINDOW` | Hors fenêtre de 24 h : le client doit écrire d'abord. | خارج نافذة 24 ساعة: يجب أن يكتب العميل أولًا. | Outside the 24 h window: the customer must write first. | inline in composer | wait for customer |
| 422 | `REPLY_CHANNEL_INACTIVE` | Page en pause ou déconnectée. | الصفحة متوقفة أو مفصولة. | Page paused or disconnected. | composer disabled + reason | reconnect/resume |
| 422 | `REPLY_TOO_LONG` | 2000 caractères max. | 2000 حرف كحد أقصى. | 2000 characters max. | inline | shorten |
| 422 | `INBOX_INSIGHTS_UNAVAILABLE` | Statistiques Meta indisponibles. | إحصائيات ميتا غير متاحة. | Meta insights unavailable. | state (card) | — |
| 401 | `PAGE_SYNC_TOKEN_EXPIRED` | Synchronisation impossible : page à reconnecter. | تعذّرت المزامنة: أعد ربط الصفحة. | Sync impossible: reconnect the page. | toast + banner | reconnect |

## 4. Agents & AI

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `AGENT_PAGE_ALREADY_ASSIGNED` {agentName} | Page déjà liée à « {agentName} ». La déplacer ? | الصفحة مرتبطة بـ «{agentName}». نقلها؟ | Page already linked to "{agentName}". Move it? | dialog (Move / Cancel) | confirm move |
| 422 | `AGENT_MODEL_UNAVAILABLE` | Modèle IA indisponible, un modèle de secours est utilisé. | نموذج الذكاء الاصطناعي غير متاح، يُستخدم نموذج احتياطي. | AI model unavailable, a fallback model is used. | toast (merchant) / inline (admin AI routes) | platform routing falls back (`AiRoute`); admin fixes the route |
| 429 | `PLAYGROUND_RATE_LIMITED` | Limite de test atteinte (60/h). | بلغت حد الاختبار (60/س). | Test limit reached (60/h). | inline in playground | wait |
| 429 | `ANALYSIS_RATE_LIMITED` | 3 analyses par jour max. | 3 تحليلات يوميًا كحد أقصى. | Max 3 analyses per day. | toast | tomorrow |
| 503 | `AI_PROVIDER_ERROR` | L'IA ne répond pas ; la conversation passe en file. | الذكاء الاصطناعي لا يستجيب؛ المحادثة في قائمة الانتظار. | AI not responding; conversation queued for a human. | thread banner | human reply; retry later |
| 422 | `INSIGHT_ALREADY_RESOLVED` | Déjà traité. | تمت معالجته. | Already handled. | toast | — |
| 422 | `IMAGE_ANALYSIS_FAILED` | Analyse de l'image échouée. | فشل تحليل الصورة. | Image analysis failed. | inline | retry / fill manually |

## 5. Catalogue & stock

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `PRODUCT_SKU_ALREADY_EXISTS` | SKU déjà utilisé. | رمز المنتج مستخدم. | SKU already used. | inline | change SKU |
| 422 | `PRODUCT_HAS_VARIANTS` | Ajustez le stock par variante. | عدّل المخزون لكل متغيّر. | Adjust stock per variant. | dialog | open variants |
| 422 | `PRODUCT_NOT_STOCK_TRACKED` | Ce produit n'a pas de stock (service). | هذا المنتج بدون مخزون (خدمة). | This product has no stock (service). | toast | — |
| 422 | `STOCK_INSUFFICIENT` {available} | Stock insuffisant (disponible : {available}). | المخزون غير كافٍ (المتاح: {available}). | Insufficient stock (available: {available}). | inline on line | lower qty |
| 422 | `STOCK_QUANTITY_ZERO` | Quantité nulle. | الكمية صفر. | Zero quantity. | inline | — |
| 422 | `VARIANT_REQUIRED` | Choisissez une variante. | اختر متغيّرًا. | Choose a variant. | inline on line | pick |
| 404 | `VARIANT_NOT_FOUND` | Variante introuvable. | المتغيّر غير موجود. | Variant not found. | inline | pick |
| 409 | `CATEGORY_ALREADY_EXISTS` | Catégorie existante. | الفئة موجودة. | Category exists. | inline | — |
| 409 | `ANALYSIS_PRODUCT_EXISTS` {name} | Déjà dans le catalogue : {name}. | موجود مسبقًا في الكتالوج: {name}. | Already in the catalogue: {name}. | per-row result (page analysis import) | edit the existing product |
| 409 | `CATEGORY_IN_USE` {count} | Utilisée par {count} produits. Réassigner ? | مستخدمة في {count} منتجات. إعادة تعيين؟ | Used by {count} products. Reassign? | dialog with reassign select | reassign |
| 409 | `UNIT_IN_USE` {count} | Utilisée par {count} produits. Réassigner ? | مستخدمة في {count} منتجات. إعادة تعيين؟ | Used by {count} products. Reassign? | dialog with reassign select | reassign |
| 403 | `UNIT_SYSTEM_READONLY` | Unité système non modifiable. | وحدة النظام غير قابلة للتعديل. | System unit is read-only. | toast | — |
| 422 | `IMPORT_COLUMNS_MISSING` {columns} | Colonnes manquantes : {columns}. | أعمدة ناقصة: {columns}. | Missing columns: {columns}. | state (import step 1) | fix file |
| 422 | `IMPORT_TOO_LARGE` | Max 5 Mo et 2000 lignes. | 5 م.ب و2000 سطر كحد أقصى. | Max 5 MB and 2000 rows. | inline | split file |
| — | `IMPORT_DUPLICATE_SKU_IN_FILE` {row} | Ligne {row} : SKU en double dans le fichier. | السطر {row}: رمز مكرر في الملف. | Row {row}: duplicate SKU in file. | row error in preview | fix file |
| 413 | `IMAGE_TOO_LARGE` | Image trop lourde (5 Mo max). | الصورة كبيرة جدًا (5 م.ب كحد أقصى). | Image too large (5 MB max). | inline | compress |
| 415 | `IMAGE_TYPE_INVALID` | Format non supporté (jpg, png, webp, gif). | صيغة غير مدعومة (jpg, png, webp, gif). | Unsupported format (jpg, png, webp, gif). | inline | — |
| 422 | `IMAGES_LIMIT` | 10 images max par produit. | 10 صور كحد أقصى لكل منتج. | Max 10 images per product. | inline | remove one |
| 503 | `IMAGE_ANALYSIS_UNAVAILABLE` | Analyse d'image indisponible (aucun modèle vision). | تحليل الصور غير متاح (لا يوجد نموذج رؤية). | Image analysis unavailable (no vision model). | inline | fill manually |

## 6. Clients, orders, delivery

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `CLIENT_PHONE_EXISTS` {clientName} | Numéro déjà utilisé par {clientName}. | الرقم مستخدم من {clientName}. | Number already used by {clientName}. | inline + "use existing" action | pick existing |
| 422 | `ORDER_INVALID_TRANSITION` {from, to} | Passage {from} → {to} impossible. | الانتقال {from} → {to} غير ممكن. | Transition {from} → {to} not allowed. | toast (action normally hidden) | reload |
| 422 | `ORDER_TERMINAL` | Commande clôturée. | الطلب مغلق. | Order is closed. | read-only state | — |
| 422 | `ORDER_INSUFFICIENT_STOCK` {product, available} | Stock insuffisant pour {product} ({available}). | المخزون غير كافٍ لـ {product} ({available}). | Insufficient stock for {product} ({available}). | inline on line | adjust |
| 422 | `ORDER_ADDRESS_REQUIRED` | Adresse et wilaya requises pour confirmer. | العنوان والولاية مطلوبان للتأكيد. | Address and wilaya required before confirming. | dialog state "address missing" | fill |
| 422 | `ORDER_DELETE_DELIVERED` | Commande livrée : non supprimable. | طلب مُسلَّم: لا يمكن حذفه. | Delivered order can't be deleted. | toast | mark returned instead |
| 422 | `ORDER_PAYMENT_LOCKED` | Paiement verrouillé (commande clôturée). | الدفع مقفل (طلب مغلق). | Payment locked (closed order). | read-only | — |
| 422 | `ORDER_CALL_ON_TERMINAL` (warning) | Appel enregistré ; commande inchangée. | تم تسجيل المكالمة؛ الطلب دون تغيير. | Call logged; order unchanged. | toast (warning) | — |
| 422 | `WILAYA_NOT_SERVED` | Livraison non assurée dans cette wilaya. | التوصيل غير متاح في هذه الولاية. | Delivery not available in this wilaya. | inline | choose stop-desk / activate wilaya |
| 422 | `DELIVERY_ORDER_NOT_CONFIRMED` | Confirmez la commande avant l'envoi. | أكّد الطلب قبل الإرسال. | Confirm the order before sending. | dialog | confirm |
| 409 | `DELIVERY_ORDER_ALREADY_SENT` | Déjà envoyée (colis actif). | أُرسلت مسبقًا (طرد نشط). | Already sent (active parcel). | toast | track / cancel parcel |
| 422 | `DELIVERY_NO_COURIER` | Aucun transporteur configuré. | لا يوجد ناقل مُعدّ. | No courier configured. | dialog state with link | configure |
| 422 | `COURIER_VALIDATION` {field, message} | Transporteur : {message}. | الناقل: {message}. | Courier: {message}. | inline mapped to field | fix and retry |
| 401 | `COURIER_CREDENTIALS_INVALID` | Identifiants transporteur refusés. | بيانات الناقل مرفوضة. | Courier credentials rejected. | inline (settings) / banner | update credentials |
| 503 | `COURIER_UNAVAILABLE` | Transporteur indisponible, envoi mis en attente. | الناقل غير متاح، الإرسال في الانتظار. | Courier unavailable, sending queued. | toast + order state "sending…" | auto-retry; manual retry |
| 422 | `LABEL_UNAVAILABLE` | Étiquette non fournie par ce transporteur. | الملصق غير متوفر من هذا الناقل. | Label not provided by this courier. | dialog with Djaber label | print fallback |
| 404 | `TRACKING_NOT_FOUND` | Suivi introuvable chez le transporteur. | التتبع غير موجود لدى الناقل. | Tracking not found at the courier. | state | retry later |
| 422 | `FEE_RULE_NOT_FOUND` | Pas de tarif personnalisé. | لا تعرفة مخصصة. | No custom fee. | toast | — |
| 409 | `COURIER_HAS_ACTIVE_SHIPMENTS` {count} | {count} colis en cours avec ce transporteur. | {count} طرود جارية مع هذا الناقل. | {count} active parcels with this courier. | dialog | wait or cancel parcels |

Usage rule: `STOCK_INSUFFICIENT` is returned by stock adjustments and **sale** lines; `ORDER_INSUFFICIENT_STOCK` by order lines (manual and AI tool).

## 7. GDS operations (P2)

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 422 | `SALE_INSUFFICIENT_STOCK` {product, available} | Stock insuffisant pour {product} ({available}). | المخزون غير كافٍ لـ {product} ({available}). | Insufficient stock for {product} ({available}). | inline on line | adjust |
| 422 | `SALE_DELETE_PAID` | Vente encaissée : non supprimable. | بيع مُحصَّل: لا يمكن حذفه. | Paid sale can't be deleted. | toast | set paid 0 first |
| 422 | `PURCHASE_CANCELLED_PAYMENT_LOCKED` | Achat annulé : paiement verrouillé. | شراء ملغى: الدفع مقفل. | Cancelled purchase: payment locked. | read-only | — |
| 422 | `PURCHASE_DELETE_NOT_PENDING` | Seul un achat en attente et non payé peut être supprimé. | يمكن حذف الشراء المعلّق وغير المدفوع فقط. | Only a pending, unpaid purchase can be deleted. | toast | cancel instead |
| 422 | `PURCHASE_UNTRACKED_PRODUCT` {product} | {product} est un service : non achetable. | {product} خدمة: لا يمكن شراؤها. | {product} is a service: not purchasable. | inline on line | remove line |
| 403 | `CAISSE_EDIT_AUTOMATIC` | Ligne automatique : modifiez la source (commande, vente, achat). | سطر تلقائي: عدّل المصدر (طلب، بيع، شراء). | Automatic row: edit the source (order, sale, purchase). | tooltip on lock icon | open source |
| 403 | `CAISSE_DELETE_AUTOMATIC` | Ligne automatique : non supprimable. | سطر تلقائي: لا يمكن حذفه. | Automatic row can't be deleted. | tooltip on lock icon | — |
| 422 | `REPORT_RANGE_TOO_LONG` | 732 jours max. | 732 يومًا كحد أقصى. | Max 732 days. | inline (date picker) | shorten |
| 422 | `REPORT_CUSTOM_RANGE_REQUIRED` | Choisissez une date de début et de fin. | اختر تاريخ البداية والنهاية. | Choose a start and end date. | inline | — |
| 422 | `INVALID_DATE_RANGE` | La date de fin précède le début. | تاريخ النهاية قبل البداية. | End date before start date. | inline | — |

## 8. Billing, integrations, admin

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 404 | `PLAN_NOT_FOUND` | Plan indisponible. | الخطة غير متاحة. | Plan unavailable. | toast | reload plans |
| 422 | `PLAN_IS_FREE` | Aucun paiement requis pour ce plan. | لا يلزم دفع لهذه الخطة. | No payment required for this plan. | toast | — |
| 409 | `PLAN_IN_USE` {count} | Plan utilisé par {count} espaces : désactivez-le. | الخطة مستخدمة من {count} مساحات: عطّلها. | Plan used by {count} workspaces: deactivate it. | dialog (admin) | deactivate |
| 409 | `CREDIT_PACK_HAS_PURCHASES` {count} | Pack déjà acheté {count} fois : désactivez-le plutôt que de le supprimer. | تم شراء هذه الباقة {count} مرة: عطّلها بدل حذفها. | Pack already bought {count} times: deactivate it instead of deleting it. | dialog (admin) | deactivate |
| 409 | `SUBSCRIPTION_ALREADY_ACTIVE` | Un abonnement actif existe déjà. | يوجد اشتراك نشط بالفعل. | An active subscription already exists. | dialog (admin) | end it first |
| 402 | `PAYMENT_FAILED` | Paiement refusé. | تم رفض الدفع. | Payment declined. | state (return page) | retry |
| 410 | `PAYMENT_EXPIRED` | Session de paiement expirée. | انتهت جلسة الدفع. | Payment session expired. | state | new checkout |
| 422 | `PAYMENT_AMOUNT_MISMATCH` | Montant incohérent, paiement non validé. | المبلغ غير متطابق، لم يُعتمد الدفع. | Amount mismatch, payment not validated. | silent + admin alert | support |
| 401 | `WEBHOOK_SIGNATURE_INVALID` | — | — | — | silent (logged, admin alert) | — |
| 422 | `SHEETS_NOT_CONNECTED` | Google Sheets non connecté. | Google Sheets غير متصل. | Google Sheets not connected. | state (integration card) | connect |
| 401 | `SHEETS_TOKEN_REVOKED` | Accès Google révoqué, reconnectez-vous. | تم إلغاء وصول Google، أعد الربط. | Google access revoked, reconnect. | banner | reconnect |
| 404 | `SHEETS_SPREADSHEET_NOT_FOUND` | Feuille introuvable (supprimée ?). | الجدول غير موجود (محذوف؟). | Spreadsheet not found (deleted?). | banner | pick another |
| 429 | `SHEETS_QUOTA` | Quota Google atteint, nouvel essai automatique. | بلغ حصة Google، إعادة المحاولة تلقائيًا. | Google quota reached, retrying automatically. | silent | — |
| 401 | `API_KEY_REVOKED` | Clé API révoquée. | مفتاح API ملغى. | API key revoked. | — (API) | new key |
| 403 | `API_SCOPE_FORBIDDEN` {scope} | Portée requise : {scope}. | النطاق المطلوب: {scope}. | Required scope: {scope}. | — (API) | add scope |
| 422 | `WEBHOOK_ENDPOINT_DISABLED` | Webhook désactivé après 50 échecs. | عُطّل الويبهوك بعد 50 فشلًا. | Webhook disabled after 50 failures. | banner | fix endpoint, re-enable |
| 401 | `AI_PROVIDER_KEY_REJECTED` | Clé refusée par {provider}. | رفض {provider} المفتاح. | Key rejected by {provider}. | inline (admin test) | replace key |
| 503 | `AI_PROVIDER_UNREACHABLE` | {provider} injoignable. | تعذّر الوصول إلى {provider}. | {provider} unreachable. | inline (admin test) | retry |
| 422 | `AI_PROVIDER_NO_KEY` | Aucune clé configurée. | لا يوجد مفتاح مُعدّ. | No key configured. | inline | add key |
| 422 | `ADMIN_CANNOT_DEMOTE_SELF` | Vous ne pouvez pas retirer vos propres droits. | لا يمكنك إزالة صلاحياتك. | You can't remove your own rights. | toast | — |
| 422 | `CMS_SLUG_INVALID` | Slug invalide (lettres, chiffres, tirets). | معرّف غير صالح (أحرف، أرقام، شرطات). | Invalid slug (letters, digits, dashes). | inline | — |

## 9. Customer-facing system messages (sent on Messenger/Instagram)

### 9.1 Workspace-editable system messages (4 keys)

`Workspace.systemMessages` JSON = `{ handoff, out_of_hours, out_of_stock, welcome }` × `{ fr, ar, en }`, seeded with the defaults below at workspace creation, edited in Settings › Messages système (`GET|PUT /workspace/system-messages`, preview, reset to default). Sent in the customer's last language.

| Key | Default fr | Default ar | Default en | When |
|---|---|---|---|---|
| `handoff` | Je transmets à un membre de l'équipe qui vous répondra très vite. | سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. | I'm passing this to a team member who will reply shortly. | sent when the AI hands off (FL-03) |
| `out_of_hours` | Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. | فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. | Our team is away right now; I'll take your order meanwhile and we'll call you back at opening. | once per conversation per 24 h when `Agent.businessHours` is set and now (Africa/Algiers) is outside it; the AI keeps answering and taking orders |
| `out_of_stock` | Désolé, {product} est en rupture de stock pour le moment. | عذرًا، {product} غير متوفر حاليًا. | Sorry, {product} is out of stock right now. | injected verbatim in the system prompt as the sentence the AI uses when a requested product is out of stock (`{product}` placeholder); with `outOfStockBehavior=suggest_alternative` the AI appends alternatives after it |
| `welcome` | Bonjour 👋 Bienvenue chez {shop} ! Comment puis-je vous aider ? | مرحبًا 👋 أهلًا بك في {shop}! كيف يمكنني مساعدتك؟ | Hello 👋 Welcome to {shop}! How can I help you? | standalone message immediately before the first AI reply of a newly created conversation; empty string ⇒ not sent |

### 9.2 Fixed platform texts (not editable)

i18n keys `customer.<key>`; sent in the customer's last language in the situations below; the merchant cannot change them.

| Key | Default fr | Default ar | Default en | When |
|---|---|---|---|---|
| `unavailable` | Désolé, notre assistant est momentanément indisponible. Un membre de l'équipe vous répondra bientôt. 🙏 | عذرًا، المساعد غير متاح حاليًا. سيرد عليك أحد أفراد الفريق قريبًا. 🙏 | Sorry, our assistant is temporarily unavailable. A team member will reply soon. 🙏 | credits 0 / quota (once per conversation per 24 h) |
| `unsupportedMedia` | Je ne peux pas lire ce type de message. Envoyez-moi un texte ou une photo 😊 | لا أستطيع قراءة هذا النوع من الرسائل. أرسل نصًا أو صورة 😊 | I can't read this type of message. Please send text or a photo 😊 | video/file/sticker only; voice when transcription off |
| `voiceFailed` | Je n'ai pas réussi à écouter votre vocal, pouvez-vous l'écrire ? | لم أتمكن من سماع رسالتك الصوتية، هل يمكنك كتابتها؟ | I couldn't hear your voice note, could you type it? | transcription failed |
| `outsideWindowSkipped` (internal label, not sent) | — | — | — | thread label "non délivré — hors fenêtre 24 h" |

## 10. Rendering rules

- Message language = user locale (merchant) / customer's last language (customer messages).
- `fields` keys map to i18n `validation.*`; unknown field ⇒ form-level message.
- Every `dialog` error keeps the form content; nothing is lost on error.
- Mobile uses the same codes; `banner` ⇒ top sheet, `dialog` ⇒ bottom sheet.

## 11. Warnings (non-blocking, `meta.warnings`)

| Code | fr | ar | en | UI |
|---|---|---|---|---|
| `SELLING_BELOW_COST` | Prix de vente inférieur au coût. | سعر البيع أقل من التكلفة. | Selling price below cost. | inline hint under the price field; saved anyway (D24) |
| `IMAGE_SMALL` {px} | Image de {px} px : qualité réduite sur Messenger. | صورة {px} بكسل: جودة أقل على ماسنجر. | {px} px image: lower quality on Messenger. | inline hint |
| `PLAN_NEAR_LIMIT` {resource} | Vous approchez de la limite {resource}. | تقترب من حد {resource}. | Approaching the {resource} limit. | toast |
| `AGENT_READINESS` {items[]} | Points à vérifier avant activation : {items}. | نقاط للمراجعة قبل التفعيل: {items}. | Points to check before activation: {items}. | checklist ⚠ rows (AGT-02 step 5) |


## 12. Codes added from the Figma web design (2026-10-06) `[D45]`

Every code drawn in a Figma frame (dialog footers, greyed menu items, grey "ÉTAT ·" tiles) that §1–11 did not define. Same columns. Codes that duplicated an existing one are **not** added: the canonical code is kept and the Figma text is corrected (§13). Messages follow the same voice as §1–11; `{}` = interpolated.

### 12.1 Auth, account, platform roles

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 403 | `AUTH_USER_BLOCKED` | Compte bloqué, contactez le support. | الحساب محظور، تواصل مع الدعم. | Account blocked, contact support. | state (login) | support |
| 403 | `TWO_FA_CONFIRMATION_REQUIRED` | Saisissez votre code 2FA pour confirmer. | أدخل رمز المصادقة الثنائية للتأكيد. | Enter your 2FA code to validate. | inline (code field in the dialog) | enter code |
| 409 | `INVITATION_PENDING` | Invitation déjà envoyée à cet e-mail. | تم إرسال دعوة إلى هذا البريد مسبقًا. | An invitation is already pending for this e-mail. | inline + "Renvoyer" | resend |
| 403 | `INVITATION_EMAIL_MISMATCH` {email} | Cette invitation est pour {email}. Déconnectez-vous. | هذه الدعوة موجهة إلى {email}. سجّل الخروج. | This invitation is for {email}. Sign out first. | state (invitation page) | sign out |
| 403 | `LEGAL_REACCEPT_REQUIRED` {document, version} | Acceptez les nouvelles conditions pour continuer. | اقبل الشروط الجديدة للمتابعة. | Accept the new terms to continue. | state (interstitial) | accept |
| 426 | `APP_UPDATE_REQUIRED` {minVersion, storeUrl, message} | Mise à jour requise pour continuer. | التحديث مطلوب للمتابعة. | Update required to continue. | state (mobile blocking screen) | update |
| 503 | `MAINTENANCE_MODE` {until} | Maintenance en cours jusqu'à {until} : lecture seule. | صيانة جارية حتى {until}: للقراءة فقط. | Maintenance until {until}: read-only. | banner + disabled actions | wait |
| 403 | `FEATURE_DISABLED` {feature} | Fonction indisponible pour le moment. | الميزة غير متاحة حاليًا. | Feature unavailable for now. | hidden control (toast via API) | — |
| 403 | `PLAN_FEATURE_REQUIRED` {feature} | Fonction réservée aux plans supérieurs. | الميزة متاحة في الخطط الأعلى. | Feature available on higher plans. | dialog with Comparer les plans | upgrade |
| 410 | `ACCOUNT_DELETION_TOKEN_EXPIRED` | Lien expiré (24 h). Refaites une demande. | انتهت صلاحية الرابط (24 س). أعد الطلب. | Link expired (24 h). Request again. | state (public page) | new request |
| 409 | `ACCOUNT_DELETION_PENDING` {scheduledAt} | Suppression déjà programmée le {scheduledAt}. | الحذف مبرمج مسبقًا في {scheduledAt}. | Deletion already scheduled on {scheduledAt}. | dialog (Annuler / Exporter) | cancel or wait |
| 422 | `OWNERSHIP_TRANSFER_TARGET_INVALID` | Le nouveau propriétaire doit être un admin de l'espace. | يجب أن يكون المالك الجديد مديرًا في المساحة. | The new owner must be an admin of the workspace. | inline | pick an admin |
| 422 | `ADMIN_REASON_REQUIRED` | Indiquez une raison (10 caractères min). | اذكر سببًا (10 أحرف على الأقل). | Give a reason (min 10 characters). | inline (admin dialogs) | — |
| 403 | `ADMIN_IMPERSONATION_FORBIDDEN_ACTION` | Action interdite en mode « connecté en tant que ». | الإجراء ممنوع في وضع «الدخول بصفة». | Action forbidden while impersonating. | toast (red banner context) | quit impersonation |
| 401 | `ADMIN_IMPERSONATION_EXPIRED` | Session « en tant que » expirée (30 min). | انتهت جلسة «الدخول بصفة» (30 د). | Impersonation session expired (30 min). | state → admin | restart with reason |
| 422 | `ADMIN_EMAIL_DOMAIN_INVALID` | E-mail @djaber.ai requis. | يلزم بريد @djaber.ai. | A @djaber.ai e-mail is required. | inline | — |
| 403 | `ADMIN_CREDIT_GRANT_LIMIT` {max} | Geste limité à {max} crédits pour votre rôle. | المنحة محدودة بـ {max} رصيد لدورك. | Grant limited to {max} credits for your role. | inline | ask finance / super admin |

### 12.2 Workspace lifecycle, billing, packs, promo

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `WORKSPACE_DELETION_SCHEDULED` {at} | Suppression programmée le {at} : annulez-la d'abord. | الحذف مبرمج في {at}: ألغِه أولًا. | Deletion scheduled on {at}: cancel it first. | banner + toast | cancel deletion |
| 409 | `WORKSPACE_HAS_DEBT` {amount} | Facture impayée ({amount} DA) : réglez-la d'abord. | فاتورة غير مدفوعة ({amount} دج): سدّدها أولًا. | Unpaid invoice ({amount} DA): settle it first. | dialog with Payer maintenant | pay |
| 403 | `PLAN_LIMIT_GRANDFATHERED` {resource, limit, current} | Vous dépassez la nouvelle limite ({current}/{limit} {resource}) : ajout impossible, l'existant est conservé. | تجاوزت الحد الجديد ({current}/{limit} {resource}): لا يمكن الإضافة، والموجود محفوظ. | Over the new limit ({current}/{limit} {resource}): cannot add, existing kept. | dialog with Comparer les plans | upgrade or free a slot |
| 409 | `PLAN_SLUG_TAKEN` | Slug déjà utilisé. | المعرّف مستخدم مسبقًا. | Slug already used. | inline (admin) | — |
| 200 ⚠ | `INVOICE_PARTIAL_PAYMENT` {remaining} | Paiement partiel enregistré, reste {remaining} DA : facture toujours impayée. | سُجّل دفع جزئي، المتبقي {remaining} دج: الفاتورة غير مدفوعة بعد. | Partial payment recorded, {remaining} DA left: invoice still unpaid. | warning in dialog (admin) | complete payment |
| 402 | `CREDITS_NEGATIVE_BALANCE` {balance} | Solde de crédits négatif ({balance}) après un remboursement : l'IA est bloquée. | رصيدك سالب ({balance}) بعد استرجاع: الذكاء الاصطناعي متوقف. | Negative credit balance ({balance}) after a refund: AI is blocked. | banner (red) + thread state | buy a pack / support |
| 422 | `IAP_RECEIPT_INVALID` | Reçu d'achat invalide. | إيصال الشراء غير صالح. | Invalid purchase receipt. | dialog (mobile) with Réessayer | restore purchases / support |
| 409 | `IAP_RECEIPT_ALREADY_USED` | Achat déjà crédité. | تم احتساب الشراء مسبقًا. | Purchase already credited. | silent (treated as success) | — |
| 404 | `IAP_PRODUCT_UNKNOWN` | Pack indisponible sur cette plateforme. | الحزمة غير متاحة على هذه المنصة. | Pack unavailable on this platform. | toast | pick another pack |
| 503 | `IAP_STORE_UNAVAILABLE` | Validation du store indisponible, nouvel essai automatique. | تعذّر التحقق من المتجر، سيُعاد تلقائيًا. | Store validation unavailable, retrying automatically. | state (pending purchase) | wait |
| 422 | `PROMO_INVALID` | Code promo inconnu. | رمز الخصم غير معروف. | Unknown promo code. | inline | — |
| 410 | `PROMO_EXPIRED` | Code promo expiré. | انتهت صلاحية رمز الخصم. | Promo code expired. | inline | — |
| 409 | `PROMO_ALREADY_USED` | Code déjà utilisé sur cet espace. | الرمز مستخدم مسبقًا في هذه المساحة. | Code already used on this workspace. | inline | — |
| 422 | `PROMO_PLAN_MISMATCH` {plans} | Code valable uniquement pour {plans}. | الرمز صالح فقط لـ {plans}. | Code valid only for {plans}. | inline | change plan |
| 409 | `PROMO_NOT_STACKABLE` | Une remise est déjà active : les codes ne se cumulent pas. | يوجد خصم نشط: لا يمكن الجمع بين الرموز. | A discount is already active: codes do not stack. | inline | — |
| 410 | `PROMO_LIMIT_REACHED` | Code épuisé (limite d'utilisations atteinte). | نفد الرمز (بلغ حد الاستخدام). | Code exhausted (usage limit reached). | inline | — |
| 422 | `PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN` | Les remises d'abonnement s'appliquent sur le web. | خصومات الاشتراك تُطبّق عبر الويب. | Subscription discounts apply on the web. | inline (mobile) | use the web |

### 12.3 Channels, agents, presets

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 422 | `AGENT_NO_CHANNEL` | Rattachez au moins une page avant d'activer. | اربط صفحة واحدة على الأقل قبل التفعيل. | Link at least one page before activating. | inline (step 5) + card badge "Aucun canal" | link a page |
| 409 | `AGENT_HAS_CHANNELS` {count} | {count} pages rattachées : changez les canaux d'abord. | {count} صفحات مرتبطة: غيّر القنوات أولًا. | {count} pages linked: change channels first. | dialog (delete) | detach |
| 409 | `AGENT_PAUSED_WITH_OPEN_THREADS` {count} | {count} conversations attendent une réponse : elles passeront en « À traiter ». | {count} محادثات بانتظار رد: ستنتقل إلى «للمعالجة». | {count} conversations await a reply: they will move to "To handle". | dialog (confirm) | confirm |
| 422 | `AGENT_DRAFT_INCOMPLETE` {missing[]} | Complétez : {missing}. | أكمل: {missing}. | Complete: {missing}. | checklist (step 5) | fill |
| 422 | `AGENT_FAQ_LIMIT` | 50 questions / 20 000 caractères max. | 50 سؤالًا / 20 000 حرف كحد أقصى. | Max 50 questions / 20,000 characters. | inline | shorten |
| 410 | `AGENT_TEST_LINK_EXPIRED` | Lien de test expiré (24 h). | انتهت صلاحية رابط الاختبار (24 س). | Test link expired (24 h). | state | ask a new link |
| 404 | `AGENT_VERSION_NOT_FOUND` | Version introuvable. | الإصدار غير موجود. | Version not found. | toast | reload |
| 422 | `CONVERSATION_NO_AGENT` | Aucun agent sur cette page. | لا يوجد وكيل على هذه الصفحة. | No agent on this page. | menu item greyed (Mettre l'IA en pause / Reprendre l'IA) | link an agent to the page |
| 429 | `CHANNEL_SYNC_RATE_LIMITED` {retryAfter} | Synchronisation possible dans {retryAfter}. | المزامنة ممكنة بعد {retryAfter}. | Sync possible in {retryAfter}. | tooltip (disabled button) | wait; not emitted for the channel info sync, which answers `RATE_LIMITED` (api-contract §1.9) |
| 409 | `PRESET_ARCHIVED` | Préréglage archivé, choisissez-en un autre. | الإعداد المسبق مؤرشف، اختر آخر. | Preset archived, choose another. | inline (step 1) | pick |
| 422 | `PRESET_LOCALE_INCOMPLETE` {locales} | Complétez {locales} avant de publier. | أكمل {locales} قبل النشر. | Complete {locales} before publishing. | inline (admin) | translate |
| 409 | `PRESET_PUBLISHED_IMMUTABLE` | Un préréglage publié ne se supprime pas : archivez-le. | لا يُحذف الإعداد المنشور: أرشفه. | A published preset cannot be deleted: archive it. | toast (admin) | archive |
| — | `AGENT_CHANNEL_SWITCH_NEXT_THREAD` (info) | Le changement s'applique aux nouvelles conversations. | يُطبّق التغيير على المحادثات الجديدة. | The change applies to new conversations. | note in dialog / `meta.info` | — |

### 12.4 Catalogue, stock, GDS

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 422 | `VARIANT_LIMIT` | 100 variantes max par produit. | 100 متغيّر كحد أقصى لكل منتج. | Max 100 variants per product. | inline (generator) | reduce |
| 409 | `PRODUCT_HAS_ORDERS` {count} | Référencé par {count} commandes/ventes : archivez-le. | مرتبط بـ {count} طلبات/مبيعات: أرشفه. | Referenced by {count} orders/sales: archive it. | dialog (delete disabled) | archive |
| 422 | `CATEGORY_DEPTH_EXCEEDED` | 2 niveaux de catégories max. | مستويان من الفئات كحد أقصى. | Max 2 category levels. | inline | pick a root parent |
| 403 | `GDS_MOVEMENT_IMMUTABLE` | Journal immuable : corrigez par un nouvel ajustement. | السجل غير قابل للتعديل: صحّح بتعديل جديد. | Immutable ledger: correct with a new adjustment. | greyed menu item + tooltip | contre-passer |
| 409 | `INVENTORY_IN_PROGRESS` {number} | Inventaire {number} en cours : terminez-le d'abord. | الجرد {number} جارٍ: أنهِه أولًا. | Inventory {number} in progress: finish it first. | dialog | open the count |
| 422 | `INVENTORY_VARIANCE_NOTE_REQUIRED` | Note obligatoire pour un écart > 10 %. | الملاحظة إلزامية لفرق > 10 %. | Note required for a variance > 10 %. | inline (validate dialog) | add note |
| 404 | `INVENTORY_NOT_FOUND` | Inventaire introuvable. | الجرد غير موجود. | Inventory not found. | state | back |
| 409 | `SALE_BLOCKED_BY_INVENTORY` | Ventes comptoir bloquées pendant l'inventaire. | مبيعات المحل متوقفة أثناء الجرد. | Counter sales blocked during the inventory. | dialog state | finish the count |
| 429 | `RECO_RATE_LIMITED` {retryAfter} | Régénération possible dans {retryAfter} (1 fois / 10 min). | إعادة التوليد ممكنة بعد {retryAfter} (مرة كل 10 د). | Regeneration possible in {retryAfter} (1 per 10 min). | tooltip (disabled) | wait |
| 409 | `PURCHASE_ALREADY_RECEIVED` | Achat reçu : annulation impossible, corrigez le stock. | تم استلام الشراء: لا يمكن الإلغاء، صحّح المخزون. | Purchase received: cannot cancel, adjust stock instead. | greyed action + tooltip | adjust stock |
| 409 | `SUPPLIER_HAS_PURCHASES` {count} | {count} achats liés : désactivez le fournisseur. | {count} مشتريات مرتبطة: عطّل المورّد. | {count} linked purchases: deactivate the supplier. | dialog | deactivate |
| 409 | `SUPPLIER_ALREADY_EXISTS` {name} | Ce fournisseur existe déjà : {name} (même téléphone ou e-mail). | هذا المورّد موجود مسبقًا: {name} (نفس الهاتف أو البريد). | This supplier already exists: {name} (same phone or e-mail). | inline (phone / e-mail field) | open the existing supplier |
| 422 | `SALE_PARTIAL_REQUIRES_CUSTOMER` | Paiement partiel : identifiez le client. | دفع جزئي: حدّد العميل. | Partial payment: identify the client. | inline (client field) | pick client |
| 422 | `SALE_CANNOT_CANCEL_AFTER_7D` | Vente de plus de 7 jours : annulation impossible. | البيع أقدم من 7 أيام: لا يمكن الإلغاء. | Sale older than 7 days: cannot cancel. | greyed action + tooltip | adjustment + manual cash row |
| 422 | `SALE_IMMUTABLE` | Vente validée : annulez et refaites-la. | البيع مؤكّد: ألغِه وأعده. | Validated sale: cancel and redo. | toast | cancel + redo |
| 409 | `CASH_DAY_CLOSED` {date} | Journée du {date} clôturée. | يوم {date} مُقفل. | Day {date} is closed. | dialog (Rouvrir la journée, Admin+) | reopen (admin) |
| 422 | `CASH_ENTRY_EDIT_WINDOW_EXPIRED` | Ligne de plus de 24 h : ajoutez une correction. | السطر أقدم من 24 س: أضف تصحيحًا. | Row older than 24 h: add a correction row. | tooltip (disabled) | correction row |
| 200 ⚠ | `PURCHASE_OVER_RECEIVE` {ordered, received} (warning; the line quantity is raised to the received quantity) | Reçu > commandé ({received}/{ordered}) : le bon est complété. | المستلم > المطلوب ({received}/{ordered}): أُكمل أمر الشراء. | Received > ordered ({received}/{ordered}): purchase order completed. | inline warning (accepted) | — |

### 12.5 Orders, delivery, clients

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 422 | `ORDER_CALLBACK_IN_PAST` | Choisissez une heure à venir. | اختر وقتًا لاحقًا. | Pick a future time. | inline | — |
| 422 | `SHIPMENT_NOT_CREATED` | Pas de colis créé pour cette commande. | لا يوجد طرد لهذا الطلب. | No parcel created for this order. | row "ignorée" in labels dialog | send first |
| 409 | `COURIER_CANCEL_NOT_ALLOWED` | Colis déjà ramassé : annulation impossible, utilisez « Retournée ». | تم استلام الطرد: لا يمكن الإلغاء، استخدم «مرتجع». | Parcel already picked up: cannot cancel, use "Returned". | dialog | mark returned at reception |
| 409 | `COURIER_ADDRESS_LOCKED` | Adresse verrouillée : annulez le colis d'abord. | العنوان مقفل: ألغِ الطرد أولًا. | Address locked: cancel the parcel first. | dialog (Annuler le colis) | cancel parcel |
| 429 | `TRACKING_SYNC_RATE_LIMITED` {retryAfter} | Actualisation possible dans {retryAfter} (1 / 5 min). | التحديث ممكن بعد {retryAfter} (مرة كل 5 د). | Refresh possible in {retryAfter} (1 per 5 min). | disabled button "Limite 1 / 5 min" | wait |
| 409 | `CUSTOMER_MERGE_IRREVERSIBLE` | Fusion irréversible : confirmez. | الدمج لا رجعة فيه: أكّد. | Merge is irreversible: confirm. | dialog (confirm flag) | confirm |
| 409 | `CUSTOMER_HAS_ORDERS` {count} | {count} commandes : archivez plutôt le client. | {count} طلبات: أرشف العميل بدلًا من ذلك. | {count} orders: archive the client instead. | dialog (Archiver) | archive |
| 409 | `CUSTOMER_BLOCKED` {clientName} | Client bloqué : commande refusée. | العميل محظور: الطلب مرفوض. | Client blocked: order refused. | dialog (confirm flag, manual orders: re-send with `confirm=true`) · silent (AI) | unblock (Admin+) |
| 403 | `CUSTOMER_BLOCKED_BY_PLATFORM` | Bloqué par la plateforme : contestez via le support. | محظور من المنصة: اعترض عبر الدعم. | Blocked by the platform: contest through support. | tooltip (no Débloquer) | support |

### 12.6 Moderation, reports, support

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 409 | `MODERATION_APPEAL_ALREADY_USED` | Contestation déjà utilisée pour ce produit. | تم استخدام الاعتراض مسبقًا لهذا المنتج. | Appeal already used for this product. | button hidden / toast | resubmit |
| 410 | `MODERATION_APPEAL_WINDOW_EXPIRED` | Délai de contestation dépassé (7 j). | انتهت مهلة الاعتراض (7 أيام). | Appeal window expired (7 d). | state | resubmit |
| 409 | `MODERATION_ITEM_ALREADY_DECIDED` | Déjà traité par un autre modérateur. | تمت معالجته من مشرف آخر. | Already decided by another moderator. | toast (admin) + refresh | — |
| 422 | `MODERATION_REASON_REQUIRED` | Motif et message au marchand obligatoires. | السبب والرسالة إلى التاجر إلزاميان. | Reason and message to the merchant required. | inline (admin) | — |
| 422 | `MODERATION_REJECTED` | Produit refusé : modifiez-le et resoumettez. | المنتج مرفوض: عدّله وأعد إرساله. | Product rejected: edit and resubmit. | banner (product) | resubmit / appeal |
| 409 | `MODERATION_NOT_REJECTED` | Ce produit n'est pas refusé : rien à resoumettre. | هذا المنتج غير مرفوض: لا شيء لإعادة إرساله. | This product is not rejected: nothing to resubmit. | toast (action hidden normally) | reload |
| 409 | `ABUSE_REPORT_ALREADY_OPEN` | Signalement déjà en cours pour ce client. | يوجد بلاغ جارٍ عن هذا العميل. | A report is already open for this client. | dialog state | wait |
| 429 | `ABUSE_REPORT_RATE_LIMITED` | Trop de signalements aujourd'hui. | بلاغات كثيرة اليوم. | Too many reports today. | toast | tomorrow |
| 422 | `ABUSE_REPORT_SELF` | Vous ne pouvez pas signaler votre propre espace. | لا يمكنك الإبلاغ عن مساحتك. | You cannot report your own workspace. | toast | — |
| 409 | `TICKET_CLOSED` | Demande clôturée : ouvrez-en une nouvelle. | الطلب مغلق: افتح طلبًا جديدًا. | Ticket closed: open a new one. | state (ticket) | new ticket |

### 12.7 Settings, integrations, CMS, jobs, lists

| HTTP | Code | fr | ar | en | UI | Recovery |
|---|---|---|---|---|---|---|
| 422 | `WEBHOOK_URL_INVALID` | URL invalide (HTTPS obligatoire). | رابط غير صالح (HTTPS إلزامي). | Invalid URL (HTTPS required). | inline | — |
| 409 | `QUICK_REPLY_TITLE_TAKEN` | Titre déjà utilisé. | العنوان مستخدم مسبقًا. | Title already used. | inline | — |
| 422 | `CMS_LOCALE_MISSING` {locales} | Langue(s) manquante(s) : {locales}. Cochez « replier sur FR » ou traduisez. | لغات ناقصة: {locales}. فعّل «الرجوع إلى FR» أو ترجم. | Missing language(s): {locales}. Tick "fallback to FR" or translate. | inline (admin) | translate / fallback |
| 409 | `CMS_SLUG_TAKEN` | Slug déjà utilisé. | المعرّف مستخدم مسبقًا. | Slug already used. | inline | — |
| 500 | `REPORT_EXPORT_FAILED` {ref} | Export échoué (réf. {ref}). Réessayez. | فشل التصدير (مرجع {ref}). أعد المحاولة. | Export failed (ref. {ref}). Retry. | row state ÉCHEC + Réessayer | retry |
| 409 | `JOB_NOT_CANCELLABLE` | Tâche déjà terminée ou non annulable. | المهمة منتهية أو غير قابلة للإلغاء. | Job already finished or not cancellable. | toast | — |
| 409 | `SAVED_VIEW_NAME_TAKEN` | Une vue porte déjà ce nom. | يوجد عرض بهذا الاسم. | A view already has this name. | inline | rename |
| 403 | `SAVED_VIEW_SHARED_READONLY` | Vue partagée : dupliquez-la pour la modifier. | عرض مشترك: انسخه لتعديله. | Shared view: duplicate it to edit. | tooltip | duplicate |

### 12.8 Warnings added (non-blocking, `meta.warnings`)

Pointer rows only; each warning is defined once in the section named.

| Code | fr | ar | en | UI |
|---|---|---|---|---|
| `AGENT_READINESS` | see §11 | | | |
| `PURCHASE_OVER_RECEIVE` | see 12.4 | | | |
| `INVOICE_PARTIAL_PAYMENT` | see 12.2 | | | |
| `AGENT_CHANNEL_SWITCH_NEXT_THREAD` | see 12.3 | | | |

## 13. Canonical codes, aliases and Figma text fixes

The Figma frames and older spec drafts use a few codes that duplicate existing ones or contradict a spec value. **Canonical** = the code to implement and to write in Figma; the alias must not exist in code. This table is mirrored by `packages/shared/src/errors/aliases.ts`; no alias appears anywhere else in the docs or in API responses.

| Figma text (frame) | Canonical / correct value | Action in Figma |
|---|---|---|
| `USER_OWNS_WORKSPACE` (ADM-03, ADM-16, ADM-17, PUB deletion) | `ACCOUNT_OWNS_WORKSPACE` (§2) | rename |
| `TWO_FA_CODE_INVALID` (AUTH states, DLG Settings) | `AUTH_2FA_INVALID` (§2) | rename |
| `PLAN_AGENT_LIMIT` (AGT-02 step 5, MECH Agents) | `PLAN_LIMIT {resource: agents}` (§1) | rename |
| `ORDER_NOT_CONFIRMED` (ORD-05 v2 menu, AR frame) | `DELIVERY_ORDER_NOT_CONFIRMED` (§6) | rename |
| `ORDER_ALREADY_SHIPPED` (DLG Orders "Annuler la commande") | `DELIVERY_ORDER_ALREADY_SENT` (§6) | rename |
| `ORDER_NOT_SHIPPABLE` (MECH Delivery bulk results) | `DELIVERY_ORDER_ALREADY_SENT` when the order has an active shipment, else `DELIVERY_ORDER_NOT_CONFIRMED` (§6) | rename |
| `ORDER_STATUS_TRANSITION_INVALID` (DLG Orders "Changer le statut") | `ORDER_INVALID_TRANSITION` (§6) | rename |
| `COURIER_AUTH` (MECH Delivery filter) | `COURIER_CREDENTIALS_INVALID` (§6) | rename |
| `CASH_ENTRY_LOCKED` (GDS-09, DLG GDS II) | `CAISSE_EDIT_AUTOMATIC` (§7) | rename |
| `CATEGORY_NAME_TAKEN` (DLG GDS) | `CATEGORY_ALREADY_EXISTS` (§5) | rename |
| `PRICE_BELOW_COST` (DLG GDS "Prix en masse") | `SELLING_BELOW_COST` (§11 warning) | rename |
| `PURCHASE_OVER_RECEIPT_WARNING` (GDS-07) | `PURCHASE_OVER_RECEIVE` (warning `200 ⚠`, §12.4) | rename |
| `ANALYTICS_RANGE_TOO_LARGE` + "365 j" (ANA-02) | `REPORT_RANGE_TOO_LONG`, **732 d** (§7, 04 §8) | rename + fix value |
| `CHANNEL_DISCONNECT_CONFIRM` (MECH Channels) | not a code — dialog "Déconnecter la page" | remove code |
| `REPORT_RATE_LIMITED` / `REPORT_ALREADY_OPEN` / `REPORT_SELF` / `ABUSE_REPORT_DUPLICATE` (SAFE, coverage matrix) | `ABUSE_REPORT_RATE_LIMITED` / `ABUSE_REPORT_ALREADY_OPEN` / `ABUSE_REPORT_SELF` / `ABUSE_REPORT_ALREADY_OPEN` (§12.6); `REPORT_*` stays for the reports module | rename |
| `MODERATION_APPEAL_USED` (MOD appeal dialog) | `MODERATION_APPEAL_ALREADY_USED` (§12.6) | rename |
| `MODERATION_APPEAL_EXPIRED` (MOD appeal dialog) | `MODERATION_APPEAL_WINDOW_EXPIRED` (§12.6) | rename |
| `CUSTOMER_BLOCK_PLATFORM` (SAFE blocks list) | `CUSTOMER_BLOCKED_BY_PLATFORM` (§12.5) | rename |
| `IAP_ALREADY_CREDITED` (ADM-15 rules, MOB packs) | `IAP_RECEIPT_ALREADY_USED` (§12.2) | rename |
| `MAINTENANCE` (GLOBAL banner) | `MAINTENANCE_MODE` (§12.1) | rename |
| `WORKSPACE_READ_ONLY` (SET danger zone, GLOBAL) | not a code — mutations on `Workspace.status=deletion_scheduled` ⇒ `409 WORKSPACE_DELETION_SCHEDULED {at}` (§12.2) | rename |
| `ORDER_LIMIT_EXCEEDED` (AGT-02 step 3, INB thread) | not a code — the `create_order` AI tool returns the handoff hint `order_limit` (04 §18); never returned by the API | remove code |
| `MODERATION_PENDING` (CAT-08 pill) | not a code — pill `EN ATTENTE` = `Product.moderationStatus=pending` | remove code |
| `KNOWLEDGE_FILE_TOO_LARGE` (implicit, AGT-02 step 2) | `UPLOAD_TOO_LARGE {max: 5 MB}` | — |
| "Extraire depuis ma page Facebook (5 crédits)" (AGT-02 step 2), "Générer un agent … 10 crédits" (DLG Agents), "Extraire le catalogue … coûte des crédits" (MECH Channels) | page analysis and agent generation are **free, rate-limited 3/day** (D17) | fix text |
| "8 images max · ≤ 8 Mo · < 500 px" (CAT-09, DLG GDS II, DLG Inbox composer "8 Mo") | **10 images · 5 MB · 600 px** (CAT-02, INB-03) | fix values |
| "1 analyse / page / 24 h" (DLG Agents generate) | 3 / day / workspace (AGT-03, CHN-08) | fix text |
| "30 min de validité" reset link (AUTH states) | 60 min (AUTH-03) | fix text |
| Model shown as choice in AGT-02 step 4 frame ("3 · MODÈLE IA", "gpt-4o-mini · température 0,5") and old step names | 5 steps of D54; model read-only badge | redraw step labels |
| `CashEntry` / `Customer` / `AiProviderModel` / `CreditTransaction` / `CreditBalance` / `ReportJob` / `RecommendationJob` model names (several frames) | `CashTransaction` / `Client` / `AiModel` / `CreditLedger` / (balance = computed) / `Job(kind=export)` / `Job(kind=recommendations)` (05) | rename labels |
| Notification slugs on REF Deep-link map and ANA-01b filter: `order.created`, `order.needs_call`, `conversation.needs_human`, `credits.100`, `plan.expiring`, `plan.expired`, `page.needs_reconnect`, `page.approved`, `ai.provider_error`, `invitation.accepted`, `courier.unavailable`, `legal.reaccept_required`, `account.deletion_scheduled` | `order.ai_created`, `order.callback_due`, `conversation.handoff`, `credits.exhausted`, `subscription.expiring`, `subscription.expired`, `channel.needs_reconnect`, `channel.approved`, `ai.error`, `member.joined`, `shipment.failed` (data.reason=courier_unavailable), `legal.reacceptance_required`, `account.deletion_confirmed` (03 §15) | rename |
| Shipment status labels "created · picked_up" (MECH Delivery filter) | `created` → `sent`; `picked_up` is a valid status (pill RAMASSÉE = `Shipment.status=picked_up`); the full list is the `ShipmentStatus` enum (06 §10) | fix label |
| "Suivi actualisé toutes les 30 min par transporteur" (DLV-08) | DLV-04 cadence (2 h × 3 d, then 12 h, stale 30 d) | fix text |
| "Lien de paiement … expire 48 h" (DLG Orders II) | 15 min (PAY-02, 04 §6) | fix text |
| "Conversation supprimée restaurable 30 j" (DLG Inbox) | consistent with soft delete; purge with messages at 12 months (D28) | keep; note |
| `Workspace.targetMargin` (GDS-10 PRIX card), `Product.lowStockThreshold` | `Workspace.targetMarginPct` (default 35, Settings › Stock advanced mode) / `Product.minStock` (05) | rename labels |
| "Plan Starter" everywhere vs 02 §5 (free + plans from the API) | plan names are data (`Plan.name`) — no fix, but the free plan must exist | — |

## 14. Rendering additions

- **Greyed menu items**: the `Actions ⌄` menu footer shows the blocking code's `fr/ar/en` message (not the code) with the code in a tooltip for support.
- **Confirmation-flag codes** (`CUSTOMER_MERGE_IRREVERSIBLE`, `AGENT_PAUSED_WITH_OPEN_THREADS`, `CUSTOMER_BLOCKED` on manual orders, `WORKSPACE_DELETION_SCHEDULED` cancel): the 409 payload carries `data` for the dialog; the client re-sends with `confirm=true`.
- **Warnings** (`200 ⚠`): returned in `meta.warnings[]` with the same code and shown inline where the action happened; never a toast alone.
- **Admin-only codes** (`ADMIN_*`, `MODERATION_*` admin side, `PRESET_*`, `CMS_*`, `PLAN_SLUG_TAKEN`) are rendered in the admin shell only; the merchant never sees them.
