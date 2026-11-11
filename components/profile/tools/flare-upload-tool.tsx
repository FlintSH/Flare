'use client'

import { Download, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { UPLOAD_PROGRAM_RELEASES_URL } from '@/lib/uploads/uploader-clients'
import {
  flareUploadConfig,
  flareUploadConfigName,
} from '@/lib/uploads/uploader-clients/render'

import { useToast } from '@/hooks/use-toast'

import { useUploaderConfiguration } from './configuration'
import { ToolRow } from './tool-parts'
import { saveTextAsFile } from './use-uploader-download'

/**
 * The helper program and its configuration file. Flare links to the
 * release assets of the project and never downloads or starts a program
 * for the user.
 */
export function FlareUploadTool() {
  const configuration = useUploaderConfiguration()
  const { toast } = useToast()

  function download() {
    if (!configuration) return
    const name = flareUploadConfigName(configuration)
    saveTextAsFile(flareUploadConfig(configuration), name)
    toast({
      title: 'Configuration ready',
      description: `Save ${name} in the flare-upload folder of your user configuration and keep it private.`,
    })
  }

  return (
    <ToolRow
      title="flare-upload"
      description={
        <>
          The command-line program that encrypts on your machine. Every tool
          below starts it for an encrypted profile.{' '}
          <a
            href={UPLOAD_PROGRAM_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary underline underline-offset-4"
          >
            Get the program
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </>
      }
      action={
        <Button
          variant="outline"
          onClick={download}
          disabled={!configuration}
          data-download="flare-upload-config"
        >
          <Download />
          Download configuration
        </Button>
      }
    />
  )
}
