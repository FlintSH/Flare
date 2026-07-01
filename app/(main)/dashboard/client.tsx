'use client'

import { FileGrid } from '@/components/dashboard/file-grid'

interface DashboardClientProps {
  organizationEnabled: boolean
}

export function DashboardClient({ organizationEnabled }: DashboardClientProps) {
  return (
    <div className="container space-y-6">
      <FileGrid organizationEnabled={organizationEnabled} />
    </div>
  )
}
