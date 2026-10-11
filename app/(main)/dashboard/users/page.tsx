import { redirect } from 'next/navigation'

import { UsersWorkspace } from '@/components/invites/users-workspace'

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
    <div className="container space-y-6">
      <header className="rounded-2xl border bg-card p-5 sm:p-6">
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {showInvites
            ? 'Manage user accounts, roles, permissions, and invite links.'
            : 'Manage user accounts, roles, and permissions.'}
        </p>
      </header>
      <UsersWorkspace
        initialTab={tab === 'invites' ? 'invites' : 'accounts'}
        showInvites={showInvites}
      />
    </div>
  )
}
