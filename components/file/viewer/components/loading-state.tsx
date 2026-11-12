import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The tallest a preview grows. The share layout sets `--stage-max` so the
 * file's name, its actions and the preview fit one screen together.
 */
export const stageMaxHeightClassName = 'max-h-[var(--stage-max,60vh)]'

/** The surface a preview sits on, between the file's header and the card's edge. */
export const stageSurfaceClassName = 'bg-muted/60 dark:bg-muted/30'

interface LoadingStateProps {
  message?: string
  /** The size of the preview this stands in for, so loading doesn't move the page. */
  className?: string
  style?: React.CSSProperties
}

/** A placeholder the size of the preview it stands in for. */
export function LoadingState({
  message = 'Loading preview…',
  className,
  style,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-24 w-full items-center justify-center overflow-hidden p-6',
        stageSurfaceClassName,
        className
      )}
      style={style}
      role="status"
    >
      <div
        className="absolute inset-0 animate-pulse bg-muted/50 dark:bg-muted/40"
        aria-hidden="true"
      />
      <p className="relative inline-flex items-center gap-2.5 rounded-full border border-border/60 bg-panel px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm">
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin"
          aria-hidden="true"
        />
        {message}
      </p>
    </div>
  )
}
