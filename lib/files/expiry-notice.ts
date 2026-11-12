import { formatDistanceStrict } from 'date-fns'

/**
 * When a file's stored upload options say it expires, if they do. Scheduling,
 * replacing and cancelling an expiry all rewrite this record, so a share page
 * can read it without looking up the expiry job. Files uploaded before
 * upload options recorded an expiry have none here.
 *
 * Earlier versions stored the upload request's own ISO form (`+02:00`, no
 * seconds), so the record is read as an instant, never compared as text.
 */
export function recordedExpiry(uploadOptions: unknown): Date | null {
  if (!uploadOptions || typeof uploadOptions !== 'object') return null
  const { expiresAt } = uploadOptions as { expiresAt?: unknown }
  if (typeof expiresAt !== 'string') return null
  const instant = new Date(expiresAt)
  return Number.isNaN(instant.getTime()) ? null : instant
}

/** "Expires in 3 days" for an expiry still ahead; null once it has passed. */
export function expiryNotice(expiresAt: Date, now = new Date()): string | null {
  const remaining = expiresAt.getTime() - now.getTime()
  if (remaining <= 0) return null
  if (remaining < 60_000) return 'Expires in less than a minute'
  return `Expires in ${formatDistanceStrict(expiresAt, now)}`
}

/** Whether an expiry is close enough for a share page to stress it. */
export function expiresSoon(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() - now.getTime() < 3 * 86_400_000
}
