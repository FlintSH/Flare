import { NextResponse } from 'next/server'

import { readImageUpload } from '@/lib/customization/image-upload'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { AVATAR_POLICY } from '@/lib/storage/avatar-policy'
import { uploadAvatar } from '@/lib/users/avatar'

const api = routes('/api/profile/avatar', {
  failure: { message: 'Failed to upload avatar' },
  logger: loggers.users,
})

export const POST = api(async (request) => {
  const { session } = await requireSession(request, 'profile.update')
  const { bytes } = await readImageUpload(request, AVATAR_POLICY)
  const publicPath = await uploadAvatar(session.user.id, bytes)
  return NextResponse.json({ success: true, url: publicPath })
})
