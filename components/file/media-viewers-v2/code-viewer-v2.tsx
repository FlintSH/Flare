'use client'

import { useCallback, useState } from 'react'

import CodeMirror from '@uiw/react-codemirror'
import { Check, Code, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { useToast } from '@/hooks/use-toast'

import { getLanguageExtension } from '../protected/language-utils'

interface CodeViewerV2Props {
  content: string | undefined
  language: string
  fileName: string
  isLoading: boolean
}

export function CodeViewerV2({
  content,
  language,
  fileName,
  isLoading,
}: CodeViewerV2Props) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const handleCopyCode = useCallback(async () => {
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: 'Code copied',
        description: 'Code content has been copied to clipboard',
      })
    } catch {
      toast({
        title: 'Failed to copy code',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }, [content, toast])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading code...</p>
        </div>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-3">
          <div className="text-4xl text-muted-foreground">⚠️</div>
          <p className="text-muted-foreground">Failed to load code content</p>
          <p className="text-sm text-muted-foreground">{fileName}</p>
        </div>
      </div>
    )
  }

  const lines = content.split('\n').length
  const size = new Blob([content]).size

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Code className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-medium truncate max-w-xs sm:max-w-md">
                {fileName}
              </h1>
              <p className="text-xs text-muted-foreground">
                {language} • {lines} lines • {(size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyCode}
            className="shrink-0"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">
              {copied ? 'Copied!' : 'Copy'}
            </span>
          </Button>
        </div>
      </div>

      {/* Code content */}
      <div className="overflow-auto">
        <div className="min-h-screen">
          <CodeMirror
            value={content}
            extensions={[getLanguageExtension(language)]}
            editable={false}
            theme="dark"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              foldGutter: true,
              searchKeymap: true,
            }}
            className="text-sm"
            style={{
              fontSize: '14px',
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Menlo, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          />
        </div>
      </div>

      {/* Mobile-optimized bottom padding */}
      <div className="h-32 sm:h-0" />
    </div>
  )
}
