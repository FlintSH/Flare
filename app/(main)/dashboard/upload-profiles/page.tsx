import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'

export default async function UploadProfilesPage() {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  redirect('/dashboard/profile?section=uploads')
}
