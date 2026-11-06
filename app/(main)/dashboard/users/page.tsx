import { canSeeInvites } from '@/components/dashboard/navigation'
import { UsersWorkspace } from '@/components/invites/users-workspace'
import { PageHeader } from '@/components/layout/page-header'

import { requireDashboardPage } from '../page-access'

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const session = await requireDashboardPage('/dashboard/users')
  const { tab } = await searchParams
  const showInvites = canSeeInvites(session.user)

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
