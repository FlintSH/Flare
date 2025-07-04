'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { useToast } from '@/hooks/use-toast'

export function BashTool() {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleBashDownload = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile/bash')
      if (!response.ok) {
        throw new Error('Failed to download bash script')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-upload.sh'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'Bash upload script downloaded successfully',
      })
    } catch (error) {
      console.error('Bash script download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download bash upload script',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <h3 className="font-medium">Bash Script</h3>
        <p className="text-sm text-muted-foreground">
          Simple upload script for command line usage
        </p>
      </div>
      <Button
        variant="outline"
        onClick={handleBashDownload}
        disabled={isLoading}
      >
        {isLoading ? 'Downloading...' : 'Download Script'}
      </Button>
    </div>
  )
}
