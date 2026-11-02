import { redirect } from 'next/navigation'

import { UsersWorkspace } from '@/components/invites/users-workspace'
import { PageHeader } from '@/components/layout/page-header'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const session = await getPageSession()

  if (!session?.user || !hasPermission(session.user, 'users.read')) {
    redirect('/dashboard')
  }
  const { tab } = await searchParams
  const showInvites =
    hasPermission(session.user, 'invites.create') ||
    hasPermission(session.user, 'invites.manage')

  return (
    <div className="container space-y-7">
      <PageHeader
        eyebrow="Your community"
        title="Users"
        description={
          showInvites
            ? 'Manage user accounts, roles, permissions, and invite links.'
            : 'Manage user accounts, roles, and permissions.'
        }
      />
      <UsersWorkspace
        initialTab={tab === 'invites' ? 'invites' : 'accounts'}
        showInvites={showInvites}
      />
    </div>
  )
}
