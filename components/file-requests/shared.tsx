'use client'

import { formatDistanceToNow } from 'date-fns'

import { Badge } from '@/components/ui/badge'

import {
  type FileRequestStatus,
  type FileRequestView,
  fileRequestUrl,
  formatRequestBytes,
} from '@/lib/file-requests/policy'

export async function requestJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(result.error || 'File requests are unavailable. Try again.')
  return result
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

const statusVariants = {
  open: 'success',
  paused: 'warning',
  full: 'neutral',
  expired: 'neutral',
  closed: 'neutral',
} as const satisfies Record<FileRequestStatus, string>

export const statusLabels: Record<FileRequestStatus, string> = {
  open: 'Open',
  paused: 'Paused',
  full: 'Full',
  expired: 'Expired',
  closed: 'Closed',
}

export function RequestStatus({ status }: { status: FileRequestStatus }) {
  return <Badge variant={statusVariants[status]}>{statusLabels[status]}</Badge>
}

export function absolute(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function relative(value: string) {
  return formatDistanceToNow(new Date(value), { addSuffix: true })
}

export function requestLink(request: Pick<FileRequestView, 'token'>) {
  return fileRequestUrl(window.location.origin, request.token)
}

/** "12 files · 340 MB received", "of 20 files" when limited. */
export function receivedText(request: FileRequestView) {
  const files =
    request.maxFiles === null
      ? `${request.fileCount} ${request.fileCount === 1 ? 'file' : 'files'}`
      : `${request.fileCount} of ${request.maxFiles} ${request.maxFiles === 1 ? 'file' : 'files'}`
  const bytes =
    request.maxBytes === null
      ? formatRequestBytes(request.bytesReceived)
      : `${formatRequestBytes(request.bytesReceived)} of ${formatRequestBytes(request.maxBytes)}`
  return `${files} · ${bytes}`
}

export function lifetimeText(request: FileRequestView) {
  if (request.closedAt) return `Closed ${relative(request.closedAt)}`
  if (!request.expiresAt) return 'No deadline'
  const expires = new Date(request.expiresAt)
  return `${expires <= new Date() ? 'Closed' : 'Closes'} ${relative(request.expiresAt)}`
}

export function destinationText(request: FileRequestView) {
  return `Saves to ${request.folder?.name ?? 'Unfiled'} · ${request.profile ? `${request.profile.name} profile` : 'Account default'}`
}
