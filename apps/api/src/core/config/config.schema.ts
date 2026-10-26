// 01-nest-module-map §5 "Config": zod schema, fails fast on boot, secrets never logged.
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4010),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PUBLIC_API_URL: z.string().default('http://localhost:4010'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3010'),
  WEB_ORIGINS: z.string().default('http://localhost:3010'),

  // Auth — EdDSA key pair (PKCS8 / SPKI PEM, base64-encoded). Generated on first dev boot when empty.
  JWT_PRIVATE_KEY: z.string().default(''),
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_ACCESS_TTL_S: z.coerce.number().int().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().default(7), // AUTH-02: rotating refresh token, 7 days
  // web and API on two different sites (Vercel + VPS host): refresh cookie SameSite=None; Secure; Partitioned
  REFRESH_COOKIE_CROSS_SITE: bool.default(false),
  // AES-256-GCM key ring: `v1:<base64 32 bytes>,v2:...` (last = current).
  ENCRYPTION_KEYS: z.string().default(''),

  // Storage: `local` (dev/test default) or `s3`
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.local/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),

  // Mail: `file` (dev/test default) or `resend`
  MAIL_DRIVER: z.enum(['file', 'resend', 'smtp']).default('file'),
  // `smtp` driver (the V1 server's mailbox): host, port (465 = implicit TLS), credentials
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_LOCAL_DIR: z.string().default('.local/mail'),
  MAIL_FROM: z.string().default('Djaber <no-reply@djaber.ai>'),
  RESEND_API_KEY: z.string().optional(),

  // Meta
  META_DRIVER: z.enum(['fake', 'graph']).default('fake'),
  // safety guard: the Graph adapter refuses to start in development / test unless this is true (the V1 app is live on the same Meta app)
  META_ALLOW_LIVE: bool.default(false),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  // Meta accepts the HUMAN_AGENT tag (a member's reply 24 h – 7 days after the customer's message, Messenger) only from
  // apps approved for the « Human Agent » feature in App Review; refused otherwise with #100/2018276 (tester account
  // 26/10). Off ⇒ such a reply is refused at once with REPLY_OUTSIDE_WINDOW, as on Instagram. Turn on once approved.
  META_HUMAN_AGENT_TAG: bool.default(false),
  // V1 → V2 cutover on the same public host: answer the paths registered in the Meta app (webhook, OAuth return,
  // data deletion) so nothing changes on Meta's side. Off by default.
  META_LEGACY_PATHS: bool.default(false),
  // Facebook Login permissions requested (comma list) when the Meta app has fewer than the full list; empty = full list
  META_FACEBOOK_SCOPES: z.string().default(''),
  // OAuth `redirect_uri` path (must equal the one registered in Meta); `{platform}` = facebook | instagram
  META_OAUTH_CALLBACK_PATH: z.string().default('/api/v1/channels/callback/{platform}'),

  // Payments (Chargily is the only gateway, D4)
  PAYMENT_PROVIDER: z.literal('chargily').default('chargily'),
  PAYMENT_DRIVER: z.enum(['fake', 'chargily']).default('fake'),
  // safety guard: the Chargily adapter refuses to start in development / test unless this is true (no real payment from dev)
  PAYMENT_ALLOW_LIVE: bool.default(false),
  CHARGILY_API_KEY: z.string().optional(),
  CHARGILY_SECRET: z.string().optional(),
  CHARGILY_MODE: z.enum(['test', 'live']).default('test'),

  // AI providers (platform keys live in DB `AiProvider`; env only bootstraps them)
  AI_DRIVER: z.enum(['fake', 'live']).default('fake'),
  // safety guard: the live adapter refuses to start in development / test unless this is true
  AI_ALLOW_LIVE: bool.default(false),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // Couriers / Google / push / stores
  COURIER_DRIVER: z.enum(['fake', 'live']).default('fake'),
  // safety guard: the live courier drivers refuse to start in development / test unless this is true (never create real parcels from dev)
  COURIER_ALLOW_LIVE: bool.default(false),
  // per courier account limiter (03-events §3 `courier` queue): parcel creation 5 / s, tracking batches 2 / s
  COURIER_SEND_RPS: z.coerce.number().int().min(1).default(5),
  COURIER_TRACK_RPS: z.coerce.number().int().min(1).default(2),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SHEETS_DRIVER: z.enum(['fake', 'google']).default('fake'),
  // safety guard (M11): the Google Sheets driver refuses to start in development / test unless this is true
  SHEETS_ALLOW_LIVE: bool.default(false),
  // 05-integrations §3: while the Google OAuth app is in "testing" status the Sheets card shows "≤ 100 utilisateurs test"
  GOOGLE_OAUTH_VERIFIED: bool.default(false),
  GOOGLE_PICKER_KEY: z.string().optional(),
  GOOGLE_PICKER_APP_ID: z.string().optional(),
  // D41 testing exemption: comma-separated e-mails of platform users who may open the admin without 2FA. Ignored when
  // NODE_ENV=production (the rule then applies to everyone); meant for the staging test super admin only.
  PLATFORM_2FA_EXEMPT_EMAILS: z.string().default(''),
  // outbound merchant webhooks (M11): in development / test only local / LAN receivers are called unless this is true
  WEBHOOKS_ALLOW_LIVE: bool.default(false),
  // captcha of the public forms (M11): none | fake (token `fake-pass`) | turnstile (refused in development / test unless CAPTCHA_ALLOW_LIVE)
  CAPTCHA_DRIVER: z.enum(['none', 'fake', 'turnstile']).default('fake'),
  CAPTCHA_ALLOW_LIVE: bool.default(false),
  CAPTCHA_SITE_KEY: z.string().optional(),
  CAPTCHA_SECRET: z.string().optional(),
  PUSH_DRIVER: z.enum(['fake', 'fcm']).default('fake'),
  // SMS port (M10, PlatformProvider `sms`): `fake` writes the messages to SMS_LOCAL_DIR (no live SMS), `none` drops them
  SMS_DRIVER: z.enum(['fake', 'none']).default('fake'),
  SMS_LOCAL_DIR: z.string().default('.local/sms'),
  FCM_SERVICE_ACCOUNT: z.string().optional(),
  // safety guard: the FCM adapter refuses to start in development / test unless this is true (03-events §5.2)
  PUSH_ALLOW_LIVE: bool.default(false),
  IAP_DRIVER: z.enum(['fake', 'stores']).default('fake'),
  // safety guard: the live store validators refuse to start in development / test unless this is true
  IAP_ALLOW_LIVE: bool.default(false),
  GOOGLE_PLAY_SERVICE_ACCOUNT: z.string().optional(),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().default('ai.djaber.app'),
  // Pub/Sub push subscription URL carries `?token=<this>` (05-integrations §5)
  GOOGLE_PLAY_PUBSUB_TOKEN: z.string().optional(),
  APP_STORE_SHARED_SECRET: z.string().optional(),
  APPLE_IAP_KEY_ID: z.string().optional(),
  APPLE_IAP_ISSUER_ID: z.string().optional(),
  APPLE_IAP_PRIVATE_KEY: z.string().optional(),
  APPLE_IAP_BUNDLE_ID: z.string().default('ai.djaber.app'),
  APPLE_IAP_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // SHA-256 fingerprint of "Apple Root CA - G3" (the root of the x5c chain of every App Store signed payload)
  APPLE_ROOT_CA_SHA256: z.string().default('63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179'),

  // Prometheus `/metrics` (07-non-functional §5): internal network only; when set, the scrape needs `Authorization: Bearer <token>`
  METRICS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SWAGGER_ENABLED: bool.default(true),
  SEED_ADMIN_EMAIL: z.string().default('admin@djaber.local'),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
