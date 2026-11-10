'use client'

import { signOut } from 'next-auth/react'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { clearStoredAccountKeys } from '@/lib/e2ee/client/browser-store'
import { dropLocalAddresses } from '@/lib/e2ee/client/local-address'
import { endSearchSession } from '@/lib/library/search-client'

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
      // The account keys of this browser go first (docs/e2ee-spec.md, section
      // 6.4), so they are gone even if the sign-out request fails.
      await clearStoredAccountKeys()
      // The local cache of encrypted records goes too (section 9.8.1).
      await endSearchSession()
      // This page is replaced before its key state says "signed out", so it
      // tells the service worker itself to forget every file key (section
      // 12.2.3). The keys this page opened go with the page.
      dropLocalAddresses()
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
