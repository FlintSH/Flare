'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { useToast } from '@/hooks/use-toast'

export function ShareXTool() {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleShareXDownload = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile/sharex')
      if (!response.ok) {
        throw new Error('Failed to download ShareX config')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-sharex.sxcu'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'ShareX configuration downloaded successfully',
      })
    } catch (error) {
      console.error('ShareX download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download ShareX configuration',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <h3 className="font-medium">ShareX</h3>
        <p className="text-sm text-muted-foreground">
          Popular screenshot and file sharing tool for Windows
        </p>
      </div>
      <Button
        variant="outline"
        onClick={handleShareXDownload}
        disabled={isLoading}
      >
        {isLoading ? 'Downloading...' : 'Download Config'}
      </Button>
    </div>
  )
}
