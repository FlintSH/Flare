import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { PermissionError, requirePermission } from '@/lib/permissions/server'
import { validateFileType } from '@/lib/security/file-validation'
import { uploadAvatar } from '@/lib/storage/avatar'

const logger = loggers.users

export async function POST(req: Request) {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('profile.update')
    if (permissionDenied) return permissionDenied
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    const avatarBytes = await file.arrayBuffer()
    const avatarBuffer = Buffer.from(avatarBytes)
    const typeCheck = await validateFileType(avatarBuffer, file.type)
    if (!typeCheck.valid) {
      return NextResponse.json(
        { error: 'File content does not match claimed image type' },
        { status: 400 }
      )
    }
    if (
      typeCheck.detectedType &&
      !typeCheck.detectedType.startsWith('image/')
    ) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    const publicPath = await uploadAvatar(session.user.id, avatarBuffer)
    return NextResponse.json({ success: true, url: publicPath })
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    logger.error('Avatar upload error', error as Error)
    return NextResponse.json(
      { error: 'Failed to upload avatar' },
      { status: 500 }
    )
  }
}
