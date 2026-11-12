'use client';
// "Contacter le support" (HELP-03, Figma "HELP — Help & support (merchant)" contact card): SUJET (= ticket category;
// Operators get no "Facturation", the API answers 403 FORBIDDEN), PRIORITÉ normale | urgente ("urgent = boutique
// bloquée"), MESSAGE ≥ 20 characters, attachments (captures, CSV — `POST /uploads { kind: ticket_attachment }`),
// editable "CONTEXTE JOINT" (workspace, plan, browser, page, last error — never customer messages), guide suggestion
// before sending, `POST /support/tickets`. Errors stay inside the form, its content is kept; leave guard while dirty.
import { CreateTicketSchema, formatDateTime, TICKET_ATTACHMENTS_MAX, TICKET_MESSAGE_MIN, type AppLocale, type TicketCategory } from '@djaber/shared';
import { Button, cn, Field, FormAlert, Select, Textarea, toast } from '@djaber/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { useRouter } from '@/i18n/navigation';
import { getLastApiError } from '@/lib/api';
import { applyServerErrors, errorMessage, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { helpApi, useHelpArticles, type UploadedFile } from './api';
import { useArticleParam } from './article-sheet';
import { allowedCategories, buildContext, CONTEXT_KEYS, contextPayload, suggestGuide, type AutoContext } from './logic';

const FormSchema = CreateTicketSchema.pick({ category: true, priority: true, message: true });
type Values = z.input<typeof FormSchema>;
/** 5 MB per attachment (same ceiling as the other merchant uploads) */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,text/csv,.csv';

export function ContactForm({ from, compact, className }: { from?: string | null; compact?: boolean; className?: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const categories = allowedCategories(s.role);
  const form = useForm<Values>({ resolver: zodResolver(FormSchema), defaultValues: { category: categories.includes('integrations') ? 'integrations' : categories[0], priority: 'normal', message: '' } });
  const [context, setContext] = useState<AutoContext>(() =>
    buildContext({
      workspace: s.workspace?.name ?? s.membership?.name ?? null,
      plan: s.workspace?.plan?.name ?? null,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      page: from ?? null,
      lastError: getLastApiError(),
      formatAt: (iso) => formatDateTime(iso, locale),
    }),
  );
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useMutation({ mutationFn: helpApi.create });

  const message = useWatch({ control: form.control, name: 'message' }) ?? '';
  const category = useWatch({ control: form.control, name: 'category' }) as TicketCategory;
  const guides = useHelpArticles({});
  const deferred = useDeferredValue(message);
  const suggestion = useMemo(() => (deferred.trim().length >= 8 ? suggestGuide(deferred, category, guides.data ?? []) : null), [deferred, category, guides.data]);
  const article = useArticleParam();
  const dirty = form.formState.isDirty || files.length > 0;
  const { guard } = useLeaveGuard(dirty && !create.isSuccess, t('help.contact.entity'));

  const addFiles = async (list: FileList | null) => {
    setError(null);
    for (const f of Array.from(list ?? [])) {
      if (files.length >= TICKET_ATTACHMENTS_MAX) {
        setError(t('help.contact.attachments.max', { max: TICKET_ATTACHMENTS_MAX }));
        break;
      }
      if (f.size > ATTACHMENT_MAX_BYTES) {
        setError(t('error.UPLOAD_TOO_LARGE', { max: t('help.attachments.maxSize') }));
        continue;
      }
      try {
        setUploading(0);
        const up = await helpApi.upload(f, setUploading);
        setFiles((prev) => [...prev, up]);
      } catch (e) {
        setError(errorMessage(e, t));
      } finally {
        setUploading(null);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await create.mutateAsync({
        category: v.category,
        priority: v.priority ?? 'normal',
        message: v.message,
        attachments: files.map((f) => f.id),
        context: contextPayload(context),
        channel: 'web',
      });
      toast({ tone: 'success', message: t('help.contact.sent', { number: `#${r.number.replace(/^#/, '')}` }) });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'support-tickets' });
      form.reset(v);
      setFiles([]);
      router.push(`/help/tickets/${r.id}`);
    } catch (e) {
      const msg = applyServerErrors(form, e, t, { fields: ['category', 'priority', 'message'] });
      if (msg) setError(msg);
    }
  });

  const tooShortHint = t('help.contact.message.hint', { min: TICKET_MESSAGE_MIN });
  return (
    <form onSubmit={onSubmit} noValidate data-testid="contact-form" className={cn('flex flex-col gap-3', className)}>
      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        <Field label={t('help.contact.category')} htmlFor="ticket-category" error={fieldError(t, form.formState.errors.category?.message)}>
          <Select id="ticket-category" {...form.register('category')} data-testid="ticket-category">
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(`enum.Ticket.category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('help.contact.priority')} htmlFor="ticket-priority" hint={t('help.contact.priority.hint')}>
          <Select id="ticket-priority" {...form.register('priority')} data-testid="ticket-priority">
            <option value="normal">{t('enum.Ticket.priority.normal')}</option>
            <option value="urgent">{t('enum.Ticket.priority.urgent')}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('help.contact.message')} htmlFor="ticket-message" error={form.formState.errors.message?.type === 'too_small' ? t('help.contact.message.min', { min: TICKET_MESSAGE_MIN }) : fieldError(t, form.formState.errors.message?.message, { max: 5000 })} hint={tooShortHint}>
        <Textarea id="ticket-message" rows={compact ? 3 : 6} placeholder={t('help.contact.message.placeholder')} {...form.register('message')} data-testid="ticket-message" />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" id="ticket-files" tabIndex={-1} aria-label={t('help.contact.attachments.add')} onChange={(e) => void addFiles(e.target.files)} data-testid="ticket-files" />
        <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} loading={uploading !== null} disabled={files.length >= TICKET_ATTACHMENTS_MAX}>
          <Paperclip className="size-3.5" aria-hidden />
          {uploading !== null ? t('help.contact.attachments.uploading', { pct: uploading }) : t('help.contact.attachments.add')}
        </Button>
        {files.map((f) => (
          <span key={f.id} data-testid="ticket-file" className="inline-flex items-center gap-1 rounded-full border border-line-edge px-2 py-0.5 ts-label-meta text-text-secondary">
            <bdi>{f.name}</bdi>
            <button type="button" aria-label={`${t('action.remove')} ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="text-text-muted hover:text-text-primary">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>

      <fieldset className="rounded-card border border-line-edge bg-ink-base px-3 py-2.5" data-testid="ticket-context">
        <legend className="px-1 ts-label-micro text-text-muted">{t('help.contact.context')}</legend>
        <div className="grid gap-1.5">
          {CONTEXT_KEYS.map((k) => (
            <label key={k} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
              <span className="ts-label-micro text-text-muted">{t(`help.contact.context.${k}`)}</span>
              <input
                value={context[k]}
                onChange={(e) => setContext((c) => ({ ...c, [k]: e.target.value }))}
                className="h-6 w-full min-w-0 rounded-[4px] border border-transparent bg-transparent px-1 font-mono text-[11px] text-text-secondary hover:border-line-edge focus:border-line-lit focus:outline-none"
                placeholder="—"
                data-context={k}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {suggestion ? (
          <button type="button" data-testid="guide-suggestion" onClick={() => article.open(suggestion.key)} className="max-w-[60%] text-start ts-label-micro text-accent-inbound hover:underline">
            {t('help.contact.suggestion', { title: suggestion.title })}
          </button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" loading={create.isPending} disabled={uploading !== null} data-testid="ticket-submit">
          {t('help.contact.submit')}
        </Button>
      </div>
      {guard}
    </form>
  );
}
