'use client';
// Attachments of a ticket reply (tester report 25/10 UX-002: a client could attach files when opening a ticket, never
// when replying): the same rules as the contact form — captures / CSV, ≤ 5 MB each, ≤ TICKET_ATTACHMENTS_MAX,
// `POST /uploads { kind: ticket_attachment }` at once, the ids sent with the reply.
import { TICKET_ATTACHMENTS_MAX } from '@djaber/shared';
import { Button } from '@djaber/ui';
import { Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { helpApi, type UploadedFile } from './api';
import { ATTACHMENT_MAX_BYTES } from './contact-form';

const ACCEPT = 'image/png,image/jpeg,image/webp,text/csv,.csv';

export function useTicketAttachments() {
  const t = useT();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (list: FileList | null) => {
    setError(null);
    let count = files.length;
    for (const f of Array.from(list ?? [])) {
      if (count >= TICKET_ATTACHMENTS_MAX) {
        setError(t('help.contact.attachments.max', { max: TICKET_ATTACHMENTS_MAX }));
        break;
      }
      if (f.size > ATTACHMENT_MAX_BYTES) {
        setError(`${t('error.UPLOAD_TOO_LARGE', { max: t('help.attachments.maxSize') })} (UPLOAD_TOO_LARGE)`);
        continue;
      }
      try {
        setUploading(0);
        const up = await helpApi.upload(f, setUploading);
        count += 1;
        setFiles((prev) => [...prev, up]);
      } catch (e) {
        setError(errorMessage(e, t));
      } finally {
        setUploading(null);
      }
    }
    if (input.current) input.current.value = '';
  };
  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept={ACCEPT} multiple className="sr-only" id="ticket-reply-files" tabIndex={-1} aria-label={t('help.contact.attachments.add')} onChange={(e) => void add(e.target.files)} data-testid="ticket-reply-files" />
      <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={uploading !== null} disabled={files.length >= TICKET_ATTACHMENTS_MAX}>
        <Paperclip className="size-3.5" aria-hidden />
        {uploading !== null ? t('help.contact.attachments.uploading', { pct: uploading }) : t('help.contact.attachments.add')}
      </Button>
      {files.map((f) => (
        <span key={f.id} data-testid="ticket-reply-file" className="inline-flex items-center gap-1 rounded-full border border-line-edge px-2 py-0.5 ts-label-meta text-text-secondary">
          <bdi>{f.name}</bdi>
          <button type="button" aria-label={`${t('action.remove')} ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="text-text-muted hover:text-text-primary">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
  return { files, ids: files.map((f) => f.id), uploading: uploading !== null, error, clear: () => setFiles([]), picker };
}
