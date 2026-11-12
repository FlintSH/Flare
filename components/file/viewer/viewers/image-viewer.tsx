import { useState } from 'react'

import { flushSync } from 'react-dom'

import {
  type CheckerTone,
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

export function ImageViewer({
  file,
  src,
}: {
  file: { id: string; name: string }
  src?: string
}) {
  const { sharing } = useAppearance()
  const [failedUrl, setFailedUrl] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState<{
    src: string
    /** Smaller than the stage both ways, so it gets a margin on the stage. */
    small: boolean
    tone: CheckerTone
  }>()

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
            src={src}
            alt={file.name}
            decoding="async"
            onClick={() => setExpanded(true)}
            onLoad={({ currentTarget: image }) => {
              const stage = image.parentElement?.parentElement
              // Before the first paint at the new size.
              flushSync(() =>
                setLoaded({
                  src,
                  small:
                    !!stage &&
                    image.naturalWidth < stage.clientWidth &&
                    image.naturalHeight < window.innerHeight * 0.5,
                  tone: checkerToneFor(image),
                })
              )
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
