'use client'

import { BashTool } from './bash-tool'
import { FlameshotTool } from './flameshot-tool'
import { ShareXTool } from './sharex-tool'
import { SpectacleTool } from './spectacle-tool'
import { UploadToken } from './upload-token'

export function ProfileTools() {
  return (
    <div className="space-y-6">
      <div className="divide-y rounded-xl border bg-background/40 px-4 sm:px-5 [&>div]:py-5">
        <ShareXTool />
        <FlameshotTool />
        <SpectacleTool />
        <BashTool />
      </div>
      <div className="rounded-xl border bg-background/40 p-4 sm:p-5">
        <UploadToken />
      </div>
    </div>
  )
}
