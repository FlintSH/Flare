'use client'

import { signOut } from 'next-auth/react'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'

import { useToast } from '@/hooks/use-toast'

/**
 * Signs out to the sign-in form. A failure shows a toast, unless `onError`
 * reports it the caller's own way.
 */
export function useSignOut({
  onError,
}: { onError?: (error: unknown) => void } = {}) {
  const { toast } = useToast()
  return async () => {
    try {
      // The local form. With SSO auto-login, the usual sign-in page sends the
      // person straight back to their provider, which signs them in again or,
      // once they deleted their account, can provision a new one.
      await signOut({ callbackUrl: LOCAL_SIGN_IN_PATH })
    } catch (error) {
      if (onError) return onError(error)
      console.error('Logout error:', error)
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive',
      })
    }
  }
}
