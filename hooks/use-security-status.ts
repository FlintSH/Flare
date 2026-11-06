'use client'

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

import type { SecurityStatus } from '@/components/auth/security-api'

import { accountRequest } from '@/lib/client/account-request'

export function useSecurityStatus() {
  const { data: session, status } = useSession()
  const userId = status === 'authenticated' ? session?.user?.id : undefined
  const sessionId = userId ? (session?.user?.sessionId ?? null) : null
  return useQuery({
    queryKey: ['account-security', userId, sessionId],
    queryFn: ({ signal }) =>
      accountRequest<SecurityStatus>('/api/auth/security', { signal }),
    enabled: status === 'authenticated' && !!userId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
