'use client'

import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { type LucideIcon, ShieldCheck } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  const mobileSectionId = useId()
  const sectionHeading = useRef<HTMLHeadingElement>(null)
  const focusSelection = useRef(false)
  const dirtySections = sections.filter((section) => section.dirty)

  const selectSection = (section: T) => {
    if (section === activeSection) return
    focusSelection.current = true
    onSectionChange(section)
  }

  useEffect(() => {
    if (!focusSelection.current) return
    focusSelection.current = false
    // Wait for a popup to finish returning focus to its trigger. Section
    // changes keep the page mounted, including edits in previously used panels.
    const frame = window.requestAnimationFrame(() => {
      sectionHeading.current?.focus({ preventScroll: true })
      sectionHeading.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSection])

  return (
    <div className="relative isolate mx-auto w-full max-w-7xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-28 -z-10 h-96 w-96 rounded-full bg-primary/[.035] blur-3xl dark:bg-primary/[.015]"
      />
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={actions}
      />

      <div className="grid min-w-0 gap-6 pt-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 self-start lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:p-1">
          <div className="space-y-2 lg:hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Label htmlFor={mobileSectionId}>Section</Label>
              {dirtySections.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {dirtySections.length}{' '}
                  {dirtySections.length === 1 ? 'section has' : 'sections have'}{' '}
                  unsaved changes
                </span>
              )}
            </div>
            <Select
              value={activeSection}
              onValueChange={(value) => selectSection(value as T)}
            >
              <SelectTrigger
                id={mobileSectionId}
                aria-label={`${title} section`}
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.title}
                    {section.dirty ? ' · Unsaved changes' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav
            aria-label={`${title} sections`}
            className="hidden gap-1.5 lg:flex lg:flex-col"
          >
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => selectSection(section.id)}
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  activeSection === section.id
                    ? 'border-border bg-panel text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    activeSection === section.id
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted/40'
                  )}
                >
                  <section.icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="flex items-center gap-2 whitespace-nowrap text-sm font-medium">
                    {section.title}
                    {section.dirty && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary">
                        <span className="sr-only">Unsaved changes</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-pretty text-xs font-normal leading-relaxed text-muted-foreground">
                    {section.hint || section.description}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          {asideNote && (
            <div className="mt-5 hidden border-t border-border/60 px-3 pt-4 text-xs leading-relaxed text-muted-foreground lg:block">
              <ShieldCheck className="mb-3 h-5 w-5" aria-hidden="true" />
              {asideNote}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {selected && (
            <div>
              <h2
                ref={sectionHeading}
                tabIndex={-1}
                className="scroll-mt-28 text-xl font-semibold tracking-tight outline-none"
              >
                {selected.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
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
