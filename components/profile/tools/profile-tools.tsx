'use client'

import { Separator } from '@/components/ui/separator'

import { BashTool } from './bash-tool'
import { FlameshotTool } from './flameshot-tool'
import { ShareXTool } from './sharex-tool'
import { UploadToken } from './upload-token'

export function ProfileTools() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Upload Tools</h3>
        <p className="text-sm text-muted-foreground">
          Download pre-configured settings for your favorite upload tools.
        </p>
      </div>

      <div className="space-y-6">
        <UploadToken />

        <Separator />

        <ShareXTool />

        <Separator />

        <FlameshotTool />

        <Separator />

        <BashTool />
      </div>
    </div>
  )
}
