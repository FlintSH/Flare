'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { ToolRow } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

export function ITakeTool() {
  const { download, ready, available, configuration } = useUploaderDownload(
    'itake',
    {
      ready: {
        title: 'iTake configuration ready',
        description:
          'Open the downloaded .itup file and confirm Import in iTake.',
      },
      failed: {
        title: 'Download failed',
        description: 'Could not write the iTake configuration.',
      },
    }
  )
  const profileName = configuration?.profile?.name
  const dialog = (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!ready || !available}>
          Set up iTake
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up iTake on macOS</DialogTitle>
          <DialogDescription>
            Screenshots and screen recordings, uploaded straight to Flare.
            Requires macOS 15 or newer.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-4 pl-5 text-sm">
          <li>
            <a
              href="https://github.com/SerStars/iTake/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              Install iTake
            </a>{' '}
            and open it. Allow screen recording access when macOS asks.{' '}
            <a
              href="https://github.com/SerStars/iTake#installing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              Installation help
            </a>
          </li>
          <li>
            Download your config below, open the <strong>.itup</strong> file,
            and confirm <strong>Import</strong> in iTake. Your server and upload
            token are already filled in.
          </li>
          <li>
            In iTake, open <strong>Preferences → Uploader</strong>, select{' '}
            <strong>Flare — {profileName || 'Account defaults'}</strong>, and
            enable <strong>Upload Automatically</strong>. Leave{' '}
            <strong>Auto Copy Link</strong> on to copy the share link after each
            upload. Allow Keychain access if prompted on the first upload.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          {profileName
            ? 'This config uses the selected upload profile.'
            : 'This config follows your default upload profile.'}{' '}
          Keep it private: it includes your upload token. If replacing a config,
          remove its old uploader in iTake first.
        </p>
        <DialogFooter>
          <Button onClick={() => download({})}>Download config</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return (
    <ToolRow
      title="iTake"
      description={
        available
          ? 'Screenshots and screen recording on macOS 15 or newer. Import a ready-to-use config to upload and copy links automatically.'
          : 'Not available for an encrypted profile: an iTake uploader file describes one web request and cannot encrypt or start a program. Use a plain profile, or upload with flare-upload.'
      }
      action={dialog}
    />
  )
}
