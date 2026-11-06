'use client'

import type { SecurityStatus } from '@/components/auth/security-api'

import { useAccountQuery } from '@/hooks/use-account-query'

export function useSecurityStatus() {
  return useAccountQuery<SecurityStatus>(
    'account-security',
    '/api/auth/security',
    { retry: false, refetchOnWindowFocus: false }
  )
}
