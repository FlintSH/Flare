import { ExternalLink, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { LoadingState } from '../components/loading-state'
import { PreviewPlaceholder } from '../components/preview-placeholder'

const stageHeightClassName = 'h-[var(--stage-max,70vh)] min-h-80'

/**
 * Whether this browser shows a PDF inside a page. Android browsers, and
 * desktop ones with the built-in viewer turned off, download it instead and
 * leave the frame blank. Browsers that don't say are assumed to show it.
 */
function showsPdfInline() {
  return (
    typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
  )
}

/** `src` is set once the page is interactive, so this only runs in a browser. */
export function PdfViewer({ name, src }: { name: string; src?: string }) {
  if (src && !showsPdfInline())
    return (
      <div className="w-full p-4 sm:p-5">
        <PreviewPlaceholder
          icon={FileText}
          title="This browser opens PDFs in their own tab"
          titleAs="h2"
          description="Open the document to read it, or download it to keep a copy."
          className="py-10"
        >
          <Button asChild size="sm" className="mt-2">
            <a href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Open PDF
              <span className="sr-only"> in a new tab</span>
            </a>
          </Button>
        </PreviewPlaceholder>
      </div>
    )

  return (
    // The browser draws its own viewer over the loading state, in its own
    // colours.
    <div className="relative w-full">
      <LoadingState
        message="Loading document…"
        className={stageHeightClassName}
      />
      {src && (
        // Chromium otherwise opens a thumbnail sidebar that shrinks the page.
        <iframe
          src={`${src}#navpanes=0&view=FitH`}
          className="absolute inset-0 block h-full w-full"
          title={`${name} document preview`}
        />
      )}
    </div>
  )
}
