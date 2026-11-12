import { type RefObject, useEffect, useRef, useState } from 'react'

import { CalendarDays } from 'lucide-react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { cn } from '@/lib/utils'

interface DateRailProps {
  controlsRef: RefObject<HTMLDivElement | null>
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
  controlsRef,
  label,
  firstLabel,
  lastLabel,
  row,
  rowCount,
  scrolling,
  onSeek,
}: DateRailProps) {
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null)
  useEffect(() => setControlsHost(controlsRef.current), [controlsRef])
  const openedAt = useRef(row)
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
  return (
    <>
      {controlsHost &&
        createPortal(
          <>
            <Dialog
              modal={false}
              onOpenChange={(open) => {
                if (open) openedAt.current = row
              }}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Browse by date"
                  className="h-10 gap-1.5 rounded-lg bg-background/70 px-2 text-xs sm:px-3"
                >
                  <CalendarDays className="h-4 w-4" />
                  <span className="sm:hidden">Dates</span>
                  <span className="hidden sm:inline">Browse by date</span>
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-w-sm"
                onCloseAutoFocus={(event) => {
                  if (openedAt.current === row) return
                  // Seeking can move the trigger above the viewport. Return
                  // focus to the visible file without undoing that date jump.
                  const file = [
                    ...document.querySelectorAll<HTMLAnchorElement>(
                      '[data-file-index] a'
                    ),
                  ].find((element) => {
                    const rect = element.getBoundingClientRect()
                    return rect.top >= 96 && rect.bottom <= window.innerHeight
                  })
                  if (file) {
                    event.preventDefault()
                    file.focus({ preventScroll: true })
                  }
                }}
              >
                <DialogTitle>Browse by date</DialogTitle>
                <DialogDescription>
                  Drag to a date, then close to browse those files.
                </DialogDescription>
                <p className="text-sm font-medium" aria-live="polite">
                  {label}
                </p>
                <input
                  type="range"
                  aria-label="Browse files by date"
                  aria-valuetext={label}
                  aria-valuenow={row + 1}
                  min={1}
                  max={rowCount}
                  value={row + 1}
                  onChange={(event) => onSeek(Number(event.target.value) - 1)}
                  className="h-11 w-full cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{firstLabel}</span>
                  <span>{lastLabel}</span>
                </div>
              </DialogContent>
            </Dialog>
          </>,
          controlsHost
        )}
      {createPortal(
        <div
          className="fixed hidden min-[1360px]:block bottom-[18vh] right-0 top-[max(8rem,28vh)] z-30 w-10 sm:right-2"
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
                // At rest the track stays faintly visible where the rail sits in
                // the page gutter, so the thumb reads as a scrubber on a rail.
                // Narrower screens put the rail over the content column (the
                // header panel above the grid), so there it appears only while
                // scrolling, hovered, focused or dragged.
                visible ? 'opacity-100' : 'opacity-0 min-[1360px]:opacity-70'
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
                  visible
                    ? 'bg-primary/80'
                    : 'bg-transparent min-[1360px]:bg-muted-foreground/40'
                )}
              />
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute right-4 top-0 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-lg shadow-black/20 dark:shadow-black/60 transition-opacity motion-reduce:transition-none',
                  visible ? 'opacity-100' : 'opacity-0'
                )}
              >
                {label}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
