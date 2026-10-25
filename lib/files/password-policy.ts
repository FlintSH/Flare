import { z } from 'zod'

/** Same floor as account passwords. Existing shorter file passwords keep working. */
export const FILE_PASSWORD_MIN_LENGTH = 8
/** bcrypt ignores everything after 72 bytes, so longer input would be silently cut. */
export const FILE_PASSWORD_MAX_BYTES = 72

type FilePasswordProblem = 'too_short' | 'too_long'

function problem(password: string): FilePasswordProblem | null {
  if (password.length < FILE_PASSWORD_MIN_LENGTH) return 'too_short'
  if (new TextEncoder().encode(password).length > FILE_PASSWORD_MAX_BYTES)
    return 'too_long'
  return null
}

/** Form hint for a new file password, or null when it is acceptable. */
export function filePasswordHint(password: string): string | null {
  switch (problem(password)) {
    case 'too_short':
      return `Use at least ${FILE_PASSWORD_MIN_LENGTH} characters.`
    case 'too_long':
      return `Use at most ${FILE_PASSWORD_MAX_BYTES} bytes. Some characters, such as emoji, use several.`
    default:
      return null
  }
}

/**
 * A new file password. An empty string keeps its existing meaning: no
 * password for an upload, or removing the password from an existing file.
 */
export const newFilePasswordSchema = z.string().superRefine((value, ctx) => {
  const failed = value === '' ? null : problem(value)
  if (failed)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        failed === 'too_short'
          ? `File passwords must be at least ${FILE_PASSWORD_MIN_LENGTH} characters.`
          : `File passwords must be at most ${FILE_PASSWORD_MAX_BYTES} bytes.`,
    })
})

/** The message for a rejected password field, if that is what failed. */
export function filePasswordIssue(error: unknown): string | null {
  if (!(error instanceof z.ZodError)) return null
  const issue = error.issues.find((entry) => entry.path.at(-1) === 'password')
  return issue?.message ?? null
}
