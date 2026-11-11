'use client'

import { type ReactNode, useId, useRef, useState } from 'react'

import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Closing the optional controls keeps their values and moves invalid-password
 * guidance outside, so a disabled creation action always has a visible reason. */
export function CreationOptions({
  customized,
  label = 'Sharing options',
  error,
  passwordField,
  children,
}: {
  customized: boolean
  label?: string
  error?: string | null
  passwordField?: string
  children: ReactNode
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const errorId = useId()
  return (
    <div className="space-y-3">
      <details
        ref={disclosure}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group rounded-xl border border-border bg-muted/15 px-4"
      >
        <summary
          aria-describedby={error && !open ? errorId : undefined}
          className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-medium"
        >
          <span className="mr-auto">{label}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {error ? 'Check password' : customized ? 'Customized' : 'Optional'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="space-y-4 border-t border-border pb-4 pt-4">
          {children}
        </div>
      </details>
      {error && !open && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p id={errorId} role="status" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="link"
            className="mt-1 h-auto justify-start px-0 py-1 text-foreground"
            onClick={() => {
              setOpen(true)
              if (disclosure.current) disclosure.current.open = true
              if (passwordField) document.getElementById(passwordField)?.focus()
            }}
          >
            Review password
          </Button>
        </div>
      )}
    </div>
  )
}
