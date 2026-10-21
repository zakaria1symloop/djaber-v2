// Workspace, members, settings, onboarding and home calls (06 §2 "Workspace & team", §8.1) + TanStack Query hooks.
import type { CreateQuickReply, SystemMessageKey, SystemMessagesInput, UpdateQuickReply } from '@djaber/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { InvitationDto, MemberDto, OnboardingDto, QuickReplyView, SystemMessages, UploadDto, Wilaya, WorkspaceDto } from '@/lib/contracts';

export type DeletionState = { id: string; status: WorkspaceDto['status']; deletionScheduledAt: string | null };
import { meKey, useWorkspaceId, workspaceKey } from '@/lib/session';

export type WorkspacePatch = Partial<{
  name: string;
  phone: string | null;
  address: string | null;
  senderWilayaId: number | null;
  locale: 'fr' | 'ar' | 'en';
  stockMode: 'simple' | 'advanced';
  /** PAY-02 workspace toggle (P2, M9): enables the order payment links */
  onlinePaymentEnabled: boolean;
  autoPauseOnManualReply: boolean;
  handoffReminderMin: number;
  freeDeliveryThreshold: number | null;
  /** D9 / DLV-05: confirmed orders sent to the default courier (M6) */
  autoSendToCourier: boolean;
  logoUploadId: string | null;
}>;

export const workspaceApi = {
  create: (b: { name: string; senderWilayaId: number | null; stockMode: 'simple' | 'advanced' }) => api<WorkspaceDto>('/workspaces', { method: 'POST', body: b }),
  patch: (b: WorkspacePatch & { version?: number }) => api<WorkspaceDto>('/workspace', { method: 'PATCH', body: b }),
  onboarding: () => api<OnboardingDto>('/workspace/onboarding'),
  setOnboarding: (step: number) => api<OnboardingDto>('/workspace/onboarding', { method: 'PATCH', body: { step } }),
  remove: (b: { password: string; confirmName: string }) => api<DeletionState>('/workspace', { method: 'DELETE', body: b }),
  cancelDeletion: () => api<DeletionState>('/workspace/deletion/cancel', { method: 'POST', body: {} }),
  transferOwnership: (id: string, b: { newOwnerUserId: string; password: string; totpCode?: string }) =>
    api<{ workspaceId: string; ownerUserId: string; previousOwnerUserId: string }>(`/workspaces/${id}/transfer-ownership`, { method: 'POST', body: b }),

  members: () => api<MemberDto[]>('/workspace/members'),
  invitations: () => api<InvitationDto[]>('/workspace/invitations'),
  updateMember: (id: string, b: { role?: 'admin' | 'operator'; hiddenSections?: string[] }) => api<MemberDto>(`/workspace/members/${id}`, { method: 'PATCH', body: b }),
  removeMember: (id: string) => api<null>(`/workspace/members/${id}`, { method: 'DELETE' }),
  invite: (b: { email: string; role: 'admin' | 'operator' }) => api<InvitationDto>('/workspace/invitations', { method: 'POST', body: b }),
  resendInvitation: (id: string) => api<InvitationDto | null>(`/workspace/invitations/${id}/resend`, { method: 'POST', body: {} }),
  revokeInvitation: (id: string) => api<null>(`/workspace/invitations/${id}`, { method: 'DELETE' }),

  quickReplies: () => api<QuickReplyView[]>('/workspace/quick-replies'),
  createQuickReply: (b: CreateQuickReply) => api<QuickReplyView>('/workspace/quick-replies', { method: 'POST', body: b }),
  updateQuickReply: (id: string, b: UpdateQuickReply) => api<QuickReplyView>(`/workspace/quick-replies/${id}`, { method: 'PATCH', body: b }),
  deleteQuickReply: (id: string) => api<null>(`/workspace/quick-replies/${id}`, { method: 'DELETE' }),
  reorderQuickReplies: (ids: string[]) => api<QuickReplyView[] | null>('/workspace/quick-replies/order', { method: 'PATCH', body: { ids } }),

  systemMessages: () => api<SystemMessages>('/workspace/system-messages'),
  saveSystemMessages: (b: SystemMessagesInput) => api<SystemMessages>('/workspace/system-messages', { method: 'PUT', body: b }),
  /** "Réinitialiser": restores the 3 default locales of one key. */
  resetSystemMessage: (key: SystemMessageKey) => api<SystemMessages>('/workspace/system-messages/reset', { method: 'POST', body: { key } }),

  wilayas: () => api<Wilaya[]>('/geo/wilayas'),
  upload: (file: File, kind: 'avatar' | 'logo' | 'category_image') => {
    const formData = new FormData();
    formData.set('file', file);
    formData.set('kind', kind);
    return api<UploadDto>('/uploads', { method: 'POST', formData });
  },
};

export const membersKey = (ws: string) => [ws, 'members'] as const;
export const invitationsKey = (ws: string) => [ws, 'invitations'] as const;
export const quickRepliesKey = (ws: string) => [ws, 'quick-replies'] as const;
export const systemMessagesKey = (ws: string) => [ws, 'system-messages'] as const;
export const onboardingKey = (ws: string) => [ws, 'onboarding'] as const;

export const useWilayas = () => useQuery({ queryKey: ['session', 'wilayas'], queryFn: workspaceApi.wilayas, staleTime: 24 * 3600 * 1000 });

/** Writes the workspace returned by a mutation into the cache (partial answers are merged). */
export function useWorkspaceCache() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return (patch: Partial<WorkspaceDto> | null | undefined) => {
    if (patch) qc.setQueryData<WorkspaceDto>(workspaceKey(ws), (prev) => (prev ? { ...prev, ...patch } : (patch as WorkspaceDto)));
    else void qc.invalidateQueries({ queryKey: workspaceKey(ws) });
  };
}

export function usePatchWorkspace() {
  const write = useWorkspaceCache();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspaceApi.patch,
    onSuccess: (data) => {
      write(data);
      // name and logo are also shown from the memberships of /me (switcher)
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useOnboardingStep() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const write = useWorkspaceCache();
  return useMutation({
    mutationFn: workspaceApi.setOnboarding,
    onSuccess: (data, step) => {
      write({ onboardingStep: step });
      qc.setQueryData(onboardingKey(ws), data);
    },
  });
}

export const useMembers = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: membersKey(ws), queryFn: workspaceApi.members, enabled: enabled && !!ws });
};
/** Pending invitations are visible to the Owner only (`members.write`). */
export const useInvitations = (enabled: boolean) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: invitationsKey(ws), queryFn: workspaceApi.invitations, enabled: enabled && !!ws });
};

export const useQuickReplies = () => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: quickRepliesKey(ws), queryFn: workspaceApi.quickReplies, enabled: !!ws });
};
export const useSystemMessages = () => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: systemMessagesKey(ws), queryFn: workspaceApi.systemMessages, enabled: !!ws });
};
/** Get Started checklist (ONB-02), computed from real entities on every call. */
export const useOnboarding = () => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: onboardingKey(ws), queryFn: workspaceApi.onboarding, enabled: !!ws });
};

export { conflictOf } from '@/lib/conflict';
