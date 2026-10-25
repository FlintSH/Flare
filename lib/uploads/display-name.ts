/**
 * The display name Flare stores for an uploaded file. Only the final path
 * component is kept, as busboy already does for multipart uploads, and
 * control characters are removed. Returns null when no usable name remains.
 */
export function uploadDisplayName(filename: string): string | null {
  const separator = Math.max(
    filename.lastIndexOf('/'),
    filename.lastIndexOf('\\')
  )
  const name = filename.slice(separator + 1).replace(/[\x00-\x1f\x7f]/g, '')
  return name && name !== '.' && name !== '..' ? name : null
}
