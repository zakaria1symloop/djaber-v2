// 09-code-conventions §3.5 — SET › Réponses rapides (03 §20, INB-03).
import { Injectable } from '@nestjs/common';
import { TenantContext, type QuickReply } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import type { CreateQuickReply, UpdateQuickReply } from './dto';
import { QuickReplyRepository } from './quick-reply.repository';

const view = (r: QuickReply) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  shortcut: r.shortcut,
  locale: r.locale,
  sortOrder: r.sortOrder,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
const titleTaken = () => new AppException('QUICK_REPLY_TITLE_TAKEN', {}, { title: 'validation.invalid' });

@Injectable()
export class QuickReplyService {
  constructor(private readonly repo: QuickReplyRepository) {}

  async list() {
    return (await this.repo.list()).map(view);
  }

  async create(input: CreateQuickReply) {
    // a quick reply is sent to customers: it defaults to the shop's language, not the member's screen (07 §4 Language source)
    const locale = input.locale ?? TenantContext.get().locale;
    if (await this.repo.titleExists(input.title, locale)) throw titleTaken();
    const sortOrder = (await this.repo.maxSortOrder()) + 1;
    try {
      return view(await this.repo.create({ title: input.title, body: input.body, shortcut: input.shortcut || null, locale, sortOrder }));
    } catch (e) {
      if (isUniqueViolation(e)) throw titleTaken();
      throw e;
    }
  }

  async update(id: string, input: UpdateQuickReply) {
    const current = await this.repo.byIdOrNotFound(id);
    const locale = input.locale ?? current.locale;
    const title = input.title ?? current.title;
    if ((input.title !== undefined || input.locale !== undefined) && (await this.repo.titleExists(title, locale, id))) throw titleTaken();
    try {
      return view(
        await this.repo.update(id, {
          title: input.title,
          body: input.body,
          locale: input.locale,
          shortcut: input.shortcut === undefined ? undefined : input.shortcut || null,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw titleTaken();
      throw e;
    }
  }

  async remove(id: string) {
    await this.repo.byIdOrNotFound(id);
    await this.repo.delete(id);
  }

  /** `ids` must be the full ordered list of the workspace's quick replies (06 §8.1). */
  async reorder(ids: string[]) {
    const existing = await this.repo.list();
    const unique = new Set(ids);
    if (unique.size !== ids.length || existing.length !== ids.length || !existing.every((r) => unique.has(r.id))) {
      throw new AppException('VALIDATION_ERROR', {}, { ids: 'validation.invalid' });
    }
    await this.repo.reorder(ids);
    return this.list();
  }

  /** Used by the inbox composer (M3): replaces {prénom} {boutique} {total} — INB-03. */
  render(body: string, vars: { firstName?: string; shop: string; total?: number }) {
    return body
      .replaceAll('{prénom}', vars.firstName ?? '')
      .replaceAll('{boutique}', vars.shop)
      .replaceAll('{total}', vars.total !== undefined && vars.total !== null ? `${vars.total} DA` : '');
  }
}
