import { useCallback, useState } from 'react'

import { useToast } from './use-toast'

export interface File {
  id: string
  name: string
  mimeType: string
  size: number
  visibility: 'PUBLIC' | 'PRIVATE'
  password?: string | null
  uploadedAt: string
  urlPath: string
}

export interface ShortenedUrl {
  id: string
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: string
}

export interface PaginationData {
  total: number
  pages: number
  page: number
  limit: number
}

export interface FileResponse {
  files: File[]
  pagination: PaginationData
}

export interface UrlResponse {
  urls: ShortenedUrl[]
  pagination: PaginationData
}

export interface FileFilters {
  search: string
  visibility: 'PUBLIC' | 'PRIVATE' | null
  type: string
}

export interface UseUserContentOptions {
  onFileDeleted?: (fileId: string) => void
  onFileUpdated?: (file: File) => void
  onUrlDeleted?: (urlId: string) => void
}

export function useUserContent(
  userId: string,
  options: UseUserContentOptions = {}
) {
  const [userFiles, setUserFiles] = useState<File[]>([])
  const [userUrls, setUserUrls] = useState<ShortenedUrl[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isLoadingUrls, setIsLoadingUrls] = useState(false)
  const [fileFilters, setFileFilters] = useState<FileFilters>({
    search: '',
    visibility: null,
    type: '',
  })
  const [urlSearch, setUrlSearch] = useState('')
  const [filePage, setFilePage] = useState(1)
  const [urlPage, setUrlPage] = useState(1)
  const [filePagination, setFilePagination] = useState<PaginationData | null>(
    null
  )
  const [urlPagination, setUrlPagination] = useState<PaginationData | null>(
    null
  )
  const { toast } = useToast()

  const fetchUserFiles = useCallback(
    async (page: number = 1, filters: FileFilters = fileFilters) => {
      if (!userId) return

      try {
        setIsLoadingFiles(true)
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
        })

        if (filters.search) {
          params.set('search', filters.search)
        }
        if (filters.visibility) {
          params.set('visibility', filters.visibility)
        }
        if (filters.type) {
          params.set('type', filters.type)
        }

        const response = await fetch(`/api/users/${userId}/files?${params}`)
        if (!response.ok) throw new Error('Failed to fetch user files')
        const data: FileResponse = await response.json()
        setUserFiles(data.files)
        setFilePagination(data.pagination)
        setFilePage(page)
      } catch (error) {
        console.error('Error fetching user files:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch user files',
          variant: 'destructive',
        })
      } finally {
        setIsLoadingFiles(false)
      }
    },
    [userId, fileFilters, toast]
  )

  const fetchUserUrls = useCallback(
    async (page: number = 1, search: string = urlSearch) => {
      if (!userId) return

      try {
        setIsLoadingUrls(true)
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
        })

        if (search) {
          params.set('search', search)
        }

        const response = await fetch(`/api/users/${userId}/urls?${params}`)
        if (!response.ok) throw new Error('Failed to fetch user URLs')
        const data: UrlResponse = await response.json()
        setUserUrls(data.urls)
        setUrlPagination(data.pagination)
        setUrlPage(page)
      } catch (error) {
        console.error('Error fetching user URLs:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch user URLs',
          variant: 'destructive',
        })
      } finally {
        setIsLoadingUrls(false)
      }
    },
    [userId, urlSearch, toast]
  )

  const updateFileSettings = useCallback(
    async (
      fileId: string,
      visibility: 'PUBLIC' | 'PRIVATE',
      password?: string
    ) => {
      try {
        const response = await fetch(`/api/users/${userId}/files/${fileId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            visibility,
            password: password || null,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to update file settings')
        }

        const updatedFile = await response.json()

        setUserFiles((prevFiles) =>
          prevFiles.map((file) => (file.id === fileId ? updatedFile : file))
        )

        if (options.onFileUpdated) {
          options.onFileUpdated(updatedFile)
        }

        toast({
          title: 'Success',
          description: 'File settings updated successfully',
        })

        return updatedFile
      } catch (error) {
        console.error('Error updating file settings:', error)
        toast({
          title: 'Error',
          description: 'Failed to update file settings',
          variant: 'destructive',
        })
        throw error
      }
    },
    [userId, toast, options]
  )

  const deleteFile = useCallback(
    async (fileId: string) => {
      try {
        const response = await fetch(`/api/users/${userId}/files/${fileId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to delete file')
        }

        setUserFiles((prevFiles) =>
          prevFiles.filter((file) => file.id !== fileId)
        )

        if (filePagination) {
          setFilePagination({
            ...filePagination,
            total: filePagination.total - 1,
            pages: Math.ceil((filePagination.total - 1) / filePagination.limit),
          })
        }

        if (options.onFileDeleted) {
          options.onFileDeleted(fileId)
        }

        toast({
          title: 'Success',
          description: 'File deleted successfully',
        })
      } catch (error) {
        console.error('Error deleting file:', error)
        toast({
          title: 'Error',
          description: 'Failed to delete file',
          variant: 'destructive',
        })
        throw error
      }
    },
    [userId, filePagination, toast, options]
  )

  const deleteUrl = useCallback(
    async (urlId: string) => {
      try {
        const response = await fetch(`/api/urls/${urlId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to delete URL')
        }

        setUserUrls((prevUrls) => prevUrls.filter((url) => url.id !== urlId))

        if (urlPagination) {
          setUrlPagination({
            ...urlPagination,
            total: urlPagination.total - 1,
            pages: Math.ceil((urlPagination.total - 1) / urlPagination.limit),
          })
        }

        if (options.onUrlDeleted) {
          options.onUrlDeleted(urlId)
        }

        toast({
          title: 'Success',
          description: 'URL deleted successfully',
        })
      } catch (error) {
        console.error('Error deleting URL:', error)
        toast({
          title: 'Error',
          description: 'Failed to delete URL',
          variant: 'destructive',
        })
        throw error
      }
    },
    [urlPagination, toast, options]
  )

  const handleFileFilterChange = useCallback(
    (filters: Partial<FileFilters>) => {
      const newFilters = { ...fileFilters, ...filters }
      setFileFilters(newFilters)
      fetchUserFiles(1, newFilters)
    },
    [fileFilters, fetchUserFiles]
  )

  const handleUrlSearchChange = useCallback(
    (search: string) => {
      setUrlSearch(search)
      fetchUserUrls(1, search)
    },
    [fetchUserUrls]
  )

  return {
    userFiles,
    userUrls,
    isLoadingFiles,
    isLoadingUrls,
    fileFilters,
    urlSearch,
    filePage,
    urlPage,
    filePagination,
    urlPagination,
    fetchUserFiles,
    fetchUserUrls,
    updateFileSettings,
    deleteFile,
    deleteUrl,
    handleFileFilterChange,
    handleUrlSearchChange,
    setFilePage,
    setUrlPage,
  }
}
