// 09-code-conventions §2.1 — wire format: { error: { code, message, params, fields, details, ref } }
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { formatDate, isAppLocale } from '@djaber/shared';
import { AppException } from './app.exception';
import { I18nService } from '../i18n/i18n.service';

const fieldsOf = (err: ZodError) => {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    // messages written by the shared validators are already `validation.*` keys
    fields[path] ??= issue.message.startsWith('validation.') ? issue.message : 'validation.invalid';
  }
  return fields;
};

/**
 * full-test 15/11 SALES-CASH-10: a day in a message is written as the screens write it (« 01 nov. 2026 »), never
 * `2026-11-01`; `params` keep the ISO value for the clients that format it themselves.
 */
const DATE_PARAMS = new Set(['date', 'deadline']);
export const readableDates = (params: Record<string, string | number>, locale: string): Record<string, string | number> =>
  Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, DATE_PARAMS.has(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v.length === 10 ? `${v}T12:00:00Z` : v, isAppLocale(locale) ? locale : 'fr') : v]),
  );

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(AppExceptionFilter.name);
  constructor(private readonly i18n: I18nService) {}

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const locale: string = req.locale ?? 'fr';
    const ref: string = req.id ?? 'unknown';
    const body = (
      code: string,
      params: Record<string, string | number>,
      fields: Record<string, string>,
      details: unknown,
    ) => ({
      error: {
        code,
        message: this.i18n.t(locale, `error.${code}`, { ...readableDates(params, locale), ref }),
        params,
        fields,
        details: details ?? null,
        ref,
      },
    });

    if (err instanceof AppException) {
      if (err.code === 'RATE_LIMITED' && err.params.retryAfter) {
        res.setHeader('Retry-After', String(err.params.retryAfter));
      }
      return res.status(err.getStatus()).json(body(err.code, err.params, err.fields, err.details));
    }
    if (err instanceof ZodValidationException) {
      return res.status(422).json(body('VALIDATION_ERROR', {}, fieldsOf(err.getZodError()), null));
    }
    if (err instanceof ZodError) {
      return res.status(422).json(body('VALIDATION_ERROR', {}, fieldsOf(err), null));
    }
    if (err instanceof HttpException) {
      // full-test 15/11 PRODUCTS-08 / HOME-13: a malformed id in the path (`ParseUUIDPipe`) names no record — 404 like an
      // unknown id, so the screen shows « Introuvable » instead of a « Réessayer » that can never succeed
      if (err.getStatus() === 400 && /^Validation failed \(uuid[ )]/.test(err.message)) return res.status(404).json(body('NOT_FOUND', {}, {}, null));
      const status = err.getStatus();
      const code =
        status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 413
                ? 'UPLOAD_TOO_LARGE'
                : status === 429
                  ? 'RATE_LIMITED'
                  : 'BAD_REQUEST';
      return res.status(status).json(body(code, {}, {}, null));
    }
    this.log.error({ ref, err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'unhandled');
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body('INTERNAL', {}, {}, null));
  }
}
