import {
  passkeyName,
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { changePasskey } from '@/lib/auth/security/passkeys'

type Context = { params: Promise<{ id: string }> }
export async function DELETE(req: Request, { params }: Context) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return changePasskey(
      session,
      (await params).id,
      proofSchema.parse(await securityBody(req))
    )
  })
}
export async function PATCH(req: Request, { params }: Context) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const data = proofSchema
      .extend({ name: passkeyName })
      .parse(await securityBody(req))
    return changePasskey(session, (await params).id, data, data.name)
  })
}
