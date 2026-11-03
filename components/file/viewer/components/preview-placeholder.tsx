import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PreviewPlaceholderProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'title'
> {
  icon: LucideIcon
  title: React.ReactNode
  /** Use a heading when the placeholder replaces a whole preview. */
  titleAs?: 'h2' | 'h3' | 'p'
  description?: React.ReactNode
}

/**
 * The quiet inset shown wherever there is nothing to preview. Its title is
 * smaller than the file's name, so a card never shows two competing titles.
 */
export function PreviewPlaceholder({
  icon: Icon,
  title,
  titleAs: Title = 'p',
  description,
  className,
  children,
  ...props
}: PreviewPlaceholderProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted px-6 py-8 text-center dark:bg-muted/30',
        className
      )}
      {...props}
    >
      <Icon className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <Title className="text-pretty text-sm font-medium">{title}</Title>
      {description && (
        <p className="max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </div>
  )
}
