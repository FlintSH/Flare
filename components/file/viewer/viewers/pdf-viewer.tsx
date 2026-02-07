import { useFileViewer } from '../context'

export function PdfViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) {
    return null
  }

  return (
    <div className="w-full flex items-center justify-center">
      <iframe
        src={state.urls.fileUrl}
        className="w-full min-w-[min(600px,90vw)] h-[70vh]"
        title={file.name}
      />
    </div>
  )
}
