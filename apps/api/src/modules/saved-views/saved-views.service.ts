// LST-03 / D42 / D47 — saved views (03 §34, 04 §24, 05 §16, 06 §8.1). Rules (04 §24):
// · name unique per (user, page), case-insensitive (`SAVED_VIEW_NAME_TAKEN`, inline under « Nom »);
// · one default per (user, page) (partial unique index `SavedView_one_default`): setting one clears the others;
// · a shared view is owned by its author — the others apply or duplicate it, never edit it (`SAVED_VIEW_SHARED_READONLY`);
// · deleting a shared view removes it for everyone (`sharedWith` = the count the confirmation shows);
// · a view of another member that is not shared, or of another workspace, does not exist (404).
import { Injectable } from '@nestjs/common';
import { prisma, type Prisma, type SavedView, type SavedViewPage } from '@djaber/db';
import { cleanSavedViewFilters, type SavedViewDto } from '@djaber/shared';
import { AppException, notFound } from '../../core/errors/app.exception';
import { viewerUserId } from '../../core/privacy/mask';

type Row = SavedView & { sharedBy: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null };
export type CreateInput = {
  page: SavedViewPage;
  name: string;
  filters?: Record<string, unknown>;
  sort?: string | null;
  columns?: string[];
  density?: 'compact' | 'comfortable' | null;
  isDefault?: boolean;
};
export type UpdateInput = Partial<Omit<CreateInput, 'page'>>;

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
const nameTaken = () => new AppException('SAVED_VIEW_NAME_TAKEN', {}, { name: 'validation.invalid' });
const readOnly = () => new AppException('SAVED_VIEW_SHARED_READONLY');
/** Same name for « À envoyer Sétif » and « à ENVOYER sétif » (case and spacing, accents kept). */
export const foldName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
const include = { sharedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } as const;

// J13r-1: during a read-only impersonation the owner's views are listed (writes are refused by the tenant guard)
const me = () => {
  const userId = viewerUserId();
  if (!userId) throw new AppException('FORBIDDEN');
  return userId;
};

@Injectable()
export class SavedViewsService {
  private present(r: Row, userId: string, members: number): SavedViewDto {
    return {
      id: r.id,
      page: r.page,
      name: r.name,
      filters: (r.filters ?? {}) as SavedViewDto['filters'],
      sort: r.sort,
      columns: r.columns,
      density: r.density,
      // the default of the author, never of the member a view is shared with
      isDefault: r.userId === userId && r.isDefault,
      isShared: r.isShared,
      sharedBy: r.isShared && r.sharedBy ? { id: r.sharedBy.id, name: `${r.sharedBy.firstName} ${r.sharedBy.lastName}`.trim(), avatarUrl: r.sharedBy.avatarUrl } : null,
      readOnly: r.userId !== userId,
      sharedWith: r.isShared ? Math.max(0, members - 1) : 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async view(r: Row, userId: string) {
    return this.present(r, userId, r.isShared ? await prisma.membership.count() : 0);
  }

  /** My views of the page, then the views shared with the team by the other members (each group in creation order). */
  async list(page?: SavedViewPage) {
    const userId = me();
    const rows = (await prisma.savedView.findMany({
      where: { ...(page ? { page } : {}), OR: [{ userId }, { isShared: true }] },
      include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as Row[];
    const members = rows.some((r) => r.isShared) ? await prisma.membership.count() : 0;
    const own = rows.filter((r) => r.userId === userId);
    const shared = rows.filter((r) => r.userId !== userId);
    return [...own, ...shared].map((r) => this.present(r, userId, members));
  }

  /** A view I may read (mine or shared with the team), else 404. */
  async visible(id: string) {
    const userId = me();
    const r = (await prisma.savedView.findFirst({ where: { id, OR: [{ userId }, { isShared: true }] }, include })) as Row | null;
    if (!r) throw notFound();
    return r;
  }

  /** A view I may change: mine; a shared view of another member ⇒ 403 SAVED_VIEW_SHARED_READONLY. */
  private async owned(id: string) {
    const r = await this.visible(id);
    if (r.userId !== me()) throw readOnly();
    return r;
  }

  private async nameExists(page: SavedViewPage, name: string, exceptId?: string) {
    // compared in JS: the database collation does not fold accented capitals (« À » / « à »)
    const key = foldName(name);
    const rows = await prisma.savedView.findMany({ where: { userId: me(), page, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { name: true } });
    return rows.some((r) => foldName(r.name) === key);
  }

  async create(input: CreateInput) {
    const userId = me();
    if (await this.nameExists(input.page, input.name)) throw nameTaken();
    try {
      const row = await prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.savedView.updateMany({ where: { userId, page: input.page, isDefault: true }, data: { isDefault: false } });
        return tx.savedView.create({
          data: {
            userId,
            page: input.page,
            name: input.name,
            filters: cleanSavedViewFilters(input.filters ?? {}) as Prisma.InputJsonValue,
            sort: input.sort ?? null,
            columns: input.columns ?? [],
            density: input.density ?? null,
            isDefault: !!input.isDefault,
          } as never,
          include,
        });
      });
      return this.view(row as Row, userId);
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
  }

  async update(id: string, input: UpdateInput) {
    const userId = me();
    const current = await this.owned(id);
    if (input.name !== undefined && (await this.nameExists(current.page, input.name, id))) throw nameTaken();
    try {
      const row = await prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.savedView.updateMany({ where: { userId, page: current.page, isDefault: true, NOT: { id } }, data: { isDefault: false } });
        return tx.savedView.update({
          where: { id },
          data: {
            name: input.name,
            filters: input.filters === undefined ? undefined : (cleanSavedViewFilters(input.filters) as Prisma.InputJsonValue),
            sort: input.sort === undefined ? undefined : input.sort,
            columns: input.columns,
            density: input.density === undefined ? undefined : input.density,
            isDefault: input.isDefault,
          },
          include,
        });
      });
      return this.view(row as Row, userId);
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
  }

  /** `POST /me/saved-views/:id/share` (`views.share`): the author shares or stops sharing; `sharedById` = the author. */
  async share(id: string, isShared: boolean) {
    const userId = me();
    await this.owned(id);
    const row = await prisma.savedView.update({ where: { id }, data: { isShared, sharedById: isShared ? userId : null }, include });
    return this.view(row as Row, userId);
  }

  async remove(id: string) {
    await this.owned(id);
    await prisma.savedView.delete({ where: { id } });
  }
}
