import type { EmailConfig } from './schema'

// Browser-safe: the eligibility rules the forms read are built on this table.

interface EmailLink {
  page: string
  /** How long the link works, in milliseconds. */
  lifetime: (config: EmailConfig) => number
  /** Whether the feature the link belongs to is on, besides email itself. */
  available: (config: EmailConfig) => boolean
}

const VERIFY_PAGE = '/auth/verify-email'

const verificationLifetime = (config: EmailConfig) =>
  config.verification.tokenHours * 3_600_000

const changesEnabled = (config: EmailConfig) => config.changes.enabled

/** Every link Flare emails to an account, by the purpose of its one-time token. */
export const EMAIL_LINKS = {
  verify: {
    page: VERIFY_PAGE,
    lifetime: verificationLifetime,
    available: () => true,
  },
  change: {
    page: VERIFY_PAGE,
    lifetime: verificationLifetime,
    available: changesEnabled,
  },
  change_approval: {
    page: VERIFY_PAGE,
    lifetime: verificationLifetime,
    available: changesEnabled,
  },
  reset: {
    page: '/auth/reset-password',
    lifetime: (config) => config.recovery.tokenMinutes * 60_000,
    available: (config) => config.recovery.enabled,
  },
} satisfies Record<string, EmailLink>

export type EmailTokenPurpose = keyof typeof EMAIL_LINKS

/** An address change's links: the new address confirms it, the current one approves it. */
export const EMAIL_CHANGE_PURPOSES = [
  'change',
  'change_approval',
] as const satisfies readonly EmailTokenPurpose[]

export function isEmailLinkPurpose(
  purpose: string
): purpose is EmailTokenPurpose {
  return Object.hasOwn(EMAIL_LINKS, purpose)
}

export function emailLinkAvailable(
  config: EmailConfig,
  purpose: EmailTokenPurpose
) {
  return config.enabled && EMAIL_LINKS[purpose].available(config)
}
