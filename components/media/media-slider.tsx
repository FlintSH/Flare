'use client'

import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface MediaSliderProps {
  label: string
  value: number
  max: number
  /** How far an arrow key moves the value. */
  step: number
  /** How the value reads to a screen reader. */
  valueText: string
  /** Where a lighter fill ends: how far the media has buffered. */
  secondary?: number
  /** The text shown over the pointer, such as the time it points at. */
  hint?: (value: number) => string
  onChange: (value: number) => void
  /** Told while a drag is in progress, so the player keeps its controls up. */
  onDragChange?: (dragging: boolean) => void
  disabled?: boolean
  /**
   * `media` sits on the video and is light on dark in both themes; `surface`
   * sits on a card and takes the theme's colours.
   */
  tone: 'media' | 'surface'
  className?: string
}

const tones = {
  media: {
    track: 'bg-white/25',
    secondary: 'bg-white/35',
    fill: 'bg-white',
    thumb: 'bg-white',
    ring: 'has-[:focus-visible]:ring-white',
  },
  surface: {
    track: 'bg-foreground/15',
    secondary: 'bg-foreground/15',
    fill: 'bg-primary',
    thumb: 'bg-primary ring-2 ring-panel',
    ring: 'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
  },
}

/**
 * The player's seek and volume sliders. A visually hidden range input gives
 * it the keyboard and screen-reader behaviour of a native slider; the pointer
 * is read here, so a click lands exactly where it points.
 */
export function MediaSlider({
  label,
  value,
  max,
  step,
  valueText,
  secondary,
  hint,
  onChange,
  onDragChange,
  disabled = false,
  tone,
  className,
}: MediaSliderProps) {
  const root = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<{
    x: number
    width: number
    value: number
  }>()
  const colors = tones[tone]
  const percent = (amount: number) =>
    `${max > 0 ? Math.min(Math.max(amount / max, 0), 1) * 100 : 0}%`

  const at = (clientX: number) => {
    const box = root.current!.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - box.left, 0), box.width)
    return {
      x,
      width: box.width,
      value: box.width > 0 ? (x / box.width) * max : 0,
    }
  }

  const drag = (active: boolean) => {
    setDragging(active)
    onDragChange?.(active)
  }

  return (
    <div
      ref={root}
      className={cn(
        'group/slider relative flex h-5 min-w-0 touch-none select-none items-center rounded-full has-[:focus-visible]:ring-2',
        colors.ring,
        disabled ? 'opacity-50' : 'cursor-pointer',
        className
      )}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag(true)
        onChange(at(event.clientX).value)
      }}
      onPointerMove={(event) => {
        if (disabled) return
        const point = at(event.clientX)
        // A finger hides what a pointer's hint would show.
        if (event.pointerType === 'mouse') setHover(point)
        if (dragging) onChange(point.value)
      }}
      onPointerUp={() => dragging && drag(false)}
      onPointerCancel={() => dragging && drag(false)}
      onPointerLeave={() => setHover(undefined)}
    >
      <div
        className={cn(
          'relative h-1 w-full overflow-hidden rounded-full transition-[height] duration-150',
          !disabled && 'group-hover/slider:h-1.5',
          dragging && 'h-1.5',
          colors.track
        )}
      >
        {secondary !== undefined && (
          <div
            className={cn('absolute inset-y-0 left-0', colors.secondary)}
            style={{ width: percent(secondary) }}
          />
        )}
        <div
          className={cn('absolute inset-y-0 left-0', colors.fill)}
          style={{ width: percent(value) }}
        />
      </div>
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-transform duration-150',
          colors.thumb,
          // On a card the thumb is always there, like any slider; over a
          // video it appears with the pointer or the keyboard.
          tone === 'media' &&
            !dragging &&
            'scale-0 group-hover/slider:scale-100 group-has-[:focus-visible]/slider:scale-100',
          disabled && 'hidden'
        )}
        // Kept whole at both ends of the track.
        style={{ left: `clamp(6px, ${percent(value)}, calc(100% - 6px))` }}
      />
      {hint && hover && !disabled && (
        <div
          className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white shadow"
          // Kept inside the slider, so the player's edge doesn't clip it.
          style={{ left: Math.min(Math.max(hover.x, 20), hover.width - 20) }}
          aria-hidden="true"
        >
          {hint(hover.value)}
        </div>
      )}
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max}
        // The keys move by `step` from wherever the value is; a native step
        // would first snap the value to its grid.
        step="any"
        value={Math.min(value, max)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyDown={(event) => {
          const moves: Record<string, number> = {
            ArrowRight: step,
            ArrowUp: step,
            ArrowLeft: -step,
            ArrowDown: -step,
            PageUp: max / 10,
            PageDown: -max / 10,
            Home: -max,
            End: max,
          }
          const by = moves[event.key]
          if (
            by === undefined ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return
          event.preventDefault()
          onChange(Math.min(Math.max(value + by, 0), max))
        }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  )
}
