import { useFileViewer } from '../context'

export function ImageViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) {
    return null
  }

  return (
    <div className="w-full flex items-center justify-center">
      <img
        src={state.urls.fileUrl}
        alt={file.name}
        className="max-w-full max-h-[60vh] object-contain"
      />
    </div>
  )
}
