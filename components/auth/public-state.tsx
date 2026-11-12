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
 * It shares the header and column with share pages, and the card with the
 * sign-in pages.
 */
export function PublicState({
  statusCode,
  icon,
  title,
  description,
  children,
  footer,
  backLink,
}: {
  statusCode?: string
  icon?: ReactNode
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
      {/* The footer brings its own space above it. */}
      <main
        className={cn(
          'relative z-10 flex flex-1 flex-col pt-5 sm:pt-6',
          !footer && 'pb-5 sm:pb-6'
        )}
      >
        <div className={cn(publicColumnClassName, 'flex flex-1 flex-col')}>
          {/* In the middle of the page, where a shared file's card sits, so
              unlocking a file doesn't move it. A way back to a shared folder
              sits right above the card. */}
          <div className="flex flex-1 items-center justify-center">
            <div className="flex w-full max-w-[400px] flex-col gap-3">
              {backLink && <PublicBackLink {...backLink} />}
              <AuthCard
                titleId="public-state-title"
                icon={icon}
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
