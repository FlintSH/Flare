import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function signWebhook(
  secret: string,
  timestamp: string,
  body: string
): string {
  return (
    'v1=' +
    createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  )
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(address) === 6) {
    // Only ordinary global unicast. This excludes loopback, mapped IPv4,
    // NAT64, unique/link-local, multicast and IPv4 transition mechanisms.
    const [first, second = '0'] = address.toLowerCase().split(':')
    const prefix = parseInt(first, 16)
    const subnet = parseInt(second || '0', 16)
    return (
      prefix >= 0x2000 &&
      prefix <= 0x3fff &&
      prefix !== 0x2002 &&
      !(prefix === 0x2001 && (subnet <= 0x1ff || subnet === 0xdb8))
    )
  }
  return false
}

export function parseWebhookUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid webhook URL.')
  }
  const privateAllowed =
    process.env.FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK === 'true'
  if (
    url.protocol !== 'https:' &&
    !(privateAllowed && url.protocol === 'http:')
  )
    throw new Error(
      'Webhooks require HTTPS. Local HTTP requires the operator private-network setting.'
    )
  if (url.username || url.password || url.hash || value.length > 2048)
    throw new Error(
      'Webhook URLs cannot contain credentials or fragments, or exceed 2048 characters.'
    )
  return url
}

/** Re-resolve every delivery, inspect all results and pin the actual connection. */
export async function resolveWebhookTarget(value: string) {
  const url = parseWebhookUrl(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Webhook DNS lookup timed out.')),
          3000
        )
      }),
    ])
    if (
      !addresses.length ||
      (process.env.FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK !== 'true' &&
        addresses.some(({ address }) => !isPublicAddress(address)))
    )
      throw new Error(
        'Webhook destination must resolve only to public IP addresses.'
      )
    return { url, address: addresses[0] }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
