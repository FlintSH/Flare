'use client'

import { useState } from 'react'

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

import { useToast } from '@/hooks/use-toast'

export function ITakeSetupButton({
  profileId,
  profileName,
  disabled,
  compact = false,
}: {
  profileId?: string
  profileName?: string
  disabled?: boolean
  compact?: boolean
}) {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  async function download() {
    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/profile/itake${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`
      )
      if (!response.ok)
        throw new Error('Failed to download iTake configuration')

      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'flare-itake.itup'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      toast({
        title: 'iTake configuration ready',
        description:
          'Open the downloaded .itup file and confirm Import in iTake.',
      })
    } catch {
      toast({
        title: 'Download failed',
        description:
          'Could not download the iTake configuration. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          disabled={disabled}
        >
          {compact ? 'iTake' : 'Set Up iTake'}
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
          {profileId
            ? 'This config uses the selected upload profile.'
            : 'This config follows your default upload profile.'}{' '}
          Keep it private: it includes your upload token. If replacing a config,
          remove its old uploader in iTake first.
        </p>
        <DialogFooter>
          <Button onClick={() => void download()} disabled={isLoading}>
            {isLoading ? 'Downloading...' : 'Download Config'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ITakeTool() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">iTake</h3>
        <p className="text-sm text-muted-foreground">
          Screenshots and screen recording on macOS 15 or newer. Import a
          ready-to-use config to upload and copy links automatically.
        </p>
      </div>
      <ITakeSetupButton />
    </div>
  )
}
