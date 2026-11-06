'use client'

import { useState } from 'react'

import { URLForm } from '@/components/dashboard/url-form'
import { URLList } from '@/components/dashboard/url-list'
import { PermissionGate } from '@/components/roles/permission-gate'

import { shortLinkUrl } from '@/lib/links/schema'

export function URLsClient() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [created, setCreated] = useState<{
    shortCode: string
    url: string
  } | null>(null)

  return (
    <div className="space-y-6">
      <PermissionGate permission="links.create">
        <URLForm
          createdUrl={created?.url ?? ''}
          onUrlAdded={(shortCode) => {
            setCreated(
              shortCode
                ? {
                    shortCode,
                    url: shortLinkUrl(shortCode, window.location.origin),
                  }
                : null
            )
            setRefreshTrigger((previous) => previous + 1)
          }}
        />
      </PermissionGate>
      <URLList
        refreshTrigger={refreshTrigger}
        onUrlDeleted={(shortCode) => {
          setCreated((current) =>
            current?.shortCode === shortCode ? null : current
          )
        }}
      />
    </div>
  )
}
