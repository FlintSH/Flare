import type { ReactNode } from 'react'

import Link from 'next/link'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { publicChipClassName } from '@/components/customization/share-layout'
import { DynamicBackground } from '@/components/layout/dynamic-background'

import { cn } from '@/lib/utils'

/** The one link style on sign-in cards and public prompts. */
export const authLinkClassName =
  'rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** The centred closing line of a card, such as "New here? Create an account". */
export function AuthFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 border-t border-border pt-5 text-center text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * The card shared by the sign-in pages, file password prompts and the
 * not-found page: one width, padding and title size.
 */
export function AuthCard({
  titleId,
  eyebrow,
  title,
  description,
  children,
}: {
  titleId: string
  eyebrow?: ReactNode
  title: ReactNode
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="w-full max-w-[400px] rounded-2xl border border-border/60 bg-panel p-6 shadow-sm"
      data-flare-surface
    >
      <div className="mb-6 space-y-2 text-center">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 id={titleId} className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-balance text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="relative isolate min-h-[calc(100dvh-57px)] overflow-hidden">
      <DynamicBackground />
      {/* A fixed distance from the top rather than centred, so the brand
          sits in the same place on every sign-in page and a message that
          appears pushes the form down instead of moving the whole card. */}
      <div className="relative z-10 flex min-h-[calc(100dvh-57px)] items-start justify-center px-4 py-10 sm:px-6 sm:pb-12 sm:pt-[max(3rem,10vh)]">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="flex justify-center">
            <Link
              href="/"
              className={cn(
                publicChipClassName,
                'pl-2.5 pr-3.5 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:pl-3.5 sm:pr-[1.125rem]'
              )}
            >
              <InstanceBrand />
            </Link>
          </div>
          <AuthCard
            titleId="auth-title"
            title={title}
            description={description}
          >
            {children}
          </AuthCard>
        </div>
      </div>
    </main>
  )
}
