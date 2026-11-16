'use client';
// /admin/viewers/products?workspaceId= — Figma "ADM-17 — Platform admin — read-only viewers (conversation, products)":
// "{workspace} — visionneuses (lecture seule)", conversations list (→ thread viewer) and products list (→ read-only
// sheet `?sheet=<id>`). Badge "LECTURE SEULE · JOURNALISÉ". Every open is audited (`viewer.open`).
import type { AdminWorkspaceDetailDto } from '@djaber/shared';
import { MonoChip } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AdminPage } from '@/features/admin/admin-page';
import { useAdminGet } from '@/features/admin/api';
import { ConversationList, ProductsViewer } from '@/features/admin/viewers/parts';
import { useT } from '@/lib/i18n';

export default function AdminViewersPage() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const workspaceId = params.get('workspaceId');
  const ws = useAdminGet<AdminWorkspaceDetailDto>(workspaceId ? `/admin/workspaces/${workspaceId}` : null);
  const setSheet = (id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set('sheet', id);
    else p.delete('sheet');
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  return (
    <AdminPage
      permission="admin.workspaces.read"
      // full-test 15/11 ADMIN-17: without a workspace (or while it loads) the page is « Visionneuses (lecture seule) », never « … — »
      title={ws.data?.name ? t('admin.viewers.title', { workspace: ws.data.name }) : t('admin.viewers.titlePlain')}
      description={t('admin.viewers.description')}
      badges={<MonoChip tone="danger">{t('admin.viewers.badge')}</MonoChip>}
    >
      {!workspaceId ? (
        <p className="ts-label-meta text-text-muted">{t('admin.viewers.pickWorkspace')}</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ConversationList workspaceId={workspaceId} />
          <ProductsViewer workspaceId={workspaceId} sheet={params.get('sheet')} onOpen={setSheet} />
        </div>
      )}
    </AdminPage>
  );
}
