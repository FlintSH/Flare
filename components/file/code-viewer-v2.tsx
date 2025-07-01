'use client'

import { useEffect, useState } from 'react'

// Import CodeMirror components
import CodeMirror from '@uiw/react-codemirror'
import { AlertCircle, Check, Copy, Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { useToast } from '@/hooks/use-toast'

import { getLanguageExtension } from './protected/language-utils'
import { CODE_FILE_TYPES, TEXT_FILE_TYPES } from './protected/mime-types'

interface CodeViewerV2Props {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  fileUrl: string
  isFullscreen: boolean
}

export function CodeViewerV2({
  file,
  fileUrl,
  isFullscreen,
}: CodeViewerV2Props) {
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  // Determine language for syntax highlighting
  const getLanguage = () => {
    if (CODE_FILE_TYPES[file.mimeType]) {
      return CODE_FILE_TYPES[file.mimeType]
    }
    if (TEXT_FILE_TYPES.includes(file.mimeType)) {
      return 'text'
    }
    // Try to guess from file extension
    const extension = file.name.split('.').pop()?.toLowerCase()
    const extensionMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'jsx',
      ts: 'typescript',
      tsx: 'tsx',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      fish: 'bash',
      ps1: 'powershell',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      xml: 'xml',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      conf: 'ini',
      md: 'markdown',
      markdown: 'markdown',
    }
    return extensionMap[extension || ''] || 'text'
  }

  const language = getLanguage()

  // Fetch file content
  useEffect(() => {
    const fetchContent = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(fileUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status}`)
        }

        const text = await response.text()
        setContent(text)
      } catch (err) {
        console.error('Failed to fetch code content:', err)
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setIsLoading(false)
      }
    }

    fetchContent()
  }, [fileUrl])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast({
        title: 'Code copied',
        description: 'File content has been copied to clipboard',
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <Card className="w-full h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Loading code...</p>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="w-full h-96 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-medium mb-2">Failed to load file</h3>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </Card>
    )
  }

  return (
    <div className="w-full">
      <Card className="overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground px-2 py-1 bg-background rounded">
              {language}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="text-xs"
            >
              {copied ? (
                <Check className="h-3 w-3 mr-1" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              {copied ? 'Copied!' : 'Copy'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="text-xs"
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          </div>
        </div>

        {/* Code Content */}
        <div
          className={`relative ${isFullscreen ? 'h-screen' : 'max-h-[60vh]'} overflow-auto`}
        >
          <CodeMirror
            value={content}
            extensions={[getLanguageExtension(language)]}
            editable={false}
            theme="light"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              foldGutter: true,
              dropCursor: false,
              allowMultipleSelections: false,
              indentOnInput: false,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
              highlightSelectionMatches: false,
              searchKeymap: true,
            }}
            className="text-sm"
            style={{
              fontSize: '14px',
              minHeight: isFullscreen ? 'calc(100vh - 60px)' : '400px',
            }}
          />
        </div>

        {/* Stats Footer */}
        <div className="flex items-center justify-between p-2 border-t bg-muted/30 text-xs text-muted-foreground">
          <div>
            {content.split('\n').length} lines, {content.length} characters
          </div>
          <div>{(new Blob([content]).size / 1024).toFixed(1)} KB</div>
        </div>
      </Card>
    </div>
  )
}
