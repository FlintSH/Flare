import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function PdfViewer() {
  const { file, state } = useFileViewer()

  if (!state.urls) return <LoadingState message="Loading document…" />

  return (
    // Full width between hairlines, like images and text. The browser draws
    // its own viewer inside, in its own colours.
    <div className="w-[56rem] min-w-0 max-w-full border-y border-border/60 bg-muted/60 dark:bg-muted/30">
      {/* Chromium otherwise opens a thumbnail sidebar that shrinks the page. */}
      <iframe
        src={`${state.urls.fileUrl}#navpanes=0&view=FitH`}
        className="block h-[70vh] min-h-80 w-full"
        title={`${file.name} document preview`}
      />
    </div>
  )
}
