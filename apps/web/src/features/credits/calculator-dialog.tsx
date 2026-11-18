'use client';
// DLG "Calculateur de crédits" (Figma "DLG — Settings & billing", PCK-05, AT-BIL-07 / AT-PCK-04): conversations / month,
// % with photo, % with voice, AI messages / conversation ⇒ `GET /credits/calculator` (every member,
// `billing.read_credits`): the formula line, the suggested plan + packs, the coverage of each plan. "Voir les packs"
// opens the pack purchase (credits page).
import { formatNumber } from '@djaber/shared';
import { Button, buttonClass, cn, Dialog, EstimateBox, Field, NumberInput, Table, Td, Th, Tr } from '@djaber/ui';
import { useEffect, useMemo, useState } from 'react';
import { useCalculator } from '@/features/billing/api';
import { CALCULATOR_DEFAULT, estimateCredits, normalizeCalculator, type CalculatorInput } from '@/features/billing/logic';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Draft = Record<keyof CalculatorInput, string>;
const toDraft = (i: CalculatorInput): Draft => ({ conversations: String(i.conversations), photoPct: String(i.photoPct), voicePct: String(i.voicePct), msgsPerConv: String(i.msgsPerConv) });
const fromDraft = (d: Draft): CalculatorInput => normalizeCalculator({ conversations: Number(d.conversations || 0), photoPct: Number(d.photoPct || 0), voicePct: Number(d.voicePct || 0), msgsPerConv: Number(d.msgsPerConv || 1) });

export function CalculatorDialog({ open, onClose, onSeePacks }: { open: boolean; onClose: () => void; /** credits page: opens "Acheter un pack"; elsewhere the link goes to the credits page */ onSeePacks?: () => void }) {
  const t = useT();
  const { can } = useSession();
  const [draft, setDraft] = useState<Draft>(toDraft(CALCULATOR_DEFAULT));
  const [input, setInput] = useState<CalculatorInput>(CALCULATOR_DEFAULT);
  useEffect(() => {
    if (open) {
      setDraft(toDraft(CALCULATOR_DEFAULT));
      setInput(CALCULATOR_DEFAULT);
    }
  }, [open]);
  // the server is asked once the typing pauses (300 ms)
  useEffect(() => {
    const id = setTimeout(() => setInput(fromDraft(draft)), 300);
    return () => clearTimeout(id);
  }, [draft]);
  const q = useCalculator(input, open);
  const local = useMemo(() => estimateCredits(fromDraft(draft)), [draft]);
  const r = q.data && !q.isPlaceholderData ? q.data : null;
  const shown = r ? { textTurns: r.textTurns, imageTurns: r.imageTurns, voiceTurns: r.voiceTurns, credits: r.credits } : local;
  const s = r?.suggestion ?? null;

  // journey J12-2: a « -5 » (refused by the NumberInput since J06r-2; kept as a guard) — the field says its range (the estimate
  // counts it as the minimum)
  const RANGE: Record<keyof CalculatorInput, [number, number]> = { conversations: [0, 1_000_000], photoPct: [0, 100], voicePct: [0, 100], msgsPerConv: [1, 200] };
  const field = (k: keyof CalculatorInput, label: string, suffix?: string, max = 9) => (
    <Field label={label} htmlFor={`calc-${k}`} error={draft[k].startsWith('-') ? t('validation.range', { min: formatNumber(RANGE[k][0]), max: formatNumber(RANGE[k][1]) }) : undefined}>
      <NumberInput id={`calc-${k}`} value={draft[k]} onValueChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} suffix={suffix} maxDigits={max} data-testid={`calc-${k}`} />
    </Field>
  );

  const suggestion = s
    ? [t('credits.calc.suggestion.plan', { plan: s.planName, credits: formatNumber(r?.plans?.find((p) => p.planId === s.planId)?.monthlyCredits ?? 0) }), ...s.packs.map((p) => t('credits.calc.suggestion.pack', { count: p.quantity, name: p.name }))].join(' + ')
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.creditCalculator.title')}
      description={t('credits.calc.context')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          {onSeePacks ? (
            <Button variant="primary" onClick={onSeePacks} data-testid="calc-see-packs">
              {t('credits.calc.seePacks')}
            </Button>
          ) : can('billing.write') ? (
            <Link href="/settings/credits?buy=1" className={buttonClass({ variant: 'primary' })} onClick={onClose} data-testid="calc-see-packs">
              {t('credits.calc.seePacks')}
            </Link>
          ) : (
            <Button variant="primary" disabledReason={t('billing.writeOnly')} data-testid="calc-see-packs">
              {t('credits.calc.seePacks')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="calculator-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          {field('conversations', t('credits.calc.conversations'))}
          {field('msgsPerConv', t('credits.calc.msgsPerConv'), undefined, 3)}
          {field('photoPct', t('credits.calc.photoPct'), '%', 3)}
          {field('voicePct', t('credits.calc.voicePct'), '%', 3)}
        </div>
        <EstimateBox data-testid="calc-result" data-credits={shown.credits}>
          <span className={cn(q.isFetching && 'opacity-70')}>
            {t('credits.calc.formula', { text: formatNumber(shown.textTurns), image: formatNumber(shown.imageTurns), voice: formatNumber(shown.voiceTurns), total: formatNumber(shown.credits) })}
            {suggestion ? ` → ${suggestion}` : ''}
            {s ? ` · ${t('credits.calc.monthly', { amount: formatNumber(s.totalMonthlyDzd) })}` : ''}
          </span>
        </EstimateBox>
        {q.isError ? <p className="ts-label-meta text-accent-alert">{errorMessage(q.error, t)}</p> : null}
        {r?.plans?.length ? (
          <div className="overflow-hidden rounded-card border border-line-edge">
            <Table aria-label={t('credits.calc.plans')}>
              <thead>
                <tr>
                  <Th>{t('credits.calc.col.plan')}</Th>
                  <Th className="text-end">{t('credits.calc.col.credits')}</Th>
                  <Th className="text-end">{t('credits.calc.col.covers')}</Th>
                </tr>
              </thead>
              <tbody>
                {r.plans.map((p) => (
                  <Tr key={p.planId} data-testid="calc-plan" data-plan={p.slug} className={cn(s?.planId === p.planId && 'bg-ink-raised')}>
                    <Td>{p.name}</Td>
                    <Td className="text-end tabular-nums">
                      <bdi dir="ltr">{p.monthlyCredits < 0 ? '∞' : formatNumber(p.monthlyCredits)}</bdi>
                    </Td>
                    <Td className={cn('text-end tabular-nums', p.coversPct >= 100 ? 'text-accent-money' : 'text-text-secondary')}>
                      <bdi dir="ltr">{p.coversPct >= 100 ? t('credits.calc.covered') : t('credits.calc.missing', { pct: Math.round(p.coversPct), missing: formatNumber(p.missingCredits) })}</bdi>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
        <p className="ts-label-meta text-text-muted">{t('credits.calc.costs')}</p>
      </div>
    </Dialog>
  );
}
