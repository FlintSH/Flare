'use client'

import { type ComponentType, useState } from 'react'

import Link from 'next/link'

import { PermissionGate } from '@/components/roles/permission-gate'

import {
  UPLOADER_CLIENT_IDS,
  type UploaderClientId,
} from '@/lib/uploads/uploader-clients'
import type { UploaderConfiguration } from '@/lib/uploads/uploader-clients/render'
import type { LegacyUploadTokenStatus } from '@/lib/users/legacy-upload-token'

import { useAccountQuery, useAccountRefresh } from '@/hooks/use-account-query'

import { BashTool } from './bash-tool'
import {
  ConfigurationPanel,
  UploaderConfigurationProvider,
} from './configuration'
import { FlameshotTool } from './flameshot-tool'
import { FlareUploadTool } from './flare-upload-tool'
import { ITakeTool } from './itake-tool'
import { LegacyTokenWarning } from './legacy-token-warning'
import { ShareXTool } from './sharex-tool'
import { SpectacleTool } from './spectacle-tool'

const uploaderTools: { [Id in UploaderClientId]: ComponentType } = {
  sharex: ShareXTool,
  itake: ITakeTool,
  flameshot: FlameshotTool,
  spectacle: SpectacleTool,
  bash: BashTool,
}

/** The account query of the card: the public address and the old token. */
export const UPLOAD_TOOLS = 'upload-tools'

export interface UploadToolsData {
  origin: string
  legacyToken: LegacyUploadTokenStatus
}

export function useUploadTools() {
  return useAccountQuery<UploadToolsData>(
    UPLOAD_TOOLS,
    '/api/profile/upload-tools',
    { retry: false }
  )
}

/**
 * The helper program and each tool, with the files of `configuration`.
 * Without one, the downloads wait: a file needs a token.
 */
export function UploaderToolRows({
  configuration,
}: {
  configuration: UploaderConfiguration | null
}) {
  return (
    <UploaderConfigurationProvider value={configuration}>
      <div
        className="divide-y rounded-xl border bg-muted/30 px-4 [&>div]:py-4"
        data-upload-tools={configuration ? 'ready' : 'waiting'}
      >
        <FlareUploadTool />
        {UPLOADER_CLIENT_IDS.map((id) => {
          const Tool = uploaderTools[id]
          return <Tool key={id} />
        })}
      </div>
    </UploaderConfigurationProvider>
  )
}

export function ProfileTools({
  onOpenIntegrations,
}: {
  onOpenIntegrations?: () => void
}) {
  const tools = useUploadTools()
  const refresh = useAccountRefresh(UPLOAD_TOOLS)
  const [configuration, setConfiguration] =
    useState<UploaderConfiguration | null>(null)

  return (
    <div className="space-y-6">
      {tools.data && (
        <LegacyTokenWarning
          status={tools.data.legacyToken}
          onRevoked={refresh}
        />
      )}
      <ConfigurationPanel
        origin={tools.data?.origin ?? null}
        configuration={configuration}
        onChange={(next) => {
          setConfiguration(next)
          // A new token ends the wait for a new configuration.
          if (next) void refresh()
        }}
      />
      <UploaderToolRows configuration={configuration} />
      <div className="space-y-2 text-sm text-muted-foreground">
        {!configuration && (
          <p>
            Create a configuration to turn on the downloads. Each one gets its
            own upload token, which you can revoke in Integrations.
          </p>
        )}
        <PermissionGate permission="tokens.manage">
          <p>
            Need separate permissions or a key for a custom app?{' '}
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
    </div>
  )
}
