'use client'

import { saveBlobAsFile } from '@/lib/client/save-file'
import {
  type UploaderClientId,
  type UploaderOptions,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'
import {
  renderUploaderFile,
  transportFor,
  uploaderAvailable,
} from '@/lib/uploads/uploader-clients/render'

import { useToast } from '@/hooks/use-toast'

import { useUploaderConfiguration } from './configuration'

interface Notice {
  title: string
  description: string
}

/** Saves text as a file that the browser downloads and never opens. */
export function saveTextAsFile(text: string, filename: string) {
  saveBlobAsFile(
    new Blob([text], { type: 'application/octet-stream' }),
    filename
  )
}

/**
 * Writes a tool's file in this browser from the configuration of the card
 * and saves it. The server never writes one: it has only the hash of the
 * token (docs/e2ee-spec.md, section 14.4).
 */
export function useUploaderDownload<Id extends UploaderClientId>(
  id: Id,
  notices: { ready: Notice; failed: Notice }
) {
  const configuration = useUploaderConfiguration()
  const { toast } = useToast()
  const client = uploaderClients[id]

  /** Whether the file was saved. */
  function download(options: UploaderOptions<Id>) {
    if (!configuration) return false
    try {
      const stem = (configuration.profile?.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      saveTextAsFile(
        renderUploaderFile(id, configuration, options),
        `flare-${stem ? `${stem}-` : ''}${client.fileName(options)}`
      )
      toast(notices.ready)
      return true
    } catch (error) {
      console.error(`${client.label} download failed:`, error)
      toast({ ...notices.failed, variant: 'destructive' })
      return false
    }
  }

  return {
    download,
    /** No configuration yet: the card creates one first. */
    ready: configuration !== null,
    /** Whether this tool has a file for the configuration's profile. */
    available: configuration
      ? uploaderAvailable(id, configuration.encryption)
      : true,
    encryption: configuration?.encryption ?? null,
    transport: configuration ? transportFor(configuration.encryption) : null,
    configuration,
  }
}
