import * as React from 'react'

import { type VariantProps, cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Small status and label chips. Status tones use the success/warning/danger/
// info tokens, so they stay readable in every theme.
const badgeVariants = cva(
  // Every chip has a hairline, so it keeps its shape on insets and rows
  // as well as on panels.
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted/60 text-muted-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        danger: 'border-danger/25 bg-danger/10 text-danger',
        info: 'border-info/25 bg-info/10 text-info',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
