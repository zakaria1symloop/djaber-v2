// Opaque single-use e-mail tokens (verify 24 h, reset 60 min, change_email 24 h): only the SHA-256 is stored.
import { Injectable } from '@nestjs/common';
import { TenantContext, type EmailToken, type EmailTokenKind, type Prisma, type Tx } from '@djaber/db';
import type { ErrorCode } from '@djaber/shared';
import { CryptoService } from '../../core/crypto/crypto.service';
import { dbOf } from '../../core/db';
import { AppException } from '../../core/errors/app.exception';

export const TOKEN_TTL_MS: Record<EmailTokenKind, number> = {
  verify: 24 * 3600_000,
  reset: 60 * 60_000,
  change_email: 24 * 3600_000,
};

/**
 * `invalid` = no such link (mistyped / truncated — full-test 15/11 PUBLIC-11: it was called « expiré »), `used` = a link
 * already used or replaced by a newer one, `expired` = past its validity.
 */
const CODES: Record<EmailTokenKind, { invalid: ErrorCode; used: ErrorCode; expired: ErrorCode }> = {
  verify: { invalid: 'AUTH_VERIFY_TOKEN_INVALID', used: 'AUTH_VERIFY_TOKEN_EXPIRED', expired: 'AUTH_VERIFY_TOKEN_EXPIRED' },
  reset: { invalid: 'AUTH_RESET_TOKEN_INVALID', used: 'AUTH_RESET_TOKEN_INVALID', expired: 'AUTH_RESET_TOKEN_EXPIRED' },
  change_email: { invalid: 'AUTH_VERIFY_TOKEN_INVALID', used: 'AUTH_VERIFY_TOKEN_EXPIRED', expired: 'AUTH_VERIFY_TOKEN_EXPIRED' },
};

@Injectable()
export class EmailTokenService {
  constructor(private readonly crypto: CryptoService) {}

  /** Creates a token and voids the previous unused ones of the same kind (only the latest link works). */
  async create(userId: string, kind: EmailTokenKind, payload?: Prisma.InputJsonValue, tx?: Tx): Promise<string> {
    const raw = this.crypto.randomToken(32);
    await TenantContext.runSystem(async () => {
      const db = dbOf(tx);
      await db.emailToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
      await db.emailToken.create({
        data: { userId, kind, tokenHash: this.crypto.sha256(raw), payload, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) },
      });
    });
    return raw;
  }

  /** Validates without consuming (reset page "validating" state). */
  async peek(raw: string, kind: EmailTokenKind, tx?: Tx): Promise<EmailToken> {
    const row = await TenantContext.runSystem(() =>
      dbOf(tx).emailToken.findUnique({ where: { tokenHash: this.crypto.sha256(raw) } }),
    );
    if (!row || row.kind !== kind) throw new AppException(CODES[kind].invalid);
    if (row.usedAt) throw new AppException(CODES[kind].used);
    if (row.expiresAt <= new Date()) throw new AppException(CODES[kind].expired);
    return row;
  }

  /** Single use: the row is claimed atomically; a second use answers "invalid". */
  async consume(raw: string, kind: EmailTokenKind, tx?: Tx): Promise<EmailToken> {
    const row = await this.peek(raw, kind, tx);
    const claimed = await TenantContext.runSystem(() =>
      dbOf(tx).emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } }),
    );
    if (!claimed.count) throw new AppException(CODES[kind].used);
    return row;
  }
}
