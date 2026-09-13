'use client'

import { useState } from 'react'

import { WorkspacePanel } from '@/components/dashboard/page-shell'
import { URLForm } from '@/components/dashboard/url-form'
import { URLList } from '@/components/dashboard/url-list'

export function URLsClient() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [createdUrl, setCreatedUrl] = useState('')

  return (
    <div className="space-y-6">
      <WorkspacePanel
        title="Create a short link"
        description="Paste a destination below. Flare creates a short address you can share anywhere."
      >
        <URLForm
          createdUrl={createdUrl}
          onUrlAdded={(shortCode) => {
            setCreatedUrl(
              shortCode ? `${window.location.origin}/u/${shortCode}` : ''
            )
            setRefreshTrigger((previous) => previous + 1)
          }}
        />
      </WorkspacePanel>
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
