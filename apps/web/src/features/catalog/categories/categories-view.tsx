'use client';
// /categories — Figma "CAT-04 — Categories & units — list + edit sheet + reassign dialog" + DLG GDS I "Nouvelle
// catégorie", "Nouvelle unité" + DLG GDS II "Supprimer la catégorie". 2-level category tree with one `Actions ⌄`
// per row (D42), units as chips (system = read-only), edit sheet in the URL (`?sheet=<id>` / `?sheet=new`).
import type { ActionDescriptor } from '@djaber/shared';
import { ActionsMenu, Button, Card, cn, StatusPill } from '@djaber/ui';
import { useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListLoading, QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { useT } from '@/lib/i18n';
import type { ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useCategories, useUnits } from '../api';
import type { Category, Unit } from '../contracts';
import { Num } from '../ui';
import { CategorySheet } from './category-sheet';
import { DeleteTaxonomyDialog, type DeleteTarget } from './delete-dialog';
import { categoryRows, findCategory, taxonomySummary, unitConversion, unitLabel } from './logic';
import { UnitDialog } from './unit-dialog';

/** Only the open sheet lives in the URL here: the tree is short, neither paged nor filtered. */
const SPEC: ListSpec = { filters: {}, sorts: ['name'], defaultSort: 'name' };
const NEW = 'new';

/** Server descriptors; when the API sends none, Modifier / Supprimer are gated by the permission (and the system flag). */
const descriptors = (actions: ActionDescriptor[] | undefined, canWrite: boolean, readonlyCode?: string): ActionDescriptor[] => {
  if (actions?.length) return actions;
  const reasonCode = readonlyCode ?? (canWrite ? undefined : 'FORBIDDEN');
  return ['edit', 'delete'].map((key) => ({ key, enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}) }));
};

export function CategoriesView() {
  const t = useT();
  const { can, workspace } = useSession();
  const canWrite = can('catalog.write');
  const advanced = workspace?.stockMode === 'advanced';
  const list = useListState(SPEC);
  const categories = useCategories();
  const units = useUnits();
  const [presetParent, setPresetParent] = useState<string | null>(null);
  const [unitDialog, setUnitDialog] = useState<{ unit: Unit | null } | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  const tree = categories.data ?? [];
  const rows = categoryRows(tree);
  const sheetId = list.state.sheet;
  const editing = sheetId && sheetId !== NEW ? findCategory(tree, sheetId) : null;
  const sheetOpen = canWrite && (sheetId === NEW || !!editing);
  const openNew = (parentId: string | null = null) => {
    setPresetParent(parentId);
    list.openSheet(NEW);
  };
  const summary = categories.data && units.data ? taxonomySummary(categories.data, units.data) : null;

  const categoryActions = (c: Category) =>
    toMenuActions(
      descriptors(c.actions, canWrite),
      {
        edit: { label: t('action.edit'), onSelect: () => list.openSheet(c.id) },
        add_child: { label: t('categories.action.addChild'), onSelect: () => openNew(c.id) },
        delete: { label: t('action.delete'), destructive: true, separated: true, onSelect: () => setDeleting({ kind: 'category', category: c }) },
      },
      t,
    );
  const unitActions = (u: Unit) =>
    toMenuActions(
      descriptors(u.actions, canWrite, u.isSystem ? 'UNIT_SYSTEM_READONLY' : undefined),
      {
        edit: { label: t('action.edit'), onSelect: () => setUnitDialog({ unit: u }) },
        delete: { label: t('action.delete'), destructive: true, onSelect: () => setDeleting({ kind: 'unit', unit: u }) },
      },
      t,
    );
  const th = 'ts-label-micro whitespace-nowrap border-b border-line-hairline px-3 py-2.5 text-start uppercase text-text-muted';

  return (
    <AppPage
      permission="catalog.read"
      eyebrow={t('nav.group.stock')}
      title={t('categories.title')}
      description={
        summary
          ? [
              t('categories.summary.categories', { count: summary.categories }),
              t('categories.summary.products', { count: summary.products }),
              `${t('units.summary.system', { count: summary.systemUnits })} + ${t('units.summary.custom', { count: summary.customUnits })}`,
            ].join(' · ')
          : undefined
      }
      actions={
        canWrite ? (
          <>
            {advanced ? (
              <Button onClick={() => setUnitDialog({ unit: null })} data-testid="new-unit">
                {t('units.add')}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => openNew()} data-testid="new-category">
              {t('categories.add')}
            </Button>
          </>
        ) : null
      }
    >
      {categories.isPending ? (
        <Card>
          <ListLoading rows={5} columns={4} />
        </Card>
      ) : categories.isError ? (
        <QueryError error={categories.error} onRetry={() => categories.refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty title={t('categories.empty.title')} description={t('categories.empty.description')} action={canWrite ? { label: t('categories.add'), onClick: () => openNew() } : undefined} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" aria-label={t('categories.table')} data-testid="categories">
            <thead>
              <tr>
                <th scope="col" className={th}>{t('categories.column.category')}</th>
                <th scope="col" className={cn(th, 'text-end')}>{t('categories.column.products')}</th>
                <th scope="col" className={cn(th, 'max-md:hidden')}>{t('categories.field.description')}</th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t('action.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ category: c, depth }) => (
                <tr key={c.id} data-category={c.name} data-depth={depth} className={cn('border-b border-line-hairline last:border-b-0', sheetId === c.id && 'bg-ink-raised')}>
                  <td className={cn('px-3 py-3', depth === 1 && 'ps-9')}>
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#888888' }} />
                      {/* the category image (sheet « IMAGE ») is shown in the list too — tester report 2026-10-20 */}
                      {c.imageUrl ? <img src={c.imageUrl} alt="" className="size-8 shrink-0 rounded-[6px] border border-line-edge object-cover" data-testid="category-thumb" /> : null}
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-end">
                    <Num value={c.productCount ?? 0} className="font-medium" />
                  </td>
                  <td className="max-w-80 truncate px-3 py-3 text-text-secondary max-md:hidden">{c.description || '—'}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center justify-end gap-3">
                      <Link href={`/products?categoryIds=${c.id}`} className="whitespace-nowrap text-text-secondary hover:text-text-primary" aria-label={t('categories.productsOf', { name: c.name })}>
                        {t('categories.products')} <span aria-hidden className="inline-block rtl:-scale-x-100">→</span>
                      </Link>
                      <ActionsMenu label={t('action.actions')} actions={categoryActions(c)} heading={c.name} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="units-heading">
        <h2 id="units-heading" className="ts-label-section text-text-muted">
          {t('units.title')}
        </h2>
        {units.isPending ? (
          <Card>
            <ListLoading rows={2} columns={4} />
          </Card>
        ) : units.isError ? (
          <QueryError error={units.error} onRetry={() => units.refetch()} />
        ) : (
          <ul className="flex flex-wrap gap-2.5" data-testid="units">
            {units.data.map((u) => {
              const conversion = unitConversion(u, units.data);
              return (
                <li key={u.id} data-unit={u.name} data-system={u.isSystem || undefined} className="flex items-center gap-2.5 rounded-card border border-line-edge bg-ink-surface py-1.5 pe-1.5 ps-3 text-[13px]">
                  <span>{unitLabel(u)}</span>
                  {conversion ? <bdi className="ts-label-meta text-text-muted">{conversion}</bdi> : null}
                  <StatusPill enumKey="Unit.kind" value={u.isSystem ? 'system' : 'custom'} className="rounded-[4px]">
                    {t(u.isSystem ? 'units.pill.system' : 'units.pill.custom')}
                  </StatusPill>
                  <ActionsMenu label={t('action.actions')} variant="ghost" actions={unitActions(u)} heading={unitLabel(u)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sheetOpen ? <CategorySheet key={sheetId} category={editing} presetParentId={sheetId === NEW ? presetParent : null} tree={tree} onClose={() => list.openSheet(null)} /> : null}
      {unitDialog && units.data ? <UnitDialog key={unitDialog.unit?.id ?? NEW} unit={unitDialog.unit} units={units.data} onClose={() => setUnitDialog(null)} /> : null}
      {deleting ? <DeleteTaxonomyDialog key={deleting.kind === 'category' ? deleting.category.id : deleting.unit.id} target={deleting} tree={tree} units={units.data ?? []} onClose={() => setDeleting(null)} /> : null}
    </AppPage>
  );
}
