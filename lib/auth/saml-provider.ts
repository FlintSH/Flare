import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers/oauth'

export interface SAMLProfile {
  id: string
  email: string
  name?: string
  firstName?: string
  lastName?: string
  image?: string
}

export interface SAMLProviderOptions extends OAuthUserConfig<SAMLProfile> {
  issuer: string
  callbackUrl: string
  entryPoint: string
  cert: string
}

export default function SAMLProvider(
  options: SAMLProviderOptions
): OAuthConfig<SAMLProfile> {
  return {
    id: 'saml',
    name: 'SAML',
    type: 'oauth',
    version: '2.0',
    authorization: {
      url: options.entryPoint,
      params: {
        response_type: 'code',
        scope: 'openid email profile',
      },
    },
    token: {
      url: `${options.callbackUrl}/token`,
    },
    userinfo: {
      url: `${options.callbackUrl}/userinfo`,
    },
    profile(profile: SAMLProfile) {
      return {
        id: profile.id,
        name: profile.name || `${profile.firstName} ${profile.lastName}`.trim(),
        email: profile.email,
        image: profile.image,
      }
    },
    options,
  }
}
