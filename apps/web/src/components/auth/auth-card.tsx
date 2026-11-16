'use client';
// AuthLayout card (Figma "AUTH — Login — default"): 440 px card on ink/base, logo + tagline, title, description.
import { useDocumentTitle } from '@/lib/document-title';
import { Card, cn, Pill, type Tone } from '@djaber/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { Logo } from '@/components/shell/sidebar';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { useLocaleCode, useT } from '@/lib/i18n';

export function AuthCard({
  title,
  description,
  badge,
  children,
  footer,
  wide,
}: {
  title: string;
  description?: ReactNode;
  badge?: { label: string; tone: Tone };
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useDocumentTitle(title);
  const t = useT();
  return (
    <Card className={cn('w-full p-8', wide ? 'max-w-[480px]' : 'max-w-[440px]')}>
      <div className="flex items-center gap-2.5">
        <Logo compact />
        <div>
          <div className="ts-display-s text-[19px] leading-none">
            Djaber<span className="text-text-secondary">.ai</span>
          </div>
          <div className="mt-1 text-[12px] text-text-muted">{t('auth.tagline')}</div>
        </div>
      </div>
      {badge ? (
        <div className="mt-5">
          <Pill tone={badge.tone}>{badge.label}</Pill>
        </div>
      ) : null}
      <h1 className={cn('ts-display-m break-words', badge ? 'mt-4' : 'mt-6')}>{title}</h1>
      {description ? <p className="ts-body mt-4 text-text-secondary">{description}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
      {footer ? <div className="mt-6 text-center text-[13px] text-text-secondary">{footer}</div> : null}
      {/* full-test 15/11 PUBLIC-14: FR · AR · EN under every auth card (forgot / reset password, verify e-mail, invitation —
          a user who opens an e-mail link in the wrong language can change it), not only on login / sign-up */}
      <Suspense>
        <LocaleSwitch className="mt-5" />
      </Suspense>
    </Card>
  );
}

/** FR · AR · EN — keeps the current path and query. */
export function LocaleSwitch({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <div role="group" aria-label={t('auth.language')} className={cn('flex items-center justify-center gap-3', className)}>
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => {
            const q = search.toString();
            router.replace(`${pathname}${q ? `?${q}` : ''}`, { locale: l });
          }}
          className={cn('ts-label-meta uppercase', l === locale ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function AuthLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('text-text-primary underline decoration-line-lit underline-offset-4 hover:decoration-white', className)}>
      {children}
    </Link>
  );
}

/** Small mono link under a field ("Mot de passe oublié ?"). */
export function MetaLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="ts-label-meta text-text-muted hover:text-text-primary">
      {children}
    </Link>
  );
}
