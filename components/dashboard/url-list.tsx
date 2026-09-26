'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Check, Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react'

import { PermissionGate } from '@/components/roles/permission-gate'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  onUrlDeleted?: (shortCode: string) => void
}

export function URLList({ refreshTrigger = 0, onUrlDeleted }: URLListProps) {
  const [urls, setUrls] = useState<ShortenedUrl[]>([])
  const requestVersion = useRef(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [origin, setOrigin] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ShortenedUrl | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { toast } = useToast()

  const fetchUrls = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestVersion.current
    try {
      const response = await fetch('/api/urls', { signal })
      if (!response.ok)
        throw new Error('Could not load your links. Please try again.')
      const data = await response.json()
      if (!signal?.aborted && requestId === requestVersion.current) {
        setUrls(data.data?.urls || [])
        setError('')
      }
    } catch (failure) {
      if (!signal?.aborted && requestId === requestVersion.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not load your links. Please try again.'
        )
    } finally {
      if (!signal?.aborted && requestId === requestVersion.current)
        setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setOrigin(window.location.origin)
    void fetchUrls(controller.signal)
    return () => controller.abort()
  }, [refreshTrigger, fetchUrls])

  const copyUrl = async (url: ShortenedUrl) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/u/${url.shortCode}`
      )
      setCopiedId(url.id)
      toast({ title: 'Link copied' })
    } catch {
      toast({
        title: 'Could not copy link',
        description: 'Open the short link to copy its address.',
        variant: 'destructive',
      })
    }
  }

  const deleteUrl = async () => {
    if (!deleting || isDeleting) return
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/urls/${deleting.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete link')
      setUrls((previous) => previous.filter((url) => url.id !== deleting.id))
      onUrlDeleted?.(deleting.shortCode)
      setDeleting(null)
      toast({ title: 'Short link deleted' })
      void fetchUrls()
    } catch {
      toast({
        title: 'Could not delete link',
        description: 'Your link is still available. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      {isLoading ? (
        <div
          role="status"
          aria-label="Loading shortened URLs"
          className="divide-y rounded-lg border"
        >
          <span className="sr-only">Loading shortened URLs…</span>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-4 p-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true)
              void fetchUrls()
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : urls.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No shortened URLs yet. Add a URL above to get started.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table
            className="min-w-[680px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label="Shortened URLs"
            tabIndex={0}
          >
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="pl-4">Original URL</TableHead>
                <TableHead>Short URL</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="pr-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {urls.map((url) => (
                <TableRow key={url.id}>
                  <TableCell className="max-w-[260px] pl-4 font-medium">
                    <a
                      href={url.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={url.targetUrl}
                      className="block truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {url.targetUrl}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-[250px]">
                    <a
                      href={`/u/${url.shortCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${origin}/u/${url.shortCode}`}
                      className="block truncate rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {origin}/u/{url.shortCode}
                    </a>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {url.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                    {new Date(url.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="pr-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyUrl(url)}
                        aria-label={`Copy short link ${url.shortCode}`}
                        title={
                          copiedId === url.id ? 'Copied' : 'Copy short link'
                        }
                      >
                        {copiedId === url.id ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <PermissionGate permission="links.delete">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(url)}
                          aria-label={`Delete short link ${url.shortCode}`}
                          title="Delete short link"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-foreground"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </PermissionGate>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this short link?</AlertDialogTitle>
            <AlertDialogDescription>
              The short link{' '}
              <span className="break-all font-medium text-foreground">
                {origin}/u/{deleting?.shortCode}
              </span>{' '}
              will stop redirecting to its destination. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Keep link
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={deleteUrl}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isDeleting ? 'Deleting…' : 'Delete link'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
