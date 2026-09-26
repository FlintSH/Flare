'use client'

import type { ReactNode } from 'react'

import type { Permission } from '@/lib/permissions/catalog'

import { usePermissions } from '@/hooks/use-permissions'

export function PermissionGate({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const { can } = usePermissions()
  return can(permission) ? children : null
}
