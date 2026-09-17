'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import * as Dialog from '@radix-ui/react-dialog'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export interface LightboxImage {
  id: string
  name: string
  src: string
  downloadUrl?: string
  subtitle?: string
}

interface ImageLightboxProps {
  images: LightboxImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  fallbackFocusRef?: RefObject<HTMLElement>
  hasPrevious?: boolean
  hasNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  navigationPending?: boolean
  positionLabel?: string
}

const controlClass =
  'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-30'

// Mount only while open, so each visit remembers its own opener and image state.
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  fallbackFocusRef,
  hasPrevious = index > 0,
  hasNext = index < images.length - 1,
  onPrevious,
  onNext,
  navigationPending = false,
  positionLabel,
}: ImageLightboxProps) {
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  )
  useEffect(() => {
    // The page keeps a stable scrollbar gutter. A full-screen viewer must
    // also cover that space; Radix locks body scrolling, but not the root.
    const root = document.documentElement
    const overflow = root.style.overflow
    const gutter = root.style.scrollbarGutter
    const { scrollX, scrollY } = window
    root.style.overflow = 'hidden'
    root.style.scrollbarGutter = 'auto'
    return () => {
      root.style.overflow = overflow
      root.style.scrollbarGutter = gutter
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
    }
  }, [])
  const current = images[index]
  const previous = () => {
    if (!navigationPending && hasPrevious) {
      if (onPrevious) onPrevious()
      else onIndexChange(index - 1)
    }
  }
  const next = () => {
    if (!navigationPending && hasNext) {
      if (onNext) onNext()
      else onIndexChange(index + 1)
    }
  }

  if (!current) return null

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 w-screen bg-black/90" />
        <Dialog.Content
          aria-describedby="image-viewer-help"
          className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-zinc-950 text-white outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = opener?.isConnected
              ? opener
              : fallbackFocusRef?.current
            target?.focus({ preventScroll: true })
          }}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              previous()
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              next()
            }
          }}
        >
          <header className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-medium">
                {current.name}
              </Dialog.Title>
              <div
                className="mt-1 flex items-center gap-2 text-xs text-white/50"
                aria-live="polite"
                aria-atomic="true"
              >
                <span>
                  {positionLabel || `${index + 1} of ${images.length}`}
                </span>
                {current.subtitle && (
                  <span className="truncate border-l border-white/20 pl-2">
                    {current.subtitle}
                  </span>
                )}
              </div>
            </div>
            {current.downloadUrl && (
              <a
                className={controlClass}
                href={current.downloadUrl}
                download={current.name}
                aria-label="Download image"
                title="Download image"
              >
                <Download className="h-5 w-5" />
              </a>
            )}
            <Dialog.Close
              className={controlClass}
              aria-label="Close image viewer"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </header>
          <p id="image-viewer-help" className="sr-only">
            Use left and right arrow keys or swipe to browse images. Zoom in to
            inspect details, and choose Fit to see the whole image. Use Shift
            and an arrow key to pan a zoomed image. Press Escape to close.
          </p>
          <ImageStage
            key={`${current.id}:${current.src}`}
            image={current}
            previous={previous}
            next={next}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            navigationPending={navigationPending}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ImageStage({
  image,
  previous,
  next,
  hasPrevious,
  hasNext,
  navigationPending,
}: {
  image: LightboxImage
  previous: () => void
  next: () => void
  hasPrevious: boolean
  hasNext: boolean
  navigationPending: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    x: number
    y: number
    left: number
    top: number
    pan: boolean
  } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const ready = natural.width > 0
  const fit =
    ready && size.width > 0
      ? Math.min(1, size.width / natural.width, size.height / natural.height)
      : 1
  const scale = zoom ?? fit
  const canPan =
    ready &&
    (natural.width * scale > size.width + 1 ||
      natural.height * scale > size.height + 1)
  const changeZoom = useCallback(
    (direction: number) =>
      setZoom(
        Math.max(
          Math.min(fit, 0.25),
          Math.min(4, scale * (direction > 0 ? 1.5 : 1 / 1.5))
        )
      ),
    [fit, scale]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !ready || failed)
        return
      if (
        event.shiftKey &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault()
        viewport.current?.scrollBy({
          left:
            event.key === 'ArrowLeft'
              ? -80
              : event.key === 'ArrowRight'
                ? 80
                : 0,
          top:
            event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0,
        })
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        changeZoom(1)
      }
      if (event.key === '-') {
        event.preventDefault()
        changeZoom(-1)
      }
      if (event.key === '0') {
        event.preventDefault()
        setZoom(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [changeZoom, ready, failed])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the center of the image in view when switching magnification.
  useEffect(() => {
    const element = viewport.current
    if (element) {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    }
  }, [scale])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={viewport}
          className={cn(
            'absolute inset-0 overflow-auto overscroll-contain',
            canPan ? 'cursor-grab active:cursor-grabbing' : 'touch-pan-y'
          )}
          style={canPan ? { touchAction: 'pan-x pan-y' } : undefined}
          onDoubleClick={() => {
            if (ready) setZoom(zoom === null ? 1 : null)
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            const element = event.currentTarget
            gesture.current = {
              x: event.clientX,
              y: event.clientY,
              left: element.scrollLeft,
              top: element.scrollTop,
              pan: canPan && event.pointerType === 'mouse',
            }
            element.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const start = gesture.current
            if (!start?.pan) return
            event.currentTarget.scrollLeft =
              start.left - (event.clientX - start.x)
            event.currentTarget.scrollTop =
              start.top - (event.clientY - start.y)
          }}
          onPointerUp={(event) => {
            const start = gesture.current
            gesture.current = null
            if (!start || canPan || event.pointerType === 'mouse') return
            const dx = event.clientX - start.x
            const dy = event.clientY - start.y
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              if (dx < 0) next()
              else previous()
            }
          }}
          onPointerCancel={() => {
            gesture.current = null
          }}
        >
          {!failed && (
            <div
              className="flex min-h-full min-w-full"
              style={
                ready
                  ? {
                      width: natural.width * scale,
                      height: natural.height * scale,
                    }
                  : undefined
              }
            >
              <img
                src={image.src}
                alt={image.name}
                draggable={false}
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => setFailed(true)}
                className="m-auto block max-w-none shrink-0 select-none"
                style={{
                  width: ready ? natural.width * scale : undefined,
                  height: ready ? natural.height * scale : undefined,
                  visibility: ready ? 'visible' : 'hidden',
                }}
              />
            </div>
          )}
        </div>
        {(!ready || navigationPending || failed) && (
          <div
            className={cn(
              'pointer-events-none absolute inset-0 flex items-center justify-center',
              navigationPending && 'bg-zinc-950/40'
            )}
            role="status"
          >
            {failed ? (
              <div className="px-6 text-center text-white/60">
                <ImageOff className="mx-auto mb-3 h-8 w-8" />
                <p className="text-sm">This image couldn’t be displayed.</p>
                <p className="mt-1 text-xs">
                  {image.downloadUrl
                    ? 'Try downloading the original file.'
                    : 'Close the viewer and try again.'}
                </p>
              </div>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-white/60" />
                <span className="sr-only">Loading image…</span>
              </>
            )}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-center gap-2 px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:gap-6">
        {(hasPrevious || hasNext) && (
          <button
            type="button"
            className={cn(controlClass, 'border border-white/10')}
            onClick={previous}
            disabled={!hasPrevious || navigationPending}
            aria-label="Previous image"
            title="Previous image (←)"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div
          className="flex items-center rounded-full border border-white/10 bg-white/5 p-1"
          role="group"
          aria-label="Image zoom"
        >
          <button
            type="button"
            className={controlClass}
            onClick={() => changeZoom(-1)}
            disabled={!ready || failed || scale <= Math.min(fit, 0.25)}
            aria-label="Zoom out"
            title="Zoom out (−)"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={cn(
              controlClass,
              'px-3 text-xs',
              zoom === null && 'bg-white/10 text-white'
            )}
            onClick={() => setZoom(null)}
            disabled={!ready || failed}
            aria-label="Fit image"
            aria-pressed={zoom === null}
            title="Fit image (0)"
          >
            Fit
          </button>
          <button
            type="button"
            className={cn(
              controlClass,
              'px-3 text-xs tabular-nums',
              zoom === 1 && 'bg-white/10 text-white'
            )}
            onClick={() => setZoom(1)}
            disabled={!ready || failed}
            aria-label="Actual size"
            aria-pressed={zoom === 1}
            title="Actual size"
          >
            100%
          </button>
          <button
            type="button"
            className={controlClass}
            onClick={() => changeZoom(1)}
            disabled={!ready || failed || scale >= 4}
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {(hasPrevious || hasNext) && (
          <button
            type="button"
            className={cn(controlClass, 'border border-white/10')}
            onClick={next}
            disabled={!hasNext || navigationPending}
            aria-label="Next image"
            title="Next image (→)"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        <span className="sr-only" role="status">
          {ready ? `Zoom ${Math.round(scale * 100)}%` : ''}
        </span>
      </footer>
    </div>
  )
}
