/**
 * Reading what someone hands Flare outside its tools (a paste on any page,
 * or into Find) and doing the one thing it's for. Nothing here sends what
 * was pasted anywhere until the person chooses the action. Browser-safe.
 */
import { withScheme } from '@/lib/links/compose'
import { type ShortLink, shortLinkUrl } from '@/lib/links/schema'
import { findSecret } from '@/lib/paste/insights'
import { FIND_MINIMUM } from '@/lib/search/contract'

import { copyWhenReady } from './clipboard'
import { apiRequest } from './request'

/** An address that starts anywhere, even inside a word. */
const ADDRESS_INSIDE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi

/** The words of a text, split where spaces, markup or quoting would end an address. */
const ADDRESS_IN_TEXT = /[^\s<>"'`()[\]{}]+/g

/** The open Links page reloads its list on this (a link made elsewhere). */
export const LINKS_CHANGED = 'flare:links-changed'

/**
 * What a link inside a text carries (its first such link), in words, or
 * null: the same rule as for a link on its own.
 */
export function credentialIn(text: string): string | null {
  // Each word of the first 4 KB (bare example.com/… addresses), and each
  // address with a scheme or www. anywhere in up to 1 MB (a long log or
  // email): cheap to find, and the ones that matter there.
  for (const [word] of text.slice(0, 4096).matchAll(ADDRESS_IN_TEXT)) {
    const url = asLink(word)
    const carries = url && linkCarriesCredential(url)
    if (carries) return carries
  }
  // These start with a scheme or www., so they're addresses however long
  // (a signed URL can pass asLink's length limit).
  for (const [address] of text.slice(0, 1 << 20).matchAll(ADDRESS_INSIDE)) {
    const carries = linkCarriesCredential(withScheme(address))
    if (carries) return carries
  }
  return null
}

/** Text longer than this, or on several lines, is never treated as a search. */
export const SEARCHABLE_MAX = 200

export type Gift =
  | { kind: 'files'; files: File[] }
  | {
      kind: 'link'
      url: string
      /** Why the link shouldn't be shortened on a key press: what it seems to carry. */
      carries: string | null
    }
  | {
      kind: 'text'
      text: string
      lines: number
      /** What credential the text seems to hold, in words, or null. */
      secret: string | null
    }

/**
 * Query and fragment keys that usually hold a credential or a one-time code,
 * however they're joined (reset_token, resetToken, apiKey, X-Amz-Signature).
 * Erring towards private: a harmless key that matches only means the link
 * isn't shortened from a key press.
 */
const CREDENTIAL_WORDS = new Set([
  'token',
  'code',
  'key',
  'secret',
  'signature',
  'sig',
  'password',
  'passwd',
  'pass',
  'pwd',
  'auth',
  'session',
  'sid',
  'otp',
  'ticket',
  'credential',
  // Flare's own invite links redeem an account.
  'invite',
  // Run together, all lower case.
  'apikey',
  'accesstoken',
  'authtoken',
  'sessionid',
])
/** Whether a key names a credential by its last word: reset_token, apiKey. */
function credentialKey(key: string) {
  const words = key
    // APIKey, SSOToken, then apiKey.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean)
  const last = words.at(-1) ?? ''
  return (
    CREDENTIAL_WORDS.has(last) || (last === 'hash' && words.at(-2) === 'token')
  )
}

/**
 * What a link seems to carry that makes it private, in words ("a sign-in
 * token"), or null: a password in its address, a credential-like query
 * value, or a known token shape anywhere in it.
 */
export function linkCarriesCredential(url: string, depth = 0): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return 'a password'
  // The fragment too, as sign-in flows put tokens there (#access_token=).
  // An app's route there has a query of its own (#/reset?token=).
  const hash = parsed.hash.replace(/^#/, '')
  const fragment = new URLSearchParams(hash)
  const route = new URLSearchParams(
    hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  )
  for (const params of [parsed.searchParams, fragment, route])
    for (const [key, value] of params) {
      if (value && credentialKey(key)) return 'a token'
      // A link carried inside another (?redirect=…) counts as well.
      // (Also one without its scheme, //host/… or www.…, or a path on the
      // same site, /login?token=….)
      if (depth < 3 && /^(?:https?:)?\/|^www\./i.test(value)) {
        // (An app link like myapp://… has no origin to resolve a path on.)
        let nested: string | null = null
        try {
          nested = value.startsWith('/')
            ? new URL(value, parsed.origin).href
            : withScheme(value)
        } catch {
          nested = null
        }
        const inner = nested && linkCarriesCredential(nested, depth + 1)
        if (inner) return inner
      }
    }
  return findSecret(url)
}

/**
 * Endings of sites people type bare, none of them a common file extension
 * (so not .ai, an Illustrator file, or .md, .sh).
 */
const SITE_SUFFIXES =
  /\.(?:com|org|net|io|dev|app|co|me|gg|xyz|info|edu|gov|tv|uk|de|fr|nl|eu|ca|us|ly|site|page|blog|tech|cloud)$/i

/** A whole string that is one web address, with the scheme it would get. */
export function asLink(text: string): string | null {
  const value = text.trim()
  if (!value || value.length > 4096 || /\s/.test(value)) return null
  const schemed = /^https?:\/\//i.test(value)
  const url = withScheme(value)
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const parsed = new URL(url)
    // Typed with its scheme, any host counts (an intranet name, an IP).
    // Without one, a lone dotted word is a file name as often as a site
    // (canyon.jpg, notes.md), so it takes www., a path, a query or a port,
    // or ends in a suffix that only sites use (example.com).
    if (schemed) return url
    const addressed =
      /^www\./i.test(value) ||
      /^[^/?#]+[/?#:]/.test(value) ||
      SITE_SUFFIXES.test(parsed.hostname)
    return addressed &&
      (parsed.hostname.includes('.') || parsed.hostname === 'localhost')
      ? url
      : null
  } catch {
    return null
  }
}

/**
 * What a paste holds, in the order Flare acts on it: files first, then a
 * lone link, then text. Null when there's nothing to act on.
 */
export function readGift(payload: {
  files: readonly File[]
  text: string
}): Gift | null {
  if (payload.files.length) return { kind: 'files', files: [...payload.files] }
  const text = payload.text
  if (!text.trim()) return null
  const url = asLink(text)
  if (url) return { kind: 'link', url, carries: linkCarriesCredential(url) }
  return {
    kind: 'text',
    text,
    lines: text.replace(/\n$/, '').split('\n').length,
    secret: findSecret(text) ?? credentialIn(text),
  }
}

/**
 * Shortens `url` under a random ending and copies the short link, asking for
 * the clipboard within the key press or click that called this.
 */
export async function shortenAndCopy(url: string) {
  const creating = apiRequest<ShortLink>('/api/urls', {
    body: { url },
    fallback: 'Could not create the link. Try again.',
  })
  const copying = copyWhenReady(
    creating.then((link) =>
      shortLinkUrl(link.shortCode, window.location.origin)
    )
  )
  const link = await creating
  window.dispatchEvent(new Event(LINKS_CHANGED))
  const made = shortLinkUrl(link.shortCode, window.location.origin)
  return { id: link.id, link: made, copied: await copying }
}

/**
 * Why typed text isn't sent to the server, if it isn't, and the secret it
 * holds: a long paste is scanned once for both.
 */
export function searchHold(query: string): {
  reason: 'short' | 'secret' | 'link' | 'long' | null
  secret: string | null
} {
  const trimmed = query.trim()
  if (trimmed.length < FIND_MINIMUM) return { reason: 'short', secret: null }
  // A link of any length (up to an address's limit) is a link, and a secret
  // of any length or shape is a secret, before either counts as long text.
  if (asLink(trimmed)) return { reason: 'link', secret: null }
  // A credential-carrying link anywhere in it (beside other words, in <…>,
  // in Markdown) counts too: neither the search nor the library's address
  // sees it.
  const secret = findSecret(trimmed) ?? credentialIn(trimmed)
  if (secret) return { reason: 'secret', secret }
  if (trimmed.length > SEARCHABLE_MAX || /\n/.test(query))
    return { reason: 'long', secret: null }
  return { reason: null, secret: null }
}
