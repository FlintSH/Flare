import { getConfig } from '@/lib/config'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/registration-status', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async () => {
  try {
    const config = await getConfig()
    return {
      enabled: config.settings.general.registrations.enabled,
      message: config.settings.general.registrations.disabledMessage,
    }
  } catch {
    return { enabled: false, message: 'Registration is currently unavailable.' }
  }
})
