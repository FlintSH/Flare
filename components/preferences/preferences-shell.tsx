'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type LucideIcon, ShieldCheck } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PreferenceSection<T extends string = string> = {
  id: T
  title: string
  description: string
  hint?: string
  icon: LucideIcon
  dirty?: boolean
}

export function PreferencesShell<T extends string>({
  eyebrow,
  title,
  description,
  sections,
  activeSection,
  onSectionChange,
  children,
  actions,
  asideNote,
}: {
  eyebrow: string
  title: string
  description: string
  sections: readonly PreferenceSection<T>[]
  activeSection: T
  onSectionChange: (section: T) => void
  children: ReactNode
  actions?: ReactNode
  asideNote?: ReactNode
}) {
  const selected = sections.find((section) => section.id === activeSection)
  const navigation = useRef<HTMLElement>(null)

  useEffect(() => {
    const revealSelection = () => {
      const nav = navigation.current
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
      const container = nav.getBoundingClientRect()
      const item = active.getBoundingClientRect()
      if (item.left < container.left)
        nav.scrollLeft -= container.left - item.left
      else if (item.right > container.right)
        nav.scrollLeft += item.right - container.right
    }
    revealSelection()
    window.addEventListener('resize', revealSelection)
    return () => window.removeEventListener('resize', revealSelection)
  }, [activeSection])

  return (
    <div className="relative isolate mx-auto w-full max-w-7xl pb-12">
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
          <div className="flex shrink-0 items-center gap-3">{actions}</div>
        )}
      </header>

      <div className="grid min-w-0 gap-7 pt-7 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10 lg:pt-9">
        <aside className="min-w-0">
          <nav
            ref={navigation}
            aria-label={`${title} sections`}
            className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onSectionChange(section.id)}
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:items-start',
                  activeSection === section.id
                    ? 'border-border bg-card text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    activeSection === section.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/70'
                  )}
                >
                  <section.icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 lg:pt-0.5">
                  <span className="flex items-center gap-2 whitespace-nowrap text-sm font-medium">
                    {section.title}
                    {section.dirty && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary">
                        <span className="sr-only">Unsaved changes</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 hidden text-xs font-normal leading-relaxed text-muted-foreground lg:block">
                    {section.hint || section.description}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          {asideNote && (
            <div className="mt-8 hidden border-t border-border/60 px-3.5 pt-6 text-xs leading-relaxed text-muted-foreground lg:block">
              <ShieldCheck className="mb-3 h-5 w-5" aria-hidden="true" />
              {asideNote}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {selected && (
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {selected.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {selected.description}
              </p>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export function PreferencesPanel({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  if (!active && !visited) return null

  return (
    <section hidden={!active} className={active ? 'space-y-6' : undefined}>
      {children}
    </section>
  )
}
