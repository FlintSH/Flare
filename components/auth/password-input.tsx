'use client'

import * as React from 'react'

import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'

type PasswordInputProps = Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  'type'
> & {
  /** The particular field, for example "current password". Never its value. */
  visibilityLabel: string
  'data-sensitive'?: string | boolean
}

/** A concealed account password with a field-local, keyboard-accessible reveal. */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(function PasswordInput(
  {
    visibilityLabel,
    id: suppliedId,
    className,
    disabled,
    'data-sensitive': sensitive = 'true',
    ...props
  },
  ref
) {
  const generatedId = React.useId()
  const id = suppliedId ?? generatedId
  const group = React.useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = React.useState(false)
  const visible = revealed && !disabled

  React.useLayoutEffect(() => {
    if (disabled) setRevealed(false)
  }, [disabled])

  // Native fieldsets can disable the field without changing its own props.
  React.useLayoutEffect(() => {
    const input = group.current?.querySelector('input')
    if (!input) return
    const observer = new MutationObserver(() => {
      if (input.matches(':disabled')) setRevealed(false)
    })
    for (
      let parent = input.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (parent.tagName === 'FIELDSET')
        observer.observe(parent, {
          attributes: true,
          attributeFilter: ['disabled'],
        })
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={group}
      className="relative min-w-0"
      data-password-field=""
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setRevealed(false)
      }}
    >
      <Input
        {...props}
        id={id}
        ref={ref}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        data-sensitive={sensitive}
        className={cn('min-h-[44px] pr-[52px]', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-1/2 h-[44px] w-[44px] !min-h-[44px] !min-w-[44px] -translate-y-1/2"
        disabled={disabled}
        aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        aria-controls={id}
        aria-pressed={visible}
        data-password-visibility=""
        onClick={() => setRevealed((previous) => !previous)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
})
