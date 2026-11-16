// 04-business-rules §2 — shared validators (API, web, mobile, AI tools). Messages are i18n keys.
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';

/** Normalises +213 / 00213 / spaces / dots / dashes to the national form `0XXXXXXXXX`. */
export const normalizePhoneDz = (raw: string): string => {
  // full-test 15/11 SETTINGS-03: Arabic-Indic digits (٠٦٩٩…, ۰۶۹۹…) read as Latin digits — a blocked « ٠٦٩٩٩٩٩٩٠١ » blocked nobody
  let p = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s.\-()]/g, '');
  if (p.startsWith('+213')) p = '0' + p.slice(4);
  else if (p.startsWith('00213')) p = '0' + p.slice(5);
  else if (p.startsWith('213') && p.length >= 12) p = '0' + p.slice(3);
  return p;
};

export const isPhoneDz = (normalized: string) =>
  /^0[5-7]\d{8}$/.test(normalized) || /^0[2-4]\d{7}$/.test(normalized);

export const phoneDz = z.string().transform(normalizePhoneDz).refine(isPhoneDz, 'validation.phone');

export const fullName = z
  .string()
  .trim()
  .min(3, 'validation.name')
  .max(80, 'validation.name')
  .regex(/^[\p{L}\p{N} '\-.]+$/u, 'validation.name')
  .refine((v) => (v.match(/\p{L}/gu) ?? []).length >= 2, 'validation.name');

export const wilayaCode = z.coerce
  .number()
  .int()
  .min(1, 'validation.wilaya')
  .max(WILAYA_COUNT, 'validation.wilaya');
export const communeText = z.string().trim().min(1, 'validation.commune').max(100, 'validation.commune');
export const addressHome = z.string().trim().min(10, 'validation.address').max(500, 'validation.address');
/** Email as the API stores it (same transform as `email`): `'  Zak@Boutique.DZ '` ⇒ `'zak@boutique.dz'`. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export const email = z
  .string()
  .trim()
  .toLowerCase()
  // full-test 15/11 PUBLIC-15: an empty e-mail is « Champ requis », like the other required fields of the same forms
  .min(1, 'validation.required')
  .max(254, 'validation.email')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'validation.email');
export const sellingPrice = z.coerce.number().int('validation.price').gt(0, 'validation.price');
export const costPrice = z.coerce.number().int('validation.price').min(0, 'validation.price');
export const money = z.coerce.number().int('validation.price').min(0, 'validation.price');
export const lineQuantity = z.coerce.number().int('validation.quantity').min(1, 'validation.quantity');
export const stockQuantity = z.coerce.number().int('validation.quantity').min(0, 'validation.quantity');
export const percentage = z.coerce
  .number()
  .int('validation.range')
  .min(0, 'validation.range')
  .max(100, 'validation.range');
export const sku = z.string().trim().min(1, 'validation.length').max(255, 'validation.length');
export const replyText = z.string().trim().min(1, 'validation.length').max(2000, 'validation.length');

/** Dates of business documents may not be more than one day in the future. */
export const businessDate = z.coerce
  .date()
  .refine((d) => d.getTime() <= Date.now() + 24 * 3600 * 1000, 'validation.date');

/** Password: 8 chars min, at least one letter and one digit (11 AUTH_PASSWORD_WEAK). */
export const password = z
  .string()
  .min(8, 'validation.password')
  .max(128, 'validation.password')
  .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), 'validation.password');

export const uuid = z.string().uuid('validation.id');
export const localeSchema = z.enum(['fr', 'ar', 'en']);
export const shortText = (max = 120) =>
  z.string().trim().min(1, 'validation.length').max(max, 'validation.length');
export const optionalText = (max = 1000) =>
  z.string().trim().max(max, 'validation.length').optional().nullable();
export const httpsUrl = z
  .string()
  .trim()
  .max(2048, 'validation.url')
  .regex(/^https:\/\/[^\s]+$/, 'validation.url');
