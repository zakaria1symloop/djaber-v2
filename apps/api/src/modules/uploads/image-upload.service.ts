// api-contract §1.10 — images ≤ 5 MB (jpeg / png / webp / gif), re-encoded with sharp (EXIF stripped) before storage.
// M1 uses it for avatars and workspace logos; later milestones add the other `UploadKind`s.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma, TenantContext, type UploadKind } from '@djaber/db';
import { AppException, validationError } from '../../core/errors/app.exception';
import { isPrivateKey, StorageService } from '../../core/storage/storage.service';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** PDF / CSV attachments (appeal proof, support tickets): ≤ 5 MB (04 §12 appeal, 03 §25 HELP-03), stored as sent. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
const PDF_MIMES = new Set(['application/pdf', 'application/x-pdf']);
const CSV_MIMES = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SHARP_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
/**
 * full-test 15/11 HELP-06: a support attachment keeps the name the merchant picked — written in its storage key as
 * `<uuid>~<base64url(name)>.<ext>` (no schema change) and read back by `attachmentName`. Multer hands non-ASCII names
 * as latin-1: they are decoded back to UTF-8.
 */
export const originalName = (raw: string | undefined): string => {
  if (!raw) return '';
  let name = raw;
  if (![...raw].some((c) => c.charCodeAt(0) > 0xff)) {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    if (!utf8.includes('\ufffd')) name = utf8;
  }
  const bad = (c: string) => c.charCodeAt(0) < 32 || c === '/' || c === String.fromCharCode(92);
  return [...name.normalize('NFC')].filter((c) => !bad(c)).join('').trim().slice(0, 100);
};
const nameTag = (kind: UploadKind, raw: string | undefined): string => {
  const name = kind === 'ticket_attachment' ? originalName(raw) : '';
  return name ? `~${Buffer.from(name, 'utf8').toString('base64url')}` : '';
};
/** The picked name of a support attachment (key `…/<uuid>~<base64url>.<ext>`), or the last key segment for older files. */
export const attachmentName = (storageKey: string): string => {
  const last = storageKey.split('/').pop() ?? storageKey;
  const m = /^[0-9a-f-]{36}~([A-Za-z0-9_-]+)\.\w+$/.exec(last);
  if (!m) return last;
  const name = Buffer.from(m[1]!, 'base64url').toString('utf8');
  return name && !name.includes('\ufffd') ? name : last;
};

/** Square-ish identity pictures: 512 px is enough for every place they are shown. */
const MAX_EDGE: Partial<Record<UploadKind, number>> = { avatar: 512, logo: 512, category_image: 512 };

export type UploadedFile = { buffer: Buffer; mimetype: string; size: number; originalname?: string };
export type UploadResult = { id: string; url: string; mime: string; size: number; width: number | null; height: number | null };

@Injectable()
export class ImageUploadService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Images are re-encoded (`store`); PDF (magic `%PDF-`) and, when `allowCsv`, CSV text files are stored raw (≤ 5 MB):
   * `appeal_attachment` (PDF since M10, carry-over M2) and `ticket_attachment` (screenshots, PDF, CSV — HELP-03).
   */
  async storeAttachment(file: UploadedFile | undefined, kind: UploadKind, userId: string, workspaceId: string | null, o: { allowCsv: boolean }): Promise<UploadResult> {
    if (!file?.buffer?.length) throw validationError({ file: 'validation.required' });
    if (IMAGE_MIMES.has(file.mimetype)) return this.store(file, kind, userId, workspaceId);
    const isPdf = PDF_MIMES.has(file.mimetype) || file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    // full-test 15/11 HELP-12: « captures, CSV » — a text/plain file is a CSV only with a .csv name (a .txt was accepted)
    const csvName = /\.csv$/i.test(file.originalname ?? '');
    const isCsv = !isPdf && o.allowCsv && (csvName || (CSV_MIMES.has(file.mimetype) && file.mimetype !== 'text/plain'));
    if (!isPdf && !isCsv) throw new AppException('UPLOAD_TYPE_INVALID', {}, { file: 'validation.invalid' });
    if (file.size > FILE_MAX_BYTES || file.buffer.length > FILE_MAX_BYTES) throw new AppException('UPLOAD_TOO_LARGE', { max: '5 MB' }, { file: 'validation.invalid' });
    // the declared type is not trusted: a PDF starts with `%PDF-`, a CSV is text without NUL bytes
    if (isPdf && file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppException('UPLOAD_TYPE_INVALID', {}, { file: 'validation.invalid' });
    if (isCsv && file.buffer.includes(0)) throw new AppException('UPLOAD_TYPE_INVALID', {}, { file: 'validation.invalid' });
    const mime = isPdf ? 'application/pdf' : 'text/csv';
    const ext = isPdf ? 'pdf' : 'csv';
    const key = `${kind === 'ticket_attachment' ? 'private/' : ''}${workspaceId ? `ws/${workspaceId}` : `users/${userId}`}/${kind}/${randomUUID()}${nameTag(kind, file.originalname)}.${ext}`;
    const stored = await this.storage.put(key, file.buffer, mime);
    const row = await TenantContext.runSystem(() =>
      prisma.upload.create({ data: { workspaceId, storageKey: key, url: stored.url, mime, size: file.buffer.length, kind, createdById: userId } }),
    );
    return { id: row.id, url: isPrivateKey(key) ? this.storage.signedUrl(key, 3600) : row.url, mime: row.mime, size: row.size, width: null, height: null };
  }

  async store(file: UploadedFile | undefined, kind: UploadKind, userId: string, workspaceId: string | null): Promise<UploadResult> {
    if (!file?.buffer?.length) throw validationError({ file: 'validation.required' });
    if (!IMAGE_MIMES.has(file.mimetype)) throw new AppException('IMAGE_TYPE_INVALID', {}, { file: 'validation.invalid' });
    if (file.size > IMAGE_MAX_BYTES) throw new AppException('IMAGE_TOO_LARGE', {}, { file: 'validation.invalid' });

    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      const img = sharp(file.buffer, { failOn: 'error' });
      const meta = await img.metadata();
      // the declared mime type is not trusted: the decoded format decides
      if (!meta.format || !SHARP_FORMATS.has(meta.format)) throw new Error('unsupported format');
      out = await img
        .rotate()
        .resize({ width: MAX_EDGE[kind] ?? 2048, height: MAX_EDGE[kind] ?? 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppException('IMAGE_TYPE_INVALID', {}, { file: 'validation.invalid' });
    }

    const key = `${kind === 'ticket_attachment' ? 'private/' : ''}${workspaceId ? `ws/${workspaceId}` : `users/${userId}`}/${kind}/${randomUUID()}${nameTag(kind, file.originalname)}.webp`;
    const stored = await this.storage.put(key, out.data, 'image/webp');
    const row = await TenantContext.runSystem(() =>
      prisma.upload.create({
        data: { workspaceId, storageKey: key, url: stored.url, mime: 'image/webp', size: out.data.length, kind, createdById: userId },
      }),
    );
    return { id: row.id, url: isPrivateKey(key) ? this.storage.signedUrl(key, 3600) : row.url, mime: row.mime, size: row.size, width: out.info.width ?? null, height: out.info.height ?? null };
  }
}
