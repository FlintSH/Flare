import { z } from 'zod'

// The rules for an account's name, sign-in address and password, shared by
// the API schemas and the forms, so this module must stay browser-safe.

/**
 * No path has ever accepted an empty name, and setup accepted one character,
 * so every name an account has stays valid when it is saved again.
 */
export const ACCOUNT_NAME_MIN_LENGTH = 1
export const ACCOUNT_PASSWORD_MIN_LENGTH = 8
/** bcrypt ignores everything after 72 bytes, so a longer password would be cut silently. */
export const PASSWORD_MAX_BYTES = 72

/** Whether bcrypt reads all of a password, file passwords included. */
export function fitsPasswordHash(password: string) {
  return new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES
}

export const accountNameSchema = z
  .string()
  .min(ACCOUNT_NAME_MIN_LENGTH, 'Username is required')

export const accountEmailSchema = z.string().email()

export const accountPasswordSchema = z
  .string()
  .min(ACCOUNT_PASSWORD_MIN_LENGTH)
  .refine(
    fitsPasswordHash,
    `Password must use at most ${PASSWORD_MAX_BYTES} bytes.`
  )

/** Persistent guidance for choosing a new account password. */
export const ACCOUNT_PASSWORD_HELP = `Use at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters and at most ${PASSWORD_MAX_BYTES} bytes. Some emoji count as more than one toward the minimum. Plain English letters use one byte each; emoji and accented letters can use more.`

/** Browser-safe feedback using the same rule that the account APIs enforce. */
export function accountPasswordHint(password: string): string | null {
  const result = accountPasswordSchema.safeParse(password)
  if (result.success) return null
  return result.error.issues[0].code === 'too_small'
    ? `Use at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`
    : `Use at most ${PASSWORD_MAX_BYTES} bytes. Emoji and accented letters can use several bytes.`
}
