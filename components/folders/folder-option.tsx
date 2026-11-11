'use client'

import type { ReactNode } from 'react'

import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The scrolling list both folder pickers use (Move, and the archive
 * destination). Pair it with `ref={scrollFadeRef}` and a max height that
 * leaves part of a row showing, inside a `rounded-xl border p-1` frame: the
 * edge fade masks the list, so the frame has to sit outside it.
 */
export const folderListClassName =
  'scroll-fade overflow-y-auto overscroll-contain'

/** One destination in a folder picker: icon, path, and a check when chosen. */
export function FolderOption({
  icon,
  label,
  selected,
  disabled,
  onSelect,
}: {
  icon: ReactNode
  label: ReactNode
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
        selected
          ? 'bg-primary/10 text-primary dark:bg-secondary dark:text-secondary-foreground'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {selected && <Check aria-hidden="true" />}
    </button>
  )
}
