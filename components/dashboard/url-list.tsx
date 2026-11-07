'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import {
  type LinkSort,
  linkSortLabels,
  shortLinkListView,
} from '@/components/dashboard/url-list-model'
import { PermissionGate } from '@/components/roles/permission-gate'
import { MetaLine } from '@/components/shared/meta-line'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { type ShortLink, shortLinkUrl } from '@/lib/links/schema'

import { SessionScoped } from '@/hooks/use-account-query'
import { useToast } from '@/hooks/use-toast'

interface URLListProps {
  refreshTrigger?: number
  onUrlDeleted?: (shortCode: string) => void
}

function URLListLoading() {
  return (
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
  )
}

export function URLList(props: URLListProps) {
  return (
    <SessionScoped loading={<URLListLoading />}>
      {(scope) => <SessionURLList {...props} userId={scope.userId} />}
    </SessionScoped>
  )
}

function SessionURLList({
  refreshTrigger = 0,
  onUrlDeleted,
  userId,
}: URLListProps & { userId: string }) {
  const [urls, setUrls] = useState<ShortLink[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LinkSort>('newest')
  const searchId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const requestVersion = useRef(0)
  const active = useRef(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [origin, setOrigin] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ShortLink | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { toast } = useToast()
  const view = useMemo(
    () => shortLinkListView(urls, userId, query, sort, origin),
    [urls, userId, query, sort, origin]
  )
  const clearSearch = () => {
    setQuery('')
    searchRef.current?.focus()
  }
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const fetchUrls = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestVersion.current
    try {
      const data = await apiRequest<{ urls?: ShortLink[] }>('/api/urls', {
        signal,
      })
      if (!signal?.aborted && requestId === requestVersion.current) {
        setUrls(data.urls || [])
        setError('')
      }
    } catch (failure) {
      if (!signal?.aborted && requestId === requestVersion.current)
        setError(
          failure instanceof RefusedRequest || !(failure instanceof Error)
            ? 'Could not load your links. Please try again.'
            : failure.message
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

  const copyUrl = async (url: ShortLink) => {
    try {
      await navigator.clipboard.writeText(
        shortLinkUrl(url.shortCode, window.location.origin)
      )
      if (!active.current) return
      setCopiedId(url.id)
      toast({ title: 'Link copied' })
    } catch {
      if (!active.current) return
      toast({
        title: 'Could not copy link',
        description:
          'Use your browser’s link menu to copy the short link address.',
        variant: 'destructive',
      })
    }
  }

  const deleteUrl = async () => {
    if (!deleting || isDeleting) return
    setIsDeleting(true)
    try {
      await apiRequest(`/api/urls/${deleting.id}`, {
        method: 'DELETE',
        fallback: 'Your link is still available. Please try again.',
      })
      if (!active.current) return
      setUrls((previous) => previous.filter((url) => url.id !== deleting.id))
      onUrlDeleted?.(deleting.shortCode)
      setDeleting(null)
      toast({ title: 'Short link deleted' })
      void fetchUrls()
    } catch (error) {
      if (!active.current) return
      toast({
        title: 'Could not delete link',
        description:
          error instanceof RefusedRequest
            ? error.message
            : 'Your link is still available. Please try again.',
        variant: 'destructive',
      })
    } finally {
      if (active.current) setIsDeleting(false)
    }
  }

  const copyAction = (url: ShortLink) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
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
  )

  const deleteAction = (url: ShortLink) => (
    <PermissionGate permission="links.delete">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setDeleting(url)}
        aria-label={`Delete short link ${url.shortCode}`}
        title="Delete short link"
        className="shrink-0 text-muted-foreground hover:bg-danger/10 hover:text-destructive focus-visible:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </PermissionGate>
  )

  return (
    <>
      {isLoading ? (
        <URLListLoading />
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
      ) : view.total === 0 && !query ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No shortened URLs yet. Add a URL above to get started.
        </p>
      ) : (
        <div className="space-y-3">
          <div
            role="search"
            aria-label="Find a short link"
            className="space-y-1.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[7.5rem] flex-[1_1_7.5rem]">
                <Label htmlFor={searchId} className="sr-only">
                  Search links
                </Label>
                <Input
                  ref={searchRef}
                  id={searchId}
                  type="search"
                  placeholder="Search links"
                  value={query}
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-describedby={`${searchId}-help ${searchId}-count`}
                  className={`${query ? 'pr-11 ' : ''}[&::-webkit-search-cancel-button]:appearance-none`}
                />
                {query && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-0 top-1/2 h-8 w-9 -translate-y-1/2"
                    aria-label="Clear link search"
                    title="Clear search"
                    onClick={clearSearch}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
              <Select
                value={sort}
                onValueChange={(value) => setSort(value as LinkSort)}
              >
                <SelectTrigger
                  className="w-auto min-w-[7rem] shrink-0 gap-2 px-2"
                  aria-label={`Sort links: ${linkSortLabels[sort]}`}
                >
                  <SelectValue>
                    {sort === 'newest'
                      ? 'Newest'
                      : sort === 'oldest'
                        ? 'Oldest'
                        : 'Most clicks'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(linkSortLabels) as LinkSort[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {linkSortLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p
              id={`${searchId}-help`}
              className="text-xs text-muted-foreground"
            >
              Search your destinations and short codes.
            </p>
            <p
              id={`${searchId}-count`}
              role="status"
              className="text-xs text-muted-foreground"
            >
              {view.urls.length.toLocaleString()} of{' '}
              {view.total.toLocaleString()} links
            </p>
          </div>
          {view.urls.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-5">
              <p className="text-sm text-muted-foreground">
                No links match your search.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSearch}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              {/* The shareable path leads every row, with Copy beside it.
              Phones use the same hierarchy without a table-heading strip. */}
              <Table className="table-fixed" aria-label="Shortened URLs">
                <TableHeader className="hidden bg-muted/30 md:table-header-group">
                  <TableRow>
                    <TableHead className="pl-4">Link</TableHead>
                    <TableHead className="w-20 text-right">Clicks</TableHead>
                    <TableHead className="hidden w-28 text-right lg:table-cell">
                      Created
                    </TableHead>
                    <TableHead className="w-16 pr-4 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.urls.map((url) => {
                    const created = new Date(url.createdAt).toLocaleDateString()
                    return (
                      <TableRow key={url.id}>
                        <TableCell className="py-3 pl-4 pr-3 md:pr-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <a
                                href={shortLinkUrl(url.shortCode)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={shortLinkUrl(url.shortCode, origin)}
                                className="min-w-0 truncate rounded-sm font-mono font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {shortLinkUrl(url.shortCode)}
                              </a>
                              {copyAction(url)}
                            </div>
                            <div className="-mr-1.5 shrink-0 md:hidden">
                              {deleteAction(url)}
                            </div>
                          </div>
                          <a
                            href={url.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={url.targetUrl}
                            className="mt-1 block break-all rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:[@media(hover:hover)_and_(pointer:fine)]:truncate"
                          >
                            {url.targetUrl}
                          </a>
                          <MetaLine
                            className="mt-1 text-xs text-muted-foreground lg:hidden"
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
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {url.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground lg:table-cell">
                          {created}
                        </TableCell>
                        <TableCell className="hidden pr-4 text-right md:table-cell">
                          <div className="-mr-1.5 flex justify-end">
                            {deleteAction(url)}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
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
                {shortLinkUrl(deleting?.shortCode ?? '', origin)}
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
