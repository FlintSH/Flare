import type { ReactNode } from 'react'

import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function WorkspacePage({
  eyebrow = 'Your workspace',
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative isolate mx-auto w-full max-w-7xl space-y-7 pb-12 sm:space-y-9',
        className
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-28 -z-10 h-96 w-96 rounded-full bg-primary/[.035] blur-3xl"
      />
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border/60 pb-7 pt-2 sm:pb-9">
        <div className="max-w-2xl">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-3 sm:pt-7">
            {actions}
          </div>
        )}
      </header>
      {children}
    </div>
  )
}

export function WorkspacePanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6',
        className
      )}
    >
      {(title || action) && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            )}
            {description && (
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function WorkspaceNote({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon?: LucideIcon
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <aside
      className={cn(
        'rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6',
        className
      )}
    >
      {Icon && (
        <span className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </aside>
  )
}
