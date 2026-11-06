import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type MetaItem = {
  key: string
  text: ReactNode
  title?: string
  /** Lets a long value, such as a name, break inside itself. */
  wrap?: boolean
  className?: string
}

/**
 * A metadata line ("0 of 1 use · Expires in 1 day"), spaced like " · " in
 * running text. Lines break between items, never inside one, so a label
 * stays with its value ("Never expires", "Created 2 days ago"). Each middot
 * belongs to the item after it, and the one that starts a line sits in the
 * clipped margin, so no line starts or ends with a separator. It renders
 * spans, so it also fits inside buttons.
 */
export function MetaLine({
  items,
  className,
}: {
  items: MetaItem[]
  className?: string
}) {
  return (
    <span className={cn('block overflow-hidden', className)}>
      <span className="-ml-[0.8em] flex flex-wrap">
        {items.map((item) => (
          <span
            key={item.key}
            title={item.title}
            className={cn(
              'min-w-0 before:inline-block before:w-[0.8em] before:text-center before:content-["·"]',
              // A value wider than a whole line ends in an ellipsis.
              !item.wrap && 'max-w-full truncate',
              item.className
            )}
          >
            {item.text}
          </span>
        ))}
      </span>
    </span>
  )
}
