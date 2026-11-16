'use client';
// /admin/plans — Figma "ADM-04 — Platform admin — plans editor" + DLG "Créer un plan" / "Supprimer le plan « … »".
// Cards VISIBLE / POPULAIRE / ARCHIVÉ · n ABONNÉS RESTANTS, inline editor `?edit=<id>` with version n → n+1 and the
// server impact preview, Dupliquer (= create dialog prefilled), Migrer les abonnés, delete blocked by PLAN_IN_USE.
import type { PlanAdminDto } from '@djaber/shared';
import { ActionsMenu, AdminCard, Button, Card, EmptyState, MonoChip, PlanCardsSkeleton, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { adminWrite, useAdminGet, useAdminInvalidate } from '@/features/admin/api';
import { CreatePlanDialog, DeletePlanDialog, MigratePlanDialog } from '@/features/admin/plans/dialogs';
import { PlanEditor } from '@/features/admin/plans/editor';
import { draftOf, type PlanDraft } from '@/features/admin/plans/form';
import { usePlatform } from '@/features/admin/platform';
import { useFormats, useLimit } from '@/features/admin/ui';
import { toMenuActions } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';

const FEATURE_LINE = ['voice_notes', 'image_recognition', 'google_sheets', 'api_keys', 'couriers'] as const;

export default function AdminPlansPage() {
  const t = useT();
  const f = useFormats();
  const limit = useLimit();
  const locale = useLocaleCode();
  const { can } = usePlatform();
  const write = can('admin.billing.write');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = useAdminGet<PlanAdminDto[]>('/admin/plans');
  const invalidate = useAdminInvalidate();
  const [create, setCreate] = useState<{ initial: PlanDraft | null } | null>(null);
  const [del, setDel] = useState<PlanAdminDto | null>(null);
  const [migrate, setMigrate] = useState<PlanAdminDto | null>(null);
  const editId = params.get('edit');
  const setEdit = (id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set('edit', id);
    else p.delete('edit');
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const archive = useMutation({ mutationFn: (id: string) => adminWrite(`/admin/plans/${id}/archive`, 'POST', {}) });
  const restore = useMutation({ mutationFn: (id: string) => adminWrite(`/admin/plans/${id}/restore`, 'POST', {}) });
  const run = async (m: typeof archive, id: string, done: string) => {
    try {
      await m.mutateAsync(id);
      void invalidate('/admin/plans');
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const plans = q.data ?? [];
  const editing = plans.find((p) => p.id === editId) ?? null;

  const pill = (p: PlanAdminDto) =>
    p.archivedAt ? (
      <MonoChip tone="warning">{t('admin.plans.pill.archived', { count: p.subscribers })}</MonoChip>
    ) : (
      <MonoChip tone={p.isFeatured ? 'success' : p.isVisible ? 'info' : 'neutral'}>{[p.isVisible ? t('admin.plans.pill.visible') : t('admin.plans.pill.hidden'), p.isFeatured ? t('admin.plans.pill.popular') : null].filter(Boolean).join(' · ')}</MonoChip>
    );
  const menu = (p: PlanAdminDto) =>
    toMenuActions(
      p.actions,
      {
        edit: { label: t('admin.plans.action.edit'), onSelect: () => setEdit(p.id), hidden: !write },
        duplicate: { label: t('admin.plans.action.duplicate'), onSelect: () => setCreate({ initial: draftOf(p) }), hidden: !write },
        migrate: { label: t('admin.plans.action.migrate'), onSelect: () => setMigrate(p), hidden: !write },
        archive: { label: t('admin.plans.action.archive'), onSelect: () => void run(archive, p.id, t('admin.plans.archived')), hidden: !write },
        restore: { label: t('admin.plans.action.restore'), onSelect: () => void run(restore, p.id, t('admin.plans.restored')), hidden: !write },
        delete: { label: t('admin.plans.action.delete'), onSelect: () => setDel(p), destructive: true, hidden: !write, separated: true },
      },
      t,
    );

  return (
    <AdminPage
      permission="admin.billing.read"
      title={t('nav.admin.plans')}
      description={t('admin.plans.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => window.open(`/${locale}/pricing`, '_blank', 'noopener')}>
            {t('admin.plans.previewPricing')}
          </Button>
          {write ? (
            <Button variant="primary" onClick={() => setCreate({ initial: null })} data-testid="new-plan">
              {t('admin.plans.new')}
            </Button>
          ) : null}
        </>
      }
    >
      {q.isPending ? (
        <PlanCardsSkeleton count={4} label={t('common.loading')} />
      ) : q.isError ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : plans.length === 0 ? (
        <Card className="py-6">
          <EmptyState title={t('admin.plans.empty')} action={write ? { label: t('admin.plans.new'), onClick: () => setCreate({ initial: null }), variant: 'primary' } : undefined} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="plan-cards">
          {plans.map((p) => {
            const items = menu(p);
            return (
              <AdminCard
                key={p.id}
                data-plan={p.slug}
                title={p.name}
                muted={!!p.archivedAt}
                pills={pill(p)}
                menu={items.length ? <ActionsMenu label={t('action.actions')} actions={items} heading={p.name} iconOnly variant="ghost" /> : undefined}
                rows={[
                  { label: t('admin.plans.card.credits'), value: t('admin.plans.card.creditsValue', { value: limit(p.limits.monthlyCredits) }) },
                  { label: t('admin.plans.card.limits'), value: t('admin.plans.card.limitsValue', { pages: limit(p.limits.maxPages), agents: limit(p.limits.maxAgents), members: limit(p.limits.maxMembers), products: limit(p.limits.maxProducts) }) },
                  { label: t('admin.plans.card.features'), value: FEATURE_LINE.map((k) => `${t(`admin.plans.feature.${k}`)} ${(p.features ?? p.limits.features).includes(k) ? '✓' : '✗'}`).join(' · ') },
                  { label: t('admin.plans.card.subscribers'), value: t('admin.plans.card.subscribersValue', { count: p.subscribers }) },
                ]}
                actions={
                  write ? (
                    <>
                      <Button size="sm" onClick={() => setEdit(p.id)} aria-pressed={editId === p.id} data-testid={`edit-${p.slug}`}>
                        {t('admin.plans.action.edit')}
                      </Button>
                      {p.archivedAt ? (
                        <Button size="sm" variant="ghost" onClick={() => setMigrate(p)}>
                          {t('admin.plans.action.migrate')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setCreate({ initial: draftOf(p) })}>
                          {t('admin.plans.action.duplicate')}
                        </Button>
                      )}
                    </>
                  ) : undefined
                }
              >
                <div className="text-[15px]">
                  {p.priceMonthly ? t('admin.plans.card.price', { price: f.money(p.priceMonthly) }) : f.money(0)}
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
      {editing ? <PlanEditor key={`${editing.id}:${editing.version}`} plan={editing} canWrite={write} onClose={() => setEdit(null)} onArchive={() => void run(archive, editing.id, t('admin.plans.archived')).then(() => setEdit(null))} /> : null}
      <CreatePlanDialog open={!!create} initial={create?.initial} onClose={() => setCreate(null)} />
      <DeletePlanDialog plan={del} plans={plans} open={!!del} onClose={() => setDel(null)} />
      <MigratePlanDialog plan={migrate} plans={plans} open={!!migrate} onClose={() => setMigrate(null)} />
    </AdminPage>
  );
}
