'use client'

import type { Query, QueryKey } from '@tanstack/react-query'

import type { SecurityStatus } from '@/components/auth/security-api'

import { useAccountQuery, useSessionScope } from '@/hooks/use-account-query'

/**
 * The status to show while a new browser session's status loads: the last
 * one, if it belongs to the same account. A confirmation with a passphrase
 * or a passkey signs the open account in again in place. That starts a new
 * browser session and with it a new query key, and without this the status
 * is absent for a moment: an open dialog drops its form and what was typed
 * into it. The status of a different account is never shown.
 */
export function sameAccountStatus(userId: string | undefined) {
  return <T>(
    previous: T | undefined,
    previousQuery: Pick<Query, 'queryKey'> | undefined
  ): T | undefined => {
    const key: QueryKey | undefined = previousQuery?.queryKey
    return userId && key?.[1] === userId ? previous : undefined
  }
}

export function useSecurityStatus() {
  const userId = useSessionScope()?.userId
  return useAccountQuery<SecurityStatus>(
    'account-security',
    '/api/auth/security',
    {
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: sameAccountStatus(userId),
    }
  )
}
