'use client';
// Identity section (wizard step 1 = "Identité" of the Configuration tab) — Figma "AGT-02 — Agent wizard — step 1
// identity": internal name, display name, description, avatar (page / upload / initials), languages checklist with the
// default language, tone, tutoiement, emojis and the live preview of a reply.
import { AgentAvatar, CheckChip, Field, FormSection, Input, PreviewPanel, SegmentedControl, Select, Textarea, toast } from '@djaber/ui';
import { useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/forms';
import { useT, type TFunction } from '@/lib/i18n';
import { agentsApi } from '../api';
import type { Agent, AgentLanguage, AvatarMode } from '../contracts';
import { EMOJI_LEVELS, FORMALITIES, LANGUAGES, TONES } from '../contracts';
import { DESCRIPTION_MAX, NAME_MAX, previewLanguage, previewReply, type AgentDraft, type Issue } from '../logic';

export type SectionProps = {
  draft: AgentDraft;
  set: (patch: Partial<AgentDraft>) => void;
  errors: Record<string, Issue>;
  /** Operator, or the form is being saved: fields greyed */
  readOnly?: boolean;
  badge?: ReactNode;
  /** the wizard runs inside the onboarding tunnel: links to other app pages are hidden (the tunnel guard sends them back) */
  inTunnel?: boolean;
  /** owner request 11/11: where the names stand with the moderators (none for a new, unsaved agent) */
  nameReview?: Agent['nameReview'];
};
export const issueText = (t: TFunction, issue: Issue | undefined): string | undefined => (issue ? t(issue.key, issue.params) : undefined);

const AVATAR_MODES: AvatarMode[] = ['page', 'upload', 'initials'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Owner request 11/11: the names customers read wait for a Djaber moderator. Pending ⇒ which name the agent uses meanwhile;
 * refused ⇒ the moderator's reason and « change it to submit it again ».
 */
export function NameReviewNote({ review }: { review?: Agent['nameReview'] }) {
  const t = useT();
  if (!review || review.status === 'approved') return null;
  const current = review.approvedDisplayName?.trim() || review.approvedName?.trim() || '';
  const text =
    review.status === 'rejected'
      ? review.reason?.trim()
        ? t('agents.nameReview.rejected', { reason: review.reason.trim() })
        : t('agents.nameReview.rejectedNoReason')
      : current
        ? t('agents.nameReview.pending', { name: current })
        : t('agents.nameReview.pendingNone');
  return (
    <p role="status" data-testid="agent-name-review" data-status={review.status} className={`md:col-span-2 rounded-card border px-3 py-2 text-[13px] ${review.status === 'rejected' ? 'border-accent-alert/40 text-accent-alert' : 'border-accent-starred/40 text-accent-starred'}`}>
      {text}
    </p>
  );
}

export function IdentityFields({ draft: d, set, errors, readOnly, badge, nameReview }: SectionProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const lang = previewLanguage(d);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setAvatarError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setAvatarError(t('error.IMAGE_TYPE_INVALID'));
    if (file.size > AVATAR_MAX_BYTES) return setAvatarError(t('error.IMAGE_TOO_LARGE'));
    setUploading(true);
    try {
      const up = await agentsApi.upload(file, 'avatar');
      set({ avatarMode: 'upload', avatarUploadId: up.id, avatarUrl: up.url });
    } catch (e) {
      setAvatarError(errorMessage(e, t));
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const toggleLanguage = (l: AgentLanguage, on: boolean) => {
    const languages = on ? LANGUAGES.filter((x) => x === l || d.languages.includes(x)) : d.languages.filter((x) => x !== l);
    set({ languages: [...languages], defaultLanguage: d.defaultLanguage && languages.includes(d.defaultLanguage) ? d.defaultLanguage : (languages[0] ?? null) });
  };

  return (
    <>
      <FormSection title={t('agents.identity.title')} badge={badge} data-section="identity">
        <div className="flex flex-col gap-4 md:flex-row">
          <AgentAvatar name={d.displayName || d.name || '·'} src={d.avatarMode === 'upload' ? d.avatarUrl : null} size={96} className="self-center md:self-start" />
          <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
            <Field label={t('agents.identity.name')} htmlFor="agent-name" required error={issueText(t, errors.name)} hint={t('agents.identity.name.hint')}>
              <Input id="agent-name" dir="auto" maxLength={NAME_MAX + 20} value={d.name} disabled={readOnly} placeholder={t('agents.identity.name.placeholder')} aria-invalid={!!errors.name || undefined} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('agents.identity.displayName')} htmlFor="agent-display-name" error={issueText(t, errors.displayName)} hint={t('agents.identity.displayName.hint')}>
              <Input id="agent-display-name" dir="auto" maxLength={NAME_MAX + 20} value={d.displayName} disabled={readOnly} placeholder={t('agents.identity.displayName.placeholder')} aria-invalid={!!errors.displayName || undefined} onChange={(e) => set({ displayName: e.target.value })} />
            </Field>
            <NameReviewNote review={nameReview} />
            <Field label={t('agents.identity.description')} htmlFor="agent-description" error={issueText(t, errors.description)}>
              <Textarea id="agent-description" dir="auto" className="!min-h-16" maxLength={DESCRIPTION_MAX + 50} value={d.description} disabled={readOnly} placeholder={t('agents.identity.description.placeholder')} aria-invalid={!!errors.description || undefined} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label={t('agents.identity.avatar')} error={avatarError ?? undefined} hint={d.avatarMode === 'upload' ? t('agents.identity.avatar.uploadHint') : undefined}>
              <SegmentedControl
                label={t('agents.identity.avatar')}
                disabled={readOnly}
                value={d.avatarMode}
                onChange={(m) => {
                  if (readOnly) return;
                  set({ avatarMode: m });
                  if (m === 'upload' && !d.avatarUrl) fileRef.current?.click();
                }}
                options={AVATAR_MODES.map((m) => ({ value: m, label: t(`agents.identity.avatar.${m}`) }))}
              />
              {d.avatarMode === 'upload' && !readOnly ? (
                <button type="button" className="w-fit text-[12px] text-accent-inbound hover:underline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? t('common.sending') : t('agents.identity.avatar.choose')}
                </button>
              ) : null}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={t('agents.identity.avatar.choose')} tabIndex={-1} disabled={readOnly} onChange={(e) => void onFile(e.target.files?.[0])} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title={t('agents.languages.title')} description={t('agents.languages.description')} data-section="languages">
        <div role="group" aria-label={t('agents.languages.title')} className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <CheckChip key={l} name={l} checked={d.languages.includes(l)} disabled={readOnly} onChange={(on) => toggleLanguage(l, on)}>
              {t(`agents.language.${l}`)}
            </CheckChip>
          ))}
        </div>
        {errors.languages ? (
          <p role="alert" className="-mt-2 text-[12px] text-accent-alert">
            {issueText(t, errors.languages)}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('agents.languages.default')} htmlFor="agent-default-language" error={issueText(t, errors.defaultLanguage)}>
            <Select id="agent-default-language" value={d.defaultLanguage ?? ''} disabled={readOnly || !d.languages.length} onChange={(e) => set({ defaultLanguage: (e.target.value || null) as AgentLanguage | null })}>
              {d.languages.map((l) => (
                <option key={l} value={l}>
                  {t(`agents.language.short.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('agents.tone.label')} htmlFor="agent-tone">
            <Select id="agent-tone" value={d.tone ?? 'warm'} disabled={readOnly} onChange={(e) => set({ tone: e.target.value as AgentDraft['tone'] })}>
              {TONES.map((v) => (
                <option key={v} value={v}>
                  {t(`agents.tone.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('agents.formality.label')} htmlFor="agent-formality">
            <Select id="agent-formality" value={d.formality ?? 'follow_customer'} disabled={readOnly} onChange={(e) => set({ formality: e.target.value as AgentDraft['formality'] })}>
              {FORMALITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`agents.formality.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('agents.emoji.label')} htmlFor="agent-emoji">
            <Select id="agent-emoji" value={d.emojiLevel ?? 'moderate'} disabled={readOnly} onChange={(e) => set({ emojiLevel: e.target.value as AgentDraft['emojiLevel'] })}>
              {EMOJI_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {t(`agents.emoji.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <PreviewPanel
          label={t('agents.preview.label')}
          messages={[
            { author: 'customer', text: t(`agents.preview.question.${lang}`) },
            { author: 'ai', text: previewReply(t(`agents.preview.reply.${lang}`), d.emojiLevel) },
          ]}
          note={t('agents.preview.note', { name: d.displayName.trim() || t('agents.preview.pageName') })}
        />
      </FormSection>
    </>
  );
}
