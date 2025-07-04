import { useRouter } from 'next/navigation'

import { useToast } from './use-toast'

export interface FileActionsOptions {
  urlPath?: string
  name?: string
  fileId?: string
  verifiedPassword?: string
}

export function useFileActions(options: FileActionsOptions = {}) {
  const router = useRouter()
  const { toast } = useToast()

  const copyUrl = () => {
    if (!options.urlPath) return

    const baseUrl = window.location.origin
    const url = `${baseUrl}${options.urlPath}`

    navigator.clipboard.writeText(url).then(() => {
      toast({
        title: 'URL copied',
        description: 'The file URL has been copied to your clipboard',
      })
    })
  }

  const copyRawUrl = () => {
    if (!options.urlPath) return

    const baseUrl = window.location.origin
    let url = `${baseUrl}${options.urlPath}/raw`

    if (options.verifiedPassword) {
      url += `?password=${encodeURIComponent(options.verifiedPassword)}`
    }

    navigator.clipboard.writeText(url).then(() => {
      toast({
        title: 'Raw URL copied',
        description: 'The raw file URL has been copied to your clipboard',
      })
    })
  }

  const download = () => {
    if (!options.name) return

    const baseUrl = window.location.origin
    let url: string

    // Use the dedicated download endpoint if fileId is available
    if (options.fileId) {
      url = `${baseUrl}/api/files/${options.fileId}/download`

      if (options.verifiedPassword) {
        url += `?password=${encodeURIComponent(options.verifiedPassword)}`
      }
    } else if (options.urlPath) {
      // Fallback to raw endpoint if no fileId
      url = `${baseUrl}${options.urlPath}/raw`

      if (options.verifiedPassword) {
        url += `?password=${encodeURIComponent(options.verifiedPassword)}`
      }
    } else {
      return
    }

    // Create a temporary link and trigger download
    const link = document.createElement('a')
    link.href = url
    link.download = options.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const openRaw = () => {
    if (!options.urlPath) return

    const baseUrl = window.location.origin
    let url = `${baseUrl}${options.urlPath}/raw`

    if (options.verifiedPassword) {
      url += `?password=${encodeURIComponent(options.verifiedPassword)}`
    }

    window.open(url, '_blank')
  }

  return {
    copyUrl,
    copyRawUrl,
    download,
    openRaw,
  }
}
