// M11 — public pages API (03 §36 PUB-01…08, 06 §12, api-contract §3.14, 02-route-map §3.1): CMS pages with locale
// fallback, public account deletion (DEL-01, FL-22), the user's data export (`GET /me/data-export`), the captcha of the
// public forms. Every route here is `@Public()` except `/me/data-export*` (any authenticated user).
import { z } from 'zod';
import { CmsTypeValues, LocaleValues } from '../enums';

/** `GET /cms/:key?lang=&preview=` · `GET /legal/:key?lang=` · `GET /cms/preview/:token` */
export const CmsPublicQuerySchema = z
  .object({ lang: z.enum(LocaleValues).optional(), preview: z.string().trim().max(2000).optional() })
  .strict();
export type CmsPublicQuery = z.infer<typeof CmsPublicQuerySchema>;
/** `GET /cms?type=page&category=features&lang=` — list of published entries of one type (landing blocks, legal links). */
export const CmsListQuerySchema = z
  .object({ type: z.enum(CmsTypeValues).default('page'), category: z.string().trim().max(60).optional(), lang: z.enum(LocaleValues).optional() })
  .strict();
export type CmsListQuery = z.infer<typeof CmsListQuerySchema>;

/** Keys seeded by M11 for the public site (route map §3.1). Bodies are Markdown; `features` uses one `## ` section per block. */
export const PUBLIC_CMS_KEYS = ['landing', 'features', 'pricing-faq', 'cookies', 'data-deletion', 'terms', 'privacy', 'account_deletion', 'content_rules'] as const;

/**
 * api-contract §3.14 `CmsEntryDto` (+ `category`, `previousBody` for the "vN → vN+1" diff of PUB-03, `preview`).
 * `fallback: true` ⇒ the requested locale is not published and the French text is served (banner "affiché en français").
 */
export type CmsEntryDto = {
  key: string;
  type: (typeof CmsTypeValues)[number];
  category: string | null;
  locale: 'fr' | 'ar' | 'en';
  requestedLocale: 'fr' | 'ar' | 'en';
  fallback: boolean;
  title: string;
  body: string;
  version: number;
  publishedAt: string;
  /** published versions, newest first (version history at the bottom of a legal page) */
  versions: { version: number; publishedAt: string }[];
  /** body of the previous version in the same locale (null for v1) — the page renders the vN-1 → vN diff */
  previousBody: string | null;
  /** true when served through an admin preview token (unpublished content, 24 h link) */
  preview: boolean;
};
export type CmsListItemDto = Pick<CmsEntryDto, 'key' | 'type' | 'category' | 'locale' | 'requestedLocale' | 'fallback' | 'title' | 'body' | 'version' | 'publishedAt'> & { sortOrder: number };

// --- announcements (ADM-08 type `announcement`, 06 §8.1, route map §2 layout hooks) -----------------------------------------
/**
 * A live announcement in the reader's locale (French when not translated). Merchant app: `GET /announcements` (channel
 * `banner`, the workspace's plan / workspace targeted, not dismissed by the user) — one dismissible banner each;
 * `GET /announcements/:id` (notification `platform.announcement`) also answers an ended / withdrawn one with its `state`.
 * Public site: `GET /cms/announcements` (channel `web`, announcements for every workspace).
 */
export type AnnouncementView = {
  id: string;
  key: string;
  title: string;
  body: string;
  /** "En savoir plus" target (http(s) URL or an app path) */
  link: string | null;
  locale: 'fr' | 'ar' | 'en';
  fallback: boolean;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string;
  /** `live` · `ended` (window over) · `withdrawn` (unpublished / archived) · `scheduled` (not started yet) */
  state: 'live' | 'ended' | 'withdrawn' | 'scheduled';
  dismissed: boolean;
};

// --- captcha (public forms) ---------------------------------------------------------------------------------------------
/**
 * `GET /captcha/config` → which widget the public forms render. `none` = no widget; `fake` (dev / test) = a plain checkbox
 * "Je ne suis pas un robot" that sends the token `fake-pass`; `turnstile` = Cloudflare Turnstile with `siteKey`.
 * A missing / refused token answers `422 VALIDATION_ERROR` with `fields.captchaToken = validation.captcha`.
 */
export type CaptchaConfigDto = { provider: 'none' | 'fake' | 'turnstile'; siteKey: string | null };
export const FAKE_CAPTCHA_PASS = 'fake-pass';

// --- public account deletion (DEL-01, FL-22, PUB-06) ----------------------------------------------------------------------
/** `POST /account-deletion/request { email, consent: true }` → always `200 { sent: true }` (same answer for unknown e-mails), 3 / h / IP. */
export const AccountDeletionPublicRequestSchema = z
  .object({
    email: z.string({ required_error: 'validation.required' }).trim().toLowerCase().email('validation.email').max(254),
    consent: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
    locale: z.enum(LocaleValues).optional(),
  })
  .strict();
export type AccountDeletionPublicRequestInput = z.infer<typeof AccountDeletionPublicRequestSchema>;
/** `POST /account-deletion/confirm/:token { exportData? }` → `AccountDeletionPublicDto` (status `grace` + `cancelToken`). */
export const AccountDeletionConfirmSchema = z.object({ exportData: z.boolean().default(false) }).strict();
export type AccountDeletionConfirmInput = z.infer<typeof AccountDeletionConfirmSchema>;

/**
 * `GET /account-deletion/confirm/:token` (state of the link), `POST /account-deletion/confirm/:token`, `POST /account-deletion/cancel/:token`.
 * The confirmation link is valid 24 h and single use (`410 ACCOUNT_DELETION_TOKEN_EXPIRED`); after confirmation the page
 * keeps `cancelToken` (valid until `scheduledAt`) for "Annuler" and to follow the export.
 * Blocked requests answer `ACCOUNT_OWNS_WORKSPACE` / `WORKSPACE_HAS_DEBT {amount}` / `ACCOUNT_DELETION_PENDING {scheduledAt}`.
 */
export type AccountDeletionPublicDto = {
  status: 'pending_confirmation' | 'grace' | 'blocked' | 'cancelled' | 'anonymised';
  /** `a***@gmail.com` */
  emailMasked: string;
  requestedAt: string;
  /** end of validity of the confirmation link (pending_confirmation only) */
  linkExpiresAt: string | null;
  scheduledAt: string | null;
  blockedReason: 'ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT' | null;
  /** workspaces the account owns (owner note of the page) */
  ownedWorkspaces: { name: string; status: string }[];
  cancelToken: string | null;
  export: DataExportDto | null;
};

// --- data export (DEL-01 "Exporter mes données", JSON + CSV, 7 days) --------------------------------------------------------
/** `GET /me/data-export` → 202 `{ jobId }` (an export of the last hour is reused) · `GET /me/data-export/:jobId` → `DataExportDto`. */
export type DataExportDto = {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'partial' | 'cancelled';
  progress: number;
  /** signed link to the ZIP (`account.json` + CSV files), valid until `expiresAt` (7 days) */
  url: string | null;
  createdAt: string;
  expiresAt: string | null;
};
export const DATA_EXPORT_TTL_DAYS = 7;
