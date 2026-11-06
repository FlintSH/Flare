import { NextResponse } from 'next/server'

import { securityRoutes } from '@/lib/auth/security/http'
import {
  authenticationOptions,
  passkeyChallengeCookie,
} from '@/lib/auth/security/passkeys'
import { securityLimit } from '@/lib/auth/security/shared'
import { refuseApiCredentials } from '@/lib/http/access'
import { assertSameOrigin } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'

const api = routes('/api/auth/passkeys/options', securityRoutes)

export const POST = api(async (request) => {
  refuseApiCredentials(request)
  assertSameOrigin(request)
  await securityLimit(
    `passkey-options:${clientIp(request.headers) ?? 'unknown'}`,
    100
  )
  const { binding, ...result } = await authenticationOptions()
  const response = NextResponse.json(result)
  response.cookies.set(passkeyChallengeCookie(binding))
  return response
})
