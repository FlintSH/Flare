const oidcErrorMessages: Record<string, string> = {
  OidcNoEmail:
    "Your identity provider didn't share an email address, so we can't sign you in.",
  OidcAccountExists:
    'An account with this email already exists. Use local sign-in or its previously linked SSO identity. Automatic account linking is not supported.',
  OidcNotProvisioned:
    'No local Flare account found matching this OIDC account and automatic sign-up is disabled. Contact an admin.',
  OidcEmailUnverified:
    "Your identity provider hasn't verified this email address, so we can't create an account. Contact an admin.",
}

export function getOidcErrorMessage(errorCode: string) {
  return (
    oidcErrorMessages[errorCode] ||
    'Sign-in with SSO failed. Please try again or contact an admin.'
  )
}
