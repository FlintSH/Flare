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
  // One client, one key: dual-stack listeners report IPv4 clients this way.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate)
  if (version === 6 && mapped && isIP(mapped[1]) === 4) return mapped[1]
  return version === 6 ? candidate.toLowerCase() : candidate
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
