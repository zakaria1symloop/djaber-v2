import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { AppException } from '../errors/app.exception';
import { ConfigService } from '../config/config.service';
import { StorageService } from './storage.service';

/** `filename*` of a Content-Disposition header (RFC 6266 / 5987) with an ASCII fallback. */
export const contentDisposition = (kind: 'attachment' | 'inline', fileName: string) => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

/**
 * Serves the signed links of `StorageService.signedUrl` (exports, prints, labels, proofs) whatever the driver, and the
 * public objects of the `local` driver (dev / test; with `s3` the public URL points at the bucket/CDN).
 * `?dl=<file name>` answers `Content-Disposition: attachment` so the browser saves the file instead of opening it.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('*key')
  async get(@Param('key') key: string | string[], @Query('exp') exp: string, @Query('sig') sig: string, @Query('dl') dl: string | undefined, @Res() res: any) {
    const k = Array.isArray(key) ? key.join('/') : key;
    const e = Number(exp);
    const signed = !!sig && !!e && e >= Date.now() / 1000 && sig === this.storage.sign(k, e);
    if (k.startsWith('private/') ? !signed : !signed && this.config.get('STORAGE_DRIVER') !== 'local') throw new AppException('NOT_FOUND');
    try {
      const { body, mime } = await this.storage.get(k);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', k.startsWith('private/') ? 'private, no-store' : 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (dl !== undefined) res.setHeader('Content-Disposition', contentDisposition('attachment', dl.trim() || k.split('/').pop()!));
      res.end(body);
    } catch {
      throw new AppException('NOT_FOUND');
    }
  }
}
