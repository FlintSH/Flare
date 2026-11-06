'use client'

import { Button } from '@/components/ui/button'

import { uploaderClients } from '@/lib/uploads/uploader-clients'

import { ToolRow, type UploaderToolProps } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

export function ShareXTool({
  profileId,
  compact,
  disabled,
}: UploaderToolProps) {
  const { download, isLoading } = useUploaderDownload('sharex', {
    ready: {
      title: 'ShareX configuration ready',
      description:
        'Open the downloaded .sxcu file in ShareX and confirm the import.',
    },
    failed: {
      title: 'Error',
      description: 'Failed to download ShareX configuration',
    },
  })

  const button = (
    <Button
      variant="outline"
      size={compact ? 'sm' : 'default'}
      onClick={() => void download({}, profileId)}
      disabled={disabled || isLoading}
    >
      {compact
        ? uploaderClients.sharex.label
        : isLoading
          ? 'Downloading…'
          : 'Download config'}
    </Button>
  )
  if (compact) return button

  return (
    <ToolRow
      title="ShareX"
      description="Screenshots and file sharing on Windows. Open the downloaded .sxcu file in ShareX and confirm the import."
      action={button}
    />
  )
}
