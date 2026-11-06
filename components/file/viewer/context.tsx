'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { fileUrls } from '@/lib/files/urls'

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

  const { content: fileUrl, direct: directLookupUrl } = fileUrls(file, {
    password: verifiedPassword,
  })
  const urls = useMemo(() => ({ fileUrl }), [fileUrl])

  const fetchContent = useCallback(async () => {
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
  }, [urls])

  const fetchDirectUrl = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }))

    try {
      const response = await fetch(directLookupUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch direct URL: ${response.status}`)
      }
      const data = await response.json()
      const directUrl: string = data.url

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
  }, [directLookupUrl, urls])

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
