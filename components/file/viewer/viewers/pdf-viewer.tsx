import { LoadingState } from '../components/loading-state'

export function PdfViewer({
  name,
  src,
  sandboxed = false,
}: {
  name: string
  src?: string
  /**
   * For a document Flare cannot vouch for, such as a decrypted file: the
   * frame gets an opaque origin and runs no script, whatever the bytes are.
   */
  sandboxed?: boolean
}) {
  if (!src) return <LoadingState message="Loading document…" />

  return (
    // Full width between hairlines, like images and text. The browser draws
    // its own viewer inside, in its own colours.
    <div className="w-[56rem] min-w-0 max-w-full border-y border-border/60 bg-muted/60 dark:bg-muted/30">
      {/* Chromium otherwise opens a thumbnail sidebar that shrinks the page. */}
      <iframe
        src={`${src}#navpanes=0&view=FitH`}
        className="block h-[70vh] min-h-80 w-full"
        title={`${name} document preview`}
        {...(sandboxed && { sandbox: '', referrerPolicy: 'no-referrer' })}
      />
    </div>
  )
}
