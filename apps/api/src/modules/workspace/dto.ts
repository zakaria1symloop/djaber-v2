// Request DTOs of the workspace module (zod → nestjs-zod). Shapes follow api-contract §3.2 and 06-api "Workspace & team".
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { email, localeSchema, phoneDz, WILAYA_COUNT, MEMBER_SECTIONS } from '@djaber/shared';

const name = z.string().trim().min(1, 'validation.required').max(120, 'validation.length');
const currentPassword = z.string().min(1, 'validation.required').max(128, 'validation.length');
const totpCode = z.string().trim().max(12, 'validation.length').optional().nullable();

// --- workspace -------------------------------------------------------------------------------------------------------
export const CreateWorkspaceSchema = z
  .object({
    name,
    senderWilayaId: z.number().int().min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya').optional().nullable(),
    stockMode: z.enum(['simple', 'advanced']).optional(),
    locale: localeSchema.optional(),
  })
  .strict();
export class CreateWorkspaceDto extends createZodDto(CreateWorkspaceSchema) {}

export const UpdateWorkspaceSchema = z
  .object({
    name: name.optional(),
    phone: phoneDz.nullable().optional(),
    address: z.string().trim().max(500, 'validation.length').nullable().optional(),
    senderWilayaId: z.number().int().min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya').nullable().optional(),
    locale: localeSchema.optional(),
    stockMode: z.enum(['simple', 'advanced']).optional(),
    freeDeliveryThreshold: z.number().int('validation.price').min(0, 'validation.price').max(100_000_000, 'validation.price').nullable().optional(),
    autoPauseOnManualReply: z.boolean().optional(),
    handoffReminderMin: z.number().int('validation.range').min(0, 'validation.range').max(1440, 'validation.range').optional(),
    targetMarginPct: z.number().int('validation.range').min(0, 'validation.range').max(100, 'validation.range').optional(),
    /** DLV-05 / D9: a confirmed order is sent to the default courier automatically */
    autoSendToCourier: z.boolean().optional(),
    /** PAY-02 / 03 §20 (M9): online payment of orders through Chargily (payment links, AI tool `create_payment_link`) */
    onlinePaymentEnabled: z.boolean().optional(),
    /** id returned by `POST /uploads { kind: 'logo' }`; null removes the logo */
    logoUploadId: z.string().uuid('validation.id').nullable().optional(),
    /** optimistic concurrency (api-contract §1.8): stale ⇒ 409 CONFLICT { current } */
    version: z.number().int().min(1).optional(),
  })
  .strict();
export class UpdateWorkspaceDto extends createZodDto(UpdateWorkspaceSchema) {}
export type UpdateWorkspace = z.infer<typeof UpdateWorkspaceSchema>;

export const OnboardingSchema = z
  .object({
    /** 1–6 = tunnel steps (ONB-01), 99 = "Passer la configuration" */
    step: z
      .number()
      .int('validation.range')
      .refine((n) => (n >= 0 && n <= 6) || n === 99, 'validation.range'),
  })
  .strict();
export class OnboardingDto extends createZodDto(OnboardingSchema) {}

export const DeleteWorkspaceSchema = z.object({ password: currentPassword, confirmName: z.string().trim().min(1, 'validation.required').max(120) }).strict();
export class DeleteWorkspaceDto extends createZodDto(DeleteWorkspaceSchema) {}

export const TransferOwnershipSchema = z
  .object({ newOwnerUserId: z.string().uuid('validation.id'), password: currentPassword, totpCode })
  .strict();
export class TransferOwnershipDto extends createZodDto(TransferOwnershipSchema) {}

// --- members & invitations ---------------------------------------------------------------------------------------------
const csv = <T extends [string, ...string[]]>(values: T) =>
  z
    .preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.enum(values)))
    .optional();

export const MembersQuerySchema = z.object({
  role: csv(['owner', 'admin', 'operator']),
  state: csv(['active', 'invited', 'read_only']),
  q: z.string().trim().max(120).optional(),
});
export class MembersQueryDto extends createZodDto(MembersQuerySchema) {}
export type MembersQuery = z.infer<typeof MembersQuerySchema>;

const invitableRole = z.enum(['admin', 'operator'], { errorMap: () => ({ message: 'validation.invalid' }) });
export const InviteSchema = z.object({ email, role: invitableRole }).strict();
export class InviteDto extends createZodDto(InviteSchema) {}

/** `owner` is accepted by the schema so the service can answer OWNER_IMMUTABLE instead of a bare validation error. */
/** `PATCH /workspace/members/:id` — the role and / or the sections hidden from the member (owner decision 2026-10-21). */
export const ChangeRoleSchema = z
  .object({
    role: z.enum(['owner', 'admin', 'operator'], { errorMap: () => ({ message: 'validation.invalid' }) }).optional(),
    hiddenSections: z.array(z.enum(MEMBER_SECTIONS, { errorMap: () => ({ message: 'validation.invalid' }) })).max(MEMBER_SECTIONS.length).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.hiddenSections !== undefined, { message: 'validation.required', path: ['role'] });
export class ChangeRoleDto extends createZodDto(ChangeRoleSchema) {}

// --- quick replies (09-code-conventions §3) ------------------------------------------------------------------------------
export const CreateQuickReplySchema = z
  .object({
    title: z.string().trim().min(1, 'validation.required').max(80, 'validation.length'),
    body: z.string().trim().min(1, 'validation.required').max(1000, 'validation.length'),
    /** '' and null both mean "no shortcut" (forms send the empty input as is) */
    shortcut: z
      .union([z.literal(''), z.string().trim().regex(/^\/[a-z0-9-]{1,29}$/, 'validation.invalid')])
      .optional()
      .nullable(),
    locale: localeSchema.optional(),
  })
  .strict();
export const UpdateQuickReplySchema = CreateQuickReplySchema.partial().strict();
export const ReorderQuickRepliesSchema = z.object({ ids: z.array(z.string().uuid('validation.id')).min(1, 'validation.required') }).strict();
export class CreateQuickReplyDto extends createZodDto(CreateQuickReplySchema) {}
export class UpdateQuickReplyDto extends createZodDto(UpdateQuickReplySchema) {}
export class ReorderQuickRepliesDto extends createZodDto(ReorderQuickRepliesSchema) {}
export type CreateQuickReply = z.infer<typeof CreateQuickReplySchema>;
export type UpdateQuickReply = z.infer<typeof UpdateQuickReplySchema>;

// --- system messages (11 §9.1) -------------------------------------------------------------------------------------------
export const SYSTEM_MESSAGE_KEYS = ['handoff', 'out_of_hours', 'out_of_stock', 'welcome'] as const;
export type SystemMessageKey = (typeof SYSTEM_MESSAGE_KEYS)[number];
const text = z.string().trim().max(1000, 'validation.length');
const localized = z.object({ fr: text.optional(), ar: text.optional(), en: text.optional() }).strict();
export const SystemMessagesSchema = z
  .object({ handoff: localized.optional(), out_of_hours: localized.optional(), out_of_stock: localized.optional(), welcome: localized.optional() })
  .strict();
export class SystemMessagesDto extends createZodDto(SystemMessagesSchema) {}
export type SystemMessagesInput = z.infer<typeof SystemMessagesSchema>;
export const ResetSystemMessageSchema = z.object({ key: z.enum(SYSTEM_MESSAGE_KEYS, { errorMap: () => ({ message: 'validation.invalid' }) }) }).strict();
export class ResetSystemMessageDto extends createZodDto(ResetSystemMessageSchema) {}

// --- legal ---------------------------------------------------------------------------------------------------------------
export const LegalAcceptSchema = z
  .object({ key: z.enum(['terms', 'privacy', 'account_deletion', 'content_rules'], { errorMap: () => ({ message: 'validation.invalid' }) }), version: z.number().int().min(1) })
  .strict();
export class LegalAcceptDto extends createZodDto(LegalAcceptSchema) {}
