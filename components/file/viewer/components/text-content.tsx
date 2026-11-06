import { useMemo } from 'react'

import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { FileText } from 'lucide-react'
import { useTheme } from 'next-themes'

import type { Language } from '@/lib/files/file-kind'

import { usePreviewText } from '../preview-text'
import { codeGrammar } from './code-grammar'
import { codeViewerTheme } from './code-theme'
import { ErrorState } from './error-state'
import { LoadingState } from './loading-state'
import { PreviewPlaceholder } from './preview-placeholder'

/** Markdown prose wraps to the width; code, logs and other text keep their
 * lines and scroll sideways, so columns stay aligned. */
const WRAPPED_LANGUAGES = new Set<Language>(['markdown'])

const failedContent = (status?: number) =>
  status ? `Failed to fetch content: ${status}` : 'Failed to fetch content'

export function TextContent({
  name,
  url,
  language,
}: {
  name: string
  url: string
  language: Language
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
  if (preview.status === 'loading') {
    return <LoadingState message="Loading file content…" />
  }

  if (!preview.text)
    return (
      <div className="w-full px-6">
        <PreviewPlaceholder icon={FileText} title="This file is empty" />
      </div>
    )

  // Hairlines above and below set the scrolling text apart from the title
  // and the actions.
  return (
    <section
      className="w-full min-w-0 border-y border-border/60 font-mono text-[13px] sm:text-sm"
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
