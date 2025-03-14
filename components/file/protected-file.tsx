'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'

import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { wast } from '@codemirror/lang-wast'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import CodeMirror from '@uiw/react-codemirror'
import { LockIcon } from 'lucide-react'
import { useSession } from 'next-auth/react'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'

import { PasswordPrompt } from '@/components/auth/password-prompt'
import { FileActions } from '@/components/file/file-actions'
import { Button } from '@/components/ui/button'

import { sanitizeUrl } from '@/lib/utils/url'

interface ProtectedFileProps {
  file: {
    id: string
    name: string
    urlPath: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    userId: string
    mimeType: string
  }
}

// Comprehensive MIME type mappings
const CODE_FILE_TYPES: Record<string, string> = {
  // Web Technologies
  'text/html': 'html',
  'application/html': 'html',
  'text/css': 'css',
  'application/css': 'css',
  // JavaScript and variants
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'application/x-javascript': 'javascript',
  'text/ecmascript': 'javascript',
  'application/ecmascript': 'javascript',
  'text/babel': 'javascript',
  'text/jsx': 'jsx',
  'application/jsx': 'jsx',
  'text/x-jsx': 'jsx',
  // TypeScript and variants
  'application/typescript': 'typescript',
  'text/typescript': 'typescript',
  'text/x-typescript': 'typescript',
  'application/x-typescript': 'typescript',
  'text/tsx': 'tsx',
  'application/tsx': 'tsx',
  'text/x-tsx': 'tsx',
  'application/x-tiled-tsx': 'tsx',
  // JSON and variants
  'application/json': 'json',
  'text/json': 'json',
  'application/x-json': 'json',
  'application/manifest+json': 'json',
  'application/ld+json': 'json',
  // Python
  'text/x-python': 'python',
  'application/x-python': 'python',
  'application/x-python-code': 'python',
  'text/x-python-script': 'python',
  // PHP
  'application/x-httpd-php': 'php',
  'text/x-php': 'php',
  'application/php': 'php',
  // Ruby
  'text/x-ruby': 'ruby',
  'application/x-ruby': 'ruby',
  'text/ruby': 'ruby',
  // System/Low Level
  'text/x-sh': 'bash',
  'text/x-shellscript': 'shell',
  'application/x-sh': 'bash',
  'text/x-c': 'c',
  'text/x-csrc': 'c',
  'text/x-chdr': 'c',
  'text/x-c++': 'cpp',
  'text/x-c++src': 'cpp',
  'text/x-c++hdr': 'cpp',
  'text/x-java': 'java',
  'text/x-java-source': 'java',
  'text/x-go': 'go',
  'text/x-golang': 'go',
  'text/x-rust': 'rust',
  'text/rust': 'rust',
  'text/x-kotlin': 'kotlin',
  'text/kotlin': 'kotlin',
  'text/x-swift': 'swift',
  'text/swift': 'swift',
  'text/x-scala': 'scala',
  'text/scala': 'scala',
  'text/x-perl': 'perl',
  'application/x-perl': 'perl',
  'text/x-lua': 'lua',
  'application/x-lua': 'lua',
  // Data/Config
  'text/xml': 'xml',
  'application/xml': 'xml',
  'text/x-yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-toml': 'toml',
  'application/toml': 'toml',
  'text/x-ini': 'ini',
  'text/ini': 'ini',
  'text/x-properties': 'properties',
  'text/x-java-properties': 'properties',
  // CSV
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/x-csv': 'csv',
  // Database
  'text/x-sql': 'sql',
  'application/sql': 'sql',
  'text/x-mysql': 'sql',
  'text/x-pgsql': 'sql',
  // Markup
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/md': 'markdown',
  'text/x-md': 'markdown',
  'text/x-rst': 'rest',
  'text/x-latex': 'latex',
  'application/x-latex': 'latex',
  'application/x-tex': 'latex',
  // Other Languages
  'text/x-haskell': 'haskell',
  'text/x-literate-haskell': 'haskell',
  'text/x-erlang': 'erlang',
  'text/x-elixir': 'elixir',
  'text/x-clojure': 'clojure',
  'text/x-fsharp': 'fsharp',
  'text/x-r': 'r',
  'text/r': 'r',
  'text/x-matlab': 'matlab',
  'text/x-octave': 'matlab',
  'text/x-dart': 'dart',
  'application/dart': 'dart',
  'text/x-groovy': 'groovy',
  'text/groovy': 'groovy',
  'text/x-julia': 'julia',
  // Web Assembly
  'text/x-wasm': 'wasm',
  'application/wasm': 'wasm',
  // GraphQL
  'application/graphql': 'graphql',
  'text/x-graphql': 'graphql',
  // Protocol Buffers
  'text/x-protobuf': 'protobuf',
  'application/x-protobuf': 'protobuf',
  // Docker
  'text/x-dockerfile': 'dockerfile',
  'application/vnd.docker.dockerfile': 'dockerfile',
  // Git
  'text/x-git-config': 'git',
  'text/x-git': 'git',
  // CSS Variants
  'text/x-scss': 'scss',
  'text/scss': 'scss',
  'text/x-sass': 'sass',
  'text/sass': 'sass',
  'text/x-less': 'less',
  'text/less': 'less',
  // Template Languages
  'text/x-handlebars': 'handlebars',
  'text/x-mustache': 'mustache',
  'text/x-ejs': 'javascript',
  'text/x-nunjucks': 'javascript',
  'text/x-vue': 'html',
  'text/vue': 'html',
  'text/x-svelte': 'html',
  'text/svelte': 'html',
  'text/x-blade': 'php',
  'text/blade': 'php',
  'text/x-twig': 'twig',
  'text/twig': 'twig',
  'text/x-jinja': 'jinja2',
  'text/jinja': 'jinja2',
  'text/x-velocity': 'velocity',
  'text/velocity': 'velocity',
  // Assembly
  'text/x-asm': 'asm6502',
  'text/x-nasm': 'nasm',
  'text/x-masm': 'nasm',
  'text/x-gas': 'nasm',
}

const TEXT_FILE_TYPES = ['text/plain', 'text/rtf', 'text/x-log']

const VIDEO_FILE_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/x-flv',
  'video/3gpp',
  'video/3gpp2',
]

const AUDIO_FILE_TYPES = [
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'audio/x-m4a',
  'audio/x-flac',
  'audio/x-aiff',
  'audio/x-wav',
]

// Constants
const MAX_CSV_SIZE = 1024 * 1024 // 1MB limit for CSV preview

interface CsvViewerProps {
  url: string
  title: string
  verifiedPassword?: string
}

function CsvViewer({ url, title, verifiedPassword }: CsvViewerProps) {
  const [csvData, setCsvData] = useState<string[][]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAndParseCsv = async () => {
      try {
        const response = await fetch(
          url + (verifiedPassword ? `?password=${verifiedPassword}` : '')
        )

        // Check file size
        const contentLength = response.headers.get('content-length')
        if (contentLength && parseInt(contentLength) > MAX_CSV_SIZE) {
          setError('File is too large for preview. Please download to view.')
          setIsLoading(false)
          return
        }

        const text = await response.text()
        Papa.parse<string[]>(text, {
          complete: (results: ParseResult<string[]>) => {
            console.log('CSV parsed:', results.data.length, 'rows')
            setCsvData(results.data)
            setIsLoading(false)
          },
          error: (error: Error) => {
            console.error('CSV parse error:', error)
            setError('Failed to parse CSV: ' + error.message)
            setIsLoading(false)
          },
          header: false,
          skipEmptyLines: true,
          delimiter: ',', // Explicitly set delimiter
          newline: '\n', // Explicitly set newline
        })
      } catch {
        setError('Failed to load CSV file')
        setIsLoading(false)
      }
    }

    fetchAndParseCsv()
  }, [url, verifiedPassword])

  if (isLoading) {
    return (
      <div className="w-full flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading CSV data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full flex flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground mb-2">{error}</p>
        <iframe
          src={url}
          className="w-full h-full border-0 font-mono"
          title={title}
        />
      </div>
    )
  }

  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <table className="w-full border-collapse">
        <thead className="bg-muted sticky top-0">
          <tr>
            {csvData[0]?.map((header, i) => (
              <th
                key={i}
                className="p-2 text-left border border-border font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csvData.slice(1).map((row, i) => (
            <tr key={i} className="hover:bg-muted/50">
              {row.map((cell, j) => (
                <td key={j} className="p-2 border border-border">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Add a function to get the appropriate language extension for CodeMirror
function getLanguageExtension(language: string) {
  switch (language) {
    case 'html':
      return html()
    case 'css':
      return css()
    case 'javascript':
      return javascript()
    case 'json':
      return json()
    case 'jsx':
      return javascript({ jsx: true })
    case 'typescript':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'python':
      return python()
    case 'markdown':
      return markdown()
    case 'yaml':
      return yaml()
    case 'java':
      return java()
    case 'sql':
      return sql()
    case 'xml':
      return xml()
    case 'wasm':
      return wast()
    case 'c':
    case 'cpp':
      return cpp()
    case 'rust':
      return rust()
    case 'php':
      return php()
    case 'go':
      return go()
    case 'sass':
      return sass()
    case 'scss':
      return sass()
    case 'less':
      return less()
    default:
      return javascript() // Default to javascript for unknown languages
  }
}

export function ProtectedFile({ file }: ProtectedFileProps) {
  const { data: session } = useSession()
  const [isVerified, setIsVerified] = useState(false)
  const [verifiedPassword, setVerifiedPassword] = useState<string>()
  const [codeContent, setCodeContent] = useState<string>()
  const [fileUrls, setFileUrls] = useState<{
    fileUrl: string
    rawUrl: string
  }>()
  const isOwner = session?.user?.id === file.userId

  // Check if file is accessible
  const isPrivate = file.visibility === 'PRIVATE' && !session?.user

  // Check if file is text-based
  const isTextBased = Boolean(
    CODE_FILE_TYPES[file.mimeType] ||
      TEXT_FILE_TYPES.includes(file.mimeType) ||
      file.mimeType === 'text/csv'
  )

  // Set up URLs when password or verification status changes
  useEffect(() => {
    const fileUrl = `/api/files${sanitizeUrl(file.urlPath)}${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
    const rawUrl = `${sanitizeUrl(file.urlPath)}/raw${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
    setFileUrls({ fileUrl, rawUrl })
  }, [file.urlPath, verifiedPassword])

  // Check URL parameters for password on client-side only if not owner
  useEffect(() => {
    if (!isOwner && file.password) {
      const searchParams = new URLSearchParams(window.location.search)
      const parentVerifiedPassword = searchParams.get('password')
      if (parentVerifiedPassword && !verifiedPassword) {
        setVerifiedPassword(parentVerifiedPassword)
        setIsVerified(true)
      }
    }
  }, [verifiedPassword, isOwner, file.password])

  // Fetch code content for syntax highlighting if needed
  const fetchCodeContent = useCallback(async () => {
    if (CODE_FILE_TYPES[file.mimeType] && !codeContent) {
      const response = await fetch(
        `/api/files${sanitizeUrl(file.urlPath)}${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
      )
      const text = await response.text()
      setCodeContent(text)
    }
  }, [file.mimeType, file.urlPath, verifiedPassword, codeContent])

  // Call fetchCodeContent when component mounts or when dependencies change
  useEffect(() => {
    if (!isPrivate && (!file.password || isVerified || isOwner)) {
      if (CODE_FILE_TYPES[file.mimeType]) {
        fetchCodeContent()
      } else if (TEXT_FILE_TYPES.includes(file.mimeType) && !codeContent) {
        fetch(
          `/api/files${sanitizeUrl(file.urlPath)}${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
        )
          .then((response) => response.text())
          .then((text) => setCodeContent(text))
      }
    }
  }, [
    file.mimeType,
    file.urlPath,
    verifiedPassword,
    isPrivate,
    file.password,
    isVerified,
    isOwner,
    codeContent,
    fetchCodeContent,
  ])

  if (isPrivate) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <LockIcon className="h-12 w-12 text-muted-foreground" />
        <p className="text-center text-muted-foreground">
          This file is private. Please sign in to view it.
        </p>
        <Button asChild>
          <Link href="/auth/signin">Sign In</Link>
        </Button>
      </div>
    )
  }

  // Only show password prompt if not owner and password is required
  if (file.password && !isOwner && !isVerified) {
    const verifyPassword = async (password: string) => {
      const response = await fetch(
        `/api/files${sanitizeUrl(file.urlPath)}?password=${password}`
      )
      if (response.ok) {
        setVerifiedPassword(password)
      }
      return response.ok
    }

    return (
      <PasswordPrompt
        onSubmit={verifyPassword}
        onSuccess={() => setIsVerified(true)}
      />
    )
  }

  return (
    <>
      {/* File content */}
      <div className="bg-black/5 dark:bg-white/5 flex items-center justify-center">
        {(() => {
          if (!fileUrls) return null
          const { fileUrl, rawUrl } = fileUrls

          // Image files
          if (file.mimeType.startsWith('image/')) {
            return (
              <img
                src={fileUrl}
                alt={file.name}
                className="max-w-full max-h-[70vh] object-contain"
              />
            )
          }

          // CSV files - check both MIME type and file extension
          if (
            file.mimeType.includes('csv') ||
            file.name.toLowerCase().endsWith('.csv')
          ) {
            console.log('CSV file detected, using CSV viewer')
            return (
              <CsvViewer
                url={fileUrl}
                title={file.name}
                verifiedPassword={verifiedPassword}
              />
            )
          }

          // PDF files
          if (file.mimeType === 'application/pdf') {
            return (
              <div className="w-full">
                <iframe
                  src={fileUrl}
                  className="w-full h-[80vh]"
                  title={file.name}
                />
              </div>
            )
          }

          // Video files
          if (VIDEO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
            return (
              <video
                src={rawUrl}
                controls
                className="max-w-full max-h-[70vh]"
                controlsList="nodownload"
                preload="metadata"
              >
                <source src={rawUrl} type={file.mimeType} />
                Your browser does not support the video tag.
              </video>
            )
          }

          // Audio files
          if (AUDIO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
            return (
              <div className="w-full p-8">
                <audio
                  src={fileUrl}
                  controls
                  className="w-full"
                  controlsList="nodownload"
                  preload="metadata"
                >
                  <source src={fileUrl} type={file.mimeType} />
                  Your browser does not support the audio tag.
                </audio>
              </div>
            )
          }

          // Code files with syntax highlighting
          if (CODE_FILE_TYPES[file.mimeType]) {
            return (
              <div className="w-full max-h-[60vh] overflow-auto">
                <CodeMirror
                  value={codeContent || ''}
                  width="40vw"
                  extensions={[
                    getLanguageExtension(CODE_FILE_TYPES[file.mimeType]),
                  ]}
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

          // Text files (plain text, markdown, etc)
          if (TEXT_FILE_TYPES.includes(file.mimeType)) {
            console.log('Text file detected, using text viewer')
            if (!codeContent) {
              return (
                <div className="w-full flex items-center justify-center p-8">
                  <p className="text-muted-foreground">
                    Loading text content...
                  </p>
                </div>
              )
            }
            return (
              <div className="w-full max-h-[60vh] overflow-auto">
                <CodeMirror
                  value={codeContent}
                  width="40vw"
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

          // Default fallback for unsupported file types
          return (
            <div className="w-full flex flex-col items-center justify-center p-8 text-center">
              <p className="text-muted-foreground mb-2">
                Preview not available for this file type
              </p>
              <p className="text-sm text-muted-foreground">({file.mimeType})</p>
            </div>
          )
        })()}
      </div>

      {/* Actions */}
      <div className="p-6 border-t bg-muted/50">
        <FileActions
          urlPath={sanitizeUrl(file.urlPath)}
          name={file.name}
          verifiedPassword={verifiedPassword}
          showOcr={file.mimeType.startsWith('image/')}
          isTextBased={isTextBased}
          content={codeContent}
          fileId={file.id}
        />
      </div>
    </>
  )
}
