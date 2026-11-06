// The account-security values the server enforces and the forms state.
// Browser-safe.

export const TOTP_DIGITS = 6
/** An authenticator code, as an HTML `pattern`. */
export const TOTP_CODE_PATTERN = `[0-9]{${TOTP_DIGITS}}`
export const TOTP_PLACEHOLDER = '0'.repeat(TOTP_DIGITS)
const TOTP_CODE = new RegExp(`^${TOTP_CODE_PATTERN}$`)

export function isTotpCode(code: string) {
  return TOTP_CODE.test(code)
}

/** The longest code a sign-in or security request takes: an authenticator code or either kind of recovery code. */
export const SECURITY_CODE_MAX_LENGTH = 80
/** Room for an authenticator recovery code as typed, with hyphens or spaces. */
export const RECOVERY_CODE_INPUT_LENGTH = 32

/** Passkeys one account can register. */
export const MAX_PASSKEYS = 10

/** How long a security challenge lasts: a passkey sign-in or registration, or authenticator setup. */
export const SECURITY_CHALLENGE_MINUTES = 5

/**
 * How long a sign-in proves who is changing the account: a passkey, recovery
 * code or SSO sign-in counts this long. Messages state it as `RECENT_PROOF_WINDOW`.
 */
export const RECENT_PROOF_MINUTES = 5
export const RECENT_PROOF_WINDOW = 'five minutes'

/** The window of each security attempt limit; a refused attempt waits this long. */
export const SECURITY_LIMIT_MINUTES = 15

/** How long a browser sign-in lasts. */
export const BROWSER_SESSION_DAYS = 30
/** How long sign-in attempts are kept, and sessions after they expire. */
export const LOGIN_HISTORY_DAYS = 90
