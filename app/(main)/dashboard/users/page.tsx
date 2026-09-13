import { redirect } from 'next/navigation'

import { WorkspacePage } from '@/components/dashboard/page-shell'
import { UserList } from '@/components/dashboard/user-list'

import { getPageSession } from '@/lib/auth/page-session'

export default async function UsersPage() {
  const session = await getPageSession()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/dashboard')
  }

  return (
    <WorkspacePage
      eyebrow="Your instance"
      title="Users"
      description="A clear view of the people, access, and content on your instance."
    >
      <UserList />
    </WorkspacePage>
  )
}
