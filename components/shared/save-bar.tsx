import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

const tones = {
  saved: 'bg-success',
  unsaved: 'bg-warning',
  draft: 'bg-info',
} as const

/**
 * The one bar that commits changes (the appearance studio, the role editor,
 * email settings and unsaved instance settings): a panel with the status at
 * the start and the actions at the end. Phones stack the status above the
 * actions, each full width with the main action on top. Pass default-size
 * (36px) buttons as children, main action last.
 */
export function SaveBar({
  tone,
  title,
  description,
  children,
  sticky = false,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone?: keyof typeof tones
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Follow the bottom of the screen, for editors taller than a screen. */
  sticky?: boolean
}) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 px-6 py-4 shadow-sm backdrop-blur-xl sm:flex-row sm:flex-wrap sm:items-center sm:justify-between',
        // Floating over the form, it takes the opaque lifted surface.
        sticky && 'sticky bottom-4 z-30 bg-overlay shadow-lg shadow-black/20',
        className
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          {tone && (
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', tones[tone])}
            />
          )}
          {title}
        </p>
        {description && (
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {/* Phones stack the actions full width with the main one on top, like
          dialog footers; pass them in reading order, main action last. */}
      <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
        {children}
      </div>
    </div>
  )
}
