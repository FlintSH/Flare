import { z } from 'zod'

// The rules for an account's name, sign-in address and password, shared by
// the API schemas and the forms, so this module must stay browser-safe.

/**
 * The shortest username. No path has ever accepted an empty name, and setup
 * accepted one character, so every name an account has stays valid when it
 * is saved again.
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

/** A new account password, whether or not account email is enabled. */
export const accountPasswordSchema = z
  .string()
  .min(ACCOUNT_PASSWORD_MIN_LENGTH)
  .refine(
    fitsPasswordHash,
    `Password must use at most ${PASSWORD_MAX_BYTES} bytes.`
  )
