import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantContext, NO_LIMITS, type TenantInfo } from '@djaber/db';
import { requestedLocale } from '../i18n/i18n.service';

/**
 * First middleware of every request:
 *  - request id (`X-Request-Id`, echoed) used as `ref` in errors and logs;
 *  - locale from `?lang` / `Accept-Language`;
 *  - opens the AsyncLocalStorage tenant store (09 §2.3); guards later fill it with `Object.assign`.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const requested = requestedLocale(req.headers['accept-language'], req.query?.lang);
    req.locale = requested ?? 'fr';
    const placeholder: TenantInfo = {
      workspaceId: '',
      readOnly: false,
      locale: req.locale,
      // the page's language when the client names one; otherwise screen texts fall back to the account / workspace language
      requestLocale: requested,
      stockMode: 'simple',
      suspended: false,
      limits: NO_LIMITS,
      bypass: true, // until a guard resolves a workspace, only non-tenant models are meaningful
    };
    req.tenant = placeholder;
    TenantContext.run(placeholder, next);
  }
}
