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
        title: 'Upload script ready',
        description:
          'Run the downloaded script with Bash and a file path. No token editing needed.',
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">Bash Script</h3>
        <p className="text-sm text-muted-foreground">
          Upload from your terminal. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            bash &lt;script.sh&gt; &lt;file&gt;
          </code>{' '}
          with your downloaded script and the file to upload.
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
