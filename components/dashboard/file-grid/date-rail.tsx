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
  onSeek: (row: number) => void
}

/** A quiet companion to the native scrollbar; never intercepts page scrolling. */
export function DateRail({
  label,
  firstLabel,
  lastLabel,
  row,
  rowCount,
  scrolling,
  onSeek,
}: DateRailProps) {
  const track = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const visible = hovered || focused || dragging || scrolling
  const progress = row / Math.max(1, rowCount - 1)
  const seek = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = Math.max(
      0,
      Math.min(1, (clientY - rect.top - 14) / (rect.height - 28))
    )
    onSeek(Math.round(ratio * (rowCount - 1)))
  }
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed bottom-[18vh] right-0 top-[max(8rem,28vh)] z-30 w-10 sm:right-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Browse files by date"
        aria-orientation="vertical"
        aria-valuemin={1}
        aria-valuemax={rowCount}
        aria-valuenow={row + 1}
        aria-valuetext={label}
        className="relative h-full w-full touch-none cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
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
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          seek(event.clientY)
        }}
        onPointerMove={(event) => {
          if (dragging) seek(event.clientY)
        }}
        onPointerUp={(event) => {
          setDragging(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
      >
        <div
          className={cn(
            'absolute bottom-3.5 left-1/2 top-3.5 w-px -translate-x-1/2 bg-border transition-opacity motion-reduce:transition-none',
            visible ? 'opacity-100' : 'opacity-30'
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-10 top-0 whitespace-nowrap text-[10px] text-muted-foreground transition-opacity motion-reduce:transition-none',
            visible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {firstLabel}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-0 right-10 whitespace-nowrap text-[10px] text-muted-foreground transition-opacity motion-reduce:transition-none',
            visible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {lastLabel}
        </span>
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: `calc(14px + (100% - 28px) * ${progress})` }}
        >
          <div
            className={cn(
              'h-7 w-1 -translate-y-1/2 rounded-full transition-colors motion-reduce:transition-none',
              visible ? 'bg-primary/80' : 'bg-muted-foreground/30'
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute right-4 top-0 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border/60 bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-xl transition-opacity motion-reduce:transition-none',
              visible ? 'opacity-100' : 'opacity-0'
            )}
          >
            {label}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
