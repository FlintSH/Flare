import { emailDiagnostics, emailSettingsRoutes } from '@/lib/email/admin'
import { getEmailSettingsView, saveEmailConfig } from '@/lib/email/config'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/settings/email', emailSettingsRoutes)

export const GET = api(async (request) => {
  await requireSession(request, 'settings.email')
  const view = await getEmailSettingsView()
  return {
    data: {
      ...view,
      diagnostics: await emailDiagnostics(view.config.enabled),
    },
  }
})

export const PUT = api(async (request) => {
  await requireSession(request, 'settings.email')
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
