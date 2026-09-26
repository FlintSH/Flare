'use client'

import { useSession } from 'next-auth/react'

import { type Permission, hasPermission } from '@/lib/permissions/catalog'

export function usePermissions() {
  const { data: session } = useSession()
  return {
    user: session?.user,
    can: (permission: Permission) => hasPermission(session?.user, permission),
  }
}
