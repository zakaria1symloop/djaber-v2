'use client';
// Step 2 of the import wizard — Figma "CAT-06 — Import wizard — preview with row errors": file card, 4 tiles,
// tabs Erreurs / Toutes / Nouvelles catégories, rows table (50 rows per page: a file may hold 2 000 rows).
import { formatNumber, IMPORT_FIELDS, type ImportField, type ImportPreviewResult, type ImportPreviewRow } from '@djaber/shared';
import { Button, Card, cn, DataTable, EmptyState, Ltr, Pagination, StatusPill, type Column } from '@djaber/ui';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { Money, Num } from '../ui';
import { fileExtension, formatFileSize, IMPORT_PAGE_SIZE, IMPORT_TABS, invalidRows, newCategoryNames, windowRows, type ImportTab } from './logic';

/**
 * "SKU déjà utilisé." (`error.<CODE>` or a `validation.*` key, with the row params). Retest 11/11 UX-054: the reason
 * only — the code stays in `data-code` and in the last column of the error file.
 */
export const describeRowError = (t: TFunction, e: ImportPreviewRow['errors'][number]): string => {
  const key = e.code.startsWith('validation.') ? e.code : `error.${e.code}`;
  const text = t.has(key) ? t(key, { min: '', max: '', row: '', count: '', ...e.params }).replace(/\s+/g, ' ').trim() : '';
  return text || e.code;
};

export function FileCard({ result, size, onChangeFile, onEditMapping, busy }: { result: ImportPreviewResult; size: number | null; onChangeFile: () => void; onEditMapping?: () => void; busy?: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const mapped = IMPORT_FIELDS.filter((f) => !!result.mapping?.[f]);
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="import-file">
      <span className="rounded-[4px] border border-line-edge px-2 py-1 ts-label-meta uppercase text-text-secondary">{fileExtension(result.fileName) || 'csv'}</span>
      <div className="min-w-0 flex-1 basis-64">
        <div className="truncate text-[14px] font-medium">
          <bdi>{result.fileName}</bdi> · {t('import.file.rows', { count: result.totals.rows })}
          {size !== null ? (
            <>
              {' · '}
              <Ltr>{formatFileSize(size, locale)}</Ltr>
            </>
          ) : null}
        </div>
        <div className="ts-label-meta mt-1 truncate text-text-muted" title={mapped.map((f) => `${t(`import.field.${f}`)} ← « ${result.mapping[f]} »`).join(' · ')}>
          {t('import.file.columns')}{' '}
          {mapped.length ? mapped.map((f) => `${t(`import.field.${f}`)} ← « ${result.mapping[f]} »`).join(' · ') : '—'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" onClick={onChangeFile} disabled={busy}>
          {t('import.file.change')}
        </Button>
        {onEditMapping ? (
          <Button variant="ghost" onClick={onEditMapping} disabled={busy}>
            {t('import.file.editMapping')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function Tile({ value, label, tone, testId, children }: { value: React.ReactNode; label: string; tone?: 'money' | 'alert' | 'inbound'; testId: string; children?: React.ReactNode }) {
  return (
    <Card className="px-4 py-3" data-testid={testId}>
      <div className={cn('ts-numeral-l', tone === 'money' && 'text-accent-money', tone === 'alert' && 'text-accent-alert', tone === 'inbound' && 'text-accent-inbound')}>{value}</div>
      <div className="ts-label-micro mt-1.5 uppercase text-text-muted">{label}</div>
      {children}
    </Card>
  );
}

export function PreviewTiles({ totals, plan }: { totals: ImportPreviewResult['totals']; plan: { name: string; current: number; limit: number } | null }) {
  const t = useT();
  const over = (totals.overPlanLimit ?? 0) > 0;
  // rows refused for the plan limit are counted in `overPlanLimit`, not in `create`
  const added = (totals.create ?? totals.valid) + (totals.overPlanLimit ?? 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile testId="tile-valid" tone="money" value={<Num value={totals.valid} />} label={t('import.tile.valid')} />
      <Tile testId="tile-invalid" tone={totals.invalid ? 'alert' : undefined} value={<Num value={totals.invalid} />} label={t('import.tile.invalid')} />
      <Tile testId="tile-categories" tone="inbound" value={<Num value={totals.newCategories ?? 0} />} label={t('import.tile.categories')} />
      <Tile
        testId="tile-plan"
        tone={over ? 'alert' : undefined}
        value={plan ? <Ltr>{`${formatNumber(plan.current)} + ${formatNumber(added)} ${over ? '>' : '≤'} ${plan.limit === -1 ? '∞' : formatNumber(plan.limit)}`}</Ltr> : '—'}
        label={t(plan && !over ? 'import.tile.planOk' : 'import.tile.plan')}
      >
        {over ? (
          <p className="mt-1.5 text-[12px] text-accent-alert" role="alert">
            {t('import.plan.over', { count: totals.overPlanLimit, plan: plan?.name ?? '' })}
          </p>
        ) : null}
      </Tile>
    </div>
  );
}

const text = (v: string | number | boolean | null | undefined) => (v === null || v === undefined || v === '' ? <span className="text-text-muted">—</span> : String(v));
const numeric = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function PreviewRows({
  result,
  tab,
  onTabChange,
  existingCategories,
}: {
  result: ImportPreviewResult;
  tab: ImportTab;
  onTabChange: (tab: ImportTab) => void;
  existingCategories: readonly string[];
}) {
  const t = useT();
  const [page, setPage] = useState(1);
  const errors = useMemo(() => invalidRows(result.rows), [result.rows]);
  const categories = useMemo(() => newCategoryNames(result.rows, existingCategories), [result.rows, existingCategories]);
  const counts: Record<ImportTab, number> = { errors: result.totals.invalid ?? errors.length, all: result.totals.rows ?? result.rows.length, categories: result.totals.newCategories ?? categories.length };
  const source = tab === 'errors' ? errors : result.rows;
  const view = windowRows(source, page);

  const columns: Column<ImportPreviewRow>[] = [
    { key: 'row', header: t('import.col.row'), ltr: true, hideable: false, className: 'w-14 tabular-nums text-text-muted', cell: (r) => r.row },
    { key: 'name', header: t('common.name'), cell: (r) => <span className="font-medium">{text(r.values.name)}</span> },
    { key: 'sku', header: t('import.col.sku'), ltr: true, cell: (r) => text(r.values.sku) },
    { key: 'price', header: t('common.price'), align: 'end', cell: (r) => (numeric(r.values.price) !== null ? <Money value={numeric(r.values.price)} /> : text(r.values.price)) },
    { key: 'stock', header: t('import.col.stock'), align: 'end', cell: (r) => (numeric(r.values.stock) !== null ? <Num value={numeric(r.values.stock)} /> : text(r.values.stock)) },
    { key: 'category', header: t('import.col.category'), cell: (r) => text(r.values.category) },
    { key: 'error', header: t('import.col.error'), className: 'min-w-64', cell: (r) => <RowStatus row={r} /> },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('import.tabs.label')} className="flex flex-wrap gap-2">
        {IMPORT_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`import-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="import-tabpanel"
            data-tab={k}
            onClick={() => {
              setPage(1);
              onTabChange(k);
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-card border px-3 text-[13px] transition-colors',
              tab === k ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
            )}
          >
            {t(`import.tab.${k}`)}
            <Ltr className="tabular-nums">{formatNumber(counts[k])}</Ltr>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="import-tabpanel" aria-labelledby={`import-tab-${tab}`}>
        {tab === 'categories' ? (
          categories.length === 0 ? (
            <EmptyState title={counts.categories > 0 ? t('import.categories.count', { count: counts.categories }) : t('import.categories.none')} />
          ) : (
            <Card>
              <ul className="divide-y divide-line-hairline" data-testid="import-categories">
                {categories.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0 truncate font-medium">{c.name}</span>
                    <span className="ts-label-meta text-text-muted">{t('import.file.rows', { count: c.rows })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )
        ) : source.length === 0 ? (
          <EmptyState icon={<Check className="size-5" />} title={tab === 'errors' ? t('import.errors.none') : t('import.rows.none')} />
        ) : (
          <DataTable
            label={t(`import.tab.${tab}`)}
            columns={columns}
            rows={view.rows}
            rowKey={(r) => String(r.row)}
            density="compact"
            card={(r) => (
              <div className="flex flex-col gap-1 px-3 py-2.5 text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{text(r.values.name)}</span>
                  <span className="ts-label-meta shrink-0 text-text-muted">{t('import.row.number', { row: r.row })}</span>
                </div>
                <div className="ts-label-meta text-text-muted">
                  <Ltr>{String(r.values.sku ?? '—')}</Ltr> · {numeric(r.values.price) !== null ? <Money value={numeric(r.values.price)} /> : '—'}
                </div>
                <RowStatus row={r} />
              </div>
            )}
            footer={
              view.pages > 1 ? (
                <Pagination
                  page={view.page}
                  pageSize={IMPORT_PAGE_SIZE}
                  total={view.total}
                  onPageChange={setPage}
                  labels={{
                    previous: t('action.previousPage'),
                    next: t('action.nextPage'),
                    perPage: (n) => t('common.perPage', { count: n }),
                    range: (from, to, all) => t('common.rangeOf', { from, to, total: formatNumber(all) }),
                  }}
                />
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function RowStatus({ row }: { row: ImportPreviewRow }) {
  const t = useT();
  if (row.ok || row.errors.length === 0) {
    const kind = row.ok ? (row.action === 'update' ? 'update' : 'ok') : 'skip';
    return (
      <StatusPill enumKey="Import.row" value={kind} className="rounded-[4px]">
        {t(`import.row.${kind}`)}
      </StatusPill>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5" data-testid="row-errors">
      {row.errors.map((e, i) => (
        <li key={`${e.code}-${i}`} data-code={e.code} className="ts-label-meta normal-case text-accent-alert">
          {describeRowError(t, e)}
          {e.field ? <span className="text-text-muted"> · {t(`import.field.${e.field as ImportField}`)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

