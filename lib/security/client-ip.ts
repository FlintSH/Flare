import { isIP } from 'node:net'

type HeaderSource = { get(name: string): string | null }

// Longest textual IPv6 address with brackets, a zone index, and a port.
const MAX_CANDIDATE = 100
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/

/**
 * An optional single header that the operator's edge sets or overwrites with
 * the client address, such as `CF-Connecting-IP`. When it is configured, no
 * other header is trusted.
 */
function configuredHeader(): string | null {
  const name = process.env.FLARE_CLIENT_IP_HEADER?.trim()
  return name && HEADER_NAME.test(name) ? name.toLowerCase() : null
}

/** One address from a header value, or null when it is not an address. */
export function parseClientAddress(value: string | null | undefined) {
  let candidate = value?.trim()
  if (!candidate || candidate.length > MAX_CANDIDATE) return null
  // `[2001:db8::1]` and `[2001:db8::1]:443` (RFC 7239, some load balancers).
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(candidate)
  if (bracketed) candidate = bracketed[1]
  // `203.0.113.9:51234`, as Azure Application Gateway and IIS ARR send it.
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(candidate))
    candidate = candidate.slice(0, candidate.lastIndexOf(':'))
  const version = isIP(candidate)
  if (!version) return null
  return version === 6 ? canonicalIPv6(candidate) : candidate
}

/** The eight 16-bit groups of an address that `isIP` accepted as IPv6. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)
  // A trailing dotted IPv4 part stands for the last two groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number)
    text =
      text.slice(0, dotted.index) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const groups = (part: string) =>
    part ? part.split(':').map((group) => parseInt(group, 16)) : []
  const gap = text.indexOf('::')
  if (gap === -1) return groups(text)
  const head = groups(text.slice(0, gap))
  const tail = groups(text.slice(gap + 2))
  return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
}

/**
 * One key per client, however the address was written: an IPv4-mapped
 * address (`::ffff:203.0.113.9`, `::ffff:cb00:7109`, or written out in full)
 * becomes the IPv4 address that dual-stack listeners report it as, and other
 * IPv6 addresses use the RFC 5952 text form. Zone indexes are dropped.
 */
function canonicalIPv6(address: string): string {
  const groups = ipv6Groups(address)
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join('.')
  // Compress the longest run of two or more zero groups, the first if tied.
  let start = -1
  let length = 0
  for (let index = 0; index < 8;) {
    let end = index
    while (end < 8 && groups[end] === 0) end++
    if (end - index >= 2 && end - index > length) {
      start = index
      length = end - index
    }
    index = end === index ? index + 1 : end
  }
  const text = groups.map((group) => group.toString(16))
  return start === -1
    ? text.join(':')
    : `${text.slice(0, start).join(':')}::${text.slice(start + length).join(':')}`
}

function firstEntry(value: string | null) {
  if (value === null) return null
  const comma = value.indexOf(',')
  return comma === -1 ? value : value.slice(0, comma)
}

/**
 * The client address Flare uses for rate limits, login history, and request
 * keys, or null when the request carries none.
 *
 * By default this is `X-Real-IP`, then the first `X-Forwarded-For` entry,
 * skipping values that are not addresses. A trusted proxy must set or
 * replace these headers; anything it passes through is client input.
 * `FLARE_CLIENT_IP_HEADER` replaces both with one header for deployments
 * whose edge carries the address elsewhere, such as a CDN in front of the
 * proxy.
 */
export function clientIp(headers: HeaderSource): string | null {
  const configured = configuredHeader()
  if (configured) return parseClientAddress(firstEntry(headers.get(configured)))
  return (
    parseClientAddress(headers.get('x-real-ip')) ??
    parseClientAddress(firstEntry(headers.get('x-forwarded-for')))
  )
}

/** Reads a plain header record, as NextAuth passes to credential providers. */
export function headerRecord(
  record: Record<string, string | string[] | undefined> | undefined
): HeaderSource {
  return {
    get(name) {
      const value = record?.[name.toLowerCase()]
      return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
    },
  }
}
