import * as React from 'react'

import { type VariantProps, cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// One callout for messages in forms, pages and dialogs. The text stays in the
// foreground colour; the tone comes from the tint, border and icon.
const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3 text-sm leading-relaxed text-foreground [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-[0.875rem] [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/30 [&>svg]:text-muted-foreground',
        destructive: 'border-danger/30 bg-danger/10 [&>svg]:text-danger',
        warning: 'border-warning/30 bg-warning/10 [&>svg]:text-warning',
        success: 'border-success/30 bg-success/10 [&>svg]:text-success',
        info: 'border-border bg-muted/30 [&>svg]:text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-medium leading-5 tracking-tight', className)}
    {...props}
  />
))
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-pretty text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertTitle, AlertDescription }
