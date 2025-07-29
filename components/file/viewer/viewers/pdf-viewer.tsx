import { useFileViewer } from '../context'

export function PdfViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) {
    return null
  }

  return (
    <div className="w-full">
      <iframe
        src={state.urls.fileUrl}
        className="w-full h-[60vh]"
        title={file.name}
      />
    </div>
  )
}
