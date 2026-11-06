'use client'

import type { ReactNode } from 'react'

import { RadioGroupItem } from '@/components/ui/radio-group'

import { cn } from '@/lib/utils'

/**
 * The option card every setup step uses (storage, access, the starting look
 * and email): an inset with a hairline, the primary border once chosen, and the
 * app's radio at the top right. The whole card is the radio's label and
 * shows its focus ring. Use inside a RadioGroup.
 */
export function SetupOption({
  id,
  value,
  selected,
  title,
  description,
  visual,
  className,
}: {
  id: string
  value: string
  selected: boolean
  title: ReactNode
  description: ReactNode
  /** An icon tile or swatch beside the radio; the text takes its place if omitted. */
  visual?: ReactNode
  className?: string
}) {
  const text = (
    <span className="block min-w-0 space-y-1">
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-pretty text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
    </span>
  )
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
        selected
          ? 'border-primary bg-primary/5'
          : 'bg-muted/30 hover:border-primary/50',
        className
      )}
    >
      <span
        className={cn('flex gap-3', visual ? 'items-center' : 'items-start')}
      >
        <span className="min-w-0 flex-1">{visual ?? text}</span>
        <RadioGroupItem
          id={id}
          value={value}
          className={cn(
            'shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0',
            !visual && 'mt-0.5'
          )}
        />
      </span>
      {visual && text}
    </label>
  )
}

export function SetupOptionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background [&_svg]:h-5 [&_svg]:w-5">
      {children}
    </span>
  )
}
