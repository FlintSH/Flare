import { useState } from 'react'

import { flushSync } from 'react-dom'

import { useAppearance } from '@/components/customization/appearance-provider'
import {
  type CheckerTone,
  checkerClassName,
  checkerToneFor,
} from '@/components/file/checker-tone'
import { ImageLightbox } from '@/components/file/image-lightbox'

import { cn } from '@/lib/utils'

import { ErrorState } from '../components/error-state'
import { ExpandImageButton } from '../components/expand-image-button'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function ImageViewer() {
  const { file, state } = useFileViewer()
  const { sharing } = useAppearance()
  const [failedUrl, setFailedUrl] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState<{
    portrait: boolean
    /** Smaller than the stage both ways, so it gets a margin on the stage. */
    small: boolean
    tone: CheckerTone
  }>()

  if (!state.urls) return <LoadingState message="Loading image…" />
  if (failedUrl === state.urls.fileUrl) {
    return (
      <ErrorState error="This image couldn’t be displayed in your browser." />
    )
  }

  const cover = sharing.imageFit === 'cover'

  return (
    // A stage between hairlines: narrow images sit on it instead of the
    // card, and light screenshots keep their edges. The expand button sits
    // on the stage's corner, beside a narrow image rather than over it.
    <div
      className={cn(
        'relative flex w-full items-center justify-center border-y border-border/60 bg-muted/60 dark:bg-muted/30',
        loaded?.small && !cover && 'py-6'
      )}
    >
      <div className={cover ? 'w-full' : 'max-w-full'}>
        <img
          src={state.urls.fileUrl}
          alt={file.name}
          onLoad={({ currentTarget: image }) => {
            const stage = image.parentElement?.parentElement
            // Before the first paint at the new size.
            flushSync(() =>
              setLoaded({
                portrait: image.naturalHeight > image.naturalWidth,
                small:
                  !!stage &&
                  image.naturalWidth < stage.clientWidth &&
                  image.naturalHeight < window.innerHeight * 0.5,
                tone: checkerToneFor(image),
              })
            )
          }}
          onError={() => setFailedUrl(state.urls?.fileUrl)}
          className={cn(
            checkerClassName(loaded?.tone ?? null),
            'block',
            cover
              ? 'h-[60vh] w-full object-cover'
              : // Portrait images may use the height that keeps the card,
                // including its actions, on a larger screen: the header,
                // the card's offset (6vh), title and actions take about
                // 15rem plus that offset.
                // A faint edge keeps light images apart from the stage, except
                // where the corners or edges are see-through (it would box
                // empty space).
                cn(
                  'max-h-[60vh] max-w-full object-contain',
                  loaded?.tone !== 'none' && 'ring-1 ring-foreground/10',
                  loaded?.portrait &&
                    'sm:max-h-[max(60vh,calc(100dvh_-_6vh_-_15rem))]'
                )
          )}
        />
        {/* Shown once the image has a size, so it sits on its corner. */}
        {loaded && <ExpandImageButton onClick={() => setExpanded(true)} />}
      </div>
      {expanded && (
        <ImageLightbox
          images={[{ id: file.id, name: file.name, src: state.urls.fileUrl }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setExpanded(false)}
          positionLabel="Image preview"
        />
      )}
    </div>
  )
}
