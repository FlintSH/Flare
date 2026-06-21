'use client'

import { X } from 'lucide-react'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

interface TagBadgeProps {
  name: string
  color?: string | null
  className?: string
  onRemove?: () => void
  onClick?: () => void
}

export function TagBadge({
  name,
  color,
  className,
  onRemove,
  onClick,
}: TagBadgeProps) {
  const classes = getColorClasses(color ?? null)

  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium max-w-full',
        classes.badge,
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className
      )}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="shrink-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
          aria-label={`Remove ${name} tag`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
