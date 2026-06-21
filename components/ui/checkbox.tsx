'use client'

import * as React from 'react'

import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

// A minimal, dependency-free checkbox styled to match the shadcn/ui look.
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCheckedChange?.(!checked)
        }}
        className={cn(
          'peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center transition-colors',
          checked
            ? 'bg-primary text-primary-foreground'
            : 'bg-background/80',
          className
        )}
        {...props}
      >
        {checked && <Check className="h-3 w-3" />}
      </button>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
