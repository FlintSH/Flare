import { useEffect } from 'react'

import CodeMirror from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'

import { getLanguageExtension } from '../../protected/language-utils'
import { useFileViewer } from '../context'
import { ErrorState } from './error-state'
import { LoadingState } from './loading-state'

export function TextContent({ language }: { language: string }) {
  const { file, state, fetchContent } = useFileViewer()
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    void fetchContent()
  }, [fetchContent])

  if (state.error) return <ErrorState error={state.error} />
  if (state.isLoading || state.content === undefined) {
    return <LoadingState message="Loading file content…" />
  }

  return (
    <section className="w-full min-w-0" aria-label={`${file.name} preview`}>
      {state.content ? (
        <div className="min-w-0 overflow-auto text-sm [&_.cm-editor]:!bg-transparent [&_.cm-gutters]:!border-border [&_.cm-gutters]:!bg-muted/30 [&_.cm-scroller]:!font-mono">
          <CodeMirror
            value={state.content}
            width="100%"
            maxHeight="60vh"
            extensions={[getLanguageExtension(language)]}
            editable={false}
            readOnly
            theme={resolvedTheme === 'light' ? 'light' : 'dark'}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              foldGutter: language !== 'text',
            }}
          />
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-muted-foreground">
          This file is empty.
        </p>
      )}
    </section>
  )
}
