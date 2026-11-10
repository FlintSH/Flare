import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { publicOrigin } from '@/lib/security/public-origin'
import { UPLOADER_DOWNLOAD_PERMISSION } from '@/lib/uploads/uploader-clients'
import { legacyUploadTokenStatus } from '@/lib/users/legacy-upload-token'

/**
 * What the Upload tools card needs to write a configuration: the public
 * address that an installed tool uploads to, and the state of the upload
 * token from before end-to-end encryption (docs/e2ee-spec.md, section
 * 14.4). It returns no token and no key. The account public key of a
 * configuration comes from the unlocked keys of the browser, never from
 * here (section 10.2). Browser sessions only.
 */
const api = routes('/api/profile/upload-tools', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

/**
 * Installed tools upload to the public server URL, without a query or
 * fragment. A path in NEXTAUTH_URL is kept.
 */
function publicServerOrigin() {
  const url = process.env.NEXTAUTH_URL
    ? publicOrigin()
    : process.env.NODE_ENV === 'development'
      ? new URL('http://localhost:3000')
      : null
  if (!url || url.search || url.hash)
    throw new HttpError(500, 'Invalid server URL configuration')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export const GET = api(
  async (request) => {
    const { user } = await requireSession(
      request,
      UPLOADER_DOWNLOAD_PERMISSION,
      { refuseApiCredentials: true }
    )
    return NextResponse.json({
      origin: publicServerOrigin(),
      legacyToken: await legacyUploadTokenStatus(user.id),
    })
  },
  { audit: { skipSuccess: true } }
)
