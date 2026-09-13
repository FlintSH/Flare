'use client'

import { useState } from 'react'

import { URLForm } from '@/components/dashboard/url-form'
import { URLList } from '@/components/dashboard/url-list'

export function URLsClient() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [createdUrl, setCreatedUrl] = useState('')

  return (
    <div className="space-y-6">
      <URLForm
        createdUrl={createdUrl}
        onUrlAdded={(shortCode) => {
          setCreatedUrl(
            shortCode ? `${window.location.origin}/u/${shortCode}` : ''
          )
          setRefreshTrigger((previous) => previous + 1)
        }}
      />

      <URLList
        refreshTrigger={refreshTrigger}
        onUrlDeleted={(shortCode) => {
          setCreatedUrl((current) =>
            current.endsWith(`/u/${shortCode}`) ? '' : current
          )
        }}
      />
    </div>
  )
}
