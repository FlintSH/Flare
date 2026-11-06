import { RoleManager } from '@/components/roles/role-manager'

import { requireDashboardPage } from '../page-access'

export default async function RolesPage() {
  await requireDashboardPage('/dashboard/roles')
  return <RoleManager />
}
