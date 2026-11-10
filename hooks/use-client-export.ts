'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import { apiRequest } from '@/lib/client/request'
import type {
  ExportManifest,
  ExportProgress,
  ExportSummary,
} from '@/lib/users/export-client'
import { exportFilename } from '@/lib/users/export-client'
import {
  type ExportSink,
  type RunningExport,
  chooseExportFile,
  runExport,
} from '@/lib/users/export-runner'

export type ClientExportState =
  | { phase: 'idle' }
  /** Reading what the account holds. */
  | { phase: 'checking' }
  /** The account has encrypted files and this browser's keys are locked. */
  | { phase: 'locked' }
  | { phase: 'running'; progress: ExportProgress | null }
  | { phase: 'done'; summary: ExportSummary; sink: ExportSink }
  | { phase: 'failed'; message: string }

/**
 * The account export for an account with encrypted files
 * (docs/e2ee-spec.md, section 12.4). The server cannot decrypt, so this
 * browser builds the ZIP. An account without encrypted files, and a person
 * who chooses not to decrypt, get the server's export: `serverExport`.
 */
export function useClientExport(serverExport: () => Promise<void> | void) {
  const [state, setState] = useState<ClientExportState>({ phase: 'idle' })
  const keys = useAccountKeyState()
  const running = useRef<RunningExport | null>(null)
  const manifest = useRef<ExportManifest | null>(null)
  const unlocked = keys.status === 'unlocked' ? keys.keys : null
  // The newest key state, for a click that came before it was known.
  const latest = useRef(keys)
  useEffect(() => {
    latest.current = keys
  }, [keys])

  useEffect(() => () => running.current?.cancel(), [])

  const build = useCallback(
    async (
      list: ExportManifest,
      accountKeys: {
        accountPrivateKey: Uint8Array
        oldPrivateKeys: readonly Uint8Array[]
      }
    ) => {
      const filename = exportFilename()
      let file: FileSystemFileHandle | null
      try {
        file = await chooseExportFile(filename)
      } catch {
        // The person closed the save dialog.
        setState({ phase: 'idle' })
        return
      }
      setState({ phase: 'running', progress: null })
      const job = runExport({
        manifest: list,
        keys: accountKeys,
        file,
        filename,
        onProgress: (progress) => setState({ phase: 'running', progress }),
      })
      running.current = job
      try {
        const { summary, sink } = await job.done
        setState({ phase: 'done', summary, sink })
      } catch (error) {
        setState(
          error instanceof DOMException && error.name === 'AbortError'
            ? { phase: 'idle' }
            : {
                phase: 'failed',
                message:
                  error instanceof Error && error.message
                    ? error.message
                    : 'The export failed. Start it again.',
              }
        )
      } finally {
        running.current = null
      }
    },
    []
  )

  const start = useCallback(async () => {
    setState({ phase: 'checking' })
    let list: ExportManifest
    try {
      list = await apiRequest<ExportManifest>('/api/profile/export/manifest')
    } catch {
      // The server's export reports why it cannot run, in its own words.
      setState({ phase: 'idle' })
      await serverExport()
      return
    }
    if (!list.files.some((file) => file.encrypted)) {
      setState({ phase: 'idle' })
      await serverExport()
      return
    }
    manifest.current = list
    // Right after a page load the key store has not been read yet. That is
    // not "locked": wait for the answer, a few seconds at most.
    for (
      let waited = 0;
      latest.current.status === 'loading' && waited < 10_000;
      waited += 100
    )
      await new Promise((resolve) => setTimeout(resolve, 100))
    const current = latest.current
    if (current.status !== 'unlocked') {
      setState({ phase: 'locked' })
      return
    }
    await build(list, current.keys)
  }, [serverExport, build])

  /** After the person unlocked their keys from the `locked` phase. */
  const resume = useCallback(async () => {
    if (manifest.current && unlocked) await build(manifest.current, unlocked)
  }, [unlocked, build])

  /** The server's export: encrypted files as ciphertext, with their records. */
  const withoutDecrypting = useCallback(async () => {
    setState({ phase: 'idle' })
    await serverExport()
  }, [serverExport])

  return {
    state,
    start,
    resume,
    withoutDecrypting,
    cancel: useCallback(() => running.current?.cancel(), []),
    dismiss: useCallback(() => setState({ phase: 'idle' }), []),
    canResume: unlocked !== null,
  }
}
