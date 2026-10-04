import {
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { changeTotp } from '@/lib/auth/security/service'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return changeTotp(
      session,
      proofSchema.parse(await securityBody(req)),
      false
    )
  })
}
