import type { ReactNode } from 'react'

/** The way back, or the way to skip an optional step. */
export const setupSecondaryActionClassName = 'h-11 w-full sm:w-auto'

/** The step's main action, which always moves the setup forward. */
export const setupPrimaryActionClassName =
  'h-11 w-full sm:ml-auto sm:w-auto sm:min-w-36'

/**
 * One footer for every setup step: Back (or the optional step's skip) at the
 * start and the primary action at the end. Phones stack both at full width
 * with the primary action on top, like dialog footers and save bars.
 */
export function SetupActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center">
      {children}
    </div>
  )
}
