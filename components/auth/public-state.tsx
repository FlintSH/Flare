import type { ReactNode } from 'react'

import Link from 'next/link'

import type { LucideIcon } from 'lucide-react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

export function PublicState({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <DynamicBackground />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-5 py-7 sm:px-8">
        <Link
          href="/"
          className="inline-flex max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Go to home"
        >
          <InstanceBrand />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-16 pt-6 sm:px-8">
        <section
          className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-8"
          aria-labelledby="public-state-title"
          data-flare-surface
        >
          <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/30">
            <Icon
              className="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1
            id="public-state-title"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {title}
          </h1>
          <p className="mb-7 mt-3 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          {children}
        </section>
      </main>
    </div>
  )
}
