import { prisma } from '@/lib/database/prisma'
import { emailSettingsRoutes, requireEmailAdmin } from '@/lib/email/admin'
import { getEmailConfig, prepareEmailConfig } from '@/lib/email/config'
import { hasVerifiedEmail } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

async function impact(config: EmailConfig) {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      emailVerifiedFor: true,
      emailVerified: true,
      emailVerificationSource: true,
      emailExempt: true,
    },
  })
  const unverified = users.filter((user) => !hasVerifiedEmail(user, config))
  return {
    data: {
      unverifiedUsers: unverified.length,
      affectedUsers: unverified.filter((user) => !user.emailExempt).length,
    },
  }
}

const api = routes('/api/settings/email/impact', emailSettingsRoutes)

export const GET = api(async (request) => {
  await requireEmailAdmin(request)
  return impact(await getEmailConfig())
})

export const POST = api(async (request) => {
  await requireEmailAdmin(request)
  const body = (await readJson(request)) as {
    config?: unknown
    clearPassword?: unknown
  }
  return impact(
    (await prepareEmailConfig(body.config, body.clearPassword === true))
      .effective
  )
})
