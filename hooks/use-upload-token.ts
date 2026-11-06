import { useCallback, useEffect, useState } from 'react'

import { UploadToken } from '@/types/components/profile'

import { RefusedRequest, apiRequest } from '@/lib/client/request'

import { useToast } from './use-toast'

const TOKEN_PATH = '/api/profile/upload-token'

export function useUploadToken(): UploadToken {
  const [uploadToken, setUploadToken] = useState<string | null>(null)
  const [isLoadingToken, setIsLoadingToken] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const { toast } = useToast()

  const handleLoadToken = useCallback(async () => {
    const failed = 'Failed to fetch upload token'
    setIsLoadingToken(true)
    try {
      const data = await apiRequest<{ uploadToken: string }>(TOKEN_PATH, {
        fallback: failed,
      })
      setUploadToken(data.uploadToken)
    } catch (error) {
      console.error('Error fetching upload token:', error)
      toast({
        title: 'Error',
        description: error instanceof RefusedRequest ? error.message : failed,
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
    const failed = 'Failed to refresh upload token'
    setIsLoadingToken(true)
    try {
      const data = await apiRequest<{ uploadToken: string }>(TOKEN_PATH, {
        method: 'POST',
        fallback: failed,
      })
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
        description: error instanceof RefusedRequest ? error.message : failed,
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
