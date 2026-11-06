import {
  SECURITY_BODY_LIMIT,
  passkeyName,
  proofSchema,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { changePasskey } from '@/lib/auth/security/passkeys'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/auth/security/passkeys/[id]', securityRoutes)

export const DELETE = api(async (request, { params }: Context) => {
  const { session } = await securitySession(request)
  return changePasskey(
    session,
    (await params).id,
    await readJson(request, proofSchema, { limit: SECURITY_BODY_LIMIT })
  )
})

export const PATCH = api(async (request, { params }: Context) => {
  const { session } = await securitySession(request)
  const data = await readJson(
    request,
    proofSchema.extend({ name: passkeyName }),
    { limit: SECURITY_BODY_LIMIT }
  )
  return changePasskey(session, (await params).id, data, data.name)
})
