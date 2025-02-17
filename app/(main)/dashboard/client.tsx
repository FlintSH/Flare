'use client'

import { FileGrid } from '@/components/dashboard/file-grid'

export function DashboardClient() {
  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Your Files</h1>
        <p className="text-muted-foreground">
          View and manage your uploaded files
        </p>
      </div>

      <FileGrid />
    </div>
  )
}
