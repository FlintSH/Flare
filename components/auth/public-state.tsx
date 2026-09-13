import type { ReactNode } from 'react'

import Link from 'next/link'

import type { LucideIcon } from 'lucide-react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

export function PublicState({
  icon: Icon,
  statusCode,
  title,
  description,
  children,
  footer,
  compact = false,
}: {
  icon?: LucideIcon
  statusCode?: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  compact?: boolean
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <DynamicBackground />
      <header className="relative z-10 px-4 py-6 sm:px-6">
        <Link
          href="/dashboard"
          className="inline-flex max-w-full rounded-xl border border-border/60 bg-card/70 px-4 py-2 shadow-sm backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Go to your files"
        >
          <InstanceBrand />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-10 pt-4 sm:px-6">
        <section
          className={`w-full rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm backdrop-blur-xl ${compact ? 'max-w-[340px]' : 'max-w-md sm:p-8'}`}
          aria-labelledby="public-state-title"
          data-flare-surface
        >
          <div
            className={
              compact
                ? 'mb-4 space-y-2 text-center'
                : 'mb-6 space-y-3 text-center'
            }
          >
            {statusCode ? (
              <p
                className="text-6xl font-semibold tracking-tight"
                aria-hidden="true"
              >
                {statusCode}
              </p>
            ) : Icon ? (
              <Icon
                className="mx-auto h-6 w-6 text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
            <h1
              id="public-state-title"
              className="text-xl font-semibold tracking-tight"
            >
              {title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
        </section>
      </main>
      {footer}
    </div>
  )
}
