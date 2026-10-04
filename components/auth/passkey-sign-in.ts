'use client'

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { signIn } from 'next-auth/react'

import { securityRequest } from './security-api'

/** expectedUserId keeps an in-place confirmation bound to the open account. */
export async function signInWithPasskey(expectedUserId?: string) {
  const { options, challengeId } = await securityRequest<{
    options: PublicKeyCredentialRequestOptionsJSON
    challengeId: string
  }>('/api/auth/passkeys/options', {})
  const { startAuthentication } = await import('@simplewebauthn/browser')
  const response = await startAuthentication({ optionsJSON: options })
  const result = await signIn('passkey', {
    challengeId,
    response: JSON.stringify(response),
    ...(expectedUserId ? { expectedUserId } : {}),
    redirect: false,
    callbackUrl: '/dashboard',
  })
  if (!result?.ok || result.error) {
    if (result?.error === 'TooManyAttempts') {
      throw new Error(
        'Too many sign-in attempts. Wait 15 minutes before trying again.'
      )
    }
    throw new Error(
      expectedUserId
        ? 'Unable to confirm this account. Choose a passkey registered to the account you are editing.'
        : 'Unable to sign in with this passkey. Try again or use a passkey recovery code.'
    )
  }
}
