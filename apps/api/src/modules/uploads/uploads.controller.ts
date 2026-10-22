// api-contract §1.10 — POST /uploads multipart { file, kind } → { id, url, mime, size, width?, height? }
import { Body, Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { prisma, TenantContext } from '@djaber/db';
import { Authenticated, CurrentUser, type AuthUser } from '../../core/auth/decorators';
import { validationError } from '../../core/errors/app.exception';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { IMAGE_MAX_BYTES, ImageUploadService, type UploadedFile as Incoming } from './image-upload.service';

/** Multer's own limit sits above the business limit so that the 413 carries the catalogue code (IMAGE_TOO_LARGE). */
export const imageInterceptor = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES * 2, files: 1 } });

/** Kinds served by this endpoint so far; the other `UploadKind`s arrive with their milestone. */
const KINDS = ['avatar', 'logo', 'category_image', 'appeal_attachment', 'reply', 'cash_proof', 'ticket_attachment', 'payment_proof'] as const;
/** Kinds that belong to a workspace and need an Admin+ member of it (M2: category picture, moderation appeal attachment). */
/** `cash_proof` = receipt photo of a manual cash row (CSH-03, Owner + Admin like `gds.write`). */
const WORKSPACE_KINDS: readonly string[] = ['logo', 'category_image', 'appeal_attachment', 'reply', 'cash_proof'];
/** Workspace kinds every member may upload: the image of an inbox reply (INB-03, `inbox.read` = every role), a support ticket attachment (HELP-03, `support.write`). */
const MEMBER_KINDS: readonly string[] = ['reply', 'ticket_attachment'];
type Kind = (typeof KINDS)[number];

@Controller('uploads')
export class UploadsController {
  constructor(private readonly images: ImageUploadService) {}

  @Post()
  @Authenticated()
  @UseInterceptors(imageInterceptor())
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Incoming | undefined, @Body() body: { kind?: string }, @Req() req: any) {
    const kind = body?.kind as Kind;
    if (!KINDS.includes(kind)) throw validationError({ kind: 'validation.invalid' });
    let workspaceId: string | null = null;
    const platformUser = !!user.platformRole && user.platformRole !== 'none';
    // the proof of a manual billing payment (D71) is a platform file of the finance team (ADM-05)
    if (kind === 'payment_proof') {
      if (!platformUser || !canPlatform(user.platformRole, 'admin.billing.write')) throw validationError({ kind: 'validation.invalid' });
      return this.images.storeAttachment(file, kind, user.id, null, { allowCsv: false });
    }
    // ticket attachments of a platform user (support answer, ADM-12) belong to no workspace: the admin area uploads them
    // without `X-Workspace-Id` (an admin who is also a member of a workspace used to send it: UX-012 2026-10-21)
    const platformTicket = kind === 'ticket_attachment' && platformUser && !req.headers['x-workspace-id'];
    if (WORKSPACE_KINDS.includes(kind) || (kind === 'ticket_attachment' && !platformTicket)) {
      // a logo (category picture, appeal attachment) belongs to a workspace the user manages: the header is checked here because the route itself needs no workspace
      const header = req.headers['x-workspace-id'];
      const u = await TenantContext.runSystem(() => prisma.user.findUnique({ where: { id: user.id } }));
      const candidate = typeof header === 'string' && /^[0-9a-f-]{36}$/i.test(header) ? header : (u?.ownedWorkspaceId ?? u?.lastWorkspaceId);
      const membership = candidate
        ? await TenantContext.runSystem(() =>
            prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: candidate, userId: user.id } } }),
          )
        : null;
      if (!membership || membership.readOnly || (membership.role === 'operator' && !MEMBER_KINDS.includes(kind))) throw validationError({ kind: 'validation.invalid' });
      workspaceId = membership.workspaceId;
    }
    if (kind === 'ticket_attachment' || kind === 'appeal_attachment') return this.images.storeAttachment(file, kind, user.id, workspaceId, { allowCsv: kind === 'ticket_attachment' });
    return this.images.store(file, kind, user.id, workspaceId);
  }
}
