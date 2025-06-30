'use client'

import { useEffect, useState } from 'react'

import type { Extension } from '@codemirror/state'
import CodeMirror from '@uiw/react-codemirror'

import { getLanguageExtension } from './language-utils'

interface CodeViewerProps {
  content: string
  language: string
}

export function CodeViewer({ content, language }: CodeViewerProps) {
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadLanguageExtension = async () => {
      try {
        setIsLoading(true)
        const extension = await getLanguageExtension(language)
        setLanguageExtension(extension)
      } catch (error) {
        console.error('Failed to load language extension:', error)
        // Fallback to no extension if loading fails
        setLanguageExtension(null)
      } finally {
        setIsLoading(false)
      }
    }

    loadLanguageExtension()
  }, [language])

  if (isLoading) {
    return (
      <div className="w-full flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading syntax highlighting...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <CodeMirror
        value={content}
        width="40vw"
        extensions={languageExtension ? [languageExtension] : []}
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
