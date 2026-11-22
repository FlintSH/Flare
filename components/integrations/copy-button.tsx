'use client'

import { useEffect, useRef, useState } from 'react'

import { Check, Copy } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'

/**
 * Copies `value` and says so for a moment. With `label` it is a text button;
 * without one, an icon button named after what it copies ("Copy command").
 */
export function CopyButton({
  value,
  name,
  label,
  ...props
}: {
  value: string
  /** What is copied, for the accessible name: "command", "token". */
  name: string
  label?: string
} & Omit<ButtonProps, 'value' | 'name' | 'onClick' | 'children'>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    let next: typeof state = 'copied'
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // The browser blocked the clipboard; the text beside it can be selected.
      next = 'failed'
    }
    setState(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  const status =
    state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={label ? 'default' : 'icon'}
        aria-label={label ? undefined : `Copy ${name}`}
        onClick={() => void copy()}
        {...props}
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {label && (status ?? label)}
      </Button>
      {/* A changed icon or label alone tells a screen reader nothing. */}
      <span className="sr-only" role="status">
        {status ? `${status}: ${name}` : ''}
      </span>
    </>
  )
}
