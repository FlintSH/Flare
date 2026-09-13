import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function PdfViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) return <LoadingState message="Loading document…" />

  return (
    <div className="w-full min-w-0">
      <iframe
        src={`${state.urls.fileUrl}#view=FitH`}
        className="h-[70vh] min-h-80 w-full min-w-[min(600px,calc(100vw-3rem))] border-0"
        title={`${file.name} document preview`}
      />
    </div>
  )
}
