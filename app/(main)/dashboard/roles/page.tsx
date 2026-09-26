import { redirect } from 'next/navigation'

import { RoleManager } from '@/components/roles/role-manager'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function RolesPage() {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  if (!hasPermission(session.user, 'roles.manage'))
    redirect('/dashboard/profile')
  return <RoleManager />
}
