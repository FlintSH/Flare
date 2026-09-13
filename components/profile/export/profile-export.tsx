'use client'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { useDataExport } from '@/hooks/use-data-export'

export function ProfileExport() {
  const {
    isExporting,
    exportProgress,
    downloadProgress,
    status,
    handleExport,
  } = useDataExport()

  return (
    <div className="space-y-4">
      <Button
        onClick={handleExport}
        disabled={isExporting}
        variant="outline"
        className="w-full sm:w-auto"
      >
        {isExporting ? (
          <span>
            <span>
              {status === 'preparing'
                ? `Preparing... ${exportProgress}%`
                : status === 'downloading'
                  ? `Downloading... ${downloadProgress}%`
                  : 'Starting...'}
            </span>
          </span>
        ) : (
          'Export All Data'
        )}
      </Button>
      {isExporting && (
        <Progress
          className="max-w-md"
          value={status === 'preparing' ? exportProgress : downloadProgress}
          aria-label="Data export progress"
        />
      )}
    </div>
  )
}
