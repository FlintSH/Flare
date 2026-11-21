// What the cards and dialogs on the Integrations tab share.

/** Card titles that are also headings, so each card is reachable by heading. */
export const cardTitle = 'font-semibold leading-none tracking-tight'

/**
 * One header layout for cards with actions, as on the other profile tabs:
 * title and description on the left, actions at the top right. On phones the
 * actions follow the description.
 */
export const cardHeaderRow =
  'flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between'

/** How long a new token lasts, in days; 0 never expires. */
export const TOKEN_LIFETIMES = [
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', '1 year'],
  ['0', 'Never'],
] as const
export const DEFAULT_TOKEN_LIFETIME = '90'

/** When a token made now with this lifetime expires, as the command takes it. */
export function tokenExpiry(days: number): string | null {
  return days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
}
