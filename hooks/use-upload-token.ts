import { useCallback, useEffect, useState } from 'react'

import { UploadToken } from '@/types/components/profile'

import { useToast } from './use-toast'

export function useUploadToken(): UploadToken {
  const [uploadToken, setUploadToken] = useState<string | null>(null)
  const [isLoadingToken, setIsLoadingToken] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const { toast } = useToast()

  const handleLoadToken = useCallback(async () => {
    setIsLoadingToken(true)
    try {
      const response = await fetch('/api/profile/upload-token')
      if (!response.ok) throw new Error('Failed to fetch upload token')
      const data = await response.json()
      setUploadToken(data.uploadToken)
    } catch (error) {
      console.error('Error fetching upload token:', error)
      toast({
        title: 'Error',
        description: 'Failed to fetch upload token',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingToken(false)
    }
  }, [toast])

  useEffect(() => {
    void handleLoadToken()
  }, [handleLoadToken])

  const handleRefreshToken = async () => {
    setIsLoadingToken(true)
    try {
      const response = await fetch('/api/profile/upload-token', {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to refresh upload token')
      const data = await response.json()
      setUploadToken(data.uploadToken)
      toast({
        title: 'Success',
        description:
          'Upload token replaced. Download fresh configurations to reconnect your tools.',
      })
    } catch (error) {
      console.error('Error refreshing upload token:', error)
      toast({
        title: 'Error',
        description: 'Failed to refresh upload token',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingToken(false)
    }
  }

  return {
    uploadToken,
    isLoadingToken,
    showToken,
    setShowToken,
    handleLoadToken,
    handleRefreshToken,
  }
}
