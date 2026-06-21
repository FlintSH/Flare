'use client'

import { Check } from 'lucide-react'

import { ORGANIZATION_COLORS, getColorClasses } from '@/lib/organization/colors'
import type { OrganizationColor } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

interface ColorPickerProps {
  value: OrganizationColor | null
  onChange: (color: OrganizationColor | null) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'h-6 w-6 rounded-full border border-border bg-muted-foreground/30 flex items-center justify-center',
          value === null && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
        )}
        aria-label="No color"
      >
        {value === null && <Check className="h-3 w-3 text-foreground" />}
      </button>
      {ORGANIZATION_COLORS.map((color) => {
        const classes = getColorClasses(color)
        return (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className={cn(
              'h-6 w-6 rounded-full flex items-center justify-center transition-transform hover:scale-110',
              classes.dot,
              value === color &&
                'ring-2 ring-ring ring-offset-2 ring-offset-background'
            )}
            aria-label={color}
          >
            {value === color && <Check className="h-3 w-3 text-white" />}
          </button>
        )
      })}
    </div>
  )
}
