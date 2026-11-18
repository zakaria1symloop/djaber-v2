// Saved views calls (06 §8.1 `/me/saved-views`, D42) + TanStack Query hooks. Views are per member and per workspace.
import type { CreateSavedView, SavedViewDto, SavedViewPage, UpdateSavedView } from '@djaber/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspaceId } from '@/lib/session';

export const savedViewsApi = {
  list: (page: SavedViewPage) => api<SavedViewDto[]>('/me/saved-views', { query: { page } }),
  create: (b: CreateSavedView) => api<SavedViewDto>('/me/saved-views', { method: 'POST', body: b, idempotent: true }),
  update: (id: string, b: UpdateSavedView) => api<SavedViewDto>(`/me/saved-views/${id}`, { method: 'PATCH', body: b }),
  share: (id: string, isShared: boolean) => api<SavedViewDto>(`/me/saved-views/${id}/share`, { method: 'POST', body: { isShared }, idempotent: true }),
  remove: (id: string) => api<null>(`/me/saved-views/${id}`, { method: 'DELETE' }),
};

export const savedViewsKey = (ws: string, page: SavedViewPage) => [ws, 'saved-views', page] as const;

export const useSavedViews = (page: SavedViewPage) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: savedViewsKey(ws, page), queryFn: () => savedViewsApi.list(page), enabled: !!ws, staleTime: 60_000 });
};

/** Every write refreshes the views of the page (the DÉFAUT pill moves, a shared view appears for the team on refetch). */
export const useSavedViewMutations = (page: SavedViewPage) => {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: savedViewsKey(ws, page) });
  return {
    create: useMutation({ mutationFn: savedViewsApi.create, onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdateSavedView }) => savedViewsApi.update(id, body), onSuccess: done }),
    share: useMutation({ mutationFn: ({ id, isShared }: { id: string; isShared: boolean }) => savedViewsApi.share(id, isShared), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => savedViewsApi.remove(id), onSuccess: done }),
  };
};
