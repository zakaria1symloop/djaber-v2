'use client';
// Image tile grid (Figma "CAT-01 — Product form" IMAGES · 3 / 10, DLG GDS II "Images — erreurs inline"):
// primary tile, drag to reorder, per-tile state (ENVOI… with progress, processing after upload, error with retry),
// inline error / warning under the tile, dashed "+ AJOUTER" drop tile. Upload itself is done by the caller.
import { ArrowLeft, ArrowRight, Plus, RotateCw, Star, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ProgressBar } from './inputs';
import { cn } from './primitives';

export type ImageTile = {
  id: string;
  url: string | null;
  alt?: string;
  primary?: boolean;
  /** `uploading` = bytes in flight; `processing` = stored, re-encode pending (still "ENVOI…"); `error` = failed */
  status?: 'ready' | 'uploading' | 'processing' | 'error';
  /** 0–100 while uploading */
  progress?: number;
  error?: string;
  warning?: string;
  /** small flag over the picture (moderation: "REFUSÉE · LOGO") */
  flag?: string;
  /** `pending`: an amber flag for a picture that waits (« EN ATTENTE DE VALIDATION », « À ENVOYER ») — red otherwise */
  flagTone?: 'alert' | 'pending';
  /** `false` hides "Réessayer" on an error tile that can never be sent (wrong type, too large, over the limit) */
  retryable?: boolean;
  /** `false` hides the delete button of this tile (quick-edit sheet: saved pictures are managed on the product form) */
  removable?: boolean;
};

export type ImageGridLabels = {
  add: string;
  primary: string;
  drag: string;
  sending: string;
  makePrimary: string;
  remove: string;
  retry: string;
  moveBefore: string;
  moveAfter: string;
  /** accessible name of a tile: `tile(2)` */
  tile: (position: number) => string;
};

export function ImageTileGrid({
  tiles,
  max,
  accept,
  labels,
  onAdd,
  onRemove,
  onMakePrimary,
  onReorder,
  onRetry,
  disabled,
  size = 96,
  hint,
  className,
}: {
  tiles: ImageTile[];
  max: number;
  accept: string;
  labels: ImageGridLabels;
  onAdd?: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onMakePrimary?: (id: string) => void;
  /** new order of the ready tiles */
  onReorder?: (ids: string[]) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  size?: number;
  hint?: string;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [dropping, setDropping] = React.useState(false);
  const canAdd = !!onAdd && !disabled && tiles.length < max;
  const move = (id: string, toIndex: number) => {
    if (!onReorder) return;
    const ids = tiles.map((t) => t.id);
    const from = ids.indexOf(id);
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return;
    ids.splice(toIndex, 0, ids.splice(from, 1)[0]!);
    onReorder(ids);
  };
  const action = 'flex size-6 items-center justify-center rounded-[4px] bg-black/70 text-text-primary hover:bg-black disabled:opacity-40';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ul className="flex flex-wrap gap-3">
        {tiles.map((tile, i) => {
          const busy = tile.status === 'uploading' || tile.status === 'processing';
          const movable = !!onReorder && !disabled && !busy && tile.status !== 'error';
          return (
            <li key={tile.id} className="flex flex-col gap-1" style={{ width: size }} data-image={tile.id} data-status={tile.status ?? 'ready'}>
              <div
                role="group"
                aria-label={labels.tile(i + 1)}
                draggable={movable}
                onDragStart={(e) => {
                  setDrag(tile.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => (setDrag(null), setOver(null))}
                onDragOver={(e) => {
                  if (drag && drag !== tile.id) {
                    e.preventDefault();
                    setOver(tile.id);
                  }
                }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  move(drag, i);
                  setDrag(null);
                  setOver(null);
                }}
                style={{ height: size }}
                className={cn(
                  'group relative overflow-hidden rounded-card border bg-ink-raised',
                  tile.primary ? 'border-signal-live' : tile.status === 'error' ? 'border-accent-alert' : 'border-line-edge',
                  over === tile.id && 'ring-2 ring-accent-inbound',
                  movable && 'cursor-grab',
                )}
              >
                {tile.url ? <img src={tile.url} alt={tile.alt ?? ''} className={cn('size-full object-cover', busy && 'opacity-40')} draggable={false} /> : null}
                {tile.flag ? <span className={cn('absolute inset-x-1 top-1 truncate rounded-[3px] px-1 text-center ts-label-micro text-black', tile.flagTone === 'pending' ? 'bg-accent-starred' : 'bg-accent-alert')} title={tile.flag}>{tile.flag}</span> : null}
                {busy ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
                    <span className="ts-label-micro text-text-primary">{labels.sending}</span>
                    <ProgressBar value={tile.status === 'uploading' ? (tile.progress ?? null) : null} label={labels.sending} />
                  </div>
                ) : (
                  <div className="absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {tile.status === 'error' && onRetry && tile.retryable !== false ? (
                      <button type="button" className={action} aria-label={labels.retry} title={labels.retry} onClick={() => onRetry(tile.id)}>
                        <RotateCw className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                    {movable ? (
                      <>
                        <button type="button" className={action} aria-label={labels.moveBefore} title={labels.moveBefore} disabled={i === 0} onClick={() => move(tile.id, i - 1)}>
                          <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
                        </button>
                        <button type="button" className={action} aria-label={labels.moveAfter} title={labels.moveAfter} disabled={i === tiles.length - 1} onClick={() => move(tile.id, i + 1)}>
                          <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                        </button>
                      </>
                    ) : null}
                    {onMakePrimary && !tile.primary && tile.status !== 'error' && !disabled ? (
                      <button type="button" className={action} aria-label={labels.makePrimary} title={labels.makePrimary} onClick={() => onMakePrimary(tile.id)}>
                        <Star className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                    {onRemove && !disabled && tile.removable !== false ? (
                      <button type="button" className={action} aria-label={labels.remove} title={labels.remove} onClick={() => onRemove(tile.id)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              {tile.error ? (
                <p role="alert" className="text-[11px] leading-tight text-accent-alert">
                  {tile.error}
                </p>
              ) : tile.warning ? (
                <p className="text-[11px] leading-tight text-accent-starred">{tile.warning}</p>
              ) : (
                <span className={cn('text-center ts-label-micro', tile.primary ? 'text-signal-live' : 'text-text-muted')}>{tile.primary ? labels.primary : busy ? labels.sending : movable ? labels.drag : ' '}</span>
              )}
            </li>
          );
        })}
        {onAdd ? (
          <li style={{ width: size }}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => input.current?.click()}
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
                if (canAdd) onAdd(Array.from(e.dataTransfer.files));
              }}
              style={{ height: size }}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line-lit text-text-secondary hover:text-text-primary',
                'disabled:cursor-not-allowed disabled:opacity-40',
                dropping && 'border-accent-inbound text-text-primary',
              )}
            >
              <Plus className="size-4" aria-hidden />
              <span className="ts-label-micro">{labels.add}</span>
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-upload="product-image"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) onAdd(files);
              }}
            />
          </li>
        ) : null}
      </ul>
      {hint ? <p className="ts-label-meta text-text-muted">{hint}</p> : null}
    </div>
  );
}
