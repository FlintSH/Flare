import { useMemo } from 'react'

import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { FileText } from 'lucide-react'
import { useTheme } from 'next-themes'

import type { Language } from '@/lib/files/file-kind'
import { cn } from '@/lib/utils'

import { looksBinary, usePreviewText } from '../preview-text'
import { codeGrammar } from './code-grammar'
import { CODE_EDGE, CODE_LINE_HEIGHT, codeViewerTheme } from './code-theme'
import { ErrorState } from './error-state'
import { stageMaxHeightClassName } from './loading-state'
import { PreviewPlaceholder } from './preview-placeholder'

/** Markdown prose wraps to the width; code, logs and other text keep their
 * lines and scroll sideways, so columns stay aligned. */
const WRAPPED_LANGUAGES = new Set<Language>(['markdown'])

const failedContent = (status?: number) =>
  status ? `Failed to fetch content: ${status}` : 'Failed to fetch content'

/** A typical line of text or code, in bytes, for guessing a file's length. */
const BYTES_PER_LINE = 32
const WIDTHS = ['62%', '38%', '81%', '54%', '70%', '24%', '47%', '76%']

/**
 * Lines the size of the text that is loading: as many as a file of `bytes`
 * probably has, up to the tallest the preview grows.
 */
function TextSkeleton({ bytes }: { bytes?: number }) {
  const lines = Math.min(
    Math.max(Math.ceil((bytes ?? 2048) / BYTES_PER_LINE), 2),
    48
  )
  return (
    <div
      role="status"
      className={cn(
        'w-full overflow-hidden font-mono text-[13px] sm:text-sm',
        stageMaxHeightClassName
      )}
      style={{ height: lines * CODE_LINE_HEIGHT + 2 * CODE_EDGE }}
    >
      <span className="sr-only">Loading file content…</span>
      <div
        className="animate-pulse"
        style={{ padding: `${CODE_EDGE}px 0` }}
        aria-hidden="true"
      >
        {Array.from({ length: lines }, (_, line) => (
          <div
            key={line}
            className="flex items-center gap-4 px-3"
            style={{ height: CODE_LINE_HEIGHT }}
          >
            <span className="h-2 w-5 shrink-0 rounded-full bg-muted" />
            {/* Every fifth line is blank, as in real files. */}
            {line % 5 !== 4 && (
              <span
                className="h-2 rounded-full bg-muted"
                style={{ width: WIDTHS[line % WIDTHS.length] }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TextContent({
  name,
  url,
  language,
  bytes,
}: {
  name: string
  url: string
  language: Language
  /** The file's size, which sizes the loading state. */
  bytes?: number
}) {
  const preview = usePreviewText(url, failedContent)
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const extensions = useMemo(
    () => [
      codeGrammar(language),
      codeViewerTheme(dark),
      ...(WRAPPED_LANGUAGES.has(language) ? [EditorView.lineWrapping] : []),
    ],
    [language, dark]
  )

  if (preview.status === 'failed') return <ErrorState error={preview.message} />
  if (preview.status === 'loading') return <TextSkeleton bytes={bytes} />

  if (!preview.text)
    return (
      <div className="w-full p-4 sm:p-5">
        <PreviewPlaceholder icon={FileText} title="This file is empty" />
      </div>
    )

  // A file named like text can hold anything, and a browser gives an unknown
  // extension no type to go by.
  if (looksBinary(preview.text))
    return (
      <ErrorState
        error="This file isn’t text, so it can’t be shown here."
        fallbackMessage="Download it to open it with an app on your device."
      />
    )

  return (
    <section
      className="w-full min-w-0 font-mono text-[13px] sm:text-sm"
      aria-label={`${name} preview`}
    >
      <CodeMirror
        value={preview.text}
        extensions={extensions}
        editable={false}
        readOnly
        theme="none"
        basicSetup={{
          lineNumbers: true,
          // Every text view keeps the same gutter, foldable or not.
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
    </section>
  )
}
