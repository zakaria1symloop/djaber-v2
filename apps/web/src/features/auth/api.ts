// Auth & account calls (06 §2 "Auth & account", §8.1). Tokens are stored by `useSession().signIn`.
import type { DataExportDto } from '@djaber/shared';
import { api } from '@/lib/api';
import type { AuthTokens, InvitationPreview, LegalPending, LoginResult, MeDto, RecoveryCodes, SessionDto, TwoFaSetup } from '@/lib/contracts';

const device = () => ({ platform: 'web' as const, name: typeof navigator === 'undefined' ? undefined : navigator.userAgent.slice(0, 120) });

export const authApi = {
  login: (b: { email: string; password: string }) => api<LoginResult>('/auth/login', { method: 'POST', body: { ...b, device: device() }, noRefresh: true }),
  verify2fa: (b: { mfaToken: string; code?: string; recoveryCode?: string }) => api<AuthTokens>('/auth/2fa/verify', { method: 'POST', body: b, noRefresh: true }),
  /** `invitationToken`: sign-up from an invitation link — joins the inviter's workspace, creates none (D30). */
  register: (b: { firstName: string; lastName: string; email: string; password: string; locale: string; invitationToken?: string }) =>
    api<AuthTokens>('/auth/register', { method: 'POST', body: { ...b, device: device() }, noRefresh: true }),
  forgotPassword: (email: string) => api<{ sent: boolean }>('/auth/forgot-password', { method: 'POST', body: { email }, noRefresh: true }),
  checkResetToken: (token: string) => api<{ valid: boolean; expiresAt: string }>(`/auth/reset-password/${encodeURIComponent(token)}`, { noRefresh: true }),
  resetPassword: (b: { token: string; password: string }) => api<LoginResult>('/auth/reset-password', { method: 'POST', body: { ...b, device: device() }, noRefresh: true }),
  verifyEmail: (token: string) => api<{ email: string; emailVerifiedAt: string }>('/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () => api<{ sent: boolean; emailVerifiedAt: string | null }>('/auth/verify-email/resend', { method: 'POST', body: {} }),

  invitation: (token: string) => api<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
  /** Needs a session with the invited e-mail (a visitor signs up with `register({ invitationToken })`). */
  acceptInvitation: (token: string) =>
    api<{ workspaceId: string; workspaceName: string; role: string; readOnly: boolean }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} }),

  updateMe: (b: Partial<{ firstName: string; lastName: string; locale: string; phone: string | null; avatarUploadId: string | null }>) =>
    api<MeDto>('/me', { method: 'PATCH', body: b }),
  changePassword: (b: { currentPassword: string; newPassword: string }) => api<{ sessionsRevoked: number }>('/me/password', { method: 'PATCH', body: b }),
  changeEmail: (b: { email: string; password: string }) => api<{ pendingEmail: string }>('/me/email-change', { method: 'POST', body: b }),

  setup2fa: () => api<TwoFaSetup>('/auth/2fa/setup', { method: 'POST', body: {} }),
  enable2fa: (code: string) => api<RecoveryCodes>('/auth/2fa/enable', { method: 'POST', body: { code } }),
  disable2fa: (password: string) => api<{ totpEnabled: boolean }>('/auth/2fa/disable', { method: 'POST', body: { password } }),
  regenerateRecoveryCodes: (password: string) => api<RecoveryCodes>('/auth/2fa/recovery-codes', { method: 'POST', body: { password } }),

  sessions: () => api<SessionDto[]>('/me/sessions'),
  revokeSession: (id: string) => api<null>(`/me/sessions/${id}`, { method: 'DELETE' }),

  deletionRequest: () => api<DeletionRequest | null>('/me/deletion-request'),
  requestDeletion: (b: { password: string; totpCode?: string }) => api<DeletionRequest | null>('/me/deletion-request', { method: 'POST', body: b }),
  cancelDeletion: () => api<null>('/me/deletion-request', { method: 'DELETE' }),
  /** DEL-01 « Exporter mes données » (JSON + CSV, 7 days): 202 { jobId }, an export of the last hour is reused */
  startDataExport: () => api<{ jobId: string }>('/me/data-export'),
  dataExport: (jobId: string) => api<DataExportDto>(`/me/data-export/${encodeURIComponent(jobId)}`),

  legalPending: () => api<LegalPending[]>('/legal/pending'),
  legalAccept: (b: { key: string; version: number }) => api<null>('/legal/accept', { method: 'POST', body: b }),
};

export type DeletionRequest = {
  id: string;
  status: 'pending_confirmation' | 'grace' | 'blocked' | 'anonymised' | 'cancelled';
  requestedAt: string;
  scheduledAt: string | null;
  blockedReason: 'ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT' | null;
  exportUrl: string | null;
};
