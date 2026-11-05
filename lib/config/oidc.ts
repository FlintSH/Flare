import type { FlareConfig } from './index'

type OidcSettings = FlareConfig['settings']['general']['oidc']

function trimTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

/** The issuer without trailing slashes, as accounts' subjects record it. */
export function oidcIssuer(oidc: Pick<OidcSettings, 'issuer'>) {
  return trimTrailingSlashes(oidc.issuer)
}

export function isOidcProviderConfigured(
  oidc: Pick<OidcSettings, 'enabled' | 'issuer' | 'clientId' | 'clientSecret'>
) {
  return Boolean(
    oidc.enabled && oidc.issuer && oidc.clientId && oidc.clientSecret
  )
}

/**
 * OIDC `sub` is only unique within its issuer, not globally, so it must be
 * scoped before being used as a global lookup key (see oidcSubject on User).
 */
export function scopeOidcSubject(issuer: string, sub: string): string {
  return `${trimTrailingSlashes(issuer)}|${sub}`
}

/** The prefix of subjects the configured provider can sign in, or null when none is configured. */
export function oidcSubjectPrefix(oidc: OidcSettings): string | null {
  return isOidcProviderConfigured(oidc)
    ? scopeOidcSubject(oidc.issuer, '')
    : null
}

/** Whether people may sign in with a local password, rather than only through SSO. */
export function localSignInAllowed(
  oidc: Pick<OidcSettings, 'enabled' | 'enforceSso'>
) {
  return !(oidc.enabled && oidc.enforceSso)
}
