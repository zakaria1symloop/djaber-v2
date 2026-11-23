// Layout pieces of the product page blocks (Figma "CAT-09 — Product page — full"): a titled card and its
// label / value rows (mono label on the start side).
import { Card, cn } from '@djaber/ui';
import type { ReactNode } from 'react';

export function Block({ title, action, children, testId, className, id }: { title: string; action?: ReactNode; children: ReactNode; testId: string; className?: string; id?: string }) {
  return (
    <Card id={id} className={cn('flex flex-col gap-3 p-4 scroll-mt-20', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">{children}</dl>;
}
export function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="ts-label-micro pt-1 uppercase text-text-muted">{label}</dt>
      <dd className="min-w-0" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

/** Grey mono note under a block. */
export const Note = ({ children }: { children: ReactNode }) => <p className="ts-label-meta text-text-muted">{children}</p>;
