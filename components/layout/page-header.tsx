import type { ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'

/** A translucent panel on the page background, as used by page sections. */
export const pagePanelClassName =
  'rounded-2xl border border-border/60 bg-panel p-4 sm:p-6 shadow-sm'

/** Keep creation-page headings aligned with their centered form panels. */
export const workspaceFormPageClassName =
  'mx-auto w-full max-w-4xl space-y-5 sm:space-y-6'

/** The title block each dashboard page starts with. */
export function PageHeader({
  eyebrow,
  title,
  description,
  descriptionClassName,
  actions,
  className,
  headingRef,
  actionsBesideTitle = false,
  compactMobile = false,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  descriptionClassName?: string
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
  /** Less decorative framing for phone settings; all actions stay available. */
  compactMobile?: boolean
}) {
  const heading = (
    <h1
      ref={headingRef}
      tabIndex={headingRef ? -1 : undefined}
      className={cn(
        'flex-1 text-2xl font-semibold tracking-tight outline-none sm:text-3xl',
        compactMobile && 'text-xl'
      )}
    >
      {title}
    </h1>
  )
  const eyebrowLine = eyebrow && (
    <p
      className={cn(
        'mb-2 basis-full text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground',
        compactMobile && 'hidden sm:block'
      )}
    >
      {eyebrow}
    </p>
  )
  const descriptionLine = description && (
    <p
      className={cn(
        'order-1 mt-2 basis-full max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base',
        descriptionClassName
      )}
    >
      {description}
    </p>
  )
  const actionGroup = actions && (
    <div
      className={cn(
        'col-start-2 flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 self-center sm:self-auto',
        eyebrow ? 'row-start-2' : 'row-start-1',
        compactMobile &&
          'max-sm:[&_[data-flare-control]]:h-auto max-sm:[&_[data-flare-control]]:!min-h-[44px] max-sm:[&_[data-flare-control]]:max-w-full max-sm:[&_[data-flare-control]]:whitespace-normal max-sm:[&_[data-flare-control]]:px-[12px] max-sm:[&_[data-flare-control]]:py-[8px]'
      )}
    >
      {actions}
    </div>
  )

  // Inside a panel (the library), the header is the compact form: a smaller
  // title and a tighter description, so the first row of files stays in view.
  if (actionsBesideTitle)
    return (
      <header className={cn('border-b border-border/60 pb-5', className)}>
        {eyebrowLine}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <h1
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="text-2xl font-semibold tracking-tight outline-none"
          >
            {title}
          </h1>
          {actionGroup}
        </div>
        {description && (
          <p
            className={cn(
              'col-span-2 mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base',
              descriptionClassName
            )}
          >
            {description}
          </p>
        )}
      </header>
    )

  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 border-b border-border/60 pb-5 sm:gap-5',
        className,
        compactMobile && 'gap-x-[8px] gap-y-[8px] pb-[12px] sm:pb-5'
      )}
    >
      <div className="contents sm:block sm:min-w-0 sm:max-w-3xl">
        {eyebrowLine}
        {heading}
        {descriptionLine}
      </div>
      {actionGroup}
    </header>
  )
}
