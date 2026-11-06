'use client'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { useDataExport } from '@/hooks/use-data-export'

export function ProfileExport() {
  const { isExporting, progress, handleExport } = useDataExport()

  return (
    <div className="space-y-4">
      <Button
        onClick={handleExport}
        disabled={isExporting}
        variant="outline"
        className="w-full sm:w-auto"
      >
        {isExporting ? `Preparing… ${progress}%` : 'Export all data'}
      </Button>
      {isExporting && (
        <Progress
          className="max-w-md"
          value={progress}
          aria-label="Data export progress"
        />
      )}
    </div>
  )
}
