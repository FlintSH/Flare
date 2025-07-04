'use client'

import { useCallback, useEffect, useState } from 'react'

import { Copy, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { useToast } from '@/hooks/use-toast'

interface ShortenedUrl {
  id: string
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: string
}

interface URLListProps {
  refreshTrigger?: number
}

function URLTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Original URL</TableHead>
            <TableHead>Short URL</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(3)].map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-[250px]" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-[180px]" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="h-4 w-8 ml-auto" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="h-4 w-24 ml-auto" />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function URLList({ refreshTrigger = 0 }: URLListProps) {
  const [urls, setUrls] = useState<ShortenedUrl[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  const fetchUrls = useCallback(async () => {
    try {
      const response = await fetch('/api/urls')
      if (!response.ok) throw new Error('Failed to fetch URLs')
      const data = await response.json()
      setUrls(data.data?.urls || [])
    } catch (error) {
      console.error('Failed to load URLs:', error)
      toast({
        title: 'Error',
        description: 'Failed to load shortened URLs',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const copyUrl = async (shortCode: string) => {
    const url = `${window.location.origin}/u/${shortCode}`
    try {
      await navigator.clipboard.writeText(url)
      toast({
        title: 'URL copied',
        description: 'Shortened URL has been copied to clipboard',
      })
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy URL',
        variant: 'destructive',
      })
    }
  }

  const deleteUrl = async (id: string) => {
    try {
      const response = await fetch(`/api/urls/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete URL')

      setUrls(urls.filter((url) => url.id !== id))

      toast({
        title: 'URL deleted',
        description: 'Shortened URL has been deleted',
      })
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to delete URL',
        variant: 'destructive',
      })
    }
  }

  useEffect(() => {
    fetchUrls()
  }, [refreshTrigger, fetchUrls])

  if (isLoading) {
    return <URLTableSkeleton />
  }

  if (urls.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        No shortened URLs yet
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Original URL</TableHead>
            <TableHead>Short URL</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {urls.map((url) => (
            <TableRow key={url.id}>
              <TableCell className="font-medium max-w-[300px] truncate">
                {url.targetUrl}
              </TableCell>
              <TableCell>{`${window.location.origin}/u/${url.shortCode}`}</TableCell>
              <TableCell className="text-right">{url.clicks}</TableCell>
              <TableCell className="text-right">
                {new Date(url.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyUrl(url.shortCode)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteUrl(url.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
