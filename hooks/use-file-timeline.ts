import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileFilterOptions, FileType } from '@/types/components/file'

import { fileQuery } from '@/lib/files/gallery'
import {
  type FileTimeline,
  TIMELINE_CACHE_PAGES,
  TIMELINE_PAGE_SIZE,
  bucketAt,
  timelinePage,
} from '@/lib/files/timeline-layout'

export function useFileTimeline(
  filters: FileFilterOptions,
  refreshKey: number
) {
  const [result, setResult] = useState<{
    key: string
    data: FileTimeline
  } | null>(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const pages = useRef(new Map<string, FileType[]>())
  const failures = useRef(new Set<string>())
  const pending = useRef(new Map<string, AbortController>())
  const generation = useRef(0)
  const requiredKeys = useRef(new Set<string>())
  const query = fileQuery(filters, 1).toString()
  const grouping = filters.groupBy
  // Legacy page links still restore their position when browser history changes
  // only page. A fresh result remounts the virtual viewport at that anchor.
  const resultKey = `${query}|${grouping}|${filters.page}|${refreshKey}`
  const timeline = result?.key === resultKey ? result.data : null

  useEffect(() => {
    const controller = new AbortController()
    const activeRequests = pending.current
    generation.current++
    activeRequests.forEach((request) => request.abort())
    activeRequests.clear()
    pages.current.clear()
    failures.current.clear()
    requiredKeys.current.clear()
    setResult(null)
    setError(false)
    const params = new URLSearchParams(query)
    params.set('groupBy', grouping)
    params.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
    void fetch(`/api/files/timeline?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the library')
        const result = await response.json()
        if (!controller.signal.aborted)
          setResult({ key: resultKey, data: result.data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => {
      controller.abort()
      activeRequests.forEach((request) => request.abort())
    }
  }, [query, grouping, refreshKey, resultKey])

  const ensureRange = useCallback(
    (indices: number[]) => {
      if (!timeline) return
      const required = new Map(
        indices
          .filter(
            (index) =>
              Number.isSafeInteger(index) &&
              index >= 0 &&
              index < timeline.total
          )
          .map((index) => {
            const request = timelinePage(
              bucketAt(timeline.buckets, index),
              index
            )
            return [request.key, request] as const
          })
      )
      requiredKeys.current = new Set(required.keys())
      // Rapid scrubbing never queues an account's worth of abandoned requests.
      pending.current.forEach((request, key) => {
        if (!required.has(key)) {
          request.abort()
          pending.current.delete(key)
        }
      })
      required.forEach(({ key, bucket, page }) => {
        const cached = pages.current.get(key)
        if (cached) {
          pages.current.delete(key)
          pages.current.set(key, cached)
          return
        }
        if (
          pending.current.has(key) ||
          failures.current.has(key) ||
          pending.current.size >= 4
        )
          return
        const controller = new AbortController()
        const started = generation.current
        pending.current.set(key, controller)
        const params = new URLSearchParams(query)
        params.set('page', String(page))
        params.set('limit', String(TIMELINE_PAGE_SIZE))
        params.set('snapshot', timeline.snapshot)
        if (bucket.from && bucket.to) {
          params.set(
            'dateFrom',
            new Date(
              Math.max(
                Date.parse(bucket.from),
                filters.dateFrom ? Date.parse(filters.dateFrom) : -Infinity
              )
            ).toISOString()
          )
          params.set(
            'dateTo',
            new Date(
              Math.min(
                Date.parse(bucket.to) - 1,
                filters.dateTo ? Date.parse(filters.dateTo) : Infinity
              )
            ).toISOString()
          )
        }
        void fetch(`/api/files?${params}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok)
              throw new Error('Could not load this part of the library')
            const result = await response.json()
            if (controller.signal.aborted || generation.current !== started)
              return
            const expected = Math.min(
              TIMELINE_PAGE_SIZE,
              bucket.count - (page - 1) * TIMELINE_PAGE_SIZE
            )
            if (!Array.isArray(result.data) || result.data.length !== expected)
              throw new Error('The library changed. Refresh to continue.')
            pages.current.set(key, result.data)
            while (pages.current.size > TIMELINE_CACHE_PAGES) {
              const evict = [...pages.current.keys()].find(
                (entry) => !requiredKeys.current.has(entry)
              )
              if (!evict) break
              pages.current.delete(evict)
            }
          })
          .catch(() => {
            if (!controller.signal.aborted && generation.current === started)
              failures.current.add(key)
          })
          .finally(() => {
            if (pending.current.get(key) === controller)
              pending.current.delete(key)
            if (!controller.signal.aborted && generation.current === started)
              setRevision((value) => value + 1)
          })
      })
    },
    [timeline, query, filters.dateFrom, filters.dateTo]
  )

  const getFile = useCallback(
    (index: number) => {
      if (!timeline) return undefined
      const bucket = bucketAt(timeline.buckets, index)
      const { key } = timelinePage(bucket, index)
      return pages.current.get(key)?.[
        (index - bucket.offset) % TIMELINE_PAGE_SIZE
      ]
    },
    [timeline]
  )
  const hasFailed = useCallback(
    (index: number) => {
      if (!timeline) return false
      return failures.current.has(
        timelinePage(bucketAt(timeline.buckets, index), index).key
      )
    },
    [timeline]
  )
  const retry = useCallback(() => {
    failures.current.clear()
    setRevision((value) => value + 1)
  }, [])

  return {
    timeline,
    error,
    isLoading: !timeline && !error,
    revision,
    getFile,
    hasFailed,
    ensureRange,
    retry,
  }
}
