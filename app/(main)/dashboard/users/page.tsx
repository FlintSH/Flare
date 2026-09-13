import { redirect } from 'next/navigation'

import { UserList } from '@/components/dashboard/user-list'

import { getPageSession } from '@/lib/auth/page-session'

export default async function UsersPage() {
  const session = await getPageSession()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/dashboard')
  }

  return (
    <div className="container space-y-6">
      <header className="rounded-2xl border bg-card p-5 sm:p-6">
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage user accounts, roles, and permissions.
        </p>
      </header>
      <div className="rounded-2xl border bg-card p-4 sm:p-6">
        <UserList />
      </div>
    </div>
  )
}
