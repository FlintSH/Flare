import { useAppearance } from '@/components/customization/appearance-provider'

import { useFileViewer } from '../context'

export function ImageViewer() {
  const { file, state } = useFileViewer()
  const { sharing } = useAppearance()

  if (!state.urls) {
    return null
  }

  return (
    <div className="w-full flex items-center justify-center">
      <img
        src={state.urls.fileUrl}
        alt={file.name}
        className={
          sharing.imageFit === 'cover'
            ? 'w-full h-[60vh] object-cover'
            : 'max-w-full max-h-[60vh] object-contain'
        }
      />
    </div>
  )
}
