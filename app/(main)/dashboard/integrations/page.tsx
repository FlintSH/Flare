import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { SIGN_IN_PATH } from '@/lib/auth/sign-in'

export default async function IntegrationsPage() {
  const session = await getPageSession()
  if (!session?.user) redirect(SIGN_IN_PATH)
  redirect('/dashboard/profile?section=integrations')
}
