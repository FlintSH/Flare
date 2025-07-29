'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import DOMPurify from 'dompurify'

import { sanitizeUrl } from '@/lib/utils/url'

import type {
  FileViewerContext as FileViewerContextType,
  FileViewerFile,
  FileViewerState,
} from './types'

const FileViewerContext = createContext<FileViewerContextType | null>(null)

interface FileViewerProviderProps {
  children: React.ReactNode
  file: FileViewerFile
  verifiedPassword?: string
}

export function FileViewerProvider({
  children,
  file,
  verifiedPassword,
}: FileViewerProviderProps) {
  const [state, setState] = useState<FileViewerState>({
    isLoading: true,
    error: undefined,
  })

  const urls = useMemo(() => {
    const passwordParam = verifiedPassword
      ? `?password=${verifiedPassword}`
      : ''
    return {
      fileUrl: DOMPurify.sanitize(
        `/api/files${sanitizeUrl(file.urlPath)}${passwordParam}`
      ),
      rawUrl: DOMPurify.sanitize(
        `${sanitizeUrl(file.urlPath)}/raw${passwordParam}`
      ),
    }
  }, [file.urlPath, verifiedPassword])

  const fetchContent = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }))

    try {
      const response = await fetch(urls.fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.status}`)
      }
      const content = await response.text()
      setState((prev) => ({
        ...prev,
        content,
        urls,
        isLoading: false,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : 'Failed to fetch content',
        isLoading: false,
      }))
    }
  }

  const fetchDirectUrl = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }))

    try {
      const passwordParam = verifiedPassword
        ? `?password=${verifiedPassword}`
        : ''
      const response = await fetch(
        `${sanitizeUrl(file.urlPath)}/direct${passwordParam}`
      )
      if (!response.ok) {
        throw new Error(`Failed to fetch direct URL: ${response.status}`)
      }
      const data = await response.json()
      const directUrl = DOMPurify.sanitize(data.url)

      setState((prev) => ({
        ...prev,
        urls: prev.urls ? { ...prev.urls, directUrl } : { ...urls, directUrl },
        isLoading: false,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : 'Failed to fetch direct URL',
        isLoading: false,
      }))
    }
  }

  useEffect(() => {
    setState((prev) => ({ ...prev, urls, isLoading: false }))
  }, [urls])

  const contextValue: FileViewerContextType = {
    file,
    verifiedPassword,
    state,
    fetchContent,
    fetchDirectUrl,
  }

  return (
    <FileViewerContext.Provider value={contextValue}>
      {children}
    </FileViewerContext.Provider>
  )
}

export function useFileViewer() {
  const context = useContext(FileViewerContext)
  if (!context) {
    throw new Error('useFileViewer must be used within a FileViewerProvider')
  }
  return context
}
