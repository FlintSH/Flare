import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024)
}

export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024
}

export function formatFileSize(mb: number, decimals = 2): string {
  const bytes = mb * 1024 * 1024

  if (bytes === 0) return '0 Bytes'

  if (bytes < 1024) {
    return `${bytes.toFixed(0)} Bytes`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(decimals)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(decimals)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(decimals)} GB`
}
