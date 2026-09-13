import type { ReactNode } from 'react'

import Link from 'next/link'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

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
      <div className="relative z-10 flex min-h-[calc(100dvh-57px)] items-center justify-center px-4 py-10 sm:px-6 sm:py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <Link
            href="/"
            className="mx-auto flex w-fit max-w-full items-center justify-center rounded-2xl border border-border/70 bg-card/70 px-6 py-4 shadow-sm backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            aria-label="Go to home"
          >
            <InstanceBrand
              iconClassName="h-8 w-8"
              textClassName="text-2xl font-semibold"
            />
          </Link>
          <section
            aria-labelledby="auth-title"
            className="rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm backdrop-blur-xl sm:p-8"
            data-flare-surface
          >
            <div className="mb-6 space-y-2 text-center">
              <h1
                id="auth-title"
                className="text-2xl font-semibold tracking-tight"
              >
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
            {children}
          </section>
        </div>
      </div>
    </main>
  )
}
