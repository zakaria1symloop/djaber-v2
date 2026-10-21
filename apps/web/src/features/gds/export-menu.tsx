'use client';
// "Exporter ⌄" of /purchases and /sales (Figma GDS-07 / GDS-08; carry-over M7 → M8): `GET /purchases/export` |
// `GET /sales/export` with the current list filters and `format=csv|xlsx` → 202 job (kind `export`), followed by the
// progress toast and listed in Rapports › Exports récents.
import { formatNumber } from '@djaber/shared';
import { Button, Menu, MenuItem, toast } from '@djaber/ui';
import { ChevronDown } from 'lucide-react';
import { refusal } from '@/features/orders/dialogs/common';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, type JobRef, trackJob } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';

export function ListExportMenu({ path, filters, entity, file, disabledReason }: { path: '/purchases/export' | '/sales/export'; filters: ApiQuery; entity: string; file: string; disabledReason?: string }) {
  const t = useT();
  const run = async (format: 'csv' | 'xlsx') => {
    try {
      const { jobId } = await api<JobRef>(path, { query: { ...filters, format } });
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (j) => t('toast.export.progress', { entity, pct: j.progress, rows: formatNumber(j.total ?? 0) }),
        done: (j) => ({ message: t('toast.export.done', { file: `${file} · ${format.toUpperCase()}` }), action: j.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(j.resultUrl!, jobFileName(j)) } : undefined }),
        failed: (j, e) => (j?.error ? `${j.error.message} (${j.error.code})` : refusal(e, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  if (disabledReason) {
    return (
      <Button variant="ghost" disabledReason={disabledReason} data-testid="list-export">
        {t('action.export')}
      </Button>
    );
  }
  return (
    <Menu
      trigger={
        <Button variant="ghost" data-testid="list-export">
          {t('action.export')}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      }
    >
      <MenuItem onSelect={() => void run('xlsx')} data-export="xlsx">
        XLSX
      </MenuItem>
      <MenuItem onSelect={() => void run('csv')} data-export="csv">
        CSV
      </MenuItem>
    </Menu>
  );
}
