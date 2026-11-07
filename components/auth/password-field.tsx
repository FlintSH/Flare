'use client'

import { type FormEvent, useRef, useState } from 'react'

import { accountPasswordHint } from '@/lib/users/account-policy'

type Field = 'password' | 'confirmation'

function formInput(form: HTMLFormElement | null | undefined, id?: string) {
  const input = id ? form?.elements?.namedItem(id) : null
  return input && 'setCustomValidity' in input
    ? (input as HTMLInputElement)
    : null
}

/** Keep native validation/focus and expose the same errors after interaction. */
export function usePasswordFields({
  passwordId,
  helpId,
  confirmationId,
  optional = false,
}: {
  passwordId: string
  helpId: string
  confirmationId?: string
  optional?: boolean
}) {
  const [errors, setErrors] = useState({ password: '', confirmation: '' })
  const touched = useRef({ password: false, confirmation: false })

  const problem = (field: Field, value: string, password: string) =>
    field === 'password'
      ? optional && !value
        ? ''
        : accountPasswordHint(value) || ''
      : !value
        ? 'Confirm your password.'
        : value !== password
          ? 'Passwords do not match.'
          : accountPasswordHint(value) || ''

  const inspect = (field: Field, input: HTMLInputElement, reveal: boolean) => {
    const password =
      field === 'password'
        ? input.value
        : formInput(input.form, passwordId)?.value || ''
    const message = problem(field, input.value, password)
    input.setCustomValidity(message)
    if (reveal) touched.current[field] = true
    if (touched.current[field])
      setErrors((previous) => ({ ...previous, [field]: message }))
  }

  const inputProps = (field: Field) => ({
    'aria-invalid': errors[field] ? (true as const) : undefined,
    'aria-describedby':
      [
        field === 'password' ? helpId : '',
        errors[field]
          ? `${field === 'password' ? passwordId : confirmationId}-error`
          : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    onInvalid: (event: FormEvent<HTMLInputElement>) =>
      inspect(field, event.currentTarget, true),
    onBlur: (event: FormEvent<HTMLInputElement>) =>
      inspect(field, event.currentTarget, true),
    onInput: (event: FormEvent<HTMLInputElement>) => {
      inspect(field, event.currentTarget, false)
      // A corrected primary value must also clear an earlier mismatch without
      // making the person edit an already matching confirmation again.
      if (field === 'password') {
        const confirmation = formInput(event.currentTarget.form, confirmationId)
        if (confirmation) inspect('confirmation', confirmation, false)
      }
    },
  })

  return {
    passwordProps: inputProps('password'),
    confirmationProps: inputProps('confirmation'),
    errors,
    reset() {
      touched.current = { password: false, confirmation: false }
      setErrors({ password: '', confirmation: '' })
    },
    /** Retain the pre-request gate even for autofill/programmatic submission. */
    validate(password: string, confirmation?: string, form?: HTMLFormElement) {
      const next = {
        password: problem('password', password, password),
        confirmation:
          confirmationId && confirmation !== undefined
            ? problem('confirmation', confirmation, password)
            : '',
      }
      touched.current = { password: true, confirmation: !!confirmationId }
      setErrors(next)
      const primary = formInput(form, passwordId)
      const repeated = formInput(form, confirmationId)
      primary?.setCustomValidity(next.password)
      repeated?.setCustomValidity(next.confirmation)
      if (next.password || next.confirmation) {
        ;(next.password ? primary : repeated)?.reportValidity()
        return false
      }
      return true
    },
  }
}

export function PasswordFieldError({
  id,
  message,
}: {
  id: string
  message: string
}) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null
}
