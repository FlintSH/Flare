'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  Link2,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'

import { WorkspacePanel } from '@/components/dashboard/page-shell'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [origin, setOrigin] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ShortenedUrl | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { toast } = useToast()

  const fetchUrls = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/urls', { signal })
      if (!response.ok)
        throw new Error('Could not load your links. Please try again.')
      const data = await response.json()
      if (!signal?.aborted) {
        setUrls(data.data?.urls || [])
        setError('')
      }
    } catch (failure) {
      if (!signal?.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not load your links. Please try again.'
        )
    } finally {
      if (!signal?.aborted) setIsLoading(false)
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

  const query = search.trim().toLowerCase()
  const filteredUrls = urls.filter((url) =>
    `${url.targetUrl} ${origin}/u/${url.shortCode}`
      .toLowerCase()
      .includes(query)
  )
  const totalClicks = urls.reduce((total, url) => total + url.clicks, 0)

  return (
    <>
      <WorkspacePanel
        title="Your links"
        description="Find a destination, copy a link, or see how often it has been opened."
        action={
          !isLoading && !error ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                {urls.length.toLocaleString()}{' '}
                {urls.length === 1 ? 'link' : 'links'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5" />
                {totalClicks.toLocaleString()} total clicks
              </span>
            </div>
          ) : undefined
        }
      >
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading short links"
            className="space-y-3"
          >
            <span className="sr-only">Loading short links…</span>
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-3 rounded-xl border p-5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-10 text-center"
          >
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm">{error}</p>
            <Button
              variant="outline"
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
          <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border bg-background">
              <Link2 className="h-5 w-5 text-primary" />
            </span>
            <h3 className="mt-4 font-semibold">
              Your next great link starts here
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Create your first short link above. Its destination and click
              count will appear here.
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => document.getElementById('url')?.focus()}
            >
              Create your first link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search your links"
                placeholder="Search by destination or short link…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            {filteredUrls.length === 0 ? (
              <div className="rounded-xl border border-dashed px-6 py-10 text-center">
                <h3 className="text-sm font-medium">No matching links</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try a different address or short code.
                </p>
                <Button
                  variant="ghost"
                  className="mt-3"
                  onClick={() => setSearch('')}
                >
                  Clear search
                </Button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <div className="hidden grid-cols-[minmax(0,1fr)_80px_110px_150px] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground lg:grid">
                  <span>Link & destination</span>
                  <span className="text-right">Clicks</span>
                  <span>Created</span>
                  <span className="text-right">Actions</span>
                </div>
                <ul className="divide-y">
                  {filteredUrls.map((url) => (
                    <li
                      key={url.id}
                      className="grid min-w-0 items-center gap-4 p-4 transition-colors hover:bg-muted/20 sm:p-5 lg:grid-cols-[minmax(0,1fr)_80px_110px_150px]"
                    >
                      <div className="min-w-0">
                        <a
                          href={`/u/${url.shortCode}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-2 rounded text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          title={`${origin}/u/${url.shortCode}`}
                        >
                          <span className="truncate">
                            {origin.replace(/^https?:\/\//, '')}/u/
                            {url.shortCode}
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                        </a>
                        <p
                          className="mt-1.5 truncate text-xs text-muted-foreground"
                          title={url.targetUrl}
                        >
                          {url.targetUrl}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm tabular-nums lg:justify-end">
                        <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground lg:hidden" />
                        <span>{url.clicks.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground lg:hidden">
                          clicks
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <span className="lg:hidden">Created </span>
                        {new Date(url.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <div className="flex items-center gap-1 lg:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyUrl(url)}
                          aria-label={`Copy short link ${url.shortCode}`}
                        >
                          {copiedId === url.id ? (
                            <Check className="mr-2 h-3.5 w-3.5" />
                          ) : (
                            <Copy className="mr-2 h-3.5 w-3.5" />
                          )}
                          {copiedId === url.id ? 'Copied' : 'Copy'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(url)}
                          aria-label={`Delete short link ${url.shortCode}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground" role="status">
              {filteredUrls.length.toLocaleString()} of{' '}
              {urls.length.toLocaleString()}{' '}
              {urls.length === 1 ? 'link' : 'links'}
              {query ? ' match your search' : ''}
            </p>
          </div>
        )}
      </WorkspacePanel>
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
          <AlertDialogFooter className="mt-6">
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
