import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function CustomizePage({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>
}) {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  if (!hasPermission(session.user, 'appearance.manage'))
    redirect('/dashboard/profile?section=account#workspace-appearance')

  const { recovery } = await searchParams
  redirect(
    `/dashboard/settings?section=appearance${recovery === '1' ? '&recovery=1' : ''}`
  )
}
