import { withAuditRoute } from '@/lib/audit'
import {
  passkeyName,
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { changePasskey } from '@/lib/auth/security/passkeys'

type Context = { params: Promise<{ id: string }> }
async function handleDELETE(req: Request, { params }: Context) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return changePasskey(
      session,
      (await params).id,
      proofSchema.parse(await securityBody(req))
    )
  })
}
async function handlePATCH(req: Request, { params }: Context) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const data = proofSchema
      .extend({ name: passkeyName })
      .parse(await securityBody(req))
    return changePasskey(session, (await params).id, data, data.name)
  })
}

export async function DELETE(req: Request, { params }: Context) {
  return withAuditRoute(async () => handleDELETE(req, { params }), {
    route: '/api/auth/security/passkeys/[id]',
  })(req)
}

export async function PATCH(req: Request, { params }: Context) {
  return withAuditRoute(async () => handlePATCH(req, { params }), {
    route: '/api/auth/security/passkeys/[id]',
  })(req)
}
