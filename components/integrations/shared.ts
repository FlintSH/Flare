// What the cards and dialogs on the Integrations tab share.
import {
  ADMIN_CONNECTION_DAYS,
  ADMIN_TOKEN_MAX_DAYS,
} from '@/lib/oauth/constants'

/** Card titles that are also headings, so each card is reachable by heading. */
export const cardTitle = 'font-semibold leading-none tracking-tight'

/**
 * One header layout for cards with actions, as on the other profile tabs:
 * title and description on the left, actions at the top right. On phones the
 * actions follow the description.
 */
export const cardHeaderRow =
  'flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between'

/**
 * When a connection authorized at `start` with an administration scope
 * ends, in the viewer's locale. The consent screen and the connected agents
 * list both take the day from here, so they cannot disagree. A sentence
 * spells the month; the list keeps the short form its other dates use.
 */
export function adminConnectionEnd(
  start: Date | string = new Date(),
  form: 'sentence' | 'list' = 'sentence'
): string {
  const end = new Date(
    new Date(start).getTime() + ADMIN_CONNECTION_DAYS * 24 * 60 * 60_000
  )
  return form === 'list'
    ? end.toLocaleDateString()
    : end.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

/** How long a new token lasts, in days; 0 never expires. */
export const TOKEN_LIFETIMES = [
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', '1 year'],
  ['0', 'Never'],
] as const
export const DEFAULT_TOKEN_LIFETIME = '90'

/** Why the longer lifetimes are unavailable while an administration scope is ticked. */
export const ADMIN_LIFETIME_REASON = `Tokens with administration permissions must expire within ${ADMIN_TOKEN_MAX_DAYS} days.`

/** Whether a token with administration permissions may have this lifetime. */
export const lifetimeAllowed = (days: string, admin: boolean): boolean =>
  !admin || (Number(days) > 0 && Number(days) <= ADMIN_TOKEN_MAX_DAYS)

/**
 * The lifetime a token is created with: the one chosen, or the longest
 * allowed when an administration scope rules the chosen one out.
 */
export function allowedLifetime(days: string, admin: boolean): string {
  if (lifetimeAllowed(days, admin)) return days
  return (
    TOKEN_LIFETIMES.filter(([candidate]) => lifetimeAllowed(candidate, true))
      .map(([candidate]) => candidate)
      .at(-1) ?? DEFAULT_TOKEN_LIFETIME
  )
}

/** When a token made now with this lifetime expires, as the command takes it. */
export function tokenExpiry(days: number): string | null {
  return days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
}
