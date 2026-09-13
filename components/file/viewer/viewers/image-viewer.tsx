import { useState } from 'react'

import { useAppearance } from '@/components/customization/appearance-provider'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function ImageViewer() {
  const { file, state } = useFileViewer()
  const { sharing } = useAppearance()
  const [failedUrl, setFailedUrl] = useState<string>()

  if (!state.urls) return <LoadingState message="Loading image…" />
  if (failedUrl === state.urls.fileUrl) {
    return (
      <ErrorState error="This image couldn’t be displayed in your browser." />
    )
  }

  return (
    <div className="flex w-full items-center justify-center">
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
    </div>
  )
}
