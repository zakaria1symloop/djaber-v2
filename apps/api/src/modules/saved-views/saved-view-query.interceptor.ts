// 06 §1 « Saved views » / api-contract §1.6: every list of 05 §16 accepts `?view=<savedViewId>` — the server expands the
// stored filters and the explicit query params override them. Runs after the guards (tenant set) and before the
// handler's query pipe, so each list validates the merged query with its own schema. A view that is not mine nor shared
// with the team, of another workspace, or of another list ⇒ 404.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantContext, type SavedViewPage } from '@djaber/db';
import { savedViewApiQuery } from '@djaber/shared';
import { notFound } from '../../core/errors/app.exception';
import { SavedViewsService } from './saved-views.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** List endpoints of each `SavedViewPage` (GET, after `/api/v1`); `stats` / `export` take the same filters as their list. */
export const SAVED_VIEW_LISTS: [RegExp, SavedViewPage][] = [
  [/^\/orders(\/stats|\/export)?\/?$/, 'orders'],
  [/^\/products(\/stats|\/export)?\/?$/, 'products'],
  [/^\/clients(\/stats|\/export)?\/?$/, 'clients'],
  [/^\/conversations\/?$/, 'inbox'],
  [/^\/(shipments|delivery\/export)\/?$/, 'delivery'],
  [/^\/stock\/movements(\/export)?\/?$/, 'movements'],
  [/^\/agents\/?$/, 'agents'],
  [/^\/channels\/?$/, 'channels'],
  [/^\/notifications\/?$/, 'notifications'],
  [/^\/purchases(\/stats|\/export)?\/?$/, 'purchases'],
  [/^\/sales(\/stats|\/export)?\/?$/, 'sales'],
  [/^\/cash(\/export)?\/?$/, 'cash'],
];
export const savedViewPageOf = (path: string): SavedViewPage | null => {
  const p = path.replace(/^\/api\/v1/, '');
  return SAVED_VIEW_LISTS.find(([re]) => re.test(p))?.[1] ?? null;
};

/** Stored filters first, explicit params over them; `view` itself is consumed. */
export const mergeViewQuery = (stored: Record<string, string>, explicit: Record<string, unknown>): Record<string, unknown> => {
  const { view: _view, ...rest } = explicit;
  return { ...stored, ...rest };
};

@Injectable()
export class SavedViewQueryInterceptor implements NestInterceptor {
  constructor(private readonly views: SavedViewsService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const viewId = req.method === 'GET' ? req.query?.view : undefined;
    if (typeof viewId !== 'string' || !UUID.test(viewId)) return next.handle();
    const page = savedViewPageOf(req.path);
    if (!page || !TenantContext.maybe()?.workspaceId || !TenantContext.maybe()?.userId) return next.handle();
    const view = await this.views.visible(viewId);
    if (view.page !== page) throw notFound();
    const stored = savedViewApiQuery(view.page, (view.filters ?? {}) as Record<string, unknown>);
    // the KPIs (`/stats`) and exports take the filters only
    if (view.sort && !/\/(stats|export)\/?$/.test(req.path)) stored.sort = view.sort;
    // Express 5: `req.query` is a getter re-parsing the URL — the merged object replaces it on this request only
    Object.defineProperty(req, 'query', { value: mergeViewQuery(stored, { ...req.query }), writable: true, configurable: true, enumerable: true });
    return next.handle();
  }
}
