// Multipart upload with progress (product images: "ENVOI…" + bar per image). `fetch` exposes no upload progress,
// so this goes through XMLHttpRequest with the same headers, envelope and single silent refresh as `apiRaw`.
import { API_URL, ApiError, apiSession, markOwnWrite, refreshSession, type ApiErrorBody, type Envelope } from './api';

const send = <T>(path: string, formData: FormData, onProgress?: (pct: number) => void, signal?: AbortSignal, platform = false) =>
  new Promise<{ status: number; json: (Envelope<T> & { error?: ApiErrorBody }) | null; ref: string }>((resolve, reject) => {
    const s = apiSession.get();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept-Language', s.locale);
    if (s.accessToken) xhr.setRequestHeader('Authorization', `Bearer ${s.accessToken}`);
    // `platform`: a file of the admin area (support answer, payment proof) — no workspace, even for an admin who is a member
    if (s.workspaceId && !platform) xhr.setRequestHeader('X-Workspace-Id', s.workspaceId);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded * 100) / e.total));
    };
    xhr.onload = () => {
      let json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, json, ref: xhr.getResponseHeader('x-request-id') ?? '' });
    };
    xhr.onerror = () => reject(new TypeError('network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });

export async function uploadWithProgress<T>(path: string, formData: FormData, o: { onProgress?: (pct: number) => void; signal?: AbortSignal; platform?: boolean } = {}): Promise<Envelope<T>> {
  markOwnWrite();
  let res = await send<T>(path, formData, o.onProgress, o.signal, o.platform);
  markOwnWrite();
  if (res.status === 401 && (await refreshSession())) res = await send<T>(path, formData, o.onProgress, o.signal, o.platform);
  if (res.status < 200 || res.status >= 300 || !res.json || res.json.error) {
    throw new ApiError(res.status, {
      code: res.status === 413 ? 'UPLOAD_TOO_LARGE' : 'INTERNAL',
      message: '',
      details: null,
      ref: res.ref,
      ...res.json?.error,
      params: { ...res.json?.error?.params },
      fields: { ...res.json?.error?.fields },
    });
  }
  return res.json;
}
