'use client'

import { useState } from 'react'

import Link from 'next/link'

import { ChevronDown } from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import { BashTool } from './bash-tool'
import { FlameshotTool } from './flameshot-tool'
import { ITakeTool } from './itake-tool'
import { ShareXTool } from './sharex-tool'
import { SpectacleTool } from './spectacle-tool'
import { UploadToken } from './upload-token'

export function ProfileTools({
  onOpenIntegrations,
}: {
  onOpenIntegrations?: () => void
}) {
  const [manualSetupVisited, setManualSetupVisited] = useState(false)

  return (
    <div className="space-y-6">
      <div className="divide-y rounded-xl border bg-background/40 px-4 sm:px-5 [&>div]:py-5">
        <ShareXTool />
        <ITakeTool />
        <FlameshotTool />
        <SpectacleTool />
        <BashTool />
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          These downloads follow your default upload profile. Keep them private:
          they include access to upload to your account.
        </p>
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
      </div>
      <Collapsible
        className="rounded-xl border bg-background/40"
        onOpenChange={(open) => {
          if (open) setManualSetupVisited(true)
        }}
      >
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
          Manual setup and upload token
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent
          forceMount
          className="px-4 pb-4 data-[state=closed]:hidden sm:px-5 sm:pb-5"
        >
          {manualSetupVisited && <UploadToken />}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
