import { useEffect, useRef, useState } from 'react'

import { flushSync } from 'react-dom'

import {
  checkerClassName,
  checkerToneFor,
} from '@/components/file/checker-tone'
import { ImageLightbox } from '@/components/file/image-lightbox'
import { useAppearance } from '@/components/providers/appearance-context'

import { cn } from '@/lib/utils'

import { ErrorState } from '../components/error-state'
import { ExpandImageButton } from '../components/expand-image-button'
import {
  LoadingState,
  stageMaxHeightClassName,
  stageSurfaceClassName,
} from '../components/loading-state'

/** How a loaded picture sits on its stage. */
function measured(image: HTMLImageElement, src: string) {
  const stage = image.parentElement?.parentElement
  return {
    src,
    /** Smaller than the stage both ways, so it gets a margin on the stage. */
    small:
      !!stage &&
      image.naturalWidth < stage.clientWidth &&
      image.naturalHeight < window.innerHeight * 0.5,
    tone: checkerToneFor(image),
  }
}

export function ImageViewer({
  file,
  src,
}: {
  file: { id: string; name: string }
  src?: string
}) {
  const { sharing } = useAppearance()
  const image = useRef<HTMLImageElement>(null)
  const [failedUrl, setFailedUrl] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState<ReturnType<typeof measured>>()

  // The page arrives with the picture's address, so the browser fetches it
  // alongside the app instead of after it. A picture that finished, or
  // failed, before the app was listening never reports it here, so its state
  // is read once instead.
  useEffect(() => {
    const element = image.current
    if (!src || !element?.complete) return
    if (element.naturalWidth > 0) {
      setLoaded(measured(element, src))
      return
    }
    // Finished without a width: broken, or a drawing that states no size.
    // Decoding tells them apart without asking for the file again.
    let current = true
    element.decode().then(
      () => {
        if (current) setLoaded(measured(element, src))
      },
      () => {
        if (current) setFailedUrl(src)
      }
    )
    return () => {
      current = false
    }
  }, [src])

  if (src && failedUrl === src) {
    return (
      <ErrorState error="This image couldn’t be displayed in your browser." />
    )
  }

  const cover = sharing.imageFit === 'cover'
  const shown = src && loaded?.src === src ? loaded : null

  return (
    // A stage under the file's header: narrow images sit on it instead of
    // the card, and light screenshots keep their edges. The expand button
    // sits on the picture's corner.
    <div
      className={cn(
        'relative flex w-full items-center justify-center overflow-hidden',
        stageSurfaceClassName,
        shown && !cover && 'sm:min-h-56',
        shown?.small && !cover && 'py-6'
      )}
    >
      {/* The shape of a typical picture, so most images load without moving
          the page. */}
      {!shown && (
        <LoadingState
          message="Loading image…"
          className={cn('aspect-[16/10]', stageMaxHeightClassName)}
        />
      )}
      {src && (
        <div
          className={cn(
            'transition-opacity duration-300',
            cover ? 'w-full' : 'max-w-full',
            shown
              ? 'relative opacity-100'
              : 'pointer-events-none absolute inset-0 opacity-0'
          )}
        >
          <img
            ref={image}
            src={src}
            alt={file.name}
            decoding="async"
            onClick={() => setExpanded(true)}
            onLoad={({ currentTarget }) => {
              // Before the first paint at the new size.
              flushSync(() => setLoaded(measured(currentTarget, src)))
            }}
            onError={() => setFailedUrl(src)}
            className={cn(
              checkerClassName(shown?.tone ?? null),
              'block cursor-zoom-in',
              cover
                ? 'h-[min(60vh,var(--stage-max,60vh))] w-full object-cover'
                : // A faint edge keeps light images apart from the stage,
                  // except where the corners or edges are see-through (it
                  // would box empty space).
                  cn(
                    'max-w-full object-contain',
                    stageMaxHeightClassName,
                    shown?.tone !== 'none' && 'ring-1 ring-foreground/10'
                  )
            )}
          />
          {/* Shown once the image has a size, so it sits on its corner. */}
          {shown && <ExpandImageButton onClick={() => setExpanded(true)} />}
        </div>
      )}
      {expanded && src && (
        <ImageLightbox
          images={[{ id: file.id, name: file.name, src }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setExpanded(false)}
          positionLabel="Image preview"
        />
      )}
    </div>
  )
}
