/**
 * Reading a long link as it is pasted on the Links page: the address it
 * really is, the tracking it carries, and an ending a person could remember.
 * Browser-safe; nothing here contacts the destination.
 */
/** Long enough to say what it is, short enough to type. */
const MAX_SUGGESTED = 32

/**
 * The address typed, with `https://` added when it plainly names a site
 * without a scheme (`example.com/page`). Anything else comes back as typed,
 * for validation to judge.
 */
export function withScheme(typed: string) {
  const value = typed.trim()
  // A scheme, unless what follows the colon is a port: `localhost:3000`.
  if (!value || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return value
  // A host with a dot and a letter-only top-level name, or localhost, then
  // an optional port and path. No spaces anywhere.
  if (
    !/^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,63})(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(
      value
    )
  )
    return value
  try {
    new URL(`https://${value}`)
    return `https://${value}`
  } catch {
    return value
  }
}

/** Parameters that only say where a click came from, on any site. */
const TRACKING = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'igshid',
  'igsh',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
])

/** `si` only tracks on these sites; elsewhere it may matter. */
const SHARE_TAG_SITES = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i

function tracks(name: string, host: string) {
  const key = name.toLowerCase()
  if (key.startsWith('utm_') || TRACKING.has(key)) return true
  return key === 'si' && SHARE_TAG_SITES.test(host)
}

/**
 * The query parameters that only identify where a click came from, and the
 * address without them. Only those `name=value` pieces are cut from the text
 * as typed; everything else, encoding and order included, stays byte for
 * byte. Null when there is nothing to remove or the address won't parse.
 */
export function trackingParameters(
  address: string
): { names: string[]; cleaned: string } | null {
  let host: string
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    host = url.hostname
  } catch {
    return null
  }
  const hash = address.indexOf('#')
  const beforeHash = hash < 0 ? address : address.slice(0, hash)
  const fragment = hash < 0 ? '' : address.slice(hash)
  const question = beforeHash.indexOf('?')
  if (question < 0) return null
  const base = beforeHash.slice(0, question)
  const names: string[] = []
  const kept: string[] = []
  for (const pair of beforeHash.slice(question + 1).split('&')) {
    const raw = pair.split('=', 1)[0] ?? ''
    let name = raw
    try {
      name = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
      /* A malformed name is kept as it is. */
    }
    if (pair && tracks(name, host)) names.push(name)
    else kept.push(pair)
  }
  if (!names.length) return null
  const query = kept.some(Boolean) ? `?${kept.join('&')}` : ''
  return { names: [...new Set(names)], cleaned: `${base}${query}${fragment}` }
}

/** Path segments that identify rather than describe: IDs, hashes, dates as numbers. */
function opaque(segment: string) {
  if (/^\d+$/.test(segment)) return true
  if (
    /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(
      segment
    )
  )
    return true
  if (/^[0-9a-f]{12,}$/i.test(segment)) return true
  if (/[-_.]/.test(segment)) return false
  // Letters and digits run together: `1x9Fq0bL4rN2T8vYp3wZ`, `7Hq2xK`.
  const digits = /\d/.test(segment)
  const lower = /[a-z]/.test(segment)
  const upper = /[A-Z]/.test(segment)
  if (segment.length >= 5 && digits && lower && upper) return true
  return segment.length >= 10 && digits && (lower || upper)
}

/** A slugged title, such as `flare-brand-kit`: it says enough on its own. */
const titled = (word: string) =>
  word.split('-').filter((part) => /[a-z]{3}/.test(part)).length >= 2

/** At most `max` characters, cut between words. */
function shorten(word: string, max: number) {
  if (word.length <= max) return word
  const cut = word.slice(0, max + 1)
  const end = cut.lastIndexOf('-')
  return (end > 0 ? cut.slice(0, end) : word.slice(0, max)).replace(/-+$/, '')
}

/** Words in a URL that say where you are, not what it is. */
const FILLER = new Set([
  'www',
  'm',
  'en',
  'en-us',
  'index',
  'html',
  'htm',
  'php',
  'aspx',
  'edit',
  'view',
  'watch',
  'tag',
  'tags',
  'blob',
  'tree',
  'main',
  'master',
  'd',
  'u',
  'p',
  's',
  'c',
  'document',
  'spreadsheets',
  'presentation',
  'file',
  'share',
  'status',
  'posts',
  'post',
  'article',
  'articles',
  'wiki',
  'pages',
  'page',
  'docs',
  'doc',
  'com',
  'org',
  'net',
  'io',
  'dev',
  'app',
])

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * A short, readable ending for a destination, or null when nothing readable
 * is left once IDs and filler are set aside: `…/FlintSH/Flare/releases/tag/
 * v3.1.0` gives `flare-releases-v3-1-0` trimmed to its last words. It is only
 * a suggestion; whether it is free is checked when the link is made.
 */
export function suggestEnding(address: string): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  const words: string[] = []
  const segments = url.pathname.split('/').filter(Boolean)
  for (const raw of segments) {
    let segment = raw
    try {
      segment = decodeURIComponent(raw)
    } catch {
      /* Keep it encoded. */
    }
    // `report.pdf` reads as `report`; a version's dots stay as words.
    segment = segment.replace(/\.(html?|php|aspx?|jsp)$/i, '')
    if (!segment || opaque(segment)) continue
    const part = slug(segment)
    if (!part || FILLER.has(part)) continue
    words.push(part)
  }
  if (!words.length) {
    // A site's home page is named by its site; a page of IDs gets nothing.
    if (segments.length) return null
    const host = url.hostname.replace(/^www\./i, '').split('.')
    const name = host.length > 1 ? host[host.length - 2] : host[0]
    const part = name ? slug(name) : ''
    return part && !FILLER.has(part) ? part : null
  }
  const last = words[words.length - 1]!
  if (titled(last)) return shorten(last, MAX_SUGGESTED)
  // Otherwise the last few words: the repository and its release.
  const kept: string[] = []
  for (const word of [...words].reverse()) {
    const next = [word, ...kept].join('-')
    if (kept.length === 3 || (kept.length && next.length > MAX_SUGGESTED)) break
    kept.unshift(word)
  }
  return shorten(kept.join('-'), MAX_SUGGESTED) || null
}

/**
 * Whether a link already made leads to this address: the same text, apart
 * from the letter case of the scheme and host, which never matters, or the
 * same once tracking parameters are removed from the new one.
 */
export function sameDestination(existing: string, address: string) {
  const key = (value: string) => {
    // A user name and password before `@` keep their case; only the
    // scheme and host ignore it.
    const match =
      /^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]*@)?([^/?#]*)([\s\S]*)$/i.exec(
        value.trim()
      )
    return match
      ? `${match[1]!.toLowerCase()}${match[2] ?? ''}${match[3]!.toLowerCase()}${match[4]}`
      : value.trim()
  }
  const target = key(existing)
  if (target === key(address)) return true
  const cleaned = trackingParameters(address)?.cleaned
  return !!cleaned && target === key(cleaned)
}
