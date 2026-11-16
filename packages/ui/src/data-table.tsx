'use client';
// DataTable (02-next-route-map §5): selection column, sortable headers, density (44 / 56 px rows), column visibility,
// one actions cell per row, cards under `md` (no multi-select on phones), plus the selection bar and the
// density / columns menu. Lists keep their state in the URL (apps/web `useListState`); this file only renders.
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ArrowDown, ArrowUp, ChevronsUpDown, SlidersHorizontal } from 'lucide-react';
import * as React from 'react';
import { Ltr } from './inputs';
import { Button, Checkbox, cn } from './primitives';

export type Density = 'compact' | 'comfortable';
export type SortState = { key: string; dir: 'asc' | 'desc' };

export type Column<Row> = {
  key: string;
  /** translated header */
  header: string;
  cell: (row: Row) => React.ReactNode;
  align?: 'start' | 'end';
  /** sort field sent to the API (`sort=-price`); the header becomes a button */
  sortKey?: string;
  /** numbers, phones, SKUs: wrapped in <Ltr> */
  ltr?: boolean;
  /** hidden under this breakpoint (secondary columns at 1024) */
  hideBelow?: 'lg' | 'xl' | '2xl';
  /** false ⇒ not listed in the column picker (name, actions) */
  hideable?: boolean;
  className?: string;
};

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = { lg: 'max-lg:hidden', xl: 'max-xl:hidden', '2xl': 'max-2xl:hidden' };

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  label,
  sort,
  onSortChange,
  sortLabel,
  selection,
  density = 'comfortable',
  hiddenColumns,
  rowActions,
  actionsLabel,
  onRowClick,
  activeRowKey,
  card,
  footer,
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** accessible name of the table */
  label: string;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  /** accessible name of a sortable header: `sortLabel('Prix')` */
  sortLabel?: (header: string) => string;
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void; allLabel: string; rowLabel: (row: Row) => string };
  density?: Density;
  hiddenColumns?: readonly string[];
  /** end cell of each row (`Actions ⌄`) */
  rowActions?: (row: Row) => React.ReactNode;
  actionsLabel?: string;
  onRowClick?: (row: Row) => void;
  /** row highlighted while its side sheet is open */
  activeRowKey?: string | null;
  /** phone layout (< md): one card per row instead of the table */
  card?: (row: Row) => React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const visible = columns.filter((c) => !hiddenColumns?.includes(c.key));
  const ids = rows.map(rowKey);
  const selected = selection?.selected;
  const allOn = !!selected && ids.length > 0 && ids.every((id) => selected.has(id));
  const someOn = !!selected && ids.some((id) => selected.has(id));
  const headRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someOn && !allOn;
  }, [someOn, allOn]);

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allOn) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    selection.onChange(next);
  };
  const toggle = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const pad = density === 'compact' ? 'h-11 py-1' : 'h-14 py-2';

  return (
    <div className={cn('rounded-card border border-line-edge bg-ink-surface', className)}>
      <div className={cn('w-full overflow-x-auto', card && 'max-md:hidden')}>
        <table aria-label={label} data-density={density} className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {selection ? (
                <th scope="col" className="w-10 border-b border-line-hairline ps-3 text-start">
                  <Checkbox ref={headRef} aria-label={selection.allLabel} checked={allOn} onChange={toggleAll} />
                </th>
              ) : null}
              {visible.map((c) => {
                const active = sort && c.sortKey && sort.key === c.sortKey ? sort.dir : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (active === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'ts-label-micro whitespace-nowrap border-b border-line-hairline px-3 py-2.5 text-text-muted',
                      c.align === 'end' ? 'text-end' : 'text-start',
                      c.hideBelow && HIDE[c.hideBelow],
                    )}
                  >
                    {c.sortKey && onSortChange ? (
                      <button
                        type="button"
                        aria-label={sortLabel ? sortLabel(c.header) : c.header}
                        onClick={() => onSortChange({ key: c.sortKey!, dir: active === 'asc' ? 'desc' : 'asc' })}
                        className={cn('inline-flex items-center gap-1 uppercase hover:text-text-primary', active && 'text-text-primary')}
                      >
                        {c.header}
                        {active === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : active === 'desc' ? <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-50" aria-hidden />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th scope="col" className="sticky end-0 border-b border-line-hairline bg-ink-surface px-3 py-2.5">
                  <span className="sr-only">{actionsLabel}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowKey(row);
              const on = !!selected?.has(id);
              return (
                <tr
                  key={id}
                  data-row={id}
                  data-selected={on || undefined}
                  aria-selected={selection ? on : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-line-hairline last:border-b-0 hover:bg-ink-raised/60',
                    onRowClick && 'cursor-pointer',
                    on && 'bg-ink-raised/40',
                    activeRowKey === id && 'bg-ink-raised shadow-[inset_2px_0_0_var(--signal-live)] rtl:shadow-[inset_-2px_0_0_var(--signal-live)]',
                  )}
                >
                  {selection ? (
                    <td className={cn('w-10 ps-3', pad)} onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={selection.rowLabel(row)} checked={on} onChange={() => toggle(id)} />
                    </td>
                  ) : null}
                  {visible.map((c) => (
                    <td key={c.key} className={cn('px-3 align-middle', pad, c.align === 'end' ? 'text-end' : 'text-start', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.ltr ? <Ltr className="whitespace-nowrap">{c.cell(row)}</Ltr> : c.cell(row)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className={cn('sticky end-0 bg-ink-surface px-3 text-end align-middle', pad)} onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {card ? (
        <ul aria-label={label} className="divide-y divide-line-hairline md:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} data-row={rowKey(row)}>
              {card(row)}
            </li>
          ))}
        </ul>
      ) : null}
      {footer ? <div className="border-t border-line-hairline">{footer}</div> : null}
    </div>
  );
}

/* ---------- Selection bar: "3 produits sélectionnés · 2 avec variantes" + bulk actions ---------- */
export type BulkAction = { key: string; label: string; onSelect: () => void; destructive?: boolean; disabledReason?: string };
export function BulkBar({
  summary,
  actions,
  note,
  selectAll,
  deselectLabel,
  onDeselect,
  label,
}: {
  summary: string;
  actions: BulkAction[];
  /** "Les actions groupées renvoient un résultat par produit (ok / erreur) — jamais tout ou rien." */
  note?: string;
  selectAll?: { label: string; onSelect: () => void };
  deselectLabel: string;
  onDeselect: () => void;
  label: string;
}) {
  return (
    <div role="region" aria-label={label} className="flex flex-col gap-2 max-md:hidden">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line-edge bg-ink-surface px-3 py-2">
        <span className="me-2 text-[14px] font-medium" aria-live="polite">
          {summary}
        </span>
        {actions.map((a) => (
          <Button key={a.key} size="sm" onClick={a.onSelect} disabledReason={a.disabledReason} className={cn(a.destructive && 'border-accent-alert/60 text-accent-alert hover:border-accent-alert')}>
            {a.label}
          </Button>
        ))}
        <span className="flex-1" />
        {selectAll ? (
          <Button size="sm" variant="ghost" onClick={selectAll.onSelect}>
            {selectAll.label}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDeselect}>
          {deselectLabel}
        </Button>
      </div>
      {note ? <p className="ts-label-meta text-text-muted">{note}</p> : null}
    </div>
  );
}

/* ---------- Density + column visibility menu ---------- */
export function TableViewMenu({
  label,
  density,
  onDensityChange,
  densityLabel,
  densityOptions,
  columns,
  hidden,
  onHiddenChange,
  columnsLabel,
}: {
  label: string;
  density: Density;
  onDensityChange: (d: Density) => void;
  densityLabel: string;
  densityOptions: Record<Density, string>;
  columns?: { key: string; label: string }[];
  hidden?: readonly string[];
  onHiddenChange?: (next: string[]) => void;
  columnsLabel?: string;
}) {
  const item = 'flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-ink-raised-high';
  const mark = (on: boolean) => <span aria-hidden className={cn('size-2 rounded-full border', on ? 'border-white bg-white' : 'border-text-muted')} />;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost" aria-label={label} title={label} className="!px-0 w-10">
          <SlidersHorizontal className="size-4" aria-hidden />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl">
          <Dropdown.Label className="px-2.5 py-1.5 ts-label-micro text-text-muted">{densityLabel}</Dropdown.Label>
          <Dropdown.RadioGroup value={density} onValueChange={(v) => onDensityChange(v as Density)}>
            {(['comfortable', 'compact'] as const).map((d) => (
              <Dropdown.RadioItem key={d} value={d} className={item}>
                {mark(density === d)}
                {densityOptions[d]}
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
          {columns?.length && onHiddenChange ? (
            <>
              <Dropdown.Separator className="my-1 h-px bg-line-hairline" />
              <Dropdown.Label className="px-2.5 py-1.5 ts-label-micro text-text-muted">{columnsLabel}</Dropdown.Label>
              {columns.map((c) => {
                const on = !hidden?.includes(c.key);
                return (
                  <Dropdown.CheckboxItem
                    key={c.key}
                    checked={on}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(v) => onHiddenChange(v ? (hidden ?? []).filter((k) => k !== c.key) : [...(hidden ?? []), c.key])}
                    className={item}
                  >
                    <span aria-hidden className={cn('flex size-3.5 items-center justify-center rounded-[3px] border', on ? 'border-white bg-white' : 'border-text-muted')} />
                    {c.label}
                  </Dropdown.CheckboxItem>
                );
              })}
            </>
          ) : null}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
