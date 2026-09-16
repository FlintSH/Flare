'use client'

import { useCallback, useEffect, useState } from 'react'

import type { BuildInfo, UpdateInfo } from '@/types/dto/updates'
import { ExternalLink, TriangleAlert } from 'lucide-react'

import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import { useToast } from '@/hooks/use-toast'

export function InstanceVersion({ buildInfo }: { buildInfo: BuildInfo }) {
  const isRolling = buildInfo.channel === 'rolling'
  const { toast } = useToast()
  const [isChecking, setIsChecking] = useState(isRolling)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkForUpdates = useCallback(
    async (notify = false, signal?: AbortSignal) => {
      setIsChecking(true)
      setError(null)
      try {
        const response = await fetch('/api/updates/check', {
          cache: 'no-store',
          signal,
        })
        if (!response.ok) throw new Error('Update check failed')
        const data: UpdateInfo = await response.json()
        if (signal?.aborted) return
        setUpdateInfo(data)
        if (notify) {
          toast({
            title:
              data.hasUpdate === null
                ? 'Update status unavailable'
                : data.hasUpdate
                  ? 'Update Available'
                  : 'No Updates Available',
            description: data.message,
          })
        }
      } catch {
        if (signal?.aborted) return
        setUpdateInfo(null)
        setError('Unable to check for updates. Please try again later.')
        if (notify) {
          toast({
            title: 'Failed to check for updates',
            description: 'Please try again later',
            variant: 'destructive',
          })
        }
      } finally {
        if (!signal?.aborted) setIsChecking(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (!isRolling) return
    const controller = new AbortController()
    void checkForUpdates(false, controller.signal)
    return () => controller.abort()
  }, [isRolling, checkForUpdates])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label>Version</Label>
            {isRolling && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Rolling release
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Current version: {buildInfo.version}
          </p>
          {isRolling && (
            <p className="text-sm text-muted-foreground">
              {buildInfo.commitSha && buildInfo.commitUrl ? (
                <>
                  Based on commit{' '}
                  <a
                    href={buildInfo.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={buildInfo.commitSha}
                    className="inline-flex items-center gap-1 font-mono text-primary underline underline-offset-4"
                  >
                    {buildInfo.commitSha.slice(0, 7)}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </>
              ) : (
                'Build commit unavailable'
              )}
            </p>
          )}
          <div role="status" className="text-sm text-muted-foreground">
            {isChecking ? (
              'Checking for updates…'
            ) : error ? (
              error
            ) : updateInfo ? (
              <>
                <p
                  className={updateInfo.hasUpdate ? 'text-primary' : undefined}
                >
                  {updateInfo.message}
                </p>
                {isRolling &&
                  updateInfo.hasUpdate &&
                  updateInfo.latestCommitSha &&
                  updateInfo.latestCommitUrl && (
                    <p>
                      Latest rolling commit:{' '}
                      <a
                        href={updateInfo.latestCommitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={updateInfo.latestCommitSha}
                        className="inline-flex items-center gap-1 font-mono text-primary underline underline-offset-4"
                      >
                        {updateInfo.latestCommitSha.slice(0, 7)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </p>
                  )}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {updateInfo?.hasUpdate && updateInfo.releaseUrl && (
            <Button variant="outline" asChild>
              <a
                href={updateInfo.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {isRolling ? 'View Rolling Release' : 'View Release'}
              </a>
            </Button>
          )}
          <Button
            onClick={() => void checkForUpdates(true)}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Check for Updates'
            )}
          </Button>
        </div>
      </div>
      {isRolling && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Pre-release software</AlertTitle>
          <AlertDescription>
            Rolling releases can be unstable, contain bugs, or break your
            instance.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
