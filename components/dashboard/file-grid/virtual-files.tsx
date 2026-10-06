import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { FileType } from '@/types/components/file'
import {
  type Range,
  defaultRangeExtractor,
  observeWindowOffset,
  useWindowVirtualizer,
  windowScroll,
} from '@tanstack/react-virtual'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'

import {
  TIMELINE_WINDOW_ROWS,
  bucketAt,
  bucketLabel,
  timelineLayout,
  timelineWindowStart,
} from '@/lib/files/timeline-layout'

import type { useFileTimeline } from '@/hooks/use-file-timeline'

import { DateRail } from './date-rail'
import { FileCardSkeleton } from './file-card-skeleton'

type Library = ReturnType<typeof useFileTimeline>

interface VirtualFilesProps {
  library: Library
  initialIndex: number
  chronological: boolean
  renderFile: (file: FileType) => ReactNode
  onVisibleFiles: (files: FileType[], firstIndex: number) => void
  onRefresh: () => void
  selectionBarRef: RefObject<HTMLDivElement>
}

export function VirtualFiles({
  library,
  initialIndex,
  chronological,
  renderFile,
  onVisibleFiles,
  onRefresh,
  selectionBarRef,
}: VirtualFilesProps) {
  'use no memo'
  // TanStack exposes a mutable instance. Compiler memoization would freeze its
  // measured sizes/ranges even when its internal scroll subscription rerenders.
  const { timeline, getFile, hasFailed, ensureRange, revision, retry } = library
  const container = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, columns: 1, top: 0 })
  const [focusedRow, setFocusedRow] = useState<number | null>(null)
  const initialized = useRef(false)
  const restoreIndex = useRef(initialIndex)
  const [windowOffset, setWindowStart] = useState(0)
  const pendingSeek = useRef<number | null>(null)
  const pendingScrollDelta = useRef<number | null>(null)
  const continuitySizes = useRef<{
    width: number
    columns: number
    rows: Map<number, number>
  } | null>(null)
  const seekDestination = useRef<number | null>(null)
  const position = useRef(initialIndex)
  const previousColumns = useRef(1)
  const observeOffset = useRef<
    ((offset: number, isScrolling: boolean) => void) | null
  >(null)
  const observeScroll = useCallback<typeof observeWindowOffset>(
    (instance, callback) => {
      observeOffset.current = callback
      const cleanup = observeWindowOffset(instance, callback)
      return () => {
        observeOffset.current = null
        cleanup?.()
      }
    },
    []
  )
  const scrollSync = useRef<number | null>(null)
  const synchronizeScroll = useCallback(() => {
    if (scrollSync.current !== null) cancelAnimationFrame(scrollSync.current)
    scrollSync.current = requestAnimationFrame(() => {
      scrollSync.current = null
      // Chromium can coalesce the native event while a large scroll section
      // is replaced. Publish the actual offset after the new DOM has committed.
      window.dispatchEvent(new Event('scroll'))
    })
  }, [])
  useEffect(
    () => () => {
      if (scrollSync.current !== null) cancelAnimationFrame(scrollSync.current)
    },
    []
  )
  const scrollTo = useCallback<typeof windowScroll>(
    (offset, options, instance) => {
      windowScroll(offset, options, instance)
      // A rebase moves the browser before its native scroll event arrives.
      // Publish absolute jumps immediately: otherwise row measurement can apply
      // a size correction to the old offset and undo the jump. Corrections
      // already update the virtualizer's offset, so leave those to its observer.
      // false avoids a synchronous React flush while layout effects are running.
      if (options.adjustments === undefined)
        observeOffset.current?.(window.scrollY, false)
      synchronizeScroll()
    },
    [synchronizeScroll]
  )
  const layout = useMemo(
    () =>
      timelineLayout(
        timeline!,
        dimensions.columns,
        timeline!.groupBy !== 'none'
      ),
    [timeline, dimensions.columns]
  )
  const windowStart = Math.min(
    windowOffset,
    Math.max(0, layout.rowCount - TIMELINE_WINDOW_ROWS)
  )
  const estimateSize = useCallback(
    (index: number) => {
      const remembered = continuitySizes.current
      const knownSize =
        remembered?.width === dimensions.width &&
        remembered.columns === dimensions.columns
          ? remembered.rows.get(index + windowStart)
          : undefined
      return (
        knownSize ??
        (layout.row(index + windowStart).heading
          ? 44
          : (dimensions.width - (dimensions.columns - 1) * 16) /
              dimensions.columns +
            118)
      )
    },
    [layout, dimensions, windowStart]
  )
  const topInset = Math.max(
    96,
    selectionBarRef.current?.getBoundingClientRect().bottom ?? 0
  )
  const virtualizer = useWindowVirtualizer({
    scrollToFn: scrollTo,
    observeElementOffset: observeScroll,
    count: Math.min(TIMELINE_WINDOW_ROWS, layout.rowCount - windowStart),
    getItemKey: useCallback(
      (index: number) => index + windowStart,
      [windowStart]
    ),
    estimateSize,
    overscan: 3,
    scrollMargin: dimensions.top,
    scrollPaddingStart: topInset,
    rangeExtractor: useCallback(
      (range: Range) => {
        const indices = defaultRangeExtractor(range)
        if (
          focusedRow !== null &&
          focusedRow >= windowStart &&
          focusedRow < windowStart + TIMELINE_WINDOW_ROWS &&
          focusedRow < layout.rowCount &&
          !indices.includes(focusedRow - windowStart)
        )
          indices.push(focusedRow - windowStart)
        return indices.sort((a, b) => a - b)
      },
      [focusedRow, layout.rowCount, windowStart]
    ),
  })

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const width = element.getBoundingClientRect().width
      const columns =
        window.innerWidth >= 1280
          ? 4
          : window.innerWidth >= 1024
            ? 3
            : window.innerWidth >= 640
              ? 2
              : 1
      const top = element.getBoundingClientRect().top + window.scrollY
      setDimensions((old) =>
        old.width === width &&
        old.columns === columns &&
        Math.abs(old.top - top) < 1
          ? old
          : { width, columns, top }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useLayoutEffect(() => {
    virtualizer.measure()
    // getOffsetForIndex reads the measurement cache directly. Rebuild it after
    // resetting sizes, before a pending seek uses the new section's coordinates.
    virtualizer.getTotalSize()
  }, [dimensions.width, dimensions.columns, windowStart, virtualizer])

  useLayoutEffect(() => {
    if (Math.abs((virtualizer.scrollOffset ?? 0) - window.scrollY) > 1)
      synchronizeScroll()
  })

  const seek = useCallback(
    (row: number) => {
      seekDestination.current = row
      pendingScrollDelta.current = null
      setFocusedRow(null)
      const nextStart = timelineWindowStart(row, layout.rowCount)
      if (row < windowStart || row >= windowStart + TIMELINE_WINDOW_ROWS) {
        pendingSeek.current = row
        setWindowStart(nextStart)
      } else {
        // A drag can return to this segment before an earlier seek commits.
        // Cancel that queued segment so the most recent pointer position wins.
        pendingSeek.current = null
        setWindowStart(windowStart)
        virtualizer.scrollToIndex(row - windowStart, {
          align: 'start',
          behavior: 'auto',
        })
      }
    },
    [layout.rowCount, windowStart, virtualizer]
  )

  useLayoutEffect(() => {
    if (pendingSeek.current === null) return
    const target = pendingSeek.current
    pendingSeek.current = null
    const delta = pendingScrollDelta.current
    pendingScrollDelta.current = null
    const offset = virtualizer.getOffsetForIndex(target - windowStart, 'start')
    if (delta !== null && offset) {
      // Native scrolling crosses sections without snapping the partially visible
      // first row to its top. Measurement corrections keep this pixel anchor.
      virtualizer.scrollToOffset(offset[0] + delta, { behavior: 'auto' })
    } else {
      virtualizer.scrollToIndex(target - windowStart, {
        align: 'start',
        behavior: 'auto',
      })
    }
  }, [windowStart, virtualizer])

  useLayoutEffect(() => {
    if (!dimensions.width) return
    if (!initialized.current) {
      initialized.current = true
      previousColumns.current = dimensions.columns
      if (restoreIndex.current > 0)
        seek(layout.rowAt(Math.min(timeline!.total - 1, restoreIndex.current)))
      else if (window.scrollY > dimensions.top)
        window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (previousColumns.current !== dimensions.columns) {
      previousColumns.current = dimensions.columns
      const target = layout.rowAt(
        Math.min(timeline!.total - 1, position.current)
      )
      pendingSeek.current = target
      pendingScrollDelta.current = null
      seekDestination.current = target
      const start = timelineWindowStart(target, layout.rowCount)
      if (start !== windowStart) setWindowStart(start)
      else {
        pendingSeek.current = null
        virtualizer.scrollToIndex(target - start, { align: 'start' })
      }
    }
  }, [
    dimensions,
    initialIndex,
    layout,
    timeline,
    seek,
    virtualizer,
    windowStart,
  ])

  const rows = virtualizer.getVirtualItems()
  const indices = rows.flatMap(
    (row) => layout.row(row.index + windowStart).indices
  )
  const rangeKey = indices.join(',')
  useEffect(() => {
    // Let fast scrubbing settle before asking the server for an intermediate date.
    const timer = window.setTimeout(
      () => ensureRange(rangeKey ? rangeKey.split(',').map(Number) : []),
      60
    )
    return () => window.clearTimeout(timer)
  }, [rangeKey, ensureRange, revision])

  const viewportTop = (virtualizer.scrollOffset ?? 0) + topInset
  const viewportBottom =
    (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 800)
  const visibleRows = rows.filter(
    (row) => row.end > viewportTop && row.start < viewportBottom
  )
  const firstRow = visibleRows[0] ?? rows[0]
  const firstRowIndex = firstRow?.index
  const lastVisibleRowIndex = visibleRows.at(-1)?.index
  const firstLayout = firstRow ? layout.row(firstRow.index + windowStart) : null
  const firstIndex =
    firstLayout?.heading?.offset ?? firstLayout?.indices[0] ?? 0
  useEffect(() => {
    position.current = firstIndex
  }, [firstIndex])
  // Recenter before either end of a large native-scroll window. The date rail
  // always addresses the full account; wheel/touch scrolling continues naturally.
  useEffect(() => {
    if (
      firstRowIndex === undefined ||
      pendingSeek.current !== null ||
      layout.rowCount <= TIMELINE_WINDOW_ROWS
    )
      return
    const globalRow = firstRowIndex + windowStart
    // A new segment renders once with the previous scroll offset. Wait until
    // the browser observes the requested destination before recentering again.
    if (seekDestination.current !== null) {
      if (
        globalRow <= seekDestination.current &&
        (lastVisibleRowIndex ?? firstRowIndex) + windowStart >=
          seekDestination.current
      ) {
        seekDestination.current = null
      }
      return
    }
    if (
      (firstRowIndex < 20 && windowStart > 0) ||
      (firstRowIndex > TIMELINE_WINDOW_ROWS - 20 &&
        windowStart + TIMELINE_WINDOW_ROWS < layout.rowCount)
    ) {
      // Keep just the mounted rows' measured sizes across the cache reset.
      // Falling back to estimates for these overlapping rows would otherwise
      // shift the pixel anchor while their replacement DOM is measured again.
      continuitySizes.current = {
        width: dimensions.width,
        columns: dimensions.columns,
        rows: new Map(rows.map((row) => [row.index + windowStart, row.size])),
      }
      pendingSeek.current = globalRow
      pendingScrollDelta.current = viewportTop - firstRow!.start
      seekDestination.current = globalRow
      setWindowStart(timelineWindowStart(globalRow, layout.rowCount))
    }
  }, [
    firstRowIndex,
    lastVisibleRowIndex,
    windowStart,
    layout.rowCount,
    viewportTop,
    firstRow,
    rows,
    dimensions.width,
    dimensions.columns,
  ])
  const visibleKey = visibleRows
    .flatMap((row) => layout.row(row.index + windowStart).indices)
    .join(',')
  useEffect(() => {
    onVisibleFiles(
      visibleKey
        .split(',')
        .filter(Boolean)
        .map(Number)
        .map(getFile)
        .filter((file): file is FileType => !!file),
      firstIndex
    )
  }, [visibleKey, firstIndex, getFile, onVisibleFiles, revision])

  const failed = indices.some(hasFailed)
  const loading = indices.some((index) => !getFile(index) && !hasFailed(index))
  const bucket = bucketAt(timeline!.buckets, firstIndex)
  const label = bucketLabel(bucket, timeline!.groupBy, timeline!.timezone)

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {failed
          ? 'Could not load some files. Retry or refresh the library.'
          : loading
            ? 'Loading files'
            : `Showing files near ${firstIndex + 1} of ${timeline!.total}`}
      </div>
      <div
        ref={container}
        role="list"
        aria-label="Your files"
        aria-busy={loading}
        className="relative mr-6 sm:mr-8"
        style={{ height: virtualizer.getTotalSize(), overflowAnchor: 'none' }}
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-row]'
          )
          if (row) setFocusedRow(Number(row.dataset.row))
        }}
      >
        {rows.map((row) => {
          const { heading, indices: rowIndices } = layout.row(
            row.index + windowStart
          )
          return (
            <div
              key={row.key}
              data-index={row.index}
              data-row={row.index + windowStart}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-4"
              style={{
                transform: `translateY(${row.start - dimensions.top}px)`,
              }}
            >
              {heading ? (
                <h2 className="flex h-7 items-center gap-3 text-sm font-medium text-muted-foreground">
                  {bucketLabel(heading, timeline!.groupBy, timeline!.timezone)}
                  <span className="text-xs font-normal text-muted-foreground/60">
                    {heading.count.toLocaleString()}
                  </span>
                </h2>
              ) : (
                <div
                  className="grid items-start gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${dimensions.columns}, minmax(0, 1fr))`,
                  }}
                >
                  {rowIndices.map((index) => {
                    const file = getFile(index)
                    return (
                      <div
                        key={file?.id ?? index}
                        role="listitem"
                        aria-posinset={index + 1}
                        aria-setsize={timeline!.total}
                        data-file-index={index}
                      >
                        {file ? renderFile(file) : <FileCardSkeleton />}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {failed &&
        createPortal(
          <div
            role="alert"
            className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-3rem)] max-w-md -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-background/95 p-3 text-sm shadow-lg backdrop-blur-xl"
          >
            <span>Couldn’t load these files.</span>
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              Refresh files
            </Button>
          </div>,
          document.body
        )}
      {chronological && layout.rowCount > 3 && (
        <DateRail
          label={label}
          firstLabel={bucketLabel(
            timeline!.buckets[0],
            'year',
            timeline!.timezone
          )}
          lastLabel={bucketLabel(
            timeline!.buckets[timeline!.buckets.length - 1],
            'year',
            timeline!.timezone
          )}
          row={(firstRow?.index ?? 0) + windowStart}
          rowCount={layout.rowCount}
          scrolling={virtualizer.isScrolling}
          onSeek={seek}
        />
      )}
      <p className="py-6 text-center text-xs text-muted-foreground">
        {timeline!.total.toLocaleString()}{' '}
        {timeline!.total === 1 ? 'file' : 'files'} ·{' '}
        {windowStart + TIMELINE_WINDOW_ROWS >= layout.rowCount
          ? 'You’re all caught up'
          : 'Continue scrolling'}
      </p>
    </>
  )
}
