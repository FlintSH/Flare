import { redirect } from 'next/navigation'

import {
  type DashboardPage,
  PROFILE_ITEM,
  canOpen,
} from '@/components/dashboard/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { SIGN_IN_PATH } from '@/lib/auth/sign-in'

/**
 * The session for a dashboard page whose permissions the navigation lists.
 * Signed-out visitors go to sign-in, and people whose roles don't allow the
 * page go to Profile, which every account has.
 */
export async function requireDashboardPage(href: DashboardPage) {
  const session = await getPageSession()
  if (!session?.user) redirect(SIGN_IN_PATH)
  if (!canOpen(session.user, href)) redirect(PROFILE_ITEM.href)
  return session
}
