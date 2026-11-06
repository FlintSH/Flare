import { prisma } from '@/lib/database/prisma'
import { emailSettingsRoutes, readEmailDraft } from '@/lib/email/admin'
import { getEmailConfig, prepareEmailConfig } from '@/lib/email/config'
import { hasVerifiedEmail, satisfiesEmailPolicy } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import { requireSession } from '@/lib/http/access'
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
  // The accounts all-user verification shuts out once its grace period ends.
  const affected = users.filter((user) => !satisfiesEmailPolicy(user, config))
  return {
    data: {
      unverifiedUsers: unverified.length,
      affectedUsers: affected.length,
    },
  }
}

const api = routes('/api/settings/email/impact', emailSettingsRoutes)

export const GET = api(async (request) => {
  await requireSession(request, 'settings.email')
  return impact(await getEmailConfig())
})

export const POST = api(async (request) => {
  await requireSession(request, 'settings.email')
  const { config, clearPassword } = await readEmailDraft(request)
  return impact((await prepareEmailConfig(config, clearPassword)).effective)
})
