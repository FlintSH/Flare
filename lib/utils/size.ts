// Files and accounts record their sizes (`File.size`, `User.storageUsed`) in
// megabytes of 1024 * 1024 bytes; everything else counts bytes.
const BYTES_PER_MB = 1024 * 1024

export function bytesToMB(bytes: number): number {
  return bytes / BYTES_PER_MB
}

export function mbToBytes(mb: number): number {
  return mb * BYTES_PER_MB
}

/** A size in bytes for people, without trailing zeros: `1.5 MB`. */
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/** A recorded size in megabytes for people, with fixed decimals: `1.50 MB`. */
export function formatFileSize(mb: number, decimals = 2): string {
  const bytes = mbToBytes(mb)

  if (bytes === 0) return '0 B'

  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(decimals)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(decimals)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(decimals)} GB`
}
