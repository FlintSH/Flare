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
import { createPortal, flushSync } from 'react-dom'

import {
  type FileMenuSide,
  fileCardHeight,
  fileCardMenuSide,
} from '@/components/dashboard/file-card/layout'
import { Button } from '@/components/ui/button'

import {
  TIMELINE_WINDOW_ROWS,
  bucketAt,
  bucketLabel,
  timelineLayout,
  timelineWindowStart,
} from '@/lib/library/timeline-layout'
import { type LibraryView, libraryColumns } from '@/lib/library/view'

import type { useFileTimeline } from '@/hooks/use-file-timeline'

import { DateRail } from './date-rail'
import { FileCardSkeleton } from './file-card-skeleton'

type Library = ReturnType<typeof useFileTimeline>

interface VirtualFilesProps {
  library: Library
  view: LibraryView
  viewChangeRef: RefObject<(() => void) | null>
  initialIndex: number
  chronological: boolean
  renderFile: (file: FileType, menuSide: FileMenuSide) => ReactNode
  onVisibleFiles: (files: FileType[], firstIndex: number) => void
  onRefresh: () => void
  selectionBarRef: RefObject<HTMLDivElement | null>
}

export function VirtualFiles({
  library,
  view,
  viewChangeRef,
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
  const rowElements = useRef(new Set<HTMLDivElement>())
  const rowObserver = useRef<ResizeObserver | null>(null)
  const [dimensions, setDimensions] = useState({
    width: 0,
    columns: 1,
    top: 0,
    scale: 1,
    cardHeight: fileCardHeight(true, false, 1, view),
    view,
    compact: true,
    menuSide: 'bottom' as FileMenuSide,
  })
  const [focusedFile, setFocusedFile] = useState<number | null>(null)
  const initialized = useRef(false)
  const restoreIndex = useRef(initialIndex)
  const [windowOffset, setWindowStart] = useState(0)
  const pendingSeek = useRef<number | null>(null)
  const pendingScrollDelta = useRef<number | null>(null)
  const continuitySizes = useRef<{
    width: number
    columns: number
    cardHeight: number
    view: LibraryView
    rows: Map<number, number>
  } | null>(null)
  const seekDestination = useRef<number | null>(null)
  const position = useRef(initialIndex)
  const previousSize = useRef({ width: 0, columns: 1, cardHeight: 0, view })
  const observeOffset = useRef<
    ((offset: number, isScrolling: boolean) => void) | null
  >(null)
  const observedLeadingRowKey = useRef<string | null>(null)
  const [, setVisibleRowRevision] = useState(0)
  const observeScroll = useCallback<typeof observeWindowOffset>(
    (instance, callback) => {
      const previousAdjustment =
        instance.shouldAdjustScrollPositionOnItemSizeChange
      const adjustForInset: NonNullable<typeof previousAdjustment> = (
        item,
        _delta,
        current
      ) => {
        // Fixed controls move the usable viewport fold below the raw offset.
        // Keep core's first/remeasured distinction at that fold, including
        // upward motion; a remeasured row spanning the fold is not adjusted.
        const fold =
          (current.scrollOffset ?? 0) +
          current.scrollAdjustments +
          current.options.scrollPaddingStart
        return current.itemSizeCache.has(item.key)
          ? item.end <= fold
          : item.start < fold
      }
      instance.shouldAdjustScrollPositionOnItemSizeChange = adjustForInset
      const publishOffset = (offset: number, isScrolling: boolean) => {
        const publish = () => {
          callback(offset, isScrolling)
          // TanStack notifies for its raw viewport range. Our visible range starts
          // below the fixed header, so its leading row can change independently.
          const currentOffset = instance.scrollOffset ?? offset
          const top = currentOffset + instance.options.scrollPaddingStart
          const bottom = currentOffset + (instance.scrollRect?.height ?? 800)
          const items = instance.getVirtualItems()
          const first =
            items.find((row) => row.end > top && row.start < bottom) ?? items[0]
          const key = first ? String(first.key) : null
          if (observedLeadingRowKey.current !== key) {
            observedLeadingRowKey.current = key
            setVisibleRowRevision((revision) => revision + 1)
          }
        }
        // Native scroll callbacks and the scheduled scroll event run outside
        // React commits. Immediate programmatic/layout publications use false.
        if (isScrolling) flushSync(publish)
        else publish()
      }
      observeOffset.current = publishOffset
      const cleanup = observeWindowOffset(instance, publishOffset)
      return () => {
        observeOffset.current = null
        cleanup?.()
        if (
          instance.shouldAdjustScrollPositionOnItemSizeChange === adjustForInset
        )
          instance.shouldAdjustScrollPositionOnItemSizeChange =
            previousAdjustment
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
  const focusedRow = focusedFile === null ? null : layout.rowAt(focusedFile)
  const windowStart = Math.min(
    windowOffset,
    Math.max(0, layout.rowCount - TIMELINE_WINDOW_ROWS)
  )
  const estimateSize = useCallback(
    (index: number) => {
      const remembered = continuitySizes.current
      const knownSize =
        remembered?.width === dimensions.width &&
        remembered.columns === dimensions.columns &&
        remembered.cardHeight === dimensions.cardHeight &&
        remembered.view === view
          ? remembered.rows.get(index + windowStart)
          : undefined
      // Use image-card estimates before a row is measured. Generic rows can
      // be shorter; include touch metadata and spacing in the initial estimate.
      return (
        knownSize ??
        (layout.row(index + windowStart).heading
          ? 44 * dimensions.scale
          : dimensions.cardHeight + 16 * dimensions.scale)
      )
    },
    [layout, dimensions, windowStart, view]
  )
  const navigation =
    typeof document === 'undefined'
      ? null
      : document.querySelector('[aria-label="Main navigation"]')
  const headerBottom =
    navigation?.closest('header')?.getBoundingClientRect().bottom ?? 0
  const navigationBottom = navigation?.getBoundingClientRect().bottom ?? 58
  const topInset = Math.max(
    96,
    headerBottom + 16,
    selectionBarRef.current?.getBoundingClientRect().bottom ?? 0
  )
  const virtualizer = useWindowVirtualizer({
    // Commit-time resizeItem calls must not cause an adapter flushSync inside
    // React. Native offset and ResizeObserver callbacks flush their own batches.
    useFlushSync: false,
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

  // A single measurement owner supplies actual row sizes. Core measureElement
  // intentionally defers native-scroll reads; a content commit must measure its
  // skeleton-to-card change before paint instead of waiting for the next RO turn.
  const measureRow = useCallback(
    (element: HTMLDivElement, entry?: ResizeObserverEntry) => {
      if (!element.isConnected) return
      const index = Number(element.dataset.index)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= virtualizer.options.count
      )
        return
      const height = Math.round(
        entry?.borderBoxSize?.[0]?.blockSize ??
          element.getBoundingClientRect().height
      )
      // Reading the public item view first incorporates earlier size changes
      // before resizeItem evaluates the next row's native-anchor correction.
      const item = virtualizer
        .getVirtualItems()
        .find((row) => row.index === index)
      if (item?.size !== height) virtualizer.resizeItem(index, height)
    },
    [virtualizer]
  )
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      rowElements.current.add(element)
      rowObserver.current?.observe(element, { box: 'border-box' })
      measureRow(element)
      return () => {
        rowObserver.current?.unobserve(element)
        rowElements.current.delete(element)
      }
    },
    [measureRow]
  )
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      // ResizeObserver delivery is outside React; update all affected transforms
      // in the same batch as any native-anchor correction before browser paint.
      flushSync(() => {
        for (const entry of entries)
          measureRow(entry.target as HTMLDivElement, entry)
      })
    })
    rowObserver.current = observer
    for (const element of rowElements.current)
      observer.observe(element, { box: 'border-box' })
    return () => {
      rowObserver.current = null
      observer.disconnect()
    }
  }, [measureRow])

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const pointer = window.matchMedia('(pointer: coarse)')
    const measure = () => {
      const width = element.getBoundingClientRect().width
      const columns = libraryColumns(view, window.innerWidth)
      const compact = window.innerWidth < 640
      const top = element.getBoundingClientRect().top + window.scrollY
      const scale =
        parseFloat(getComputedStyle(document.documentElement).fontSize) / 16
      const menuSide = fileCardMenuSide(window.innerWidth, scale * 16)
      const cardHeight = fileCardHeight(
        window.innerWidth < 640,
        pointer.matches,
        scale,
        view
      )
      setDimensions((old) =>
        old.width === width &&
        old.columns === columns &&
        old.cardHeight === cardHeight &&
        old.view === view &&
        old.compact === compact &&
        old.menuSide === menuSide &&
        Math.abs(old.top - top) < 1
          ? old
          : { width, columns, top, cardHeight, scale, view, compact, menuSide }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    window.addEventListener('resize', measure)
    pointer.addEventListener('change', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      pointer.removeEventListener('change', measure)
    }
  }, [view])

  useLayoutEffect(() => {
    virtualizer.measure()
    // Rebuild the reset measurement view, then seed it from the connected DOM
    // before computing seek offsets. Rows need not produce another RO entry.
    virtualizer.getTotalSize()
    container.current
      ?.querySelectorAll<HTMLDivElement>('[data-index]')
      .forEach((element) => measureRow(element))
    // getOffsetForIndex reads the measurement cache directly. Rebuild it after
    // resetting sizes, before a pending seek uses the new section's coordinates.
    virtualizer.getTotalSize()
  }, [
    dimensions.width,
    dimensions.columns,
    dimensions.cardHeight,
    dimensions.view,
    windowStart,
    virtualizer,
    measureRow,
  ])

  useLayoutEffect(() => {
    // A loaded page can shrink a retained skeleton while native scrolling is
    // active. Publish its actual row size in this commit, before paint.
    container.current
      ?.querySelectorAll<HTMLDivElement>('[data-index]')
      .forEach((element) => measureRow(element))
  }, [dimensions, revision, virtualizer, virtualizer.isScrolling, measureRow])

  useLayoutEffect(() => {
    if (Math.abs((virtualizer.scrollOffset ?? 0) - window.scrollY) > 1)
      synchronizeScroll()
  })

  const seek = useCallback(
    (row: number) => {
      seekDestination.current = row
      pendingScrollDelta.current = null
      setFocusedFile(null)
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
  const seekFromControl = useCallback(
    (row: number) => {
      // A rail event moves the browser immediately. Commit its new range before
      // paint, rather than briefly leaving the previous rows outside the viewport.
      // Layout-effect rebases keep the asynchronous observer path above.
      flushSync(() => seek(row))
    },
    [seek]
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
      previousSize.current = dimensions
      if (restoreIndex.current > 0)
        seek(layout.rowAt(Math.min(timeline!.total - 1, restoreIndex.current)))
      else if (window.scrollY > dimensions.top)
        window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (
      previousSize.current.columns !== dimensions.columns ||
      previousSize.current.width !== dimensions.width ||
      previousSize.current.cardHeight !== dimensions.cardHeight ||
      previousSize.current.view !== dimensions.view
    ) {
      previousSize.current = dimensions
      // At the page top, keep the toolbar in view instead of aligning file zero
      // beneath navigation after a layout change.
      if (window.scrollY === 0 && position.current === 0) return
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
  const firstRowKey = firstRow ? String(firstRow.key) : null
  useLayoutEffect(() => {
    // A normal TanStack render may already have published this leading row.
    observedLeadingRowKey.current = firstRowKey
  }, [firstRowKey])
  const firstRowIndex = firstRow?.index
  const lastVisibleRowIndex = visibleRows.at(-1)?.index
  const firstLayout = firstRow ? layout.row(firstRow.index + windowStart) : null
  const firstIndex =
    firstLayout?.heading?.offset ?? firstLayout?.indices[0] ?? 0
  useEffect(() => {
    position.current = firstIndex
  }, [firstIndex])
  useLayoutEffect(() => {
    const prepare = () => {
      position.current = firstIndex
    }
    viewChangeRef.current = prepare
    return () => {
      if (viewChangeRef.current === prepare) viewChangeRef.current = null
    }
  }, [firstIndex, viewChangeRef])
  // Recenter before either end of a large native-scroll window. The date rail
  // always addresses the full account; wheel/touch scrolling continues naturally.
  useEffect(() => {
    // Layout measurements may have replaced the rows captured by this render.
    // Carry one fresh size/offset snapshot into the next virtual window.
    const currentRows = virtualizer.getVirtualItems()
    const currentOffset = virtualizer.scrollOffset ?? 0
    const currentTop = currentOffset + topInset
    const currentBottom =
      currentOffset + (virtualizer.scrollRect?.height ?? 800)
    const currentVisible = currentRows.filter(
      (row) => row.end > currentTop && row.start < currentBottom
    )
    const currentFirst = currentVisible[0] ?? currentRows[0]
    // A superseded effect must not mix a new segment with its old window.
    if (currentFirst && currentFirst.key !== currentFirst.index + windowStart)
      return
    const currentFirstIndex = currentFirst?.index
    const currentLastIndex = currentVisible.at(-1)?.index
    if (
      currentFirstIndex === undefined ||
      pendingSeek.current !== null ||
      layout.rowCount <= TIMELINE_WINDOW_ROWS
    )
      return
    const globalRow = currentFirstIndex + windowStart
    // A new segment renders once with the previous scroll offset. Wait until
    // the browser observes the requested destination before recentering again.
    if (seekDestination.current !== null) {
      if (
        globalRow <= seekDestination.current &&
        (currentLastIndex ?? currentFirstIndex) + windowStart >=
          seekDestination.current
      ) {
        seekDestination.current = null
      }
      return
    }
    if (
      (currentFirstIndex < 20 && windowStart > 0) ||
      (currentFirstIndex > TIMELINE_WINDOW_ROWS - 20 &&
        windowStart + TIMELINE_WINDOW_ROWS < layout.rowCount)
    ) {
      // Keep just the mounted rows' measured sizes across the cache reset.
      // Falling back to estimates for these overlapping rows would otherwise
      // shift the pixel anchor while their replacement DOM is measured again.
      continuitySizes.current = {
        width: dimensions.width,
        columns: dimensions.columns,
        cardHeight: dimensions.cardHeight,
        view,
        rows: new Map(
          currentRows.map((row) => [row.index + windowStart, row.size])
        ),
      }
      pendingSeek.current = globalRow
      pendingScrollDelta.current = currentTop - currentFirst!.start
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
    dimensions.cardHeight,
    view,
    topInset,
    virtualizer,
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
  const hasDateRail = chronological && layout.rowCount > 3

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
        className={
          hasDateRail ? 'relative mr-[28px] min-[1360px]:mr-0' : 'relative'
        }
        style={{ height: virtualizer.getTotalSize(), overflowAnchor: 'none' }}
        onFocusCapture={(event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-file-index]'
          )
          if (item) setFocusedFile(Number(item.dataset.fileIndex))
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
              ref={rowRef}
              className="absolute left-0 top-0 w-full pb-4"
              style={{
                transform: `translateY(${row.start - dimensions.top}px)`,
              }}
            >
              {heading ? (
                <h2 className="flex h-7 items-center gap-3 text-sm font-medium text-muted-foreground">
                  {bucketLabel(heading, timeline!.groupBy, timeline!.timezone)}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
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
                        {file ? (
                          renderFile(file, dimensions.menuSide)
                        ) : (
                          <FileCardSkeleton view={view} />
                        )}
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
      {hasDateRail && (
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
          contentTop={dimensions.top - (virtualizer.scrollOffset ?? 0)}
          rootFontSize={dimensions.scale * 16}
          navigationBottom={navigationBottom}
          compact={dimensions.compact}
          viewportHeight={virtualizer.scrollRect?.height ?? 0}
          onSeek={seekFromControl}
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
