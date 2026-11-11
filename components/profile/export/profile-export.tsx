'use client'

import { useState } from 'react'

import { LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react'

import { UnlockDialog } from '@/components/encryption/unlock-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { formatBytes } from '@/lib/utils'

import { useClientExport } from '@/hooks/use-client-export'
import { useDataExport } from '@/hooks/use-data-export'

const count = (value: number, noun: string) =>
  `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`

export function ProfileExport() {
  const { isExporting, progress, handleExport } = useDataExport()
  // An account with encrypted files is exported by this browser, which has
  // the keys. Every other account gets the server's export, as before.
  const local = useClientExport(handleExport)
  const [unlocking, setUnlocking] = useState(false)
  const { state } = local
  const running = state.phase === 'running'
  const busy = isExporting || running || state.phase === 'checking'
  const built = running ? state.progress : null
  const percent = built?.bytesTotal
    ? Math.min(100, Math.round((built.bytesDone / built.bytesTotal) * 100))
    : 0

  return (
    <div className="space-y-4" data-export-phase={state.phase}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void local.start()}
          disabled={busy}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {isExporting
            ? `Preparing… ${progress}%`
            : running
              ? `Exporting… ${percent}%`
              : state.phase === 'checking'
                ? 'Preparing…'
                : 'Export all data'}
        </Button>
        {running && (
          <Button
            variant="ghost"
            onClick={local.cancel}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        )}
      </div>
      {isExporting && (
        <Progress
          className="max-w-md"
          value={progress}
          aria-label="Data export progress"
        />
      )}
      {running && (
        <div className="max-w-md space-y-2" role="status">
          <Progress value={percent} aria-label="Data export progress" />
          <p className="break-words text-xs leading-relaxed text-muted-foreground">
            {built
              ? `File ${Math.min(built.filesDone + 1, built.filesTotal).toLocaleString('en-US')} of ${built.filesTotal.toLocaleString('en-US')}${built.current ? `: ${built.current}` : ''} · ${formatBytes(built.bytesDone)} of ${formatBytes(built.bytesTotal)}`
              : 'Opening your files…'}
            {built && built.skipped > 0
              ? ` · ${count(built.skipped, 'file')} left out`
              : ''}
          </p>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            Your browser downloads each file, decrypts it and writes the ZIP on
            this device. Keep this tab open.
          </p>
        </div>
      )}
      {state.phase === 'locked' && (
        <Alert variant="info" className="max-w-xl">
          <LockKeyhole aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>
              Your account has encrypted files, and your encryption keys are
              locked in this browser. Unlock them to export those files
              decrypted, under their real names.
            </p>
            <div className="flex flex-wrap gap-2">
              {local.canResume ? (
                <Button size="sm" onClick={() => void local.resume()}>
                  Export decrypted
                </Button>
              ) : (
                <Button size="sm" onClick={() => setUnlocking(true)}>
                  Unlock
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void local.withoutDecrypting()}
              >
                Export without decrypting
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {state.phase === 'done' && (
        <Alert
          variant={
            state.summary.failed.length || state.summary.notDecrypted.length
              ? 'warning'
              : 'info'
          }
          className="max-w-xl"
          role="status"
        >
          {state.summary.failed.length || state.summary.notDecrypted.length ? (
            <TriangleAlert aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}
          <AlertDescription className="space-y-1">
            <p>
              Export saved: {count(state.summary.files, 'file')},{' '}
              {state.summary.decrypted.toLocaleString('en-US')} decrypted in
              this browser.
            </p>
            {state.summary.notDecrypted.length > 0 && (
              <p>
                {count(state.summary.notDecrypted.length, 'encrypted file')}{' '}
                could not be opened with your keys and{' '}
                {state.summary.notDecrypted.length === 1 ? 'is' : 'are'}{' '}
                included as ciphertext.
              </p>
            )}
            {state.summary.failed.length > 0 && (
              <p>
                {count(state.summary.failed.length, 'file')}{' '}
                {state.summary.failed.length === 1 ? 'was' : 'were'} left out.{' '}
                <code className="font-mono text-xs">export-report.json</code> in
                the ZIP names{' '}
                {state.summary.failed.length === 1 ? 'it' : 'them'} and says
                why. Export again to retry.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {state.phase === 'failed' && (
        <Alert variant="destructive" className="max-w-xl">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
    </div>
  )
}
