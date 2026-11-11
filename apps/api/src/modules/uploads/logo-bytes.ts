// Shop logo bytes for the server PDFs (order slips UX-048, report exports): pdfkit draws PNG / JPEG only, so a logo
// stored as WebP / GIF is converted to PNG. Null when there is no logo or it cannot be read (the PDF goes without it).
import { prisma, TenantContext } from '@djaber/db';
import sharp from 'sharp';
import type { StorageService } from '../../core/storage/storage.service';

export const logoBytes = async (storage: StorageService, url: string | null | undefined): Promise<Buffer | null> => {
  if (!url) return null;
  const upload = await prisma.upload.findFirst({ where: { url, workspaceId: TenantContext.workspaceId() }, select: { storageKey: true, mime: true } });
  if (!upload || !upload.mime.startsWith('image/')) return null;
  const file = await storage.get(upload.storageKey).catch(() => null);
  if (!file) return null;
  if (/png|jpe?g/i.test(upload.mime)) return file.body;
  return sharp(file.body).png().toBuffer().catch(() => null);
};
