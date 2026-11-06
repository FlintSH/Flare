import { z } from 'zod'

// The IDs that name an account in its file URLs: the URL ID every account
// has and the vanity ID it may choose. The API schemas, the forms and the
// proxy's file path rule share these rules, so this module must stay
// browser-safe.

/**
 * First path segments that belong to Flare's own routes or are held back for
 * them, in any letter case. No URL ID or vanity ID may be one, they are never
 * read as a URL ID, and generated URL IDs avoid them.
 */
export const RESERVED_PUBLIC_IDS = [
  'api',
  'auth',
  'dashboard',
  'admin',
  'settings',
  'setup',
  'raw',
  'direct',
  'u',
  'profile',
  'avatars',
  '_next',
] as const

export const URL_ID_LENGTH = 5
export const VANITY_ID_MIN_LENGTH = 3
export const VANITY_ID_MAX_LENGTH = 32

/**
 * A path segment that can name an account, as a regular expression source:
 * letters, digits and inner hyphens, as long as a vanity ID may be. Every URL
 * ID fits it too, and it rules out the one-letter `/s/` and `/u/` routes.
 */
export const PUBLIC_ID_PATTERN = `[A-Za-z0-9][A-Za-z0-9-]{${VANITY_ID_MIN_LENGTH - 2},${VANITY_ID_MAX_LENGTH - 2}}[A-Za-z0-9]`

export function isReservedPublicId(id: string) {
  return (RESERVED_PUBLIC_IDS as readonly string[]).includes(id.toLowerCase())
}

const RESERVED_MESSAGE = 'This URL path is reserved and cannot be used'

const urlIdMessage = `URL ID must be ${URL_ID_LENGTH} alphanumeric characters`

const urlIdCharacters = z
  .string()
  .regex(/^[A-Za-z0-9]*$/, urlIdMessage)
  .length(URL_ID_LENGTH, urlIdMessage)

/**
 * Letters and digits, and not one of Flare's own routes. File URLs use an ID
 * as written, so letter case counts.
 */
export const urlIdSchema = urlIdCharacters.refine(
  (id) => !isReservedPublicId(id),
  RESERVED_MESSAGE
)

/**
 * Whether a URL ID being typed can still become valid: only its length may
 * fall short. A reserved ID is left for the save to refuse with its reason.
 */
export function isUrlIdDraft(value: string) {
  const result = urlIdCharacters.safeParse(value)
  return (
    result.success ||
    result.error.issues.every((issue) => issue.code === 'too_small')
  )
}

/**
 * Letters, digits and inner hyphens, and not one of Flare's own routes. Like
 * a URL ID, it is used as written, so letter case counts.
 */
export const vanityIdSchema = z
  .string()
  .min(
    VANITY_ID_MIN_LENGTH,
    `Vanity URL must be at least ${VANITY_ID_MIN_LENGTH} characters`
  )
  .max(
    VANITY_ID_MAX_LENGTH,
    `Vanity URL must be at most ${VANITY_ID_MAX_LENGTH} characters`
  )
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/,
    'Vanity URL must start and end with alphanumeric characters and can contain hyphens'
  )
  .refine((id) => !isReservedPublicId(id), RESERVED_MESSAGE)

/**
 * A vanity ID as its field keeps it while it is typed: the characters a
 * vanity ID can hold, as typed, up to its longest length.
 */
export function vanityIdDraft(value: string) {
  return value.replace(/[^A-Za-z0-9-]/g, '').slice(0, VANITY_ID_MAX_LENGTH)
}
