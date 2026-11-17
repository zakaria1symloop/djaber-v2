// Workspace, members and settings forms (03 §20 SET, api-contract §3.2).
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';
import { email, isPhoneDz, normalizePhoneDz } from '../validators';

export const workspaceName = z.string().trim().min(2, 'validation.required').max(80, 'validation.length');
/** Select value: '' = none, otherwise the wilaya id (1–69). */
const wilayaSelect = z.string().refine((v) => v === '' || (/^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= WILAYA_COUNT), 'validation.wilaya');

/** `POST /workspaces` form — invited-only user creating the single workspace they may own (D30). */
export const CreateWorkspaceSchema = z.object({
  name: workspaceName,
  senderWilayaId: wilayaSelect,
  stockMode: z.enum(['simple', 'advanced']),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

/** `PATCH /workspace` form (Settings › Espace de travail). Text inputs stay strings; the page converts them. */
export const WorkspaceProfileSchema = z.object({
  name: workspaceName,
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || isPhoneDz(normalizePhoneDz(v)), 'validation.phone'),
  address: z.string().trim().max(500, 'validation.length'),
  senderWilayaId: wilayaSelect,
  locale: z.enum(['fr', 'ar', 'en']),
  autoPauseOnManualReply: z.boolean(),
  // journey J12-10.2: an emptied field says « Champ requis » (it said « Valeur hors limites (0–1440) » under an empty field);
  // « -5 » (kept by the NumberInput as an invalid value, J12-2) is out of range
  handoffReminderMin: z
    .string()
    .superRefine((v, ctx) => {
      if (v === '') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.required' });
      else if (!/^\d{1,4}$/.test(v) || Number(v) > 1440) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.range' });
    }),
  // journey J12-2: « -5 » is refused with the field error (an emptied field = no free delivery, the hint says so); it was
  // turned into an empty field and saved as « no threshold »
  freeDeliveryThreshold: z.string().refine((v) => v === '' || /^\d{1,9}$/.test(v), 'validation.price'),
});
export type WorkspaceProfileInput = z.infer<typeof WorkspaceProfileSchema>;

export const InviteMemberSchema = z.object({ email, role: z.enum(['admin', 'operator']) });
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const SYSTEM_MESSAGE_KEYS = ['handoff', 'out_of_hours', 'out_of_stock', 'welcome'] as const;
export type SystemMessageKey = (typeof SYSTEM_MESSAGE_KEYS)[number];
const localized = z.object({
  fr: z.string().max(1000, 'validation.length'),
  ar: z.string().max(1000, 'validation.length'),
  en: z.string().max(1000, 'validation.length'),
});
/** `PUT /workspace/system-messages` — exactly 4 keys × 3 locales (11 §9.1); empty `welcome` ⇒ not sent. */
export const SystemMessagesSchema = z.object({ handoff: localized, out_of_hours: localized, out_of_stock: localized, welcome: localized });
export type SystemMessagesInput = z.infer<typeof SystemMessagesSchema>;
