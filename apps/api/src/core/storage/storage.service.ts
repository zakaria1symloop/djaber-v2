// Storage driver: `local` (dev/test, files under STORAGE_LOCAL_DIR served by FilesController) or `s3` (staging/prod).
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ConfigService } from '../config/config.service';
import { fromRepoRoot } from '../config/repo-root';

export type StoredObject = { key: string; url: string };
/**
 * Keys only ever served through a signed, short-lived URL: `private/…` and, whatever their prefix (files stored before
 * 16/11 too), the support-ticket attachments — full-test 15/11 HELP-05: a screenshot of a ticket (customers' data) opened
 * with no sign-in and was cached for a year.
 */
export const isPrivateKey = (key: string) => key.startsWith('private/') || /(^|\/)ticket_attachment\//.test(key);
/** The storage key inside a stored URL (`…/api/v1/files/<key>` or `<bucket>/<key>`), for the rows that kept only the URL. */
export const keyOfUrl = (url: string): string | null => /(?:^|\/)((?:private\/)?(?:ws|users)\/[^?#]+)/.exec(url)?.[1] ?? null;

@Injectable()
export class StorageService {
  private s3?: { client: any; sdk: any };
  constructor(private readonly config: ConfigService) {}

  private get driver() {
    return this.config.get('STORAGE_DRIVER');
  }
  private get root() {
    const dir = this.config.get('STORAGE_LOCAL_DIR');
    // relative paths are anchored at the monorepo root so api and worker share the same folder
    return fromRepoRoot(dir);
  }
  private localPath(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('storage: invalid key');
    return p;
  }
  private s3Client() {
    if (!this.s3) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require('@aws-sdk/client-s3');
      this.s3 = {
        sdk,
        client: new sdk.S3Client({
          region: this.config.get('S3_REGION') ?? 'auto',
          endpoint: this.config.get('S3_ENDPOINT'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: this.config.get('S3_ACCESS_KEY_ID') ?? '',
            secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY') ?? '',
          },
        }),
      };
    }
    return this.s3;
  }

  /** Public URL of a stored object (object keys are unguessable; private documents use `signedUrl`). */
  url(key: string): string {
    if (this.driver === 's3') {
      const base = this.config.get('S3_PUBLIC_URL') ?? `${this.config.get('S3_ENDPOINT')}/${this.config.get('S3_BUCKET')}`;
      return `${base.replace(/\/$/, '')}/${key}`;
    }
    return `${this.config.get('PUBLIC_API_URL')}/api/v1/files/${key}`;
  }

  /** Time-limited URL for private objects (exports, labels, proofs). Local driver: HMAC query signature. */
  signedUrl(key: string, ttlSeconds = 900): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.config.get('PUBLIC_API_URL')}/api/v1/files/${key}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }
  sign(key: string, exp: number) {
    return createHmac('sha256', this.config.get('ENCRYPTION_KEYS') || 'dev-storage').update(`${key}:${exp}`).digest('base64url');
  }

  async put(key: string, body: Buffer, mime: string): Promise<StoredObject> {
    if (this.driver === 's3') {
      const { client, sdk } = this.s3Client();
      await client.send(new sdk.PutObjectCommand({ Bucket: this.config.get('S3_BUCKET'), Key: key, Body: body, ContentType: mime }));
    } else {
      const p = this.localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeFile(`${p}.mime`, mime);
    }
    return { key, url: this.url(key) };
  }

  async get(key: string): Promise<{ body: Buffer; mime: string }> {
    if (this.driver === 's3') {
      const { client, sdk } = this.s3Client();
      const out = await client.send(new sdk.GetObjectCommand({ Bucket: this.config.get('S3_BUCKET'), Key: key }));
      return { body: Buffer.from(await out.Body.transformToByteArray()), mime: out.ContentType ?? 'application/octet-stream' };
    }
    const p = this.localPath(key);
    const body = await readFile(p);
    const mime = await readFile(`${p}.mime`, 'utf8').catch(() => 'application/octet-stream');
    return { body, mime };
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 's3') {
      const { client, sdk } = this.s3Client();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: this.config.get('S3_BUCKET'), Key: key }));
      return;
    }
    const p = this.localPath(key);
    await rm(p, { force: true });
    await rm(`${p}.mime`, { force: true });
  }

  /** Readiness probe. */
  async ping(): Promise<boolean> {
    try {
      if (this.driver === 's3') {
        const { client, sdk } = this.s3Client();
        await client.send(new sdk.HeadBucketCommand({ Bucket: this.config.get('S3_BUCKET') }));
      } else {
        await mkdir(this.root, { recursive: true });
      }
      return true;
    } catch {
      return false;
    }
  }
}
