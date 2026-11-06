import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { FORM_FRAMING_BYTES, readForm } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { validateFileType } from '@/lib/security/file-validation'
import { AVATAR_MAX_BYTES, avatarProblem } from '@/lib/storage/avatar-policy'
import { uploadAvatar } from '@/lib/users/avatar'

const api = routes('/api/profile/avatar', {
  failure: { message: 'Failed to upload avatar' },
  logger: loggers.users,
})

export const POST = api(async (request) => {
  const { session } = await requireSession(request, 'profile.update')

  const formData = await readForm(request, {
    limit: AVATAR_MAX_BYTES + FORM_FRAMING_BYTES,
  })
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new HttpError(400, 'No file provided')
  }

  const problem = avatarProblem(file)
  if (problem) {
    throw new HttpError(problem.status, problem.message)
  }

  const avatarBuffer = Buffer.from(await file.arrayBuffer())
  // Every accepted format has a signature, so content without one is refused.
  const typeCheck = await validateFileType(avatarBuffer, file.type)
  if (!typeCheck.valid || !typeCheck.detectedType) {
    throw new HttpError(400, 'File content does not match claimed image type')
  }

  const publicPath = await uploadAvatar(session.user.id, avatarBuffer)
  return NextResponse.json({ success: true, url: publicPath })
})
