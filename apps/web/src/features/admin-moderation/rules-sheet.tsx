'use client';
// ADM-10 header "Mots & catégories interdits" (03 MOD-09): the platform lists read by the pre-screen
// (`ModerationRule.kind ∈ blocked_word | protected_brand | prohibited_category | sensitive_category | price_reference`),
// editable by `admin.moderation.write`, every change logged by the API. Side sheet over the queue (`?panel=rules`).
// PV 09/11 « les mots interdits multi langue ar fr en »: banned words and forbidden / sensitive categories are entered in
// French, Arabic and English at once (one rule per language), so a product is caught whatever language its sheet is in.
import { formatMoney, ModerationRuleKindValues, type ModerationRuleDto, type ModerationRuleKind } from '@djaber/shared';
import { Button, ConfirmDialog, FormAlert, IconButton, Input, Ltr, MoneyInput, SideSheet, Skeleton, Switch, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AdminQueryError } from '@/features/admin/admin-page';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { modApi, useModerationRefresh, useModerationRules } from './api';
import { MULTILINGUAL_KINDS, RULE_LOCALES, ruleKey, type RuleLocale } from './rules-logic';

export function RulesSheet({ open, onClose, canWrite }: { open: boolean; onClose: () => void; canWrite: boolean }) {
  const t = useT();
  const q = useModerationRules(open);
  const refresh = useModerationRefresh();
  const [kind, setKind] = useState<ModerationRuleKind>('blocked_word');
  const [value, setValue] = useState('');
  const [words, setWords] = useState<Record<RuleLocale, string>>({ fr: '', ar: '', en: '' });
  const multilingual = (MULTILINGUAL_KINDS as readonly string[]).includes(kind);
  const entries = multilingual ? RULE_LOCALES.filter((l) => words[l].trim()).map((l) => ({ locale: l as RuleLocale | null, value: words[l].trim() })) : value.trim() ? [{ locale: null, value: value.trim() }] : [];
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModerationRuleDto | null>(null);
  const rows = (q.data ?? []).filter((r) => r.kind === kind);

  const create = useMutation({
    mutationFn: async () => {
      for (const e of entries) await modApi.createRule({ key: ruleKey(kind, e.value, e.locale), kind, value: e.value, locale: e.locale, referencePrice: kind === 'price_reference' && price ? Number(price) : undefined, isActive: true });
    },
  });
  const patch = useMutation({ mutationFn: (r: ModerationRuleDto) => modApi.patchRule(r.id, { isActive: !r.isActive }) });
  const remove = useMutation({ mutationFn: (r: ModerationRuleDto) => modApi.deleteRule(r.id) });

  const add = async () => {
    setError(null);
    try {
      await create.mutateAsync();
      setValue('');
      setWords({ fr: '', ar: '', en: '' });
      setPrice('');
      void refresh();
      toast({ tone: 'success', message: t('adminMod.rules.added') });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  const toggle = async (r: ModerationRuleDto) => {
    try {
      await patch.mutateAsync(r);
      void refresh();
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing);
      setRemoving(null);
      void refresh();
      toast({ tone: 'success', message: t('adminMod.rules.removed') });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  return (
    <SideSheet open={open} onClose={onClose} title={t('adminMod.header.lists')} subtitle={t('adminMod.rules.subtitle')} width={460} closeLabel={t('action.close')}>
      <div className="flex flex-col gap-4" data-testid="mod-rules">
        <div role="tablist" aria-label={t('adminMod.rules.kind')} className="flex flex-wrap gap-1.5">
          {ModerationRuleKindValues.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={kind === k ? 'rounded-full border border-white bg-white px-2.5 py-1 text-[12px] text-black' : 'rounded-full border border-line-hairline px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary'}
            >
              {t(`adminMod.rules.kind.${k}`)}
            </button>
          ))}
        </div>
        {canWrite ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            {multilingual ? (
              <div className="flex w-full flex-col gap-1.5">
                {RULE_LOCALES.map((l) => (
                  <Input key={l} aria-label={t(`adminMod.rules.value.${l}`)} placeholder={t(`adminMod.rules.value.${l}`)} value={words[l]} onChange={(e) => setWords((w) => ({ ...w, [l]: e.target.value }))} maxLength={200} dir={l === 'ar' ? 'rtl' : 'ltr'} data-testid={`mod-rule-value-${l}`} />
                ))}
                <p className="ts-label-meta text-text-muted">{t('adminMod.rules.multilingualHint')}</p>
              </div>
            ) : (
              <Input aria-label={t('adminMod.rules.value')} placeholder={t('adminMod.rules.value')} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} className="min-w-40 flex-1" data-testid="mod-rule-value" />
            )}
            {kind === 'price_reference' ? <MoneyInput aria-label={t('adminMod.rules.price')} value={price} onValueChange={setPrice} className="w-36" /> : null}
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!entries.length}>
              {t('action.add')}
            </Button>
          </form>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        {q.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t('adminMod.rules.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-hairline rounded-card border border-line-edge">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2" data-testid="mod-rule">
                <span className="min-w-0 flex-1 truncate text-[14px]" dir="auto">
                  {r.value}
                  {r.locale ? <span className="ms-2 rounded border border-line-hairline px-1 text-[10px] uppercase text-text-muted">{r.locale}</span> : null}
                </span>
                {r.referencePrice !== null ? <Ltr className="ts-label-meta text-text-muted">{formatMoney(r.referencePrice)}</Ltr> : null}
                <Switch checked={r.isActive} onCheckedChange={() => void toggle(r)} disabled={!canWrite} label={t('adminMod.rules.active')} />
                {canWrite ? (
                  <IconButton size="sm" variant="ghost" label={t('action.delete')} onClick={() => setRemoving(r)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('adminMod.rules.removeTitle')}
        description={removing?.value}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void confirmRemove()}
        destructive
        loading={remove.isPending}
        closeLabel={t('action.close')}
      />
    </SideSheet>
  );
}
