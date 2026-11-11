/** Shared by the short-link API and the dashboard. No server imports. */
import { z } from 'zod'

import { fragmentCarriesShareSecret } from '@/lib/e2ee/link'

/**
 * A short link stores its target on the server as plain text. The link of
 * an encrypted file carries the file's key after `#`, so shortening it
 * would give the key to the server (docs/e2ee-spec.md, section 12.6). The
 * dashboard checks this before it sends anything.
 */
export const SHORT_LINK_KEY_MESSAGE =
  'This link has an encryption key after #. A short link is stored on the server, so shortening it would give the server the key. Share the full link instead.'

export const shortLinkInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://') || u.startsWith('http://'), {
      message: 'Only HTTP and HTTPS URLs are allowed',
    })
    .refine((u) => !fragmentCarriesShareSecret(u), {
      message: SHORT_LINK_KEY_MESSAGE,
    }),
})

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
