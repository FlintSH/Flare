import { useEffect, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, RefreshCw, ScanText } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { apiRequest } from '@/lib/client/request'
import { LIBRARY_LISTS, libraryChanged } from '@/lib/library/changes'
import type { IndexFilter } from '@/lib/library/contract'
import type { SearchIndexSummary } from '@/lib/search/contract'

import { useAccountQuery } from '@/hooks/use-account-query'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { toast } from '@/hooks/use-toast'

const count = (value: number, one: string, many = `${one}s`) =>
  `${value.toLocaleString()} ${value === 1 ? one : many}`

const linkClassName =
  'rounded-sm underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * One line under the search box: how much of the library search has read,
 * what is still being read, and what couldn't be, with a way to see those
 * files and try them again. Shown while searching, filtering by index status,
 * reading, or after a failure.
 */
export function SearchIndexStatus({
  search,
  index,
  onShowIndex,
}: {
  /** The current search; new results reset the update prompt. */
  search: string
  index: IndexFilter[]
  onShowIndex: (index: IndexFilter[]) => void
}) {
  const searching = !!search.trim()
  const client = useQueryClient()
  const lifetime = useRequestLifetime()
  const [retrying, setRetrying] = useState(false)
  const { data } = useAccountQuery<SearchIndexSummary>(
    LIBRARY_LISTS.searchIndex,
    '/api/files/search-index',
    {
      retry: false,
      // Follow progress while files are being read.
      refetchInterval: (query) =>
        query.state.data?.counts.waiting ? 4000 : false,
    }
  )
  // Files read since these results loaded may match too.
  const [readSinceResults, setReadSinceResults] = useState(false)
  const lastWaiting = useRef<number | null>(null)
  useEffect(() => {
    const waiting = data?.counts.waiting ?? null
    if (
      searching &&
      waiting !== null &&
      lastWaiting.current !== null &&
      waiting < lastWaiting.current
    )
      setReadSinceResults(true)
    lastWaiting.current = waiting
  }, [data, searching])
  useEffect(() => setReadSinceResults(false), [search])

  if (!data?.total) return null
  const { waiting, failed, skipped, indexed } = data.counts
  if (!searching && !index.length && !waiting && !failed) return null

  const retry = async () => {
    const { signal } = lifetime.current
    setRetrying(true)
    try {
      const { queued } = await apiRequest<{ queued: number }>(
        '/api/files/search-index',
        { body: { failed: true }, signal }
      )
      if (signal.aborted) return
      toast({
        title: queued ? 'Reading files again' : 'Nothing to read again',
        description: queued
          ? `Flare will try ${count(queued, 'file')} again in the background.`
          : 'Those files are already waiting to be read.',
      })
      // Keep the files in view while they wait to be read again.
      if (queued && !index.includes('waiting'))
        onShowIndex([...index, 'waiting'])
      await libraryChanged(client)
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t read files again',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      if (!signal.aborted) setRetrying(false)
    }
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {waiting ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Reading {count(waiting, 'file')} for search
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <ScanText aria-hidden="true" className="h-3.5 w-3.5" />
          Text read from {indexed.toLocaleString()} of{' '}
          {count(data.total, 'file')}
        </span>
      )}
      {failed > 0 && !index.includes('failed') && (
        <button
          type="button"
          className={`${linkClassName} inline-flex items-center gap-1 text-destructive`}
          onClick={() => onShowIndex(['failed'])}
        >
          <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
          {count(failed, 'file')} couldn’t be read
        </button>
      )}
      {skipped > 0 &&
        !index.includes('skipped') &&
        (searching || index.length > 0) && (
          <button
            type="button"
            className={linkClassName}
            title={
              !data.reads.imageText || !data.reads.documents
                ? 'Some reading is turned off on this instance'
                : 'Too large to read'
            }
            onClick={() => onShowIndex(['skipped'])}
          >
            {count(skipped, 'file')} skipped
          </button>
        )}
      {index.includes('failed') && failed > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-lg text-xs"
          disabled={retrying}
          onClick={() => void retry()}
        >
          <RefreshCw
            className={`mr-1.5 h-3 w-3 ${retrying ? 'animate-spin' : ''}`}
          />
          Try reading them again
        </Button>
      )}
      {readSinceResults && (
        <button
          type="button"
          className={linkClassName}
          onClick={() => {
            setReadSinceResults(false)
            void libraryChanged(client)
          }}
        >
          More files were read. Update results
        </button>
      )}
    </p>
  )
}
