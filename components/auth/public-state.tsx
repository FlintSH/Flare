import type { ReactNode } from 'react'

import { AuthCard } from '@/components/auth/auth-shell'
import {
  PublicBackLink,
  type PublicBackLinkTarget,
  PublicHeader,
  publicColumnClassName,
} from '@/components/customization/share-layout'
import { DynamicBackground } from '@/components/layout/dynamic-background'

import { cn } from '@/lib/utils'

/**
 * A public page with one card: not found, errors and file password prompts.
 * It shares the header, column and card with share pages and sign-in pages.
 */
export function PublicState({
  statusCode,
  title,
  description,
  children,
  footer,
  backLink,
}: {
  statusCode?: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  backLink?: PublicBackLinkTarget | null
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <DynamicBackground />
      <PublicHeader />
      <main className="relative z-10 flex flex-1 flex-col pb-8 pt-5 sm:pt-6">
        <div className={cn(publicColumnClassName, 'flex flex-1 flex-col')}>
          {/* Set a little below the header on wider screens, like the
              sign-in pages, so a message doesn't move the whole card. A way
              back to a shared folder sits right above the card. */}
          <div className="flex flex-1 items-start justify-center sm:pt-[6vh]">
            <div className="flex w-full max-w-[400px] flex-col gap-3">
              {backLink && <PublicBackLink {...backLink} />}
              <AuthCard
                titleId="public-state-title"
                eyebrow={statusCode && `Error ${statusCode}`}
                title={title}
                description={description}
              >
                {children}
              </AuthCard>
            </div>
          </div>
        </div>
      </main>
      {footer}
    </div>
  )
}
