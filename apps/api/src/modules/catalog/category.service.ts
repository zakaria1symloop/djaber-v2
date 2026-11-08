// CAT-04 — categories (name unique per workspace, colour, description, optional parent, 2 levels max) and units
// (7 system units + custom). Delete is blocked while products use the row, with a reassign option.
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type Category, type Prisma, type Tx, type Unit } from '@djaber/db';
import { systemUnitText, type CategoryView, type CreateCategoryInput, type CreateUnitInput, type UnitView, type UpdateCategoryInput, type UpdateUnitInput } from '@djaber/shared';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { action, isUnique } from './catalog.util';
import { viewLocale } from './product.presenter';
import { ModerationHookService } from './moderation-hook.service';

const exists = () => new AppException('CATEGORY_ALREADY_EXISTS', {}, { name: 'validation.invalid' });

@Injectable()
export class CategoryService {
  constructor(private readonly moderation: ModerationHookService) {}

  private view(c: Category & { image?: { url: string } | null }, counts: Map<string, number>, children: CategoryView[] = []): CategoryView {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color,
      parentId: c.parentId,
      imageUrl: c.image?.url ?? null,
      productCount: counts.get(c.id) ?? 0,
      children,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      actions: [action('edit', 'catalog.write'), action('delete', 'catalog.write')],
    };
  }

  private async counts() {
    const groups = await prisma.product.groupBy({ by: ['categoryId'], where: { deletedAt: null, categoryId: { not: null } }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.categoryId!, g._count._all]));
  }

  /** `GET /categories` — the 2-level tree (roots with their sub-categories), alphabetical. */
  async list(): Promise<CategoryView[]> {
    const [rows, counts] = await Promise.all([
      prisma.category.findMany({ where: { deletedAt: null }, include: { image: { select: { url: true } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.counts(),
    ]);
    const ids = new Set(rows.map((r) => r.id));
    // a sub-category whose parent is gone is shown at the root
    return rows
      .filter((r) => !r.parentId || !ids.has(r.parentId))
      .map((root) => this.view(root, counts, rows.filter((r) => r.parentId === root.id).map((child) => this.view(child, counts))));
  }

  private async one(id: string): Promise<CategoryView> {
    const c = await prisma.category.findFirst({ where: { id, deletedAt: null }, include: { image: { select: { url: true } } } });
    if (!c) throw notFound();
    const [counts, children] = await Promise.all([this.counts(), prisma.category.findMany({ where: { parentId: id, deletedAt: null }, include: { image: { select: { url: true } } }, orderBy: { name: 'asc' } })]);
    return this.view(c, counts, children.map((ch) => this.view(ch, counts)));
  }

  private async assertName(tx: Tx, name: string, exceptId?: string) {
    const n = await tx.category.count({ where: { deletedAt: null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (n) throw exists();
  }

  /** 2 levels max: a parent must itself be a root category. */
  private async assertParent(tx: Tx, parentId: string, selfId?: string) {
    if (parentId === selfId) throw new AppException('CATEGORY_DEPTH_EXCEEDED', {}, { parentId: 'validation.invalid' });
    const parent = await tx.category.findFirst({ where: { id: parentId, deletedAt: null }, select: { parentId: true } });
    if (!parent) throw validationError({ parentId: 'validation.invalid' });
    if (parent.parentId) throw new AppException('CATEGORY_DEPTH_EXCEEDED', {}, { parentId: 'validation.invalid' });
    if (selfId && (await tx.category.count({ where: { parentId: selfId, deletedAt: null } }))) throw new AppException('CATEGORY_DEPTH_EXCEEDED', {}, { parentId: 'validation.invalid' });
  }

  private async assertImage(tx: Tx, uploadId: string) {
    const upload = await tx.upload.findFirst({ where: { id: uploadId, workspaceId: TenantContext.workspaceId(), kind: 'category_image' }, select: { id: true } });
    if (!upload) throw validationError({ imageUploadId: 'validation.invalid' });
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await prisma.$transaction((db) => fn(db as Tx));
    } catch (e) {
      if (isUnique(e)) throw exists();
      throw e;
    }
  }

  /** `POST /categories` */
  async create(input: CreateCategoryInput): Promise<CategoryView> {
    const id = await this.write(async (tx) => {
      await this.assertName(tx, input.name);
      if (input.parentId) await this.assertParent(tx, input.parentId);
      if (input.imageUploadId) await this.assertImage(tx, input.imageUploadId);
      const row = await tx.category.create({
        data: { name: input.name, description: input.description ?? null, color: input.color ?? '#888888', parentId: input.parentId ?? null, imageUploadId: input.imageUploadId ?? null } as Prisma.CategoryUncheckedCreateInput,
      });
      return row.id;
    });
    return this.one(id);
  }

  /** `PATCH /categories/:id` */
  async update(id: string, input: UpdateCategoryInput): Promise<CategoryView> {
    await this.write(async (tx) => {
      const current = await tx.category.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw notFound();
      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) await this.assertName(tx, input.name, id);
      if (input.parentId) await this.assertParent(tx, input.parentId, id);
      if (input.imageUploadId) await this.assertImage(tx, input.imageUploadId);
      await tx.category.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description === undefined ? undefined : (input.description ?? null),
          color: input.color,
          parentId: input.parentId === undefined ? undefined : (input.parentId ?? null),
          imageUploadId: input.imageUploadId === undefined ? undefined : (input.imageUploadId ?? null),
        },
      });
    });
    return this.one(id);
  }

  /**
   * `DELETE /categories/:id?reassignTo&moveChildrenToRoot` — in use ⇒ 409 CATEGORY_IN_USE {count} unless `reassignTo`
   * names another category; a parent keeps its sub-categories unless `moveChildrenToRoot=true`.
   */
  async remove(id: string, o: { reassignTo?: string; moveChildrenToRoot?: boolean } = {}): Promise<void> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const current = await tx.category.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw notFound();
      const children = await tx.category.count({ where: { parentId: id, deletedAt: null } });
      if (children && !o.moveChildrenToRoot) throw new AppException('CATEGORY_IN_USE', { count: children }, {}, { children, reason: 'HAS_SUBCATEGORIES' });
      const products = await tx.product.findMany({ where: { categoryId: id, deletedAt: null }, select: { id: true } });
      if (products.length) {
        if (!o.reassignTo) throw new AppException('CATEGORY_IN_USE', { count: products.length }, {}, { products: products.length });
        if (o.reassignTo === id) throw validationError({ reassignTo: 'validation.invalid' });
        // `reassignTo=none` = "Sans catégorie" of the reassign dialog (CAT-04)
        const target = o.reassignTo === 'none' ? { id: null } : await tx.category.findFirst({ where: { id: o.reassignTo, deletedAt: null }, select: { id: true } });
        if (!target) throw validationError({ reassignTo: 'validation.invalid' });
        await tx.product.updateMany({ where: { categoryId: id, deletedAt: null }, data: { categoryId: target.id } });
        // the category is a moderated field (04 §12)
        await this.moderation.resubmitMany(tx, products.map((p) => p.id), 'update');
      }
      // archived products simply lose the link
      await tx.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
      if (children) await tx.category.updateMany({ where: { parentId: id, deletedAt: null }, data: { parentId: null } });
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}

const unitExists = () => validationError({ name: 'validation.invalid' });

@Injectable()
export class UnitService {
  /** `Unit` is not a tenant model (system units have no workspace): the scope is explicit in every query. */
  private visible(): Prisma.UnitWhereInput {
    return { OR: [{ workspaceId: null }, { workspaceId: TenantContext.workspaceId() }] };
  }

  private view(u: Unit, counts: Map<string, number>): UnitView {
    const readonly = u.isSystem || !u.workspaceId ? 'UNIT_SYSTEM_READONLY' : undefined;
    // PV 08/11: a system unit in the language the list is viewed in
    const shown = readonly ? systemUnitText(u.abbreviation, viewLocale()) : null;
    return {
      id: u.id,
      name: shown?.name ?? u.name,
      abbreviation: shown?.abbreviation ?? u.abbreviation,
      isSystem: u.isSystem || !u.workspaceId,
      containsQty: u.containsQty,
      baseUnitId: u.baseUnitId,
      productCount: counts.get(u.id) ?? 0,
      actions: [action('edit', 'catalog.write', { reasonCode: readonly }), action('delete', 'catalog.write', { reasonCode: readonly })],
    };
  }

  private async counts() {
    const groups = await prisma.product.groupBy({ by: ['unitId'], where: { deletedAt: null, unitId: { not: null } }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.unitId!, g._count._all]));
  }

  /** `GET /units` — system units first, then the workspace's own. */
  async list(): Promise<UnitView[]> {
    const [rows, counts] = await Promise.all([prisma.unit.findMany({ where: this.visible(), orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] }), this.counts()]);
    return rows.map((u) => this.view(u, counts));
  }

  private async own(tx: Tx, id: string): Promise<Unit> {
    const u = await tx.unit.findFirst({ where: { id, AND: [this.visible()] } });
    if (!u) throw notFound();
    if (u.isSystem || !u.workspaceId) throw new AppException('UNIT_SYSTEM_READONLY');
    return u;
  }

  private async assertFree(tx: Tx, name: string, abbreviation: string, exceptId?: string) {
    const n = await tx.unit.count({
      where: {
        AND: [this.visible(), { name: { equals: name, mode: 'insensitive' }, abbreviation: { equals: abbreviation, mode: 'insensitive' } }, exceptId ? { NOT: { id: exceptId } } : {}],
      },
    });
    if (n) throw unitExists();
  }

  private async assertBase(tx: Tx, baseUnitId: string, selfId?: string) {
    const base = baseUnitId === selfId ? null : await tx.unit.findFirst({ where: { id: baseUnitId, AND: [this.visible()] }, select: { id: true } });
    if (!base) throw validationError({ baseUnitId: 'validation.invalid' });
  }

  /** `POST /units` */
  async create(input: CreateUnitInput): Promise<UnitView> {
    const row = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertFree(tx, input.name, input.abbreviation);
      if (input.baseUnitId) await this.assertBase(tx, input.baseUnitId);
      return tx.unit.create({
        data: { workspaceId: TenantContext.workspaceId(), name: input.name, abbreviation: input.abbreviation, isSystem: false, containsQty: input.containsQty ?? null, baseUnitId: input.baseUnitId ?? null },
      });
    });
    return this.view(row, new Map());
  }

  /** `PATCH /units/:id` — system units ⇒ 403 UNIT_SYSTEM_READONLY. */
  async update(id: string, input: UpdateUnitInput): Promise<UnitView> {
    const row = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const current = await this.own(tx, id);
      if (input.name !== undefined || input.abbreviation !== undefined) await this.assertFree(tx, input.name ?? current.name, input.abbreviation ?? current.abbreviation, id);
      if (input.baseUnitId) await this.assertBase(tx, input.baseUnitId, id);
      return tx.unit.update({
        where: { id },
        data: {
          name: input.name,
          abbreviation: input.abbreviation,
          containsQty: input.containsQty === undefined ? undefined : (input.containsQty ?? null),
          baseUnitId: input.baseUnitId === undefined ? undefined : (input.baseUnitId ?? null),
        },
      });
    });
    return this.view(row, await this.counts());
  }

  /** `DELETE /units/:id?reassignTo` — in use ⇒ 409 UNIT_IN_USE {count} unless `reassignTo` names another unit. */
  async remove(id: string, o: { reassignTo?: string } = {}): Promise<void> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.own(tx, id);
      const count = await tx.product.count({ where: { unitId: id, deletedAt: null } });
      if (count) {
        if (!o.reassignTo) throw new AppException('UNIT_IN_USE', { count });
        if (o.reassignTo === 'none') throw validationError({ reassignTo: 'validation.invalid' }); // a product always has a unit
        const target = o.reassignTo === id ? null : await tx.unit.findFirst({ where: { id: o.reassignTo, AND: [this.visible()] }, select: { id: true } });
        if (!target) throw validationError({ reassignTo: 'validation.invalid' });
        await tx.product.updateMany({ where: { unitId: id, deletedAt: null }, data: { unitId: target.id } });
      }
      await tx.product.updateMany({ where: { unitId: id }, data: { unitId: null } });
      await tx.unit.updateMany({ where: { baseUnitId: id, workspaceId: TenantContext.workspaceId() }, data: { baseUnitId: null, containsQty: null } });
      await tx.unit.delete({ where: { id } });
    });
  }
}
