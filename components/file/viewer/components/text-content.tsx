import { useMemo, useState } from 'react'

import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { FileText, WrapText } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

import type { Language } from '@/lib/files/file-kind'

import { usePreviewText } from '../preview-text'
import { codeGrammar } from './code-grammar'
import { codeViewerTheme } from './code-theme'
import { ErrorState } from './error-state'
import { LoadingState } from './loading-state'
import { PreviewPlaceholder } from './preview-placeholder'

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
  const [wrap, setWrap] = useState(
    language === 'markdown' || /\.txt$/i.test(name)
  )
  const preview = usePreviewText(url, failedContent)
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const extensions = useMemo(
    () => [
      codeGrammar(language),
      codeViewerTheme(dark),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [language, dark, wrap]
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
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 font-sans">
        <span className="text-xs text-muted-foreground">Text preview</span>
        <Button
          type="button"
          variant={wrap ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={wrap}
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText aria-hidden="true" />
          Wrap lines
        </Button>
      </div>
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
