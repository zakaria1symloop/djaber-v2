// 03-events-and-jobs §5.3 — transactional e-mails as plain TypeScript functions (fr / ar / en, RTL for ar).
// Names follow the catalogue: `auth/verify`, `auth/reset`, `workspace/invitation`, …
import { formatMessage, isAppLocale, type AppLocale } from '@djaber/shared';

export type MailTemplateName =
  | 'auth/verify'
  | 'auth/verify-reminder'
  | 'auth/reset'
  | 'auth/email-change'
  | 'auth/email-change-notice'
  | 'auth/account-deletion-confirm'
  /** PUB-06 / FL-22 1b (M11): confirmation link of the public deletion page, 24 h */
  | 'auth/account-deletion-request'
  | 'workspace/invitation'
  | 'workspace/ownership-transferred'
  | 'workspace/deletion-scheduled'
  | 'workspace/deleted'
  /** 03-events §4 `sched-report-schedules`: monthly report e-mail (D62) */
  | 'reports/scheduled'
  /** PRM-03: admin credit gesture, e-mail to the Owner (M9) */
  | 'billing/credits-granted'
  | 'billing/credits-removed'
  /** 03-events §5.3 generic "notification/<type>" layout: title, body, CTA deep link (the type rides in params.type) */
  | 'notification'
  /** OPS-06 (M10): public status page subscription — confirmation link, then incident updates */
  | 'status/subscribe-confirm'
  | 'status/incident'
  /** 04 §13 (M10): abuse report acknowledged at once / decided (end customers without an account, merchant reporters) */
  | 'reports/acknowledged'
  | 'reports/resolved';

type L = Record<AppLocale, string>;
type Copy = { subject: L; title: L; body: L; cta?: L; footer?: L };

const l = (fr: string, ar: string, en: string): L => ({ fr, ar, en });

const COPY: Record<MailTemplateName, Copy> = {
  notification: {
    subject: l('{title}', '{title}', '{title}'),
    title: l('{title}', '{title}', '{title}'),
    body: l('{body}', '{body}', '{body}'),
    cta: l('Ouvrir dans Djaber', 'فتح في جابر', 'Open in Djaber'),
  },
  'billing/credits-granted': {
    subject: l('{credits} crédits ajoutés à {workspaceName}', 'تمت إضافة {credits} رصيد إلى {workspaceName}', '{credits} credits added to {workspaceName}'),
    title: l('{credits} crédits offerts', '{credits} رصيد هدية', '{credits} credits added'),
    body: l(
      'L’équipe Djaber a ajouté {credits} crédits à votre espace {workspaceName}. Motif : {reason}. Ils s’ajoutent aux crédits de votre période en cours.',
      'أضاف فريق جابر {credits} رصيد إلى مساحتك {workspaceName}. السبب: {reason}. تُضاف إلى أرصدة فترتك الحالية.',
      'The Djaber team added {credits} credits to your workspace {workspaceName}. Reason: {reason}. They come on top of the credits of your current period.',
    ),
    cta: l('Voir mes crédits', 'عرض أرصدتي', 'See my credits'),
  },
  // tester log 26/10 UX-040: a removal is told like a grant
  'billing/credits-removed': {
    subject: l('{credits} crédits retirés de {workspaceName}', 'تم سحب {credits} رصيد من {workspaceName}', '{credits} credits removed from {workspaceName}'),
    title: l('{credits} crédits retirés par Djaber', 'سحب جابر {credits} رصيد', '{credits} credits removed by Djaber'),
    body: l(
      'L’équipe Djaber a retiré {credits} crédits de votre espace {workspaceName}. Motif : {reason}. Ils sont déduits des crédits de votre période en cours ; vos packs achetés ne sont pas touchés. Le détail est dans l’historique de vos crédits.',
      'سحب فريق جابر {credits} رصيد من مساحتك {workspaceName}. السبب: {reason}. تُخصم من أرصدة فترتك الحالية؛ الباقات التي اشتريتها لا تتأثر. التفاصيل في سجل أرصدتك.',
      'The Djaber team removed {credits} credits from your workspace {workspaceName}. Reason: {reason}. They are taken from the credits of your current period; the packs you bought are not touched. The details are in your credits history.',
    ),
    cta: l('Voir l’historique des crédits', 'عرض سجل الأرصدة', 'See the credits history'),
  },
  'auth/verify': {
    subject: l('Vérifiez votre e-mail', 'تحقق من بريدك الإلكتروني', 'Verify your e-mail'),
    title: l('Bienvenue sur Djaber, {firstName}', 'مرحبًا بك في جابر، {firstName}', 'Welcome to Djaber, {firstName}'),
    body: l(
      'Confirmez votre adresse e-mail pour connecter vos pages Facebook et Instagram. Ce lien est valable 24 heures.',
      'أكّد بريدك الإلكتروني لربط صفحاتك على فيسبوك وإنستغرام. هذا الرابط صالح لمدة 24 ساعة.',
      'Confirm your e-mail address to connect your Facebook and Instagram pages. This link is valid for 24 hours.',
    ),
    cta: l('Vérifier mon e-mail', 'تحقق من بريدي', 'Verify my e-mail'),
  },
  'auth/verify-reminder': {
    subject: l('Rappel : vérifiez votre e-mail', 'تذكير: تحقق من بريدك الإلكتروني', 'Reminder: verify your e-mail'),
    title: l('Votre e-mail n’est pas encore vérifié', 'لم يتم التحقق من بريدك بعد', 'Your e-mail is not verified yet'),
    body: l(
      'Sans vérification, vous ne pouvez pas connecter de page. Ce lien est valable 24 heures.',
      'بدون التحقق لا يمكنك ربط أي صفحة. هذا الرابط صالح لمدة 24 ساعة.',
      'Without verification you cannot connect a page. This link is valid for 24 hours.',
    ),
    cta: l('Vérifier mon e-mail', 'تحقق من بريدي', 'Verify my e-mail'),
  },
  'auth/reset': {
    subject: l('Réinitialisez votre mot de passe', 'إعادة تعيين كلمة المرور', 'Reset your password'),
    title: l('Mot de passe oublié ?', 'هل نسيت كلمة المرور؟', 'Forgot your password?'),
    body: l(
      'Cliquez sur le bouton pour choisir un nouveau mot de passe. Ce lien est valable 60 minutes et ne peut servir qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.',
      'اضغط على الزر لاختيار كلمة مرور جديدة. هذا الرابط صالح لمدة 60 دقيقة ويُستعمل مرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة.',
      'Click the button to choose a new password. This link is valid for 60 minutes and can be used once. If you did not ask for it, ignore this e-mail.',
    ),
    cta: l('Choisir un nouveau mot de passe', 'اختيار كلمة مرور جديدة', 'Choose a new password'),
  },
  'auth/email-change': {
    subject: l('Confirmez votre nouvelle adresse e-mail', 'أكّد بريدك الإلكتروني الجديد', 'Confirm your new e-mail address'),
    title: l('Changement d’adresse e-mail', 'تغيير البريد الإلكتروني', 'E-mail address change'),
    body: l(
      'Confirmez {newEmail} comme nouvelle adresse de connexion. Ce lien est valable 24 heures.',
      'أكّد {newEmail} كبريد جديد لتسجيل الدخول. هذا الرابط صالح لمدة 24 ساعة.',
      'Confirm {newEmail} as your new sign-in address. This link is valid for 24 hours.',
    ),
    cta: l('Confirmer la nouvelle adresse', 'تأكيد البريد الجديد', 'Confirm the new address'),
  },
  'auth/email-change-notice': {
    subject: l('Changement d’adresse e-mail demandé', 'طلب تغيير البريد الإلكتروني', 'E-mail address change requested'),
    title: l('Changement d’adresse e-mail demandé', 'طلب تغيير البريد الإلكتروني', 'E-mail address change requested'),
    body: l(
      'Une demande de changement vers {newEmail} a été faite sur votre compte. Si ce n’est pas vous, changez votre mot de passe immédiatement.',
      'تم طلب تغيير بريد حسابك إلى {newEmail}. إن لم تكن أنت فغيّر كلمة المرور فورًا.',
      'A change to {newEmail} was requested on your account. If this was not you, change your password immediately.',
    ),
  },
  'auth/account-deletion-request': {
    subject: l('Confirmez la suppression de votre compte Djaber', 'أكّد حذف حسابك على جابر', 'Confirm the deletion of your Djaber account'),
    title: l('Suppression du compte', 'حذف الحساب', 'Account deletion'),
    body: l(
      'Vous avez demandé la suppression de votre compte. Confirmez avec le bouton ci-dessous (lien valable 24 heures). Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.',
      'طلبت حذف حسابك. أكّد بالزر أدناه (الرابط صالح 24 ساعة). إذا لم تكن صاحب هذا الطلب، تجاهل هذه الرسالة.',
      'You asked to delete your account. Confirm with the button below (link valid 24 hours). If you did not make this request, ignore this e-mail.',
    ),
    cta: l('Confirmer la suppression', 'تأكيد الحذف', 'Confirm the deletion'),
  },
  'auth/account-deletion-confirm': {
    subject: l('Suppression de votre compte programmée', 'تمت برمجة حذف حسابك', 'Your account deletion is scheduled'),
    title: l('Compte désactivé', 'تم تعطيل الحساب', 'Account deactivated'),
    body: l(
      'Votre compte sera supprimé définitivement le {scheduledAt}. Pour annuler, connectez-vous avant cette date.',
      'سيُحذف حسابك نهائيًا في {scheduledAt}. للإلغاء، سجّل الدخول قبل هذا التاريخ.',
      'Your account will be permanently deleted on {scheduledAt}. To cancel, sign in before that date.',
    ),
    cta: l('Annuler (se connecter)', 'إلغاء (تسجيل الدخول)', 'Cancel (sign in)'),
  },
  'workspace/invitation': {
    subject: l('{inviterName} vous invite sur {workspaceName}', '{inviterName} يدعوك إلى {workspaceName}', '{inviterName} invites you to {workspaceName}'),
    title: l('Invitation à rejoindre {workspaceName}', 'دعوة للانضمام إلى {workspaceName}', 'Invitation to join {workspaceName}'),
    body: l(
      '{inviterName} vous invite à rejoindre l’espace {workspaceName} sur Djaber avec le rôle {role}. Cette invitation est valable 7 jours.',
      '{inviterName} يدعوك للانضمام إلى مساحة {workspaceName} على جابر بدور {role}. هذه الدعوة صالحة لمدة 7 أيام.',
      '{inviterName} invites you to join the {workspaceName} workspace on Djaber as {role}. This invitation is valid for 7 days.',
    ),
    cta: l('Accepter l’invitation', 'قبول الدعوة', 'Accept the invitation'),
  },
  'workspace/ownership-transferred': {
    subject: l('Propriété de {workspaceName} transférée', 'تم نقل ملكية {workspaceName}', 'Ownership of {workspaceName} transferred'),
    title: l('Transfert de propriété', 'نقل الملكية', 'Ownership transfer'),
    body: l(
      '{newOwnerName} est désormais propriétaire de l’espace {workspaceName}. {oldOwnerName} devient administrateur.',
      '{newOwnerName} هو الآن مالك مساحة {workspaceName}. أصبح {oldOwnerName} مديرًا.',
      '{newOwnerName} is now the owner of the {workspaceName} workspace. {oldOwnerName} becomes an admin.',
    ),
    cta: l('Voir les membres', 'عرض الأعضاء', 'View members'),
  },
  'workspace/deletion-scheduled': {
    subject: l('Suppression de {workspaceName} programmée', 'تمت برمجة حذف {workspaceName}', 'Deletion of {workspaceName} scheduled'),
    title: l('Suppression programmée', 'حذف مبرمج', 'Deletion scheduled'),
    body: l(
      'L’espace {workspaceName} sera supprimé définitivement le {at}. Vous pouvez annuler la suppression jusqu’à cette date depuis Paramètres › Zone de danger.',
      'ستُحذف مساحة {workspaceName} نهائيًا في {at}. يمكنك إلغاء الحذف حتى هذا التاريخ من الإعدادات › منطقة الخطر.',
      'The {workspaceName} workspace will be permanently deleted on {at}. You can cancel the deletion until then from Settings › Danger zone.',
    ),
    cta: l('Annuler la suppression', 'إلغاء الحذف', 'Cancel the deletion'),
  },
  'reports/scheduled': {
    subject: l('Rapport mensuel : {report} — {period}', 'التقرير الشهري: {report} — {period}', 'Monthly report: {report} — {period}'),
    title: l('{report} · {period}', '{report} · {period}', '{report} · {period}'),
    body: l('Votre rapport « {report} » de {workspaceName} pour {period} est prêt : {delivery}.', 'تقريرك « {report} » لـ {workspaceName} عن {period} جاهز: {delivery}.', 'Your “{report}” report for {workspaceName}, {period}, is ready: {delivery}.'),
    cta: l('Ouvrir le rapport dans Djaber', 'فتح التقرير في جابر', 'Open the report in Djaber'),
  },
  'status/subscribe-confirm': {
    subject: l('Confirmez votre abonnement au statut Djaber', 'أكّد اشتراكك في حالة خدمات جابر', 'Confirm your Djaber status subscription'),
    title: l('Suivre l’état des services Djaber', 'متابعة حالة خدمات جابر', 'Follow the status of Djaber services'),
    body: l(
      'Confirmez votre adresse pour recevoir un e-mail à chaque incident et à sa résolution. Vous pourrez vous désabonner à tout moment.',
      'أكّد عنوانك لتتلقى رسالة عند كل حادث وعند حله. يمكنك إلغاء الاشتراك في أي وقت.',
      'Confirm your address to receive an e-mail for every incident and its resolution. You can unsubscribe at any time.',
    ),
    cta: l('Confirmer l’abonnement', 'تأكيد الاشتراك', 'Confirm the subscription'),
  },
  'status/incident': {
    subject: l('[Statut Djaber] {title}', '[حالة جابر] {title}', '[Djaber status] {title}'),
    title: l('{title}', '{title}', '{title}'),
    body: l('{status} — {body}', '{status} — {body}', '{status} — {body}'),
    cta: l('Voir la page de statut', 'عرض صفحة الحالة', 'Open the status page'),
  },
  'reports/acknowledged': {
    subject: l('Signalement reçu', 'تم استلام البلاغ', 'Report received'),
    title: l('Merci pour votre signalement', 'شكرًا على بلاغك', 'Thank you for your report'),
    body: l(
      'Djaber a bien reçu votre signalement et l’examinera sous 24 heures. Vous serez informé de la décision.',
      'استلم جابر بلاغك وسيدرسه خلال 24 ساعة. سيتم إعلامك بالقرار.',
      'Djaber received your report and will review it within 24 hours. You will be told about the decision.',
    ),
  },
  'reports/resolved': {
    subject: l('Votre signalement a été traité', 'تمت معالجة بلاغك', 'Your report has been handled'),
    title: l('Signalement traité', 'تمت معالجة البلاغ', 'Report handled'),
    body: l('Décision de l’équipe Djaber : {decision}.', 'قرار فريق جابر: {decision}.', 'Decision of the Djaber team: {decision}.'),
  },
  'workspace/deleted': {
    subject: l('Espace {workspaceName} supprimé', 'تم حذف مساحة {workspaceName}', 'Workspace {workspaceName} deleted'),
    title: l('Espace supprimé', 'تم حذف المساحة', 'Workspace deleted'),
    body: l(
      'L’espace {workspaceName} et ses données ont été supprimés définitivement.',
      'تم حذف مساحة {workspaceName} وبياناتها نهائيًا.',
      'The {workspaceName} workspace and its data have been permanently deleted.',
    ),
  },
};

const ROLE_LABEL: Record<string, L> = {
  owner: l('Propriétaire', 'مالك', 'Owner'),
  admin: l('Administrateur', 'مدير', 'Admin'),
  operator: l('Opérateur', 'موظف', 'Operator'),
};

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `11 oct. 2026 14:05` in Africa/Algiers (08-coder-playbook §6 "Date / time display"), Latin digits. */
export const formatMailDate = (iso: string, locale: AppLocale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR', {
    timeZone: 'Africa/Algiers',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export type RenderedMail = { subject: string; html: string; text: string };

export const isMailTemplate = (name: string): name is MailTemplateName => name in COPY;

/**
 * `params.url` is the call-to-action link; `*At` params are ISO dates rendered in Africa/Algiers;
 * `role` is a MemberRole rendered with its label.
 */
export const renderMail = (name: MailTemplateName, localeIn: string, paramsIn: Record<string, unknown>): RenderedMail => {
  const locale: AppLocale = isAppLocale(localeIn) ? localeIn : 'fr';
  const copy = COPY[name];
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(paramsIn)) {
    if (v === null || v === undefined) continue;
    if (k === 'role' && typeof v === 'string') params[k] = ROLE_LABEL[v]?.[locale] ?? v;
    else if ((k === 'at' || k.endsWith('At')) && typeof v === 'string') params[k] = formatMailDate(v, locale);
    else params[k] = String(v);
  }
  const t = (m: L) => formatMessage(m[locale], params);
  const subject = t(copy.subject);
  const title = t(copy.title);
  const body = t(copy.body);
  const url = typeof paramsIn.url === 'string' ? paramsIn.url : undefined;
  const cta = copy.cta && url ? t(copy.cta) : undefined;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f5f6f8;font-family:${locale === 'ar' ? "'Changa'," : ''}Arial,Helvetica,sans-serif;color:#14171f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:28px 32px 0;font-size:20px;font-weight:700;">Djaber</td></tr>
        <tr><td style="padding:20px 32px 0;font-size:18px;font-weight:700;">${esc(title)}</td></tr>
        <tr><td style="padding:12px 32px 0;font-size:14px;line-height:22px;">${esc(body)}</td></tr>
        ${
          cta && url
            ? `<tr><td style="padding:24px 32px 0;"><a href="${esc(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 20px;border-radius:8px;">${esc(cta)}</a></td></tr>
        <tr><td style="padding:12px 32px 0;font-size:12px;line-height:18px;color:#6b7280;word-break:break-all;"><span dir="ltr">${esc(url)}</span></td></tr>`
            : ''
        }
        <tr><td style="padding:28px 32px 28px;font-size:12px;color:#6b7280;">© Djaber</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [title, '', body, ...(url ? ['', cta ? `${cta}: ${url}` : url] : [])].join('\n');
  return { subject, html, text };
};
