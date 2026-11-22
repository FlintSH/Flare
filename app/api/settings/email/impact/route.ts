import {
  emailPolicyImpact,
  emailSettingsRoutes,
  readEmailDraft,
} from '@/lib/email/admin'
import { getEmailConfig, prepareEmailConfig } from '@/lib/email/config'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'

const api = routes('/api/settings/email/impact', emailSettingsRoutes)

export const GET = api(async (request) => {
  await requireSession(request, ADMIN_PERMISSIONS.manageEmailSettings)
  return { data: await emailPolicyImpact(await getEmailConfig()) }
})

export const POST = api(async (request) => {
  await requireSession(request, ADMIN_PERMISSIONS.manageEmailSettings)
  const { config, clearPassword } = await readEmailDraft(request)
  return {
    data: await emailPolicyImpact(
      (await prepareEmailConfig(config, clearPassword)).effective
    ),
  }
})
