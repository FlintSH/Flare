import { NextResponse } from 'next/server'

import { securityRoutes } from '@/lib/auth/security/http'
import {
  authenticationOptions,
  passkeyCookieName,
} from '@/lib/auth/security/passkeys'
import {
  relyingParty,
  securityLimit,
  validateSecurityOrigin,
} from '@/lib/auth/security/shared'
import { routes } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'

const api = routes('/api/auth/passkeys/options', securityRoutes)

export const POST = api(async (request) => {
  validateSecurityOrigin(request)
  await securityLimit(
    `passkey-options:${clientIp(request.headers) ?? 'unknown'}`,
    100
  )
  const { binding, ...result } = await authenticationOptions()
  const response = NextResponse.json(result)
  response.cookies.set(passkeyCookieName(), binding, {
    httpOnly: true,
    sameSite: 'strict',
    secure: relyingParty().origin.startsWith('https:'),
    path: '/',
    maxAge: 300,
  })
  return response
})
