// Wire types of the M1 endpoints (docs/implementation/api-contract.md §3.1–3.2, docs/specs/06-api.md §2 + §8.1).
// Shapes the contract leaves open are listed in docs/implementation/assumptions-log.md (M1 web rows).
import type { AppLocale, MemberRole, PlatformRole, QuickReplyView, SystemMessageKey } from '@djaber/shared';

export type Locale = AppLocale;
export type LocalizedText = { fr: string; ar?: string; en?: string };
export type LegalDocKey = 'terms' | 'privacy' | 'account_deletion' | 'content_rules';

/** `hiddenSections`: sections the Owner hid from this member (`MEMBER_SECTIONS`) — `can()` refuses their keys */
export type Membership = { workspaceId: string; name: string; logoUrl: string | null; role: MemberRole; readOnly: boolean; hiddenSections?: string[] };
export type LegalPending = { key: LegalDocKey; version: number; url: string };
export type UserPrefs = { listDensity: 'compact' | 'comfortable'; soundOnMessage: boolean; dismissedAnnouncementIds: string[]; reportFavorites: string[] };

export type MeDto = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  locale: Locale;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  totpEnabled: boolean;
  platformRole: PlatformRole;
  status: 'active' | 'blocked' | 'deletion_scheduled';
  ownedWorkspaceId: string | null;
  prefs: UserPrefs;
  memberships: Membership[];
  pendingLegal: LegalPending[];
  deletionScheduledAt: string | null;
};

export type AuthTokens = { accessToken: string; expiresIn: number; user: MeDto };
export type LoginResult = AuthTokens | { mfaToken: string };
export const isMfaChallenge = (r: LoginResult): r is { mfaToken: string } => 'mfaToken' in r;

export type PlanLimits = {
  maxPages: number;
  maxAgents: number;
  maxProducts: number;
  maxConversationsPerMonth: number;
  maxMembers: number;
  maxApiKeys: number;
  maxWebhooks: number;
  monthlyCredits: number;
  features: string[];
};
export type PlanUsage = { pages: number; agents: number; products: number; conversationsThisMonth: number; members: number; creditsUsed: number };

export type SystemMessages = Record<SystemMessageKey, { fr: string; ar: string; en: string }>;

export type WorkspaceDto = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  senderWilayaId: number | null;
  locale: Locale;
  timezone: string;
  stockMode: 'simple' | 'advanced';
  onboardingStep: number;
  freeDeliveryThreshold: number | null;
  autoPauseOnManualReply: boolean;
  handoffReminderMin: number;
  onlinePaymentEnabled: boolean;
  autoSendToCourier: boolean;
  defaultCourierAccountId: string | null;
  targetMarginPct: number;
  systemMessages: SystemMessages;
  status: 'active' | 'suspended' | 'deletion_scheduled';
  suspendReason: 'fraud' | 'unpaid' | 'content' | 'owner_request' | 'other' | null;
  deletionScheduledAt: string | null;
  trustLevel: 'new' | 'standard' | 'trusted' | 'watch';
  plan: { slug: string; name: string; limits: PlanLimits; usage: PlanUsage; periodEnd: string; status: string } | null;
  version: number;
};

export type UserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
export type MemberDto = { id: string; user: UserRef & { email: string }; role: MemberRole; readOnly: boolean; hiddenSections: string[]; joinedAt: string; lastSeenAt: string | null };
export type InvitationDto = { id: string; email: string; role: MemberRole; sentAt: string; expiresAt: string; resendAvailableAt: string };

/** `GET /invitations/:token` (public) — 06 §8.1. */
export type InvitationPreview = {
  workspaceName: string;
  workspaceLogoUrl: string | null;
  inviterName: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
};

export type SessionDto = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
};

export type TwoFaSetup = { secret: string; otpauthUrl: string };
export type RecoveryCodes = { recoveryCodes: string[] };

export type Wilaya = { id: number; code: string; nameFr: string; nameAr: string };

export type UploadDto = { id: string; url: string; mime: string; size: number; width?: number | null; height?: number | null };

/** Get Started (ONB-02) — the four steps computed from real entities by `GET /dashboard/home`. */
export const CHECKLIST_KEYS = ['channel', 'product', 'agent', 'sale'] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export type Checklist = Record<ChecklistKey, boolean>;
/** `GET|PATCH /workspace/onboarding` — tunnel step + checklist (`order` = first delivered order or completed sale). */
export type OnboardingDto = { step: number; checklist: { channel: boolean; product: boolean; agent: boolean; order: boolean }; done: number; total: number };

/** Checklist of the API (`order`) under the keys of the Get Started block (`sale` = "Réalisez votre première vente"). */
export const checklistOf = (dto: Pick<OnboardingDto, 'checklist'> | null | undefined): Checklist => ({
  channel: dto?.checklist.channel === true,
  product: dto?.checklist.product === true,
  agent: dto?.checklist.agent === true,
  sale: dto?.checklist.order === true,
});

export type { QuickReplyView };
