'use client'

import { Button } from '@/components/ui/button'

import { uploaderClients } from '@/lib/uploads/uploader-clients'

import { ToolRow, type UploaderToolProps } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

export function BashTool({ profileId, compact, disabled }: UploaderToolProps) {
  const { download, isLoading } = useUploaderDownload('bash', {
    ready: {
      title: 'Upload script ready',
      description:
        'Run the downloaded script with Bash and a file path. No token editing needed.',
    },
    failed: {
      title: 'Error',
      description: 'Failed to download bash upload script',
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
        ? uploaderClients.bash.label
        : isLoading
          ? 'Downloading…'
          : 'Download script'}
    </Button>
  )
  if (compact) return button

  return (
    <ToolRow
      title="Bash script"
      description={
        <>
          Upload from your terminal. Run{' '}
          <code className="whitespace-nowrap rounded bg-muted px-1 py-0.5 text-xs">
            bash &lt;script.sh&gt; &lt;file&gt;
          </code>{' '}
          with your downloaded script and the file to upload.
        </>
      }
      action={button}
    />
  )
}
