// 09-code-conventions §3.2 — quick replies (Settings › Réponses rapides).
import { z } from 'zod';
import { QUICK_REPLY_ACCEPTED, unknownVariables } from './template-variables';

/** journey J09-12: an unknown `{…}` (« {inconnu} », « {PRODUCT} ») is refused like in the system messages. */
export const QuickReplyBody = z
  .string()
  .trim()
  .min(1, 'validation.required')
  .max(1000, 'validation.length')
  .refine((v) => !unknownVariables(v, QUICK_REPLY_ACCEPTED).length, 'validation.unknownVariable');
export const CreateQuickReplySchema = z
  .object({
    title: z.string().trim().min(1, 'validation.required').max(80, 'validation.length'),
    body: QuickReplyBody,
    /** '' and null both mean "no shortcut" (forms send the empty input as is) */
    shortcut: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .regex(/^\/[a-z0-9-]{1,29}$/, 'validation.shortcut'),
      ])
      .optional()
      .nullable(),
    locale: z.enum(['fr', 'ar', 'en']),
  })
  .strict();
export const UpdateQuickReplySchema = CreateQuickReplySchema.partial().strict();
export const ReorderQuickRepliesSchema = z.object({ ids: z.array(z.string().uuid()).min(1) }).strict();
export type CreateQuickReply = z.infer<typeof CreateQuickReplySchema>;
export type UpdateQuickReply = z.infer<typeof UpdateQuickReplySchema>;
export const QuickReplyView = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  shortcut: z.string().nullable(),
  locale: z.enum(['fr', 'ar', 'en']),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuickReplyView = z.infer<typeof QuickReplyView>;
