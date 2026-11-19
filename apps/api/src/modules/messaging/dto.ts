// Request DTOs of the messaging module: shared zod schemas (packages/shared/src/schemas/inbox.ts) wrapped for nestjs-zod.
import { createZodDto } from 'nestjs-zod';
import {
  AdminDataDeletionCreateSchema,
  AdminDataDeletionQuerySchema,
  BlockConversationSchema,
  BlockedWordsSchema,
  ChannelMessagesQuerySchema,
  ConversationCountsQuerySchema,
  CreateBlockSchema,
  CreateNoteSchema,
  CreateReportSchema,
  InboxQuerySchema,
  MessagesQuerySchema,
  ReportMessageSchema,
  SafetyBlocksQuerySchema,
  SafetyReportsQuerySchema,
  SafetyRulesSchema,
  SendMessageSchema,
  UpdateConversationSchema,
} from '@djaber/shared';

export class InboxQueryDto extends createZodDto(InboxQuerySchema) {}
export class ConversationCountsQueryDto extends createZodDto(ConversationCountsQuerySchema) {}
export class UpdateConversationDto extends createZodDto(UpdateConversationSchema) {}
export class SendMessageDto extends createZodDto(SendMessageSchema) {}
export class MessagesQueryDto extends createZodDto(MessagesQuerySchema) {}
export class CreateNoteDto extends createZodDto(CreateNoteSchema) {}
export class BlockConversationDto extends createZodDto(BlockConversationSchema) {}
export class SafetyBlocksQueryDto extends createZodDto(SafetyBlocksQuerySchema) {}
export class CreateBlockDto extends createZodDto(CreateBlockSchema) {}
export class CreateReportDto extends createZodDto(CreateReportSchema) {}
export class ReportMessageDto extends createZodDto(ReportMessageSchema) {}
export class SafetyReportsQueryDto extends createZodDto(SafetyReportsQuerySchema) {}
export class SafetyRulesDto extends createZodDto(SafetyRulesSchema) {}
export class BlockedWordsDto extends createZodDto(BlockedWordsSchema) {}
export class ChannelMessagesQueryDto extends createZodDto(ChannelMessagesQuerySchema) {}
// MSG-08 — data-deletion requests received by e-mail (ADM-16)
export class AdminDataDeletionCreateDto extends createZodDto(AdminDataDeletionCreateSchema) {}
export class AdminDataDeletionQueryDto extends createZodDto(AdminDataDeletionQuerySchema) {}
