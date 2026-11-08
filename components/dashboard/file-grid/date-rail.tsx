import { useRef, useState } from 'react'

import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

interface DateRailProps {
  label: string
  firstLabel: string
  lastLabel: string
  row: number
  rowCount: number
  scrolling: boolean
  contentTop: number
  rootFontSize: number
  navigationBottom: number
  compact: boolean
  viewportHeight: number
  onSeek: (row: number) => void
}

/** A visible edge lane beside the cards; native page scrolling stays available. */
export function DateRail({
  label,
  firstLabel,
  lastLabel,
  row,
  rowCount,
  scrolling,
  contentTop,
  rootFontSize,
  navigationBottom,
  compact,
  viewportHeight,
  onSeek,
}: DateRailProps) {
  const track = useRef<HTMLDivElement>(null)
  const dragOffset = useRef(0)
  const [hovered, setHovered] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragBounds, setDragBounds] = useState<{
    top: number
    height: number
  } | null>(null)
  const visible = hovered || keyboardFocused || dragging || scrolling
  const progress = Math.max(0, Math.min(1, row / Math.max(1, rowCount - 1)))
  const seek = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect) return
    const handleHeight =
      track.current
        ?.querySelector('[data-date-rail-handle]')
        ?.getBoundingClientRect().height ?? 44
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (clientY - rect.top - handleHeight / 2) /
          Math.max(1, rect.height - handleHeight)
      )
    )
    onSeek(Math.round(ratio * (rowCount - 1)))
  }
  if (typeof document === 'undefined') return null
  const expandedFeedback = rootFontSize > 20 && compact
  return createPortal(
    <>
      <div
        data-date-rail-expanded-text={expandedFeedback || undefined}
        className="fixed bottom-[18vh] right-0 z-30 w-[44px] sm:right-2"
        style={{
          // Seeking scrolls the header away. Keep the track under the finger
          // until release instead of changing its mapping during that seek.
          top:
            dragBounds?.top ??
            `max(8rem, 28vh, ${Math.max(0, contentTop + 8)}px)`,
          bottom: dragBounds ? 'auto' : undefined,
          height: dragBounds?.height,
          visibility:
            !dragBounds &&
            viewportHeight * 0.82 -
              Math.max(
                rootFontSize * 8,
                viewportHeight * 0.28,
                contentTop + 8
              ) <
              44
              ? 'hidden'
              : undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={track}
          data-date-rail-track=""
          role="slider"
          tabIndex={0}
          aria-label="Browse files by date"
          aria-orientation="vertical"
          aria-valuemin={1}
          aria-valuemax={rowCount}
          aria-valuenow={row + 1}
          aria-valuetext={label}
          className={cn(
            'relative h-full w-full touch-none cursor-ns-resize rounded-full outline-none',
            keyboardFocused && 'ring-2 ring-ring'
          )}
          onFocus={(event) => {
            setKeyboardFocused(event.currentTarget.matches(':focus-visible'))
          }}
          onBlur={() => {
            setKeyboardFocused(false)
          }}
          onKeyDown={(event) => {
            setKeyboardFocused(true)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? rowCount - 1
                  : event.key === 'ArrowDown' || event.key === 'ArrowRight'
                    ? row + 1
                    : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                      ? row - 1
                      : event.key === 'PageDown'
                        ? row + 10
                        : event.key === 'PageUp'
                          ? row - 10
                          : null
            if (next === null) return
            event.preventDefault()
            onSeek(Math.max(0, Math.min(rowCount - 1, next)))
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            const bounds = track.current?.getBoundingClientRect()
            if (bounds)
              setDragBounds({ top: bounds.top, height: bounds.height })
            event.currentTarget.focus({ preventScroll: true })
            setKeyboardFocused(false)
            event.currentTarget.setPointerCapture(event.pointerId)
            const handle = (event.target as Element)
              .closest('[data-date-rail-handle]')
              ?.getBoundingClientRect()
            dragOffset.current = handle
              ? event.clientY - (handle.top + handle.height / 2)
              : 0
            setDragging(true)
            if (!handle) seek(event.clientY)
          }}
          onPointerMove={(event) => {
            if (dragging) seek(event.clientY - dragOffset.current)
          }}
          onPointerUp={(event) => {
            setDragging(false)
            setDragBounds(null)
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            setDragging(false)
            setDragBounds(null)
          }}
          onLostPointerCapture={() => {
            setDragging(false)
            setDragBounds(null)
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-[14px] w-[16px] rounded-full border border-border bg-muted/70"
          />
          <div className="absolute bottom-[22px] left-1/2 top-[22px] w-[2px] -translate-x-1/2 bg-border" />
          <span
            data-date-rail-endpoint="first"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 -top-[16px] whitespace-nowrap text-center text-[10px] leading-[12px] text-muted-foreground transition-opacity motion-reduce:transition-none [@media(pointer:coarse)]:hidden',
              visible ? 'opacity-100' : 'opacity-0'
            )}
          >
            {firstLabel}
          </span>
          <span
            data-date-rail-endpoint="last"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 -bottom-[16px] whitespace-nowrap text-center text-[10px] leading-[12px] text-muted-foreground transition-opacity motion-reduce:transition-none [@media(pointer:coarse)]:hidden',
              visible ? 'opacity-100' : 'opacity-0'
            )}
          >
            {lastLabel}
          </span>
          <div
            data-date-rail-handle=""
            data-dragging={dragging || undefined}
            className="absolute left-0 flex h-[44px] w-[44px] -translate-y-1/2 items-center justify-center"
            style={{ top: `calc(22px + (100% - 44px) * ${progress})` }}
          >
            <div
              className={cn(
                'h-[28px] w-[6px] rounded-full transition-colors motion-reduce:transition-none',
                visible ? 'bg-primary/80' : 'bg-muted-foreground'
              )}
            />
            {!expandedFeedback && (
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-lg shadow-black/20 transition-opacity motion-reduce:transition-none',
                  visible ? 'opacity-100' : 'opacity-0',
                  // A touch drag focuses the slider too. Keep that pointer focus
                  // from leaving the bubble over file details after release.
                  !dragging &&
                    !keyboardFocused &&
                    '[@media(pointer:coarse)]:opacity-0'
                )}
              >
                {label}
              </div>
            )}
          </div>
        </div>
      </div>
      {expandedFeedback && (
        <div
          data-date-rail-feedback=""
          aria-hidden="true"
          className={cn(
            'pointer-events-none fixed inset-x-[16px] z-50 whitespace-nowrap rounded-lg border border-border bg-overlay p-[12px] text-center text-xs font-medium leading-4 text-popover-foreground shadow-lg',
            dragging || keyboardFocused ? 'opacity-100' : 'opacity-0'
          )}
          style={{ top: navigationBottom + 10 }}
        >
          {label}
        </div>
      )}
    </>,
    document.body
  )
}
