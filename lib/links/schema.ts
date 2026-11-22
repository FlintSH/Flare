/** Shared by the short-link API and the dashboard. No server imports. */
import { z } from 'zod'

/** The most characters a custom ending may have. */
export const SHORT_CODE_MAX_LENGTH = 64

const destination = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), {
    message: 'Only HTTP and HTTPS URLs are allowed',
  })

/**
 * A custom ending: what follows `/u/`. Letters, digits, `-` and `_`, the
 * characters generated codes use, so every code is safe in a path as typed.
 */
export const shortCodeSchema = z
  .string()
  .max(
    SHORT_CODE_MAX_LENGTH,
    `Endings can be at most ${SHORT_CODE_MAX_LENGTH} characters.`
  )
  .regex(/^[A-Za-z0-9_-]+$/, 'Endings can use letters, numbers, - and _ only.')

export const shortLinkInputSchema = z.object({
  url: destination,
  /** Omitted or empty: a random six-character code. */
  code: z
    .string()
    .trim()
    .nullish()
    .transform((code) => code || undefined)
    .pipe(shortCodeSchema.optional()),
})

/** A link's code is fixed; only where it leads can change. */
export const shortLinkUpdateSchema = z.strictObject({ url: destination })

/** A short link as the API sends it to its owner. */
export interface ShortLink {
  id: string
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: string
  userId: string
}

/** Moderators list one account's links, so each leaves out the owner. */
export type AccountShortLink = Omit<ShortLink, 'userId'>

export interface AccountShortLinkPage {
  urls: AccountShortLink[]
  pagination: { total: number; pages: number; page: number; limit: number }
}

/** The public redirect for a code; absolute when given the instance origin. */
export function shortLinkUrl(shortCode: string, origin = '') {
  return `${origin}/u/${shortCode}`
}
