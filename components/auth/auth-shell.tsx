import type { ReactNode } from 'react'

import Link from 'next/link'

import { FileText, FolderOpen, Link2 } from 'lucide-react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

export function AuthShell({
  eyebrow = 'Your space starts here',
  title,
  description,
  children,
}: {
  eyebrow?: string
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
          className="inline-flex max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          aria-label="Go to home"
        >
          <InstanceBrand textClassName="text-xl font-semibold" />
        </Link>
      </header>
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 pb-12 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-20 lg:pb-24">
        <div className="hidden max-w-lg lg:block">
          <p className="mb-5 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
            A little less friction
          </p>
          <h2 className="text-5xl font-semibold leading-[1.12] tracking-tight">
            A home for everything you share.
          </h2>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">
            Files, ideas, and useful links. Keep them together, make them yours,
            and share them in a moment.
          </p>
          <div className="mt-10 flex flex-wrap gap-5 border-t border-border/60 pt-6 text-sm text-muted-foreground">
            {[
              { label: 'Files', icon: FolderOpen },
              { label: 'Pastes', icon: FileText },
              { label: 'Links', icon: Link2 },
            ].map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </div>
        <section
          aria-labelledby="auth-title"
          className="mx-auto w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-8"
          data-flare-surface
        >
          <div className="mb-7">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
              {eyebrow}
            </p>
            <h1
              id="auth-title"
              className="text-3xl font-semibold tracking-tight"
            >
              {title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
        </section>
      </main>
    </div>
  )
}
