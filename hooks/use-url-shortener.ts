import { useCallback, useState } from 'react'

import { useRouter } from 'next/navigation'

import { useToast } from './use-toast'

export interface ShortenedUrl {
  id: string
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: string
}

export interface UseUrlShortenerOptions {
  onUrlCreated?: (url: ShortenedUrl) => void
  onUrlDeleted?: (id: string) => void
}

export function useUrlShortener(options: UseUrlShortenerOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [urls, setUrls] = useState<ShortenedUrl[]>([])
  const [url, setUrl] = useState('')
  const router = useRouter()
  const { toast } = useToast()

  const fetchUrls = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/urls')
      if (!response.ok) {
        throw new Error('Failed to fetch URLs')
      }
      const data = await response.json()
      setUrls(data)
    } catch (error) {
      console.error('Error fetching URLs:', error)
      toast({
        title: 'Error',
        description: 'Failed to fetch your shortened URLs',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const shortenUrl = useCallback(async () => {
    if (!url) {
      toast({
        title: 'Error',
        description: 'Please enter a URL to shorten',
        variant: 'destructive',
      })
      return
    }

    try {
      setIsLoading(true)

      let finalUrl = url.trim()
      // Add https:// if protocol is missing
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl
      }

      const response = await fetch('/api/urls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: finalUrl }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to shorten URL')
      }

      const newUrl = await response.json()

      // Add to state
      setUrls((prevUrls) => [newUrl, ...prevUrls])

      // Reset input
      setUrl('')

      // Callback
      if (options.onUrlCreated) {
        options.onUrlCreated(newUrl)
      }

      toast({
        title: 'URL shortened',
        description: `Your URL has been shortened successfully`,
      })

      router.refresh()
      return newUrl
    } catch (error) {
      console.error('Error shortening URL:', error)
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to shorten URL',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [url, toast, router, options])

  const deleteUrl = useCallback(
    async (id: string) => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/urls/${id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to delete URL')
        }

        // Remove from state
        setUrls((prevUrls) => prevUrls.filter((url) => url.id !== id))

        // Callback
        if (options.onUrlDeleted) {
          options.onUrlDeleted(id)
        }

        toast({
          title: 'URL deleted',
          description: 'The shortened URL has been deleted successfully',
        })

        router.refresh()
      } catch (error) {
        console.error('Error deleting URL:', error)
        toast({
          title: 'Error',
          description: 'Failed to delete URL',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
      }
    },
    [toast, router, options]
  )

  const copyShortUrl = useCallback(
    (shortCode: string) => {
      const baseUrl = window.location.origin
      const shortUrl = `${baseUrl}/u/${shortCode}`

      navigator.clipboard.writeText(shortUrl).then(() => {
        toast({
          title: 'URL copied',
          description: 'The shortened URL has been copied to your clipboard',
        })
      })
    },
    [toast]
  )

  return {
    isLoading,
    urls,
    url,
    setUrl,
    fetchUrls,
    shortenUrl,
    deleteUrl,
    copyShortUrl,
  }
}
