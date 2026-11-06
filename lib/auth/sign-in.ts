import { SECURITY_LIMIT_MINUTES } from './security/policy'

// What the login page and the server's sign-in steps say to each other: the
// errors a sign-in reports and the page's parameters. Browser-safe.

/** Errors the credentials providers throw; NextAuth hands the form the code as `error`. */
export const SignInError = {
  /** The password is right, and the account also needs its authenticator. */
  TwoFactorRequired: 'TwoFactorRequired',
  /** The account signs in only with a passkey or a passkey recovery code. */
  PasskeyRequired: 'PasskeyRequired',
  /** An attempt limit refused the sign-in. */
  TooManyAttempts: 'TooManyAttempts',
} as const

export type SignInError = (typeof SignInError)[keyof typeof SignInError]

export const TOO_MANY_SIGN_IN_ATTEMPTS = `Too many sign-in attempts. Wait ${SECURITY_LIMIT_MINUTES} minutes before trying again.`

export const SIGN_IN_PATH = '/auth/login'
/** The local sign-in form, which stays reachable when sign-in otherwise goes straight to SSO. */
export const LOCAL_SIGN_IN_PATH = `${SIGN_IN_PATH}?local=1`

/** Whether the login page's search parameters ask for its local form. */
export function isLocalSignIn(params: { local?: string | string[] }) {
  return params.local === '1'
}

const OIDC_ERROR_MESSAGES = {
  OidcPasskeyRequired:
    'This account requires passkey sign-in. Use a passkey or your dedicated passkey recovery code.',
  OidcTwoFactorRequired:
    'This account uses local two-factor authentication. Sign in with your password and authentication code, or use a passkey.',
  OidcNoEmail:
    "Your identity provider didn't share an email address, so we can't sign you in.",
  OidcAccountExists:
    'An account with this email already exists. Use local sign-in or its previously linked SSO identity. Automatic account linking is not supported.',
  OidcNotProvisioned:
    'No local Flare account found matching this OIDC account and automatic sign-up is disabled. Contact an admin.',
  OidcEmailUnverified:
    "Your identity provider hasn't verified this email address, so we can't create an account. Contact an admin.",
}

/** Why Flare refused an SSO sign-in, as the login page's `error` parameter. */
export type OidcError = keyof typeof OIDC_ERROR_MESSAGES

/** The login page explaining a refused SSO sign-in; `local` keeps it on the local form. */
export function oidcErrorPath(error: OidcError, local = false) {
  return `${local ? `${LOCAL_SIGN_IN_PATH}&` : `${SIGN_IN_PATH}?`}error=${error}`
}

export function getOidcErrorMessage(errorCode: string) {
  return (
    (OIDC_ERROR_MESSAGES as Record<string, string>)[errorCode] ||
    'Sign-in with SSO failed. Please try again or contact an admin.'
  )
}
