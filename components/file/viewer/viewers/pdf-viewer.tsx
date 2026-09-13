import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function PdfViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) return <LoadingState message="Loading document…" />

  return (
    <div className="w-full min-w-0 bg-muted/20">
      <iframe
        src={`${state.urls.fileUrl}#view=FitH`}
        className="h-[65vh] min-h-80 w-full border-0 sm:h-[70vh]"
        title={`${file.name} document preview`}
      />
    </div>
  )
}
