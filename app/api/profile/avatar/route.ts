import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { validateFileType } from '@/lib/security/file-validation'
import { uploadAvatar } from '@/lib/storage/avatar'

const api = routes('/api/profile/avatar', {
  failure: { message: 'Failed to upload avatar' },
  logger: loggers.users,
})

export const POST = api(async (request) => {
  const { session } = await requireSession('profile.update')

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new HttpError(400, 'No file provided')
  }

  if (!file.type.startsWith('image/')) {
    throw new HttpError(400, 'File must be an image')
  }

  const avatarBytes = await file.arrayBuffer()
  const avatarBuffer = Buffer.from(avatarBytes)
  const typeCheck = await validateFileType(avatarBuffer, file.type)
  if (!typeCheck.valid) {
    throw new HttpError(400, 'File content does not match claimed image type')
  }
  if (typeCheck.detectedType && !typeCheck.detectedType.startsWith('image/')) {
    throw new HttpError(400, 'File must be an image')
  }

  const publicPath = await uploadAvatar(session.user.id, avatarBuffer)
  return NextResponse.json({ success: true, url: publicPath })
})
