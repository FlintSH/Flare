/** Shared by the short-link API and the dashboard. No server imports. */
import { z } from 'zod'

export const shortLinkInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://') || u.startsWith('http://'), {
      message: 'Only HTTP and HTTPS URLs are allowed',
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
