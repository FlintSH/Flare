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
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">URL Shortener</h1>
        <div className="space-y-8">
          <URLForm onUrlAdded={handleUrlAdded} />
          <URLList refreshTrigger={refreshTrigger} />
        </div>
      </div>
    </div>
  )
}
