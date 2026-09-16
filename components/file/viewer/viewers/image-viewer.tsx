import { useState } from 'react'

import { Maximize2 } from 'lucide-react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { ImageLightbox } from '@/components/file/image-lightbox'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function ImageViewer() {
  const { file, state } = useFileViewer()
  const { sharing } = useAppearance()
  const [failedUrl, setFailedUrl] = useState<string>()
  const [expanded, setExpanded] = useState(false)

  if (!state.urls) return <LoadingState message="Loading image…" />
  if (failedUrl === state.urls.fileUrl) {
    return (
      <ErrorState error="This image couldn’t be displayed in your browser." />
    )
  }

  return (
    <div className="group relative flex w-full items-center justify-center">
      <img
        src={state.urls.fileUrl}
        alt={file.name}
        onError={() => setFailedUrl(state.urls?.fileUrl)}
        className={
          sharing.imageFit === 'cover'
            ? 'h-[60vh] w-full object-cover'
            : 'max-h-[60vh] max-w-full object-contain'
        }
      />
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Expand image"
        title="Expand image"
        className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
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
