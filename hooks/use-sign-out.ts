'use client'

import { signOut } from 'next-auth/react'

import { useToast } from '@/hooks/use-toast'

/** Signs out to the sign-in form, with a toast if that fails. */
export function useSignOut() {
  const { toast } = useToast()
  return async () => {
    try {
      // The local form, so instances with SSO auto-login don't sign the
      // person straight back in through their provider.
      await signOut({ callbackUrl: '/auth/login?local=1' })
    } catch (error) {
      console.error('Logout error:', error)
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive',
      })
    }
  }
}
