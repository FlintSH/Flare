import { redirect } from 'next/navigation'

import { AuditLog } from '@/components/audit/audit-log'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function AuditPage() {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  if (!hasPermission(session.user, 'audit.read')) redirect('/dashboard/profile')
  return <AuditLog />
}
