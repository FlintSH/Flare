import { useEffect, useState } from 'react'

import { UploadToken } from '@/types/components/profile'

import { useToast } from './use-toast'

export function useUploadToken(): UploadToken {
  const [uploadToken, setUploadToken] = useState<string | null>(null)
  const [isLoadingToken, setIsLoadingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const fetchToken = async () => {
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
      }
    }
    fetchToken()
  }, [toast])

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
        description: 'Upload token refreshed successfully',
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
    handleRefreshToken,
  }
}
