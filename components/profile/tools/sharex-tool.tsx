'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { UPLOAD_PROGRAM_RELEASES_URL } from '@/lib/uploads/uploader-clients'
import { shareXAction } from '@/lib/uploads/uploader-clients/render'

import { CopyableValue, ToolRow } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

export function ShareXTool() {
  const { download, ready, encryption, configuration } = useUploaderDownload(
    'sharex',
    {
      ready: {
        title: 'ShareX configuration ready',
        description:
          'Open the downloaded .sxcu file in ShareX and confirm the import.',
      },
      failed: {
        title: 'Error',
        description: 'Failed to write the ShareX configuration',
      },
    }
  )
  const action = configuration ? shareXAction(configuration) : null

  return (
    <ToolRow
      title="ShareX"
      description={
        encryption === 'encrypted'
          ? 'Screenshots and file sharing on Windows. A ShareX uploader file describes one web request and cannot encrypt, so ShareX starts flare-upload as an action.'
          : 'Screenshots and file sharing on Windows. Open the downloaded .sxcu file in ShareX and confirm the import.'
      }
      action={
        encryption === 'encrypted' && action ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Set up ShareX</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Set up ShareX with flare-upload</DialogTitle>
                <DialogDescription>
                  ShareX captures and saves the file. An action then starts
                  flare-upload, which encrypts it, uploads it and copies the
                  link.
                </DialogDescription>
              </DialogHeader>
              <ol className="list-decimal space-y-4 pl-5 text-sm">
                <li>
                  <a
                    href={UPLOAD_PROGRAM_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    Download flare-upload for Windows
                  </a>{' '}
                  and put <strong>flare-upload.exe</strong> in a folder you
                  keep.
                </li>
                <li className="space-y-2">
                  <p>
                    Download the configuration from the flare-upload row and
                    save it here:
                  </p>
                  <CopyableValue
                    label="Configuration file"
                    value={action.configPath}
                  />
                </li>
                <li className="space-y-2">
                  <p>
                    In ShareX open <strong>Task settings → Actions</strong>,
                    select <strong>Add</strong>, and enter:
                  </p>
                  <CopyableValue label="Name" value={action.name} />
                  <p className="text-xs text-muted-foreground">
                    File path: select your <strong>flare-upload.exe</strong>{' '}
                    with the browse button.
                  </p>
                  <CopyableValue label="Arguments" value={action.arguments} />
                  <p className="text-xs text-muted-foreground">
                    Turn on <strong>Hidden window</strong> and tick the new
                    action in the list.
                  </p>
                </li>
                <li>
                  Under <strong>After capture tasks</strong> turn on{' '}
                  <strong>Save image to file</strong> and{' '}
                  <strong>Perform actions</strong>, and turn off{' '}
                  <strong>Upload image to host</strong>.
                </li>
              </ol>
              <p className="text-xs text-muted-foreground">
                ShareX does not read the link an action prints, so its history
                and its own notification show the saved file, not the link. The
                link is on your clipboard after each capture.
              </p>
            </DialogContent>
          </Dialog>
        ) : (
          <Button
            variant="outline"
            onClick={() => download({})}
            disabled={!ready}
          >
            Download config
          </Button>
        )
      }
    />
  )
}
