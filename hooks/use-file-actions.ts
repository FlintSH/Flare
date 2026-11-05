export interface FileActionsOptions {
  urlPath?: string
  name?: string
  fileId?: string
  verifiedPassword?: string
}

export function useFileActions(options: FileActionsOptions = {}) {
  const download = () => {
    if (!options.name) return

    const baseUrl = window.location.origin
    let url: string

    if (options.fileId) {
      url = `${baseUrl}/api/files/${options.fileId}/download`

      if (options.verifiedPassword) {
        url += `?password=${encodeURIComponent(options.verifiedPassword)}`
      }
    } else if (options.urlPath) {
      url = `${baseUrl}${options.urlPath}/raw`

      if (options.verifiedPassword) {
        url += `?password=${encodeURIComponent(options.verifiedPassword)}`
      }
    } else {
      return
    }

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
    download,
    openRaw,
  }
}
