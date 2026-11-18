'use client';
// ADM-17 read-only viewers: conversation thread (opened with a reason → audit `viewer.open`; phones masked; "Afficher"
// for super admin with a reason → `viewer.unmask`; no composer, no export) and the products list with validation + IA
// pills (detail sheet: gallery, description, variants, moderation history).
import type { AdminViewerConversationDto, AdminViewerConversationRowDto, AdminViewerProductDto, AdminViewerProductRowDto } from '@djaber/shared';
import { Button, Card, FormAlert, FrameNote, ListSkeleton, MonoChip, OpsPanel, SideSheet, ViewerMessage } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useT, type TFunction } from '@/lib/i18n';
import { useStickToBottom } from '@/lib/stick-to-bottom';
import { AdminQueryError } from '../admin-page';
import { adminWrite, useAdminGet, useAdminList } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { usePlatform } from '../platform';
import { Money, useFormats } from '../ui';

const MOD_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = { approved: 'success', rejected: 'danger', pending: 'warning', changes_requested: 'warning', appealed: 'warning', not_required: 'neutral' };
/** validation pill: product status, or the latest moderation decision « MODIFICATION DEMANDÉE » (ADMIN-10) */
const modLabel = (t: TFunction, s: string) => (t.has(`enum.Product.moderationStatus.${s}`) ? t(`enum.Product.moderationStatus.${s}`) : t.has(`adminMod.status.${s}`) ? t(`adminMod.status.${s}`) : s);
const AI_TONE: Record<string, 'success' | 'neutral' | 'warning'> = { proposed: 'success', excluded: 'neutral', stale: 'warning' };

export function ConversationList({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminList<AdminViewerConversationRowDto>('/admin/conversations', { workspaceId, pageSize: 25 });
  return (
    <OpsPanel title={t('admin.viewers.conversations.title')} data-testid="viewer-conversations">
      {q.isPending ? (
        <ListSkeleton rows={4} columns={2} label={t('common.loading')} />
      ) : q.isError ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 ? (
        <p className="py-6 text-center ts-label-meta text-text-muted">{t('admin.viewers.conversations.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline">
          {q.data.rows.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/viewers/conversations/${c.id}`} className="flex items-center gap-3 px-1 py-2.5 text-[13px] hover:bg-ink-raised">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.customer.name} · <span dir="ltr">{c.customer.phone ?? '—'}</span></span>
                  <span className="block truncate ts-label-micro text-text-muted">{c.channel.name} · {c.lastMessagePreview ?? '—'}</span>
                </span>
                <span className="ts-label-micro text-text-muted">{f.ago(c.lastMessageAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OpsPanel>
  );
}

/** Thread viewer: the reason is asked first (every open is audited), then the masked thread. */
export function ConversationViewer({ id }: { id: string }) {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const [reason, setReason] = useState('');
  const [data, setData] = useState<AdminViewerConversationDto | null>(null);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const [unmask, setUnmask] = useState(false);
  const thread = useStickToBottom<HTMLDivElement>(data ? `${data.id}:${data.messages.length}:${data.masked}` : null);
  const open = useMutation({ mutationFn: (r: string) => api<AdminViewerConversationDto>(`/admin/conversations/${id}`, { query: { reason: r } }) });
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      setData(await open.mutateAsync(reason.trim()));
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  if (!data) {
    return (
      <Card className="flex w-full flex-col gap-3 p-5" data-testid="viewer-reason">
        <h2 className="text-[15px] font-medium">{t('admin.viewers.reason.title')}</h2>
        <p className="ts-label-meta text-text-muted">{t('admin.viewers.reason.body')}</p>
        <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
        {errors.form ? <FormAlert>{errors.form}</FormAlert> : null}
        <Button variant="primary" className="w-fit" disabled={!reasonOk(reason)} loading={open.isPending} onClick={() => void submit()} data-testid="viewer-open">
          {t('admin.viewers.reason.submit')}
        </Button>
      </Card>
    );
  }
  const author = (m: AdminViewerConversationDto['messages'][number]) => (m.author === 'customer' ? t('admin.viewers.author.customer') : m.author === 'ai' ? `${t('admin.viewers.author.ai')}${data.agent ? ` · ${data.agent.name.toUpperCase()}` : ''}` : m.author === 'system' ? t('admin.viewers.author.system') : m.authorLabel);
  return (
    <OpsPanel
      title={t('admin.viewers.thread.title', { id: data.id.slice(0, 6), workspace: data.workspace.name, platform: data.channel.platform === 'instagram' ? 'IG' : 'FB', customer: data.customer.name })}
      end={data.masked && can('admin.workspaces.unmask') ? <Button size="sm" variant="ghost" onClick={() => setUnmask(true)} data-testid="viewer-unmask">{t('admin.viewers.unmask.cta')}</Button> : undefined}
      data-testid="viewer-thread"
    >
      {/* long conversations scroll inside the panel (sized to the screen, opened on the latest message) */}
      <div ref={thread.ref} onScroll={thread.onScroll} className="-mx-1 flex max-h-[max(18rem,calc(100dvh-22rem))] flex-col gap-2 overflow-y-auto overscroll-contain px-1" data-testid="viewer-messages">
        {data.messages.map((m) => (
          <ViewerMessage key={m.id} author={author(m)} at={f.shortTime(m.at).split(' ').pop() ?? ''}>
            {m.text ? `« ${m.text} »` : m.attachments.map((a) => `[${a.type}]`).join(' ')}
          </ViewerMessage>
        ))}
      </div>
      <FrameNote className="mt-3">{data.masked ? t('admin.viewers.thread.maskedNote') : t('admin.viewers.thread.unmaskedNote')}</FrameNote>
      <UnmaskDialog id={id} open={unmask} onClose={() => setUnmask(false)} onDone={setData} />
    </OpsPanel>
  );
}

function UnmaskDialog({ id, open, onClose, onDone }: { id: string; open: boolean; onClose: () => void; onDone: (c: AdminViewerConversationDto) => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (r: string) => adminWrite<AdminViewerConversationDto>(`/admin/conversations/${id}/unmask`, 'POST', { reason: r }) });
  useOnOpen(open, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      onDone(await m.mutateAsync(reason.trim()));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} testId="dlg-unmask" size="sm" title={t('admin.viewers.unmask.title')} note={t('admin.viewers.unmask.note')} submitLabel={t('admin.viewers.unmask.cta')} disabled={!reasonOk(reason)} pending={m.isPending} error={errors.form} onSubmit={() => void submit()}>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

export function ProductsViewer({ workspaceId, sheet, onOpen }: { workspaceId: string; sheet: string | null; onOpen: (id: string | null) => void }) {
  const t = useT();
  const q = useAdminList<AdminViewerProductRowDto>('/admin/products', { workspaceId, pageSize: 50 });
  return (
    <OpsPanel title={t('admin.viewers.products.title', { count: q.data?.total ?? 0 })} data-testid="viewer-products">
      {q.isPending ? (
        <ListSkeleton rows={4} columns={3} label={t('common.loading')} />
      ) : q.isError ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 ? (
        <p className="py-6 text-center ts-label-meta text-text-muted">{t('admin.viewers.products.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line-hairline">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-hairline">
                {['product', 'price', 'validation', 'ai'].map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start ts-label-micro uppercase text-text-muted">
                    {t(`admin.viewers.products.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-line-hairline last:border-0 hover:bg-ink-raised" onClick={() => onOpen(p.id)} data-product={p.id}>
                  <td className="px-3 py-2.5">{p.name}</td>
                  <td className="px-3 py-2.5">
                    {/* journey J13r-8: a variant product sells at its variants' prices — the base price is hidden from customers */}
                    {p.priceRange && p.priceRange.min !== p.priceRange.max ? (
                      <span className="whitespace-nowrap">
                        <Money value={p.priceRange.min} /> – <Money value={p.priceRange.max} />
                      </span>
                    ) : (
                      <Money value={p.priceRange ? p.priceRange.min : p.price} />
                    )}
                  </td>
                  <td className="px-3 py-2.5"><MonoChip tone={MOD_TONE[p.moderationStatus] ?? 'neutral'}>{modLabel(t, p.moderationStatus)}</MonoChip></td>
                  <td className="px-3 py-2.5">{p.aiStatus ? <MonoChip tone={AI_TONE[p.aiStatus] ?? 'neutral'}>{t(`admin.viewers.ai.${p.aiStatus}`)}</MonoChip> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FrameNote className="mt-3">{t('admin.viewers.products.note')}</FrameNote>
      <ProductSheet id={sheet} onClose={() => onOpen(null)} />
    </OpsPanel>
  );
}

function ProductSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminGet<AdminViewerProductDto>(id ? `/admin/products/${id}` : null);
  const p = q.data;
  return (
    <SideSheet open={!!id} onClose={onClose} title={p?.name ?? t('common.loading')} subtitle={p ? `${p.sku ?? '—'} · ${p.category ?? '—'}` : undefined} closeLabel={t('action.close')}>
      {q.isPending ? (
        <ListSkeleton rows={5} columns={2} label={t('common.loading')} />
      ) : q.isError || !p ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4 text-[13px]" data-testid="viewer-product">
          {p.images.length ? (
            <div className="grid grid-cols-3 gap-2">
              {p.images.map((im) => (
                <img key={im.url} src={im.url} alt="" className="aspect-square w-full rounded-card object-cover" />
              ))}
            </div>
          ) : null}
          <p className="whitespace-pre-line text-text-secondary">{p.description ?? '—'}</p>
          {p.variants.length ? (
            <ul className="flex flex-col divide-y divide-line-hairline rounded-card border border-line-hairline">
              {p.variants.map((v) => (
                <li key={v.id} className="flex gap-3 px-3 py-2">
                  <span className="flex-1">{v.name}</span>
                  <Money value={v.price ?? p.price} />
                  <span className="text-text-muted">{v.stock}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <div className="ts-label-micro uppercase text-text-muted">{t('admin.viewers.product.history')}</div>
            <ul className="mt-1 flex flex-col gap-1">
              {p.moderationHistory.map((h, i) => (
                <li key={i} className="text-text-secondary">
                  {f.shortTime(h.at)} · {t.has(`adminMod.status.${h.status}`) ? t(`adminMod.status.${h.status}`) : h.status}
                  {h.decision ? ` · ${t.has(`adminMod.decision.${h.decision}`) ? t(`adminMod.decision.${h.decision}`) : h.decision}` : ''}
                  {h.note ? ` · ${h.note}` : ''}
                </li>
              ))}
              {p.moderationHistory.length === 0 ? <li className="text-text-muted">—</li> : null}
            </ul>
          </div>
          {p.moderationStatus === 'pending' ? (
            <Link href={`/admin/moderation?q=${encodeURIComponent(p.name)}`} className="text-accent-inbound hover:underline">
              {t('admin.viewers.product.openModeration')}
            </Link>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}

