import { compare } from 'bcryptjs'

import { hasPermission } from '@/lib/permissions/catalog'

import {
  clearFilePasswordFailures,
  filePasswordBlock,
  isVerifiedFilePassword,
  recordFilePasswordFailure,
  rememberVerifiedFilePassword,
  verifiedFilePasswordKey,
} from './password-attempts'

export type FileAccessInfo = {
  id: string
  visibility: 'PUBLIC' | 'PRIVATE'
  userId: string
  password: string | null
}

export type SessionInfo = {
  user?: { id: string; permissions?: readonly string[] }
} | null

export type FileAccessAllowed = {
  allowed: true
  isOwner: boolean
  canModerate: boolean
}

export type FileAccessDenied = {
  allowed: false
  reason:
    | 'private'
    | 'password_required'
    | 'password_invalid'
    | 'password_rate_limited'
  status: 401 | 404 | 429
  /** Set when too many incorrect passwords paused new checks for this file. */
  retryAfterSeconds?: number
}

export type FileAccessResult = FileAccessAllowed | FileAccessDenied

export type FileAccessOptions = {
  /**
   * The client address for password attempt limits, from the request's
   * forwarded headers. Without one, only the file's own limit applies.
   */
  requester?: string | null
}

export async function checkFileAccess(
  file: FileAccessInfo,
  session: SessionInfo,
  providedPassword?: string | null,
  options: FileAccessOptions = {}
): Promise<FileAccessResult> {
  const isOwner =
    session?.user?.id === file.userId &&
    hasPermission(session?.user, 'files.read')
  const canModerate = hasPermission(session?.user, 'content.read')

  if (file.visibility === 'PRIVATE' && !isOwner && !canModerate) {
    return { allowed: false, reason: 'private', status: 404 }
  }

  if (file.password && !isOwner && !canModerate) {
    if (!providedPassword) {
      return { allowed: false, reason: 'password_required', status: 401 }
    }

    const requester =
      options.requester && options.requester !== 'unknown'
        ? options.requester
        : null
    const verifiedKey = await verifiedFilePasswordKey(
      file.id,
      file.password,
      providedPassword,
      requester
    )
    const verified = isVerifiedFilePassword(verifiedKey)
    // An address that recently proved the password keeps access during a
    // pause, so other people's guessing cannot interrupt its playback.
    // Everyone else is refused before comparing, revealing nothing.
    if (!(verified && requester)) {
      const block = filePasswordBlock(file.id, requester)
      if (block) {
        return {
          allowed: false,
          reason: 'password_rate_limited',
          status: 429,
          retryAfterSeconds: block.retryAfterSeconds,
        }
      }
    }

    if (!verified) {
      const isPasswordValid = await compare(providedPassword, file.password)
      if (!isPasswordValid) {
        await recordFilePasswordFailure(file.id, requester, providedPassword)
        return { allowed: false, reason: 'password_invalid', status: 401 }
      }
      rememberVerifiedFilePassword(verifiedKey)
      clearFilePasswordFailures(file.id, requester)
    }
  }

  return { allowed: true, isOwner, canModerate }
}

/** Headers for a denied file response; tells clients when to retry a 429. */
export function fileAccessDeniedHeaders(
  access: FileAccessDenied
): Record<string, string> {
  return access.retryAfterSeconds
    ? { 'Retry-After': String(access.retryAfterSeconds) }
    : {}
}

/** Whole minutes until a paused file accepts passwords again, for messages. */
export function retryAfterMinutes(access: FileAccessDenied) {
  return Math.max(1, Math.ceil((access.retryAfterSeconds ?? 60) / 60))
}
