'use client';
// Behaviour section (wizard step 3 = "Comportement" of the Configuration tab) — Figma "AGT-02 — Agent wizard — step 3
// behaviour": capabilities with their credit cost, order-taking fields (locked ones carry a padlock), limits, risky
// client and recap rules, handoff checklist + keywords, business hours, response delay, product card template and
// closing instructions. The handoff / out-of-hours texts are the workspace system messages (read-only here, R-G).
// The model is assigned by the platform routing (`GET /ai/routes`): read-only badge, never a choice (D54).
import { Button, Checkbox, CheckChip, Dialog, Field, FormAlert, FormSection, Ltr, MoneyInput, NumberInput, RangeSlider, ScheduleEditor, Select, TagInput, Textarea, ToggleRow } from '@djaber/ui';
import { CREDIT_COST, formatMoney, type AppLocale } from '@djaber/shared';
import { useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useAiRoutes } from '../api';
import type { CapabilityKey } from '../contracts';
import { CAPABILITY_KEYS, HANDOFF_RULES } from '../contracts';
import { CLOSING_MAX, DELAY_MAX, DELAY_MIN, KEYWORD_MAX_LENGTH, KEYWORDS_MAX, ruleOn, setOrderField, setRule, TEMPLATE_MAX } from '../logic';
import { ModelBadge } from '../ui';
import { issueText, type SectionProps } from './identity';

const COST: Partial<Record<CapabilityKey, number>> = { replyText: CREDIT_COST.text, imageRecognition: CREDIT_COST.image, voiceTranscription: CREDIT_COST.voice, takeOrders: CREDIT_COST.order };
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** The placeholders offered as chips (the stock is never given to customers as a number: {stock} reads « en stock »). */
export const TEMPLATE_PLACEHOLDERS = ['name', 'price', 'description', 'stock'] as const;
/** Product card template placeholders (03 AGT-02) filled with a sample product for the live preview. */
export const renderCardTemplate = (template: string, sample: { name: string; price: string; description: string; stock: string }): string =>
  template.replace(/\[PRODUCT_CARD\]/g, '').replace(/\{(name|price|description|stock)\}/g, (_m, k: keyof typeof sample) => sample[k]).trim();

export function BehaviourFields({ draft: d, set, errors, readOnly, badge, inTunnel }: SectionProps) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { workspace, can } = useSession();
  const routes = useAiRoutes();
  const [modelInfo, setModelInfo] = useState(false);
  const text = routes.data?.find((r) => r.capability === 'text');
  const failover = (routes.data ?? []).some((r) => r.failover);
  const system = (key: 'handoff' | 'out_of_hours') => workspace?.systemMessages?.[key]?.[locale]?.trim() || workspace?.systemMessages?.[key]?.fr?.trim() || '';
  const sample = { name: t('agents.template.sample.name'), price: formatMoney(4900), description: t('agents.template.sample.description'), stock: t('agents.template.sample.stock') };
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const insertPlaceholder = (p: (typeof TEMPLATE_PLACEHOLDERS)[number]) => {
    const el = templateRef.current;
    const value = d.productCardTemplate;
    const token = `{${p}}`;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    set({ productCardTemplate: next });
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <>
      <FormSection
        title={t('agents.capabilities.title')}
        badge={
          <span className="flex items-center gap-2">
            {badge}
            {text ? <ModelBadge label={text.model.label} /> : null}
            {failover ? (
              <button type="button" className="ts-label-meta text-accent-starred hover:underline" onClick={() => setModelInfo(true)} data-testid="model-unavailable-link">
                {t('agents.model.fallback')}
              </button>
            ) : null}
          </span>
        }
        description={t('agents.model.note')}
        data-section="capabilities"
      >
        {CAPABILITY_KEYS.map((k) => (
          <ToggleRow
            key={k}
            name={k}
            checked={d.capabilities[k]}
            // answering text messages is what an agent does: the switch stays on
            disabled={readOnly || k === 'replyText'}
            onChange={(on) => set({ capabilities: { ...d.capabilities, [k]: on } })}
            title={t(`agents.capabilities.${k}`)}
            description={<Ltr>{t(`agents.capabilities.${k}.hint`, { cost: COST[k] ?? 0 })}</Ltr>}
          />
        ))}
      </FormSection>

      <FormSection title={t('agents.order.title')} description={t('agents.order.description')} data-section="order">
        <div role="group" aria-label={t('agents.order.title')} className="flex flex-wrap gap-2">
          {d.orderFields.map((f) => (
            <CheckChip key={f.key} name={f.key} checked={f.locked || f.required} locked={f.locked} lockedLabel={t('agents.order.locked')} disabled={readOnly || !d.capabilities.takeOrders} onChange={(on) => set({ orderFields: setOrderField(d, f.key, on) })}>
              {t(`agents.order.field.${f.key}`)}
            </CheckChip>
          ))}
        </div>
        {!d.capabilities.takeOrders ? (
          <p className="ts-label-meta text-text-muted" data-testid="order-fields-locked">
            {t('gaps.agents.order.needsTakeOrders')}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t('agents.order.maxQty')} htmlFor="agent-max-qty" error={issueText(t, errors.maxQtyPerOrder)} hint={t('agents.order.maxQty.hint')}>
            <NumberInput id="agent-max-qty" maxDigits={4} value={d.maxQtyPerOrder === null ? '' : String(d.maxQtyPerOrder)} disabled={readOnly} aria-invalid={!!errors.maxQtyPerOrder || undefined} onValueChange={(v) => set({ maxQtyPerOrder: v === '' ? null : Number(v) })} />
          </Field>
          <Field label={t('agents.order.maxAmount')} htmlFor="agent-max-amount" error={issueText(t, errors.maxAmountPerOrder)} hint={t('agents.order.maxAmount.hint')}>
            <MoneyInput id="agent-max-amount" value={moneyDigits(d.maxAmountPerOrder)} disabled={readOnly} aria-invalid={!!errors.maxAmountPerOrder || undefined} onValueChange={(v) => set({ maxAmountPerOrder: digitsToInt(v) })} />
          </Field>
          <Field label={t('agents.order.risky')} htmlFor="agent-risky">
            <Select id="agent-risky" value={d.riskyClientBehavior} disabled={readOnly} onChange={(e) => set({ riskyClientBehavior: e.target.value as typeof d.riskyClientBehavior })}>
              <option value="take_and_flag">{t('agents.order.risky.take_and_flag')}</option>
              <option value="handoff">{t('agents.order.risky.handoff')}</option>
            </Select>
          </Field>
          <Field label={t('agents.order.recap')} htmlFor="agent-recap">
            <Select id="agent-recap" value={d.recapMode} disabled={readOnly} onChange={(e) => set({ recapMode: e.target.value as typeof d.recapMode })}>
              <option value="always">{t('agents.order.recap.always')}</option>
              <option value="when_unsure">{t('agents.order.recap.when_unsure')}</option>
            </Select>
          </Field>
        </div>
      </FormSection>

      <FormSection title={t('agents.handoff.title')} description={t('agents.handoff.description')} data-section="handoff">
        <div role="group" aria-label={t('agents.handoff.title')} className="flex flex-col gap-3">
          {HANDOFF_RULES.map((kind) => (
            <label key={kind} data-rule={kind} className="flex cursor-pointer items-center gap-3 text-[14px]">
              <Checkbox checked={ruleOn(d, kind)} disabled={readOnly} onChange={(e) => set({ handoffRules: setRule(d, kind, e.target.checked) })} />
              <span>{t(`agents.handoff.rule.${kind}`)}</span>
            </label>
          ))}
        </div>
        {ruleOn(d, 'keyword') ? (
          <Field label={t('agents.handoff.keywords')} htmlFor="agent-keywords" error={issueText(t, errors.handoffKeywords)} hint={t('agents.handoff.keywords.hint', { max: KEYWORDS_MAX })}>
            <TagInput id="agent-keywords" label={t('agents.handoff.keywords')} value={d.handoffKeywords} max={KEYWORDS_MAX} maxLength={KEYWORD_MAX_LENGTH} disabled={readOnly} invalid={!!errors.handoffKeywords} placeholder={t('agents.handoff.keywords.placeholder')} removeLabel={(tag) => t('agents.handoff.keywords.remove', { tag })} onChange={(v) => set({ handoffKeywords: v })} />
          </Field>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <SystemMessage label={t('agents.handoff.message')} text={system('handoff')} canEdit={!inTunnel && can('workspace.settings')} />
          <SystemMessage label={t('agents.handoff.outOfHours')} text={system('out_of_hours')} canEdit={!inTunnel && can('workspace.settings')} />
        </div>
        <ScheduleEditor
          value={d.businessHours}
          onChange={(v) => set({ businessHours: v })}
          disabled={readOnly}
          dayLabels={DAY_KEYS.map((k) => t(`agents.hours.day.${k}`))}
          labels={{ enabled: t('agents.hours.enabled'), enabledHint: t('agents.hours.hint'), days: t('agents.hours.days'), from: t('agents.hours.from'), to: t('agents.hours.to') }}
          error={issueText(t, errors.businessHours)}
        />
        <Field label={t('agents.delay.label')} htmlFor="agent-delay" error={issueText(t, errors.responseDelaySec)} hint={t('agents.delay.hint')}>
          <RangeSlider id="agent-delay" label={t('agents.delay.label')} min={DELAY_MIN} max={DELAY_MAX} value={d.responseDelaySec} disabled={readOnly} onChange={(v) => set({ responseDelaySec: v })} format={(v) => (v === 0 ? t('agents.delay.none') : t('agents.delay.value', { seconds: v }))} />
        </Field>
      </FormSection>

      <FormSection title={t('agents.template.title')} description={t('agents.template.description')} data-section="template">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={t('agents.template.label')} htmlFor="agent-template" error={issueText(t, errors.productCardTemplate)} hint={t('agents.template.hint')}>
            <Textarea ref={templateRef} id="agent-template" dir="auto" value={d.productCardTemplate} maxLength={TEMPLATE_MAX + 100} disabled={readOnly} placeholder="{name} — {price}" aria-invalid={!!errors.productCardTemplate || undefined} onChange={(e) => set({ productCardTemplate: e.target.value })} />
            {/* recette 09/11 (Badro): the placeholders are picked, not typed — one click writes « {price} » where the cursor is */}
            <div role="group" aria-label={t('agents.template.insert')} className="flex flex-wrap items-center gap-1.5" data-testid="template-placeholders">
              <span className="ts-label-meta text-text-muted">{t('agents.template.insert')}</span>
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={readOnly}
                  data-placeholder={p}
                  title={t(`agents.template.placeholder.${p}`)}
                  onClick={() => insertPlaceholder(p)}
                  className="rounded-[4px] border border-line-edge bg-ink-surface px-2 py-0.5 font-mono text-[12px] text-accent-inbound hover:border-accent-inbound disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <bdi dir="ltr">{`{${p}}`}</bdi>
                </button>
              ))}
            </div>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="ts-label-meta uppercase text-text-secondary">{t('agents.template.preview')}</span>
            <p dir="auto" data-testid="template-preview" className="min-h-24 whitespace-pre-wrap rounded-card border border-line-hairline bg-ink-base px-3 py-2 text-[13px]">
              {d.productCardTemplate.trim() ? renderCardTemplate(d.productCardTemplate, sample) : <span className="text-text-muted">{t('agents.template.previewEmpty')}</span>}
            </p>
          </div>
        </div>
        <Field label={t('agents.closing.label')} htmlFor="agent-closing" error={issueText(t, errors.closingInstructions)} hint={t('agents.closing.hint')}>
          <Textarea id="agent-closing" dir="auto" className="!min-h-16" value={d.closingInstructions} maxLength={CLOSING_MAX + 100} disabled={readOnly} aria-invalid={!!errors.closingInstructions || undefined} onChange={(e) => set({ closingInstructions: e.target.value })} />
        </Field>
      </FormSection>

      <Dialog
        open={modelInfo}
        onOpenChange={setModelInfo}
        title={t('dialog.modelUnavailable.title')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setModelInfo(false)}>
            {t('action.ok')}
          </Button>
        }
      >
        <FormAlert tone="warning">
          {t('agents.model.unavailable')}
        </FormAlert>
      </Dialog>
    </>
  );
}

/** Workspace system message shown read-only, with the link to Settings › Messages système. */
function SystemMessage({ label, text, canEdit }: { label: string; text: string; canEdit: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="ts-label-meta uppercase text-text-secondary">{label}</span>
      <blockquote dir="auto" className="min-h-16 rounded-card border border-line-hairline bg-ink-base px-3 py-2 text-[13px] text-text-secondary">
        {text ? `« ${text} »` : t('agents.handoff.messageEmpty')}
      </blockquote>
      {canEdit ? (
        <Link href="/settings/system-messages" className="w-fit text-[12px] text-accent-inbound hover:underline">
          {t('agents.handoff.editMessage')}
        </Link>
      ) : null}
    </div>
  );
}
