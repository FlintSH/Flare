import { useEffect, useRef, useState } from 'react'

import CodeMirror from '@uiw/react-codemirror'

import { getLanguageExtension } from '../../protected/language-utils'
import { CODE_FILE_TYPES } from '../../protected/mime-types'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function CodeViewer() {
  const { file, state, fetchContent } = useFileViewer()
  const containerRef = useRef<HTMLDivElement>(null)
  const [fixedWidth, setFixedWidth] = useState<number | null>(null)

  useEffect(() => {
    if (!state.content) {
      fetchContent()
    }
  }, [state.content, fetchContent])

  useEffect(() => {
    if (state.content && !fixedWidth && containerRef.current) {
      // Wait for CodeMirror to render, then capture width
      setTimeout(() => {
        if (containerRef.current) {
          const width = containerRef.current.scrollWidth
          setFixedWidth(width)
        }
      }, 100)
    }
  }, [state.content, fixedWidth])

  if (state.isLoading) {
    return <LoadingState message="Loading code content..." />
  }

  if (state.error) {
    return <ErrorState error={state.error} />
  }

  if (!state.content) {
    return <ErrorState error="No content available" />
  }

  const language = CODE_FILE_TYPES[file.mimeType] || 'text'

  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <div
        ref={containerRef}
        style={{
          width: fixedWidth ? `${fixedWidth}px` : '100%',
          minWidth: fixedWidth ? `${fixedWidth}px` : '100%',
          maxWidth: fixedWidth ? `${fixedWidth}px` : '100%',
        }}
      >
        <CodeMirror
          value={state.content}
          width={fixedWidth ? `${fixedWidth}px` : '100%'}
          extensions={[getLanguageExtension(language)]}
          editable={false}
          theme="dark"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: false,
            highlightActiveLine: false,
          }}
        />
      </div>
    </div>
  )
}
