import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function CustomizePage({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>
}) {
  const session = await getPageSession()
  if (!session?.user) redirect(SIGN_IN_PATH)
  if (!hasPermission(session.user, 'appearance.manage'))
    redirect('/dashboard/profile?section=account#workspace-appearance')

  const { recovery } = await searchParams
  redirect(
    `/dashboard/settings?section=appearance${recovery === '1' ? '&recovery=1' : ''}`
  )
}
