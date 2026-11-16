// 09-code-conventions §3.4 — `workspaceId` is injected by the Prisma tenant extension.
import { Injectable } from '@nestjs/common';
import { prisma, type Locale } from '@djaber/db';
import { notFound } from '../../core/errors/app.exception';

@Injectable()
export class QuickReplyRepository {
  list() {
    return prisma.quickReply.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  }
  async byIdOrNotFound(id: string) {
    const r = await prisma.quickReply.findFirst({ where: { id } });
    if (!r) throw notFound();
    return r;
  }
  /** Titles are unique per workspace and locale (`@@unique([workspaceId, locale, title])`). */
  titleExists(title: string, locale: Locale, exceptId?: string) {
    return prisma.quickReply
      .count({ where: { title: { equals: title, mode: 'insensitive' }, locale, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
      .then((n) => n > 0);
  }
  /** full-test 15/11 SETTINGS-11: « /merci » typed in the composer must insert one known reply (case-insensitive). */
  shortcutExists(shortcut: string, exceptId?: string) {
    return prisma.quickReply
      .count({ where: { shortcut: { equals: shortcut, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
      .then((n) => n > 0);
  }
  maxSortOrder() {
    return prisma.quickReply.aggregate({ _max: { sortOrder: true } }).then((a) => a._max.sortOrder ?? -1);
  }
  create(data: { title: string; body: string; shortcut: string | null; locale: Locale; sortOrder: number }) {
    return prisma.quickReply.create({ data: data as never });
  }
  update(id: string, data: Partial<{ title: string; body: string; shortcut: string | null; locale: Locale }>) {
    return prisma.quickReply.update({ where: { id }, data });
  }
  delete(id: string) {
    return prisma.quickReply.delete({ where: { id } });
  }
  reorder(ids: string[]) {
    return prisma.$transaction(ids.map((id, i) => prisma.quickReply.update({ where: { id }, data: { sortOrder: i } })));
  }
}
