import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { securityRoute } from '@/lib/auth/security/http'
import {
  authenticationOptions,
  passkeyCookieName,
} from '@/lib/auth/security/passkeys'
import {
  relyingParty,
  requestIp,
  securityLimit,
  validateSecurityOrigin,
} from '@/lib/auth/security/shared'

async function handlePOST(req: Request) {
  return securityRoute(async () => {
    validateSecurityOrigin(req)
    await securityLimit(`passkey-options:${requestIp(req.headers)}`, 100)
    const { binding, ...result } = await authenticationOptions()
    const response = NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
    response.cookies.set(passkeyCookieName(), binding, {
      httpOnly: true,
      sameSite: 'strict',
      secure: relyingParty().origin.startsWith('https:'),
      path: '/',
      maxAge: 300,
    })
    return response
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/passkeys/options',
  })(req)
}
