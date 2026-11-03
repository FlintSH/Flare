import * as React from 'react'

import { cn } from '@/lib/utils'

// The same chevron as Select, drawn by CSS so the native control keeps its
// own list. Mid-grey reads on both light and dark fields.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b97a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

/**
 * A native <select>, styled like Input. Use it where the browser's own list
 * is wanted (long option lists, forms that submit natively).
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, style, ...props }, ref) => (
  <select
    ref={ref}
    style={{ backgroundImage: CHEVRON, ...style }}
    className={cn(
      'flex h-9 w-full appearance-none rounded-md border border-control bg-transparent bg-[length:1rem] bg-[position:right_0.6rem_center] bg-no-repeat py-1 pl-3 pr-9 text-base shadow-sm md:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground',
      className
    )}
    {...props}
  />
))
NativeSelect.displayName = 'NativeSelect'

export { NativeSelect }
