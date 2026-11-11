'use client'

import { Button } from '@/components/ui/button'

import { ToolRow } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

export function BashTool() {
  const { download, ready, transport } = useUploaderDownload('bash', {
    ready: {
      title: 'Upload script ready',
      description: 'Run the downloaded script with Bash and a file path.',
    },
    failed: {
      title: 'Error',
      description: 'Failed to write the upload script',
    },
  })

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
          {transport === 'helper' &&
            ' The script starts flare-upload, which you can also run on its own.'}
        </>
      }
      action={
        <Button
          variant="outline"
          onClick={() => download({})}
          disabled={!ready}
        >
          Download script
        </Button>
      }
    />
  )
}
