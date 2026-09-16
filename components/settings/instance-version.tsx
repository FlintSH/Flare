'use client'

import { useCallback, useEffect, useState } from 'react'

import type { BuildInfo, UpdateInfo } from '@/types/dto/updates'
import { ArrowUpRight, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function InstanceVersion({ buildInfo }: { buildInfo: BuildInfo }) {
  const isRolling = buildInfo.channel === 'rolling'
  const [isChecking, setIsChecking] = useState(isRolling)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkForUpdates = useCallback(async (signal?: AbortSignal) => {
    setIsChecking(true)
    setError(null)
    try {
      const response = await fetch('/api/updates/check', {
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error('Update check failed')
      const data: UpdateInfo = await response.json()
      if (!signal?.aborted) setUpdateInfo(data)
    } catch {
      if (signal?.aborted) return
      setUpdateInfo(null)
      setError('Update check failed. Try again.')
    } finally {
      if (!signal?.aborted) setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!isRolling) return
    const controller = new AbortController()
    void checkForUpdates(controller.signal)
    return () => controller.abort()
  }, [isRolling, checkForUpdates])

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">Flare {buildInfo.version}</span>
            {isRolling && (
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                Rolling
                <span className="flex items-baseline gap-2">
                  <span aria-hidden="true">·</span>
                  {buildInfo.commitSha && buildInfo.commitUrl ? (
                    <a
                      href={buildInfo.commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Based on commit ${buildInfo.commitSha}`}
                      aria-label={`View source commit ${buildInfo.commitSha}`}
                      className="font-mono underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
                    >
                      {buildInfo.commitSha.slice(0, 7)}
                    </a>
                  ) : (
                    'Commit unavailable'
                  )}
                </span>
              </span>
            )}
          </div>
          {isRolling && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Pre-release. May be unstable or break.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => void checkForUpdates()}
          disabled={isChecking}
          aria-label="Check for updates"
          title="Check for updates"
        >
          <RefreshCw
            className={`h-3.5 w-3.5${isChecking ? ' animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            {isChecking ? 'Checking…' : 'Check for updates'}
          </span>
        </Button>
      </div>
      <div
        role="status"
        className="text-xs leading-relaxed text-muted-foreground"
      >
        {isChecking ? (
          'Checking for updates…'
        ) : error ? (
          error
        ) : updateInfo?.hasUpdate && updateInfo.releaseUrl ? (
          <a
            href={updateInfo.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            {isRolling
              ? 'New rolling release available'
              : `Update available: ${updateInfo.latestVersion}`}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          updateInfo?.message
        )}
      </div>
    </div>
  )
}
