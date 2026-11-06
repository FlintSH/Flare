import {
  emailDiagnostics,
  emailSettingsRoutes,
  requireEmailAdmin,
} from '@/lib/email/admin'
import { getEmailSettingsView, saveEmailConfig } from '@/lib/email/config'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/settings/email', emailSettingsRoutes)

export const GET = api(async (request) => {
  await requireEmailAdmin(request)
  const view = await getEmailSettingsView()
  return {
    data: {
      ...view,
      diagnostics: await emailDiagnostics(view.config.enabled),
    },
  }
})

export const PUT = api(async (request) => {
  await requireEmailAdmin(request)
  const body = (await readJson(request)) as {
    config?: unknown
    clearPassword?: unknown
    applyToExisting?: unknown
  }
  const view = await saveEmailConfig(body.config, {
    clearPassword: body.clearPassword === true,
    applyToExisting: body.applyToExisting === true,
  })
  return {
    data: {
      ...view,
      diagnostics: await emailDiagnostics(view.config.enabled),
    },
  }
})
