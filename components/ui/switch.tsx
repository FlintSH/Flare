'use client'

import * as React from 'react'

import * as SwitchPrimitives from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

/**
 * Off is an outlined track with a small thumb, on a filled track, like the
 * checkbox: the two states differ in shape as well as colour, so a locked
 * (disabled) switch still reads as on or off.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:data-[state=checked]:border-muted-foreground disabled:data-[state=checked]:bg-muted-foreground data-[state=unchecked]:border-control data-[state=unchecked]:bg-transparent',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block rounded-full shadow-lg ring-0 transition-all data-[state=checked]:h-4 data-[state=checked]:w-4 data-[state=checked]:translate-x-4 data-[state=checked]:bg-background data-[state=unchecked]:ml-0.5 data-[state=unchecked]:h-2.5 data-[state=unchecked]:w-2.5 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-control'
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
