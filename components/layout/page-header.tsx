import type { ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'

/** A translucent panel on the page background, as used by page sections. */
export const pagePanelClassName =
  'rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-xl'

/** The title block each dashboard page starts with. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  headingRef,
  actionsBesideTitle = false,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  /** Focus target after in-page navigation; makes the heading focusable. */
  headingRef?: Ref<HTMLHeadingElement>
  /**
   * Keep small actions on the title's line at every width (the library's
   * select, count and refresh), instead of beside the whole block. This is
   * the compact header used inside a panel.
   */
  actionsBesideTitle?: boolean
}) {
  const heading = (
    <h1
      ref={headingRef}
      tabIndex={headingRef ? -1 : undefined}
      className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
    >
      {title}
    </h1>
  )
  const eyebrowLine = eyebrow && (
    <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
      {eyebrow}
    </p>
  )
  const descriptionLine = description && (
    <p className="mt-3 max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
      {description}
    </p>
  )
  const actionGroup = actions && (
    <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
  )

  // Inside a panel (the library), the header is the compact form: a smaller
  // title and a tighter description, so the first row of files stays in view.
  if (actionsBesideTitle)
    return (
      <header className={cn('border-b border-border/60 pb-7', className)}>
        {eyebrowLine}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <h1
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {title}
          </h1>
          {actionGroup}
        </div>
        {description && (
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            {description}
          </p>
        )}
      </header>
    )

  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-5 border-b border-border/60 pb-7',
        className
      )}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrowLine}
        {heading}
        {descriptionLine}
      </div>
      {actionGroup}
    </header>
  )
}
