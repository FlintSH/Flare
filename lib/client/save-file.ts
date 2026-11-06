/** The filename in a `Content-Disposition` value, preferring the UTF-8 form. */
function dispositionFilename(header: string | null) {
  if (!header) return undefined
  const extended = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1])
    } catch {
      // Malformed escapes: use the plain name below.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)
  if (quoted) return quoted[1].replace(/\\(.)/g, '$1')
  return /filename\s*=\s*([^;\s]+)/i.exec(header)?.[1]
}

export function responseFilename(response: Response, fallbackName: string) {
  return (
    dispositionFilename(response.headers.get('content-disposition')) ||
    fallbackName
  )
}

export function saveBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Some browsers cancel a download whose URL is revoked as it starts.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveResponseAsFile(
  response: Response,
  fallbackName: string
) {
  const filename = responseFilename(response, fallbackName)
  saveBlobAsFile(await response.blob(), filename)
}
