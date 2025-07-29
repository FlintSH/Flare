import { useFileViewer } from '../context'

export function AudioViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) {
    return null
  }

  return (
    <div className="w-full flex items-center justify-center py-4">
      <audio
        src={state.urls.fileUrl}
        controls
        className="w-full max-w-2xl"
        controlsList="nodownload"
        preload="metadata"
      >
        <source src={state.urls.fileUrl} type={file.mimeType} />
        Your browser does not support the audio tag.
      </audio>
    </div>
  )
}
