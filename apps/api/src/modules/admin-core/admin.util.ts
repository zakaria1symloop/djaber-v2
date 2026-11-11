// Shared helpers of the platform admin core (M10, api-a): actor, reason rule, masking, small presenters.
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ADMIN_REASON_MIN, type AdminUserRef } from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';

export type AdminActor = { userId: string; platformRole: string; ip: string | null; userAgent: string | null };

/** The platform user behind an `/admin/*` request (role read from the database by the TenantGuard, not from the JWT). */
export const Admin = createParamDecorator((_d: unknown, ctx: ExecutionContext): AdminActor => {
  const req = ctx.switchToHttp().getRequest();
  const t = TenantContext.maybe();
  return { userId: req.user?.id, platformRole: t?.platformRole ?? req.user?.platformRole ?? 'none', ip: req.ip ?? null, userAgent: (req.headers?.['user-agent'] as string | undefined)?.slice(0, 300) ?? null };
});

/** 06 §9: every admin write touching a merchant carries a reason ≥ 10 chars (`422 ADMIN_REASON_REQUIRED`, `fields.reason`). */
export const requireReason = (r: string | null | undefined, field = 'reason'): string => {
  const v = (r ?? '').trim();
  if (v.length < ADMIN_REASON_MIN) throw new AppException('ADMIN_REASON_REQUIRED', {}, { [field]: 'validation.length' });
  return v;
};

export const assertUuid = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound();
  return id;
};

export { maskName, maskPhone, maskText } from '../../core/privacy/mask';
export const maskEmail = (e: string): string => {
  const [u, d] = e.split('@');
  return `${(u ?? '').slice(0, 1)}•••@${d ?? ''}`;
};

export const userRef = (u: { id: string; firstName: string; lastName: string; email: string; avatarUrl?: string | null } | null | undefined): AdminUserRef | null =>
  u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, avatarUrl: u.avatarUrl ?? null } : null;
export const userSelect = { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } as const;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const DAY = 86_400_000;

/** `{ fr, ar?, en? }` input ⇒ stored JSON with the three keys. */
export const toLocalized = (v: { fr: string; ar?: string; en?: string } | undefined | null) => (v ? { fr: v.fr, ar: v.ar ?? '', en: v.en ?? '' } : undefined);
export const fromLocalized = (v: unknown): { fr: string; ar: string; en: string } => {
  if (typeof v === 'string') return { fr: v, ar: '', en: '' };
  const o = (v ?? {}) as Record<string, unknown>;
  return { fr: String(o.fr ?? ''), ar: String(o.ar ?? ''), en: String(o.en ?? '') };
};
/** Language the admin is viewed in (request `Accept-Language`), French by default. */
export const adminLocale = (): 'fr' | 'ar' | 'en' => TenantContext.maybe()?.requestLocale ?? 'fr';
/** Localized name in the admin's language, French when that translation is empty. */
export const pickLocal = (v: unknown) => {
  const l = fromLocalized(v);
  return l[adminLocale()] || l.fr;
};
/** Name of the free plan when a workspace has no subscription row. */
export const freePlanName = () => pickLocal({ fr: 'Gratuit', ar: 'مجاني', en: 'Free' });

/** Africa/Algiers day `YYYY-MM-DD` of an instant. */
export const algiersDay = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
