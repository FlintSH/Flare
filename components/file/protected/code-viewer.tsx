'use client'

import CodeMirror from '@uiw/react-codemirror'

import { getLanguageExtension } from './language-utils'

interface CodeViewerProps {
  content: string
  language: string
}

export function CodeViewer({ content, language }: CodeViewerProps) {
  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <CodeMirror
        value={content}
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
