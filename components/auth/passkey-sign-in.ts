'use client'

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { signIn } from 'next-auth/react'

import { SignInError, TOO_MANY_SIGN_IN_ATTEMPTS } from '@/lib/auth/sign-in'
import { apiRequest } from '@/lib/client/request'

/** expectedUserId keeps an in-place confirmation bound to the open account. */
export async function signInWithPasskey(expectedUserId?: string) {
  const { options, challengeId } = await apiRequest<{
    options: PublicKeyCredentialRequestOptionsJSON
    challengeId: string
  }>('/api/auth/passkeys/options', { body: {} })
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
    if (result?.error === SignInError.TooManyAttempts)
      throw new Error(TOO_MANY_SIGN_IN_ATTEMPTS)
    throw new Error(
      expectedUserId
        ? 'Unable to confirm this account. Choose a passkey registered to the account you are editing.'
        : 'Unable to sign in with this passkey. Try again or use a passkey recovery code.'
    )
  }
}
