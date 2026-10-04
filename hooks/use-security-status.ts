'use client'

import { useQuery } from '@tanstack/react-query'

import {
  type SecurityStatus,
  securityRequest,
} from '@/components/auth/security-api'

export function useSecurityStatus() {
  return useQuery({
    queryKey: ['account-security'],
    queryFn: () => securityRequest<SecurityStatus>('/api/auth/security'),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
