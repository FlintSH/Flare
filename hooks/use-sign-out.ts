'use client'

import { signOut } from 'next-auth/react'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { RefusedRequest } from '@/lib/client/request'

import { useToast } from '@/hooks/use-toast'

/**
 * Signs out to the sign-in form. A failure shows a toast, unless `onError`
 * reports it the caller's own way.
 */
export function useSignOut({
  onError,
}: { onError?: (error: unknown, message: string) => void } = {}) {
  const { toast } = useToast()
  return async () => {
    try {
      // The local form. With SSO auto-login, the usual sign-in page sends the
      // person straight back to their provider, which signs them in again or,
      // once they deleted their account, can provision a new one.
      await signOut({ callbackUrl: LOCAL_SIGN_IN_PATH })
    } catch (error) {
      const message =
        error instanceof RefusedRequest
          ? error.message
          : 'Unable to finish signing out. Check your connection and try again.'
      // NextAuth owns its fetch/parsing. Keep the original diagnostic rather
      // than labeling every possible library error as a transport failure.
      if (onError) return onError(error, message)
      console.error('Logout error:', error)
      toast({
        title: 'Sign-out not confirmed',
        description: message,
        variant: 'destructive',
      })
    }
  }
}
