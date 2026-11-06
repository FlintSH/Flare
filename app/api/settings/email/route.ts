import {
  emailDiagnostics,
  emailSettingsRoutes,
  readEmailDraft,
} from '@/lib/email/admin'
import { getEmailSettingsView, saveEmailConfig } from '@/lib/email/config'
import { requireSession } from '@/lib/http/access'
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
  const { config, ...options } = await readEmailDraft(request)
  const view = await saveEmailConfig(config, options)
  return {
    data: {
      ...view,
      diagnostics: await emailDiagnostics(view.config.enabled),
    },
  }
})
