import { filePasswordHint } from '@/lib/files/password-policy'

/** The rule for a new file password, shown once the entered value breaks it. */
export function FilePasswordHint({
  id,
  password,
}: {
  id: string
  password: string
}) {
  const hint = password ? filePasswordHint(password) : null
  if (!hint) return null
  return (
    <p id={id} className="text-sm text-destructive">
      {hint}
    </p>
  )
}

/** Field attributes that connect a password input to its hint. */
export function filePasswordFieldProps(id: string, password: string) {
  const invalid = Boolean(password && filePasswordHint(password))
  return {
    'aria-invalid': invalid,
    'aria-describedby': invalid ? id : undefined,
  }
}
