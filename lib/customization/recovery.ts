import { cache } from 'react'

import { headers } from 'next/headers'

import { getAccessSession } from '@/lib/auth'

import { RECOVERY_HEADER } from './recovery-request'

export const isAppearanceRecovery = cache(async () => {
  if ((await headers()).get(RECOVERY_HEADER) !== '1') return false
  // Recheck the live session: a token's old admin role is not sufficient.
  const session = await getAccessSession()
  return session?.user?.role === 'ADMIN'
})
