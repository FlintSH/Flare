'use client'

import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  PASSPHRASE_MAX_LENGTH,
  type PassphraseStrength,
  measurePassphrase,
  preloadStrengthCheck,
} from '@/lib/e2ee/client/strength'
import { cn } from '@/lib/utils'

const STRENGTH_LABELS = [
  'Too easy to guess',
  'Too easy to guess',
  'Still easy to guess',
  'Strong',
  'Very strong',
] as const

type Measured =
  | { status: 'empty' }
  | { status: 'measuring' }
  | { status: 'failed' }
  | { status: 'measured'; for: string; strength: PassphraseStrength }

/**
 * The state of a "choose a passphrase" form: the two fields, the strength of
 * the first one (docs/e2ee-spec.md, section 5.2.1) and the one problem that
 * stops the form, if any.
 *
 * `userInputs` are words that the passphrase must not be made of: the
 * account's address, its username and the name of the instance.
 */
export function useNewPassphrase(
  userInputs: readonly (string | null | undefined)[]
) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [measured, setMeasured] = useState<Measured>({ status: 'empty' })
  const inputsKey = userInputs.filter(Boolean).join('\n')

  useEffect(() => {
    preloadStrengthCheck()
  }, [])

  useEffect(() => {
    if (!passphrase) {
      setMeasured({ status: 'empty' })
      return
    }
    let stale = false
    // A short pause keeps the estimate off the path of every key press.
    const timer = setTimeout(() => {
      measurePassphrase(passphrase, inputsKey.split('\n')).then(
        (strength) => {
          if (!stale)
            setMeasured({ status: 'measured', for: passphrase, strength })
        },
        () => {
          if (!stale) setMeasured({ status: 'failed' })
        }
      )
    }, 120)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [passphrase, inputsKey])

  const strength =
    measured.status === 'measured' && measured.for === passphrase
      ? measured.strength
      : null
  const problem = !passphrase
    ? 'Enter a passphrase.'
    : measured.status === 'failed'
      ? 'The strength check could not load. Reload the page and try again.'
      : !strength
        ? 'Checking your passphrase. Try again in a moment.'
        : !strength.acceptable
          ? 'This passphrase is too easy to guess. Make it longer or add more unrelated words.'
          : passphrase !== confirmation
            ? 'The two passphrases do not match.'
            : null

  return {
    passphrase,
    confirmation,
    setPassphrase,
    setConfirmation,
    strength,
    failed: measured.status === 'failed',
    /** Why the form cannot be sent yet, or null. */
    problem,
    /** Measures a passphrase now, for a caller that cannot wait for the next render. */
    measure: (text: string) => measurePassphrase(text, inputsKey.split('\n')),
    reset() {
      setPassphrase('')
      setConfirmation('')
    },
  }
}

export type NewPassphrase = ReturnType<typeof useNewPassphrase>

/** Four segments and one line of text. The text carries the meaning; the colour repeats it. */
export function StrengthMeter({
  id,
  passphrase,
  strength,
  failed,
}: {
  id: string
  passphrase: string
  strength: PassphraseStrength | null
  failed: boolean
}) {
  const score = strength?.score ?? 0
  const filled = !strength ? 0 : Math.max(1, score)
  const tone = !strength
    ? 'bg-border'
    : score >= 3
      ? 'bg-success'
      : score === 2
        ? 'bg-warning'
        : 'bg-danger'
  const advice =
    strength && !strength.acceptable
      ? strength.warning || strength.suggestions[0] || null
      : null
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              segment <= filled ? tone : 'bg-border'
            )}
          />
        ))}
      </div>
      <p
        id={id}
        aria-live="polite"
        className="min-h-4 text-pretty text-xs leading-relaxed text-muted-foreground"
        data-strength-score={strength ? score : undefined}
      >
        {!passphrase ? (
          'Use several unrelated words. Longer is stronger than complicated.'
        ) : failed ? (
          'The strength check could not load.'
        ) : !strength ? (
          'Checking…'
        ) : (
          <>
            <span className="font-medium text-foreground">
              {STRENGTH_LABELS[score]}.
            </span>
            {advice ? ` ${advice}` : ''}
          </>
        )}
      </p>
    </div>
  )
}

/** The passphrase field with its strength meter, and the field that confirms it. */
export function NewPassphraseFields({
  form,
  disabled,
  label = 'Passphrase',
  confirmLabel = 'Confirm passphrase',
  placeholder = 'Choose a passphrase',
  inputClassName,
  autoFocus,
  idPrefix,
}: {
  form: NewPassphrase
  disabled?: boolean
  label?: string
  confirmLabel?: string
  placeholder?: string
  inputClassName?: string
  autoFocus?: boolean
  /** Stable ids for forms that focus a field by id. */
  idPrefix?: string
}) {
  const generated = useId()
  const prefix = idPrefix ?? generated
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-passphrase`}>{label}</Label>
        <Input
          id={`${prefix}-passphrase`}
          name="new-passphrase"
          type="password"
          value={form.passphrase}
          onChange={(event) => form.setPassphrase(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          maxLength={PASSPHRASE_MAX_LENGTH}
          required
          disabled={disabled}
          autoFocus={autoFocus}
          data-sensitive="true"
          aria-describedby={`${prefix}-strength`}
          className={inputClassName}
        />
        <StrengthMeter
          id={`${prefix}-strength`}
          passphrase={form.passphrase}
          strength={form.strength}
          failed={form.failed}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-confirmation`}>{confirmLabel}</Label>
        <Input
          id={`${prefix}-confirmation`}
          name="confirm-passphrase"
          type="password"
          value={form.confirmation}
          onChange={(event) => form.setConfirmation(event.target.value)}
          placeholder="Type it again"
          autoComplete="new-password"
          maxLength={PASSPHRASE_MAX_LENGTH}
          required
          disabled={disabled}
          data-sensitive="true"
          className={inputClassName}
        />
      </div>
    </>
  )
}

/** What a busy button says while Argon2id runs. */
export const DERIVING_KEYS = 'Deriving your keys…'
