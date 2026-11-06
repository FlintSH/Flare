import { DashboardClient } from './client'
import { requireDashboardPage } from './page-access'

export default async function DashboardPage() {
  await requireDashboardPage('/dashboard')
  return <DashboardClient />
}
