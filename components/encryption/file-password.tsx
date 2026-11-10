'use client'

import { useEffect, useState } from 'react'

import { StrengthMeter } from '@/components/encryption/passphrase-fields'

import {
  type PassphraseStrength,
  measurePassphrase,
  preloadStrengthCheck,
} from '@/lib/e2ee/client/strength'

/** What the Argon2id step of a file password shows while it runs. */
export const DERIVING_FILE_KEY = 'Deriving the key…'

type Measured =
  | { status: 'empty' }
  | { status: 'failed' }
  | { status: 'measured'; for: string; strength: PassphraseStrength }

/**
 * The strength of a new password of an encrypted file
 * (docs/e2ee-spec.md, section 5.2.1): zxcvbn, in the browser, with a
 * minimum score of 3. The server never gets the password, so it cannot
 * check it. `enabled: false` measures nothing.
 */
export function useFilePasswordStrength(password: string, enabled = true) {
  const [measured, setMeasured] = useState<Measured>({ status: 'empty' })

  useEffect(() => {
    if (enabled) preloadStrengthCheck()
  }, [enabled])

  useEffect(() => {
    if (!enabled || !password) {
      setMeasured({ status: 'empty' })
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      measurePassphrase(password).then(
        (strength) => {
          if (!stale)
            setMeasured({ status: 'measured', for: password, strength })
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
  }, [password, enabled])

  const strength =
    measured.status === 'measured' && measured.for === password
      ? measured.strength
      : null
  return {
    strength,
    failed: measured.status === 'failed',
    /** Why this password cannot be used yet, or null. Null for no password. */
    problem:
      !enabled || !password
        ? null
        : measured.status === 'failed'
          ? 'The strength check could not load. Reload the page and try again.'
          : !strength
            ? 'Checking the password…'
            : strength.acceptable
              ? null
              : 'This password is too easy to guess. Make it longer or add more unrelated words.',
  }
}

/** The meter under a file password field, with the text for an empty field. */
export function FilePasswordStrength({
  id,
  password,
  strength,
  failed,
  empty,
}: {
  id: string
  password: string
  strength: PassphraseStrength | null
  failed: boolean
  /** What the line says before anything is typed. */
  empty: string
}) {
  if (!password)
    return (
      <p id={id} className="text-pretty text-xs text-muted-foreground">
        {empty}
      </p>
    )
  return (
    <StrengthMeter
      id={id}
      passphrase={password}
      strength={strength}
      failed={failed}
    />
  )
}
