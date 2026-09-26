import { compare } from 'bcryptjs'

import { hasPermission } from '@/lib/permissions/catalog'

export type FileAccessInfo = {
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
  reason: 'private' | 'password_required' | 'password_invalid'
  status: 401 | 404
}

export type FileAccessResult = FileAccessAllowed | FileAccessDenied

export async function checkFileAccess(
  file: FileAccessInfo,
  session: SessionInfo,
  providedPassword?: string | null
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

    const isPasswordValid = await compare(providedPassword, file.password)
    if (!isPasswordValid) {
      return { allowed: false, reason: 'password_invalid', status: 401 }
    }
  }

  return { allowed: true, isOwner, canModerate }
}
