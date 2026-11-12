'use client';
// "Créer depuis une photo" — Figma "DLG — GDS (stock) II" (CAT-07, AT-CAT-10): 1–5 photos, states ANALYSE… (spinner,
// "lecture de la photo", cancellable, ≤ 15 s), REMPLI (only the empty fields, never the price), ÉCHEC
// (IMAGE_ANALYSIS_FAILED, credits not debited), INDISPONIBLE (IMAGE_ANALYSIS_UNAVAILABLE: the entry button is then
// disabled for the session), INSUFFICIENT_CREDITS inline with a link to the credits page, LIMITE (ANALYSIS_RATE_LIMITED:
// 3 analyses per day) and FOURNISSEUR IA (AI_PROVIDER_ERROR: retry later). Every refusal keeps the photos and the form.
import { AI_FILL_MAX_PHOTOS } from '@djaber/shared';
import { Button, Dialog, FormAlert, Pill, Spinner, cn } from '@djaber/ui';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { catalogApi } from '../api';
import type { AiFillCurrent, AiFillResult } from '../contracts';
import { checkImageFile, IMAGE_ACCEPT } from './images';
import { attributeHints, type AiFillField } from './model';

const ANALYSIS_TIMEOUT_MS = 15_000;
export const AI_FILL_CREDITS = 5;

/** IMAGE_ANALYSIS_UNAVAILABLE was answered once: the button stays disabled until the page is reloaded. */
let unavailable = false;
export const aiFillUnavailable = () => unavailable;

type Phase = { kind: 'idle' } | { kind: 'analysing' } | { kind: 'filled'; filled: AiFillField[]; hints: string[] } | { kind: 'failed' } | { kind: 'unavailable' } | { kind: 'credits' } | { kind: 'limited' } | { kind: 'provider' } | { kind: 'error'; message: string };
type Photo = { key: string; file: File; url: string; error: string | null };

export function FromPhotoDialog({
  open,
  onClose,
  initialFiles,
  current,
  onResult,
  onUnavailable,
}: {
  open: boolean;
  onClose: () => void;
  /** pictures already added to the form: offered as the photos to analyse */
  initialFiles: File[];
  current: AiFillCurrent;
  /** applies the suggestion to the form and tells which fields were filled */
  onResult: (result: AiFillResult) => AiFillField[];
  onUnavailable: () => void;
}) {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [tooMany, setTooMany] = useState(false);
  const [dropping, setDropping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const toPhoto = (file: File, i: number): Photo => {
    const code = checkImageFile(file);
    return { key: `${Date.now()}-${i}-${file.name}`, file, url: URL.createObjectURL(file), error: code ? t(`error.${code}`) : null };
  };
  useEffect(() => {
    if (!open) return;
    setPhase(unavailable ? { kind: 'unavailable' } : { kind: 'idle' });
    setTooMany(false);
    setPhotos(initialFiles.slice(0, AI_FILL_MAX_PHOTOS).map(toPhoto));
    return () => {
      abort.current?.abort();
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded each time the dialog opens
  }, [open]);

  const add = (files: File[]) => {
    const room = AI_FILL_MAX_PHOTOS - photosRef.current.length;
    setTooMany(files.length > room);
    setPhotos((list) => [...list, ...files.slice(0, Math.max(0, room)).map(toPhoto)]);
  };
  const remove = (key: string) => {
    setTooMany(false);
    setPhotos((list) => {
      const hit = list.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return list.filter((p) => p.key !== key);
    });
  };

  const valid = useMemo(() => photos.filter((p) => !p.error), [photos]);
  const analysing = phase.kind === 'analysing';
  const analyse = async () => {
    if (!valid.length || photos.some((p) => p.error)) return;
    const controller = new AbortController();
    abort.current = controller;
    cancelled.current = false;
    const timer = window.setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    setPhase({ kind: 'analysing' });
    try {
      const result = await catalogApi.aiFill(
        valid.map((p) => p.file),
        current,
        controller.signal,
      );
      setPhase({ kind: 'filled', filled: onResult(result), hints: attributeHints(result?.attributes) });
    } catch (e) {
      if (cancelled.current) return setPhase({ kind: 'idle' });
      if (!(e instanceof ApiError)) return setPhase(controller.signal.aborted ? { kind: 'failed' } : { kind: 'error', message: errorMessage(e, t) });
      if (e.code === 'IMAGE_ANALYSIS_UNAVAILABLE') {
        unavailable = true;
        onUnavailable();
        return setPhase({ kind: 'unavailable' });
      }
      if (e.code === 'IMAGE_ANALYSIS_FAILED') return setPhase({ kind: 'failed' });
      if (e.code === 'INSUFFICIENT_CREDITS') return setPhase({ kind: 'credits' });
      if (e.code === 'ANALYSIS_RATE_LIMITED') return setPhase({ kind: 'limited' });
      if (e.code === 'AI_PROVIDER_ERROR' || e.code === 'PROVIDER_UNAVAILABLE') return setPhase({ kind: 'provider' });
      setPhase({ kind: 'error', message: errorMessage(e, t) });
    } finally {
      window.clearTimeout(timer);
    }
  };
  const cancel = () => {
    cancelled.current = true;
    abort.current?.abort();
  };

  const canAdd = !analysing && photos.length < AI_FILL_MAX_PHOTOS && phase.kind !== 'unavailable';
  const fieldLabel = (f: AiFillField) => t(`products.form.photo.field.${f}`);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        if (analysing) cancel();
        onClose();
      }}
      title={t('dialog.fromPhoto.title')}
      description={t('products.form.photo.context', { credits: AI_FILL_CREDITS })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        phase.kind === 'filled' ? (
          <Button variant="primary" onClick={onClose} data-testid="photo-done">
            {t('products.form.photo.review')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={analysing ? cancel : onClose} data-testid="photo-manual">
              {analysing ? t('action.cancel') : t('products.form.photo.manual')}
            </Button>
            <Button
              variant="primary"
              onClick={analyse}
              loading={analysing}
              disabled={!valid.length || photos.some((p) => p.error)}
              disabledReason={
                phase.kind === 'unavailable'
                  ? t('error.IMAGE_ANALYSIS_UNAVAILABLE')
                  : phase.kind === 'limited'
                    ? t('error.ANALYSIS_RATE_LIMITED')
                    : undefined
              }
              data-testid="photo-analyse"
            >
              {analysing ? t('common.analyzing') : t('products.form.photo.analyse', { credits: AI_FILL_CREDITS })}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4" data-phase={phase.kind} data-testid="photo-dialog">
        <div
          onDragOver={(e) => {
            if (canAdd && e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            if (canAdd) add(Array.from(e.dataTransfer.files));
          }}
          className={cn('rounded-card border border-dashed border-line-lit p-3', dropping && 'border-accent-inbound')}
        >
          {photos.length ? (
            <ul className="mb-3 flex flex-wrap gap-2">
              {photos.map((p) => (
                <li key={p.key} className="flex w-20 flex-col gap-1">
                  <div className={cn('relative size-20 overflow-hidden rounded-card border bg-ink-raised', p.error ? 'border-accent-alert' : 'border-line-edge')}>
                    <img src={p.url} alt={p.file.name} className="size-full object-cover" />
                    {analysing ? null : (
                      <button type="button" aria-label={t('products.form.photo.remove', { name: p.file.name })} onClick={() => remove(p.key)} className="absolute end-1 top-1 flex size-5 items-center justify-center rounded-[4px] bg-black/70 hover:bg-black">
                        <X className="size-3" aria-hidden />
                      </button>
                    )}
                  </div>
                  {p.error ? (
                    <p role="alert" className="text-[11px] leading-tight text-accent-alert">
                      {p.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" disabled={!canAdd} onClick={() => input.current?.click()} className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[14px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40">
            <Plus className="size-4" aria-hidden />
            {t('products.form.photo.drop', { max: AI_FILL_MAX_PHOTOS })}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-upload="ai-fill"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) add(files);
            }}
          />
        </div>
        {tooMany ? <FormAlert tone="warning">{t('products.form.photo.tooMany', { max: AI_FILL_MAX_PHOTOS })}</FormAlert> : null}

        {analysing ? (
          <div className="flex items-center gap-3" role="status">
            <Pill tone="info" className="rounded-[4px]">
              {t('products.form.photo.state.analysing')}
            </Pill>
            <Spinner label={t('products.form.photo.reading')} />
          </div>
        ) : null}
        {phase.kind === 'filled' ? (
          <div className="flex flex-col gap-2" role="status">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="success" className="rounded-[4px]">
                {t('products.form.photo.state.filled')}
              </Pill>
              <span className="text-[13px]">{phase.filled.length ? t('products.form.photo.filled', { fields: phase.filled.map(fieldLabel).join(', ') }) : t('products.form.photo.nothing')}</span>
            </div>
            <p className="ts-label-meta text-text-muted">{t('products.form.photo.priceNote')}</p>
            {phase.hints.length ? <p className="ts-label-meta text-text-secondary">{t('products.form.photo.attributes', { list: phase.hints.join(' · ') })}</p> : null}
          </div>
        ) : null}
        {phase.kind === 'failed' ? (
          <div className="flex flex-col gap-2">
            <Pill tone="danger" className="w-fit rounded-[4px]">
              {t('products.form.photo.state.failed')}
            </Pill>
            <FormAlert>{`${t('error.IMAGE_ANALYSIS_FAILED')} · ${t('products.form.photo.notCharged')}`}</FormAlert>
          </div>
        ) : null}
        {phase.kind === 'unavailable' ? (
          <div className="flex flex-col gap-2">
            <Pill tone="warning" className="w-fit rounded-[4px]">
              {t('products.form.photo.state.unavailable')}
            </Pill>
            <FormAlert tone="warning">{`${t('error.IMAGE_ANALYSIS_UNAVAILABLE')} · ${t('products.form.photo.fillManually')}`}</FormAlert>
          </div>
        ) : null}
        {phase.kind === 'credits' ? (
          <FormAlert>
            {`${t('error.INSUFFICIENT_CREDITS')} `}
            <Link href="/settings/credits" className="normal-case text-accent-inbound underline">
              {t('action.buyCredits')}
            </Link>
          </FormAlert>
        ) : null}
        {phase.kind === 'limited' ? (
          <div className="flex flex-col gap-2">
            <Pill tone="warning" className="w-fit rounded-[4px]">
              {t('products.form.photo.state.limited')}
            </Pill>
            <FormAlert tone="warning">{`${t('error.ANALYSIS_RATE_LIMITED')} · ${t('products.form.photo.fillManually')}`}</FormAlert>
          </div>
        ) : null}
        {phase.kind === 'provider' ? (
          <div className="flex flex-col gap-2">
            <Pill tone="danger" className="w-fit rounded-[4px]">
              {t('products.form.photo.state.provider')}
            </Pill>
            <FormAlert>{`${t('products.form.photo.provider')} · ${t('products.form.photo.notCharged')}`}</FormAlert>
          </div>
        ) : null}
        {phase.kind === 'error' ? <FormAlert>{phase.message}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
