'use client'

import { apiRequest } from '@/lib/client/request'
import type { RoleSummary } from '@/lib/permissions/catalog'

import {
  type AccountQueryOptions,
  useAccountQuery,
} from '@/hooks/use-account-query'

/** A role as `GET /api/roles` lists it. */
export type ListedRole = RoleSummary & { memberCount: number }
type RolesAnswer = { roles: ListedRole[] }

const ROLES_PATH = '/api/roles'
const ROLES_FAILED = 'Could not load roles.'

/** Reads the instance's roles once. */
export function readRoles(signal?: AbortSignal) {
  return apiRequest<RolesAnswer>(ROLES_PATH, { signal, fallback: ROLES_FAILED })
}

/** The instance's roles for the signed-in session. */
export function useRoles(
  options: Pick<AccountQueryOptions<RolesAnswer>, 'enabled' | 'retry'> = {}
) {
  return useAccountQuery<RolesAnswer>('roles', ROLES_PATH, {
    fallback: ROLES_FAILED,
    ...options,
  })
}
