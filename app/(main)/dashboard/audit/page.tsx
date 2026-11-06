import { AuditLog } from '@/components/audit/audit-log'

import { requireDashboardPage } from '../page-access'

export default async function AuditPage() {
  await requireDashboardPage('/dashboard/audit')
  return <AuditLog />
}
