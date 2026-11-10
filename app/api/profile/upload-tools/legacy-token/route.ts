import { NextResponse } from 'next/server'

import { setAuditTarget } from '@/lib/audit'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'
import { UPLOADER_DOWNLOAD_PERMISSION } from '@/lib/uploads/uploader-clients'
import {
  legacyUploadTokenStatus,
  revokeLegacyUploadToken,
} from '@/lib/users/legacy-upload-token'

/**
 * Revokes the account upload token from before end-to-end encryption
 * (docs/e2ee-spec.md, section 14.4). Each tool that still holds it stops
 * uploading. Flare issues no replacement: a tool gets a new configuration
 * with a named token. Browser sessions only.
 */
const api = routes('/api/profile/upload-tools/legacy-token', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const DELETE = api(async (request) => {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const { user } = await requireSession(request, UPLOADER_DOWNLOAD_PERMISSION, {
    refuseApiCredentials: true,
  })
  setAuditTarget({ type: 'user', id: user.id })
  await revokeLegacyUploadToken(user.id)
  return NextResponse.json({
    legacyToken: await legacyUploadTokenStatus(user.id),
  })
})
