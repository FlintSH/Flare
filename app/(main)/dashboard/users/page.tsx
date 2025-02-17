import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { UserList } from '@/components/dashboard/user-list'

import { authOptions } from '@/lib/auth'

export default async function UsersPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/dashboard')
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <UserList />
    </div>
  )
}
