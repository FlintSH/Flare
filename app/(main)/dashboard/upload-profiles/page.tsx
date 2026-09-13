import { redirect } from 'next/navigation'

import { ProfileManager } from '@/components/upload-profiles/profile-manager'

import { getPageSession } from '@/lib/auth/page-session'

export default async function UploadProfilesPage() {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  return (
    <div className="container py-2">
      <ProfileManager />
    </div>
  )
}
