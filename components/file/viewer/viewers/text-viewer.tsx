import { useEffect } from 'react'

import CodeMirror from '@uiw/react-codemirror'

import { getLanguageExtension } from '../../protected/language-utils'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function TextViewer() {
  const { state, fetchContent } = useFileViewer()

  useEffect(() => {
    if (!state.content) {
      fetchContent()
    }
  }, [state.content, fetchContent])

  if (state.isLoading) {
    return <LoadingState message="Loading text content..." />
  }

  if (state.error) {
    return <ErrorState error={state.error} />
  }

  if (!state.content) {
    return <ErrorState error="No content available" />
  }

  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <CodeMirror
        value={state.content}
        width="100%"
        extensions={[getLanguageExtension('text')]}
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
