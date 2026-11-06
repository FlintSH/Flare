'use client'

import { type ComponentType, useState } from 'react'

import Link from 'next/link'

import { ChevronDown } from 'lucide-react'

import { PermissionGate } from '@/components/roles/permission-gate'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import {
  UPLOADER_CLIENT_IDS,
  UPLOADER_TOOL_PERMISSIONS,
  type UploaderClientId,
} from '@/lib/uploads/uploader-clients'

import { usePermissions } from '@/hooks/use-permissions'

import { BashTool } from './bash-tool'
import { FlameshotTool } from './flameshot-tool'
import { ITakeTool } from './itake-tool'
import { ShareXTool } from './sharex-tool'
import { SpectacleTool } from './spectacle-tool'
import type { UploaderToolProps } from './tool-parts'
import { UploadToken } from './upload-token'

/** Each uploader client's tool; the type makes every client have one. */
const uploaderTools: {
  [Id in UploaderClientId]: ComponentType<UploaderToolProps>
} = {
  sharex: ShareXTool,
  itake: ITakeTool,
  flameshot: FlameshotTool,
  spectacle: SpectacleTool,
  bash: BashTool,
}

export function ProfileTools({
  onOpenIntegrations,
}: {
  onOpenIntegrations?: () => void
}) {
  const [manualSetupVisited, setManualSetupVisited] = useState(false)

  return (
    <div className="space-y-6">
      <div className="divide-y rounded-xl border bg-muted/30 px-4 [&>div]:py-4">
        {UPLOADER_CLIENT_IDS.map((id) => {
          const Tool = uploaderTools[id]
          return <Tool key={id} />
        })}
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          These downloads follow your default upload profile. Keep them private:
          they include access to upload to your account.
        </p>
        <PermissionGate permission="tokens.manage">
          <p>
            Need separate permissions or a revocable key for a custom app?{' '}
            <Link
              href="/dashboard/profile?section=integrations"
              onNavigate={onOpenIntegrations}
              className="font-medium text-primary underline underline-offset-4"
            >
              Create an API token in Integrations
            </Link>
            .
          </p>
        </PermissionGate>
      </div>
      <Collapsible
        className="rounded-xl border bg-muted/30"
        onOpenChange={(open) => {
          if (open) setManualSetupVisited(true)
        }}
      >
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Manual setup and upload token
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent
          forceMount
          className="px-4 pb-4 data-[state=closed]:hidden"
        >
          {manualSetupVisited && <UploadToken />}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** The profile editor keeps its own button order. */
const PROFILE_TOOL_ORDER: UploaderClientId[] = [
  'sharex',
  'bash',
  'flameshot',
  'spectacle',
  'itake',
]

/**
 * Downloads with one upload profile selected, for the profile editor. Shown
 * to the same people as the Screenshot tools card.
 */
export function ProfileToolDownloads({
  profileId,
  profileName,
  disabled,
}: {
  profileId: string
  profileName: string
  disabled?: boolean
}) {
  const { can } = usePermissions()
  if (!UPLOADER_TOOL_PERMISSIONS.every((permission) => can(permission)))
    return null

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div>
        <h3 className="text-sm font-medium">Use this profile in your tools</h3>
        <p className="mt-1 text-pretty text-xs text-muted-foreground">
          Download an uploader with this profile selected. Generated configs and
          scripts contain your upload credential; keep them private.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PROFILE_TOOL_ORDER.map((id) => {
          const Tool = uploaderTools[id]
          return (
            <Tool
              key={id}
              profileId={profileId}
              profileName={profileName}
              compact
              disabled={disabled}
            />
          )
        })}
      </div>
    </div>
  )
}
