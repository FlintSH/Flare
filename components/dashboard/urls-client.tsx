'use client'

import { useState } from 'react'

import { URLForm } from '@/components/dashboard/url-form'
import { URLList } from '@/components/dashboard/url-list'

export function URLsClient() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleUrlAdded = () => {
    setRefreshTrigger((prev) => prev + 1)
  }

  return (
    <div className="space-y-6">
      <URLForm onUrlAdded={handleUrlAdded} />
      <URLList refreshTrigger={refreshTrigger} />
    </div>
  )
}
