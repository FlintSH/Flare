import { compare } from 'bcryptjs'

export type FileAccessInfo = {
  visibility: 'PUBLIC' | 'PRIVATE'
  userId: string
  password: string | null
}

export type SessionInfo = {
  user?: { id: string; role?: string }
} | null

export type FileAccessAllowed = {
  allowed: true
  isOwner: boolean
  isAdmin: boolean
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
  const isOwner = session?.user?.id === file.userId
  const isAdmin = session?.user?.role === 'ADMIN'

  if (file.visibility === 'PRIVATE' && !isOwner && !isAdmin) {
    return { allowed: false, reason: 'private', status: 404 }
  }

  if (file.password && !isOwner && !isAdmin) {
    if (!providedPassword) {
      return { allowed: false, reason: 'password_required', status: 401 }
    }

    const isPasswordValid = await compare(providedPassword, file.password)
    if (!isPasswordValid) {
      return { allowed: false, reason: 'password_invalid', status: 401 }
    }
  }

  return { allowed: true, isOwner, isAdmin }
}
