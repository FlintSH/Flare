import { useEffect } from 'react'

import CodeMirror from '@uiw/react-codemirror'

import { getLanguageExtension } from '../../protected/language-utils'
import { CODE_FILE_TYPES } from '../../protected/mime-types'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function CodeViewer() {
  const { file, state, fetchContent } = useFileViewer()

  useEffect(() => {
    if (!state.content) {
      fetchContent()
    }
  }, [state.content, fetchContent])

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
      <CodeMirror
        value={state.content}
        width="100%"
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
  )
}
