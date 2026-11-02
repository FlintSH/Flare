'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { MetaLine } from '@/components/profile/meta-line'
import { PermissionGate } from '@/components/roles/permission-gate'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

  const rowActions = (url: ShortenedUrl) => (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => copyUrl(url)}
        aria-label={`Copy short link ${url.shortCode}`}
        title={copiedId === url.id ? 'Copied' : 'Copy short link'}
      >
        {copiedId === url.id ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
      <PermissionGate permission="links.delete">
        {/* Red at rest, like every destructive row action. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleting(url)}
          aria-label={`Delete short link ${url.shortCode}`}
          title="Delete short link"
          className="text-destructive hover:bg-danger/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </PermissionGate>
    </>
  )

  return (
    <>
      {isLoading ? (
        <div
          role="status"
          aria-label="Loading shortened URLs"
          className="divide-y rounded-xl border"
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
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true)
                void fetchUrls()
              }}
            >
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : urls.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No shortened URLs yet. Add a URL above to get started.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {/* On phones the destination gets the row's full width; the short
              link, clicks, and date sit under it with the actions beside
              them. Wider screens give each its own column. */}
          <Table className="table-fixed" aria-label="Shortened URLs">
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="pl-4">Original URL</TableHead>
                <TableHead className="hidden w-60 md:table-cell">
                  Short URL
                </TableHead>
                <TableHead className="hidden w-20 text-right md:table-cell">
                  Clicks
                </TableHead>
                <TableHead className="hidden w-28 text-right lg:table-cell">
                  Created
                </TableHead>
                <TableHead className="hidden w-24 pr-3 text-right md:table-cell">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {urls.map((url) => {
                const created = new Date(url.createdAt).toLocaleDateString()
                return (
                  <TableRow key={url.id}>
                    <TableCell className="py-3 pl-4 pr-3 md:pr-2">
                      <a
                        href={url.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={url.targetUrl}
                        className="block truncate rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {url.targetUrl}
                      </a>
                      <div className="mt-1 flex items-center gap-1 lg:hidden">
                        <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                          <a
                            href={`/u/${url.shortCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${origin}/u/${url.shortCode}`}
                            className="block truncate rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                          >
                            {origin}/u/{url.shortCode}
                          </a>
                          {/* Breaks only between the two facts, and the
                              separator moves with the date, so a line
                              never ends on "·". */}
                          <MetaLine
                            className="text-muted-foreground"
                            items={[
                              {
                                key: 'clicks',
                                className: 'md:hidden',
                                text: (
                                  <>
                                    <span className="tabular-nums">
                                      {url.clicks.toLocaleString()}
                                    </span>{' '}
                                    {url.clicks === 1 ? 'click' : 'clicks'}
                                  </>
                                ),
                              },
                              { key: 'created', text: `Created ${created}` },
                            ]}
                          />
                        </div>
                        {/* The negative margin lines the last icon up with
                            the destination's end. */}
                        <div className="-mr-2.5 flex shrink-0 gap-1 md:hidden">
                          {rowActions(url)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
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
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {url.clicks.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground lg:table-cell">
                      {created}
                    </TableCell>
                    <TableCell className="hidden pr-3 text-right md:table-cell">
                      {/* The negative margin lines the last icon up with the
                          column header. */}
                      <div className="-mr-2.5 flex justify-end gap-1">
                        {rowActions(url)}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
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
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isDeleting ? 'Deleting…' : 'Delete link'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
