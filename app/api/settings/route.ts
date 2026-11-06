import { PublicSettings, SettingsUpdateResponse } from '@/types/dto/settings'
import { z } from 'zod'

import {
  ConfigValidationError,
  FlareConfig,
  SETTINGS_NOT_SAVED,
  applyConfigUpdate,
  getConfig,
} from '@/lib/config'
import {
  keepSavedCredentials,
  publicSettings,
  redactSettings,
} from '@/lib/config/views'
import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireAccount, requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
import {
  PermissionError,
  assertAccessibleAdministrator,
  getUserAccess,
  requireActorPermission,
} from '@/lib/permissions/server'
import { settingsPatchAllowed } from '@/lib/permissions/settings'

/** A change to some sections, or one section by name. */
const settingsPatch = z.object({
  settings: z.unknown().optional(),
  section: z.unknown().optional(),
  data: z.unknown().optional(),
})

/** The legacy whole-settings form posts the entire settings document. */
const settingsDocument = z.looseObject({
  settings: z.looseObject({
    advanced: z.looseObject({ customCSS: z.string().optional() }),
  }),
})

const api = routes('/api/settings', {
  envelope: 'api',
  // A body these routes can't read is answered like settings the schema refuses.
  invalid: () => new ConfigValidationError(),
  failure: { message: 'Internal server error' },
  logger: loggers.config,
})

export const GET = api(async (request) => {
  // Anyone may read the public projection, so a refused account is no error.
  const user = await requireAccount(request).catch((error: unknown) => {
    if (error instanceof HttpError) return null
    throw error
  })
  const config = await getConfig()
  if (
    !user ||
    !hasPermission(user, 'settings.read') ||
    user.credential !== 'session'
  )
    return apiResponse<PublicSettings>(publicSettings(config))
  return apiResponse<FlareConfig>(redactSettings(config))
})

export const PATCH = api(
  async (request) => {
    const { user } = await requireSession(request)
    const body = await readJson(request, settingsPatch)
    const settings = (body.settings ??
      (body.section
        ? { [body.section as string]: body.data }
        : null)) as Partial<FlareConfig['settings']> | null
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new HttpError(400, 'Choose settings to update')
    if (!settingsPatchAllowed(user, settings))
      throw new HttpError(
        403,
        'You do not have permission to change these settings.'
      )
    keepSavedCredentials(settings)
    await prisma.$transaction(async (tx) => {
      await lockRoleChanges(tx)
      const access = await getUserAccess(user.id, tx)
      if (!settingsPatchAllowed(access, settings))
        throw new PermissionError(
          'You no longer have permission to change these settings.'
        )
      // Validate current email access as well as authority before committing.
      const permission = access.permissions[0]
      if (!permission) throw new PermissionError('Permission denied')
      await requireActorPermission(tx, user.id, permission)
      await applyConfigUpdate(tx, { settings })
      await assertAccessibleAdministrator(tx)
    })
    return apiResponse({ message: 'Settings updated successfully' })
  },
  { failure: { message: SETTINGS_NOT_SAVED } }
)

export const POST = api(async (request) => {
  const { user } = await requireSession(request, 'administrator')
  const config = await readJson(request, settingsDocument)
  // The Email tab owns this section. A stale whole-settings form must not
  // overwrite its policy or submit masked SMTP credentials as a password.
  delete config.settings.email
  delete config.settings.customization

  keepSavedCredentials(config.settings)
  if (config.settings.advanced.customCSS) {
    config.settings.advanced.customCSS = config.settings.advanced.customCSS
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, user.id, 'administrator')
    await applyConfigUpdate(tx, config as Partial<FlareConfig>)
    await assertAccessibleAdministrator(tx)
  })

  const responseData: SettingsUpdateResponse = {
    message: 'Settings updated successfully',
  }

  return apiResponse<SettingsUpdateResponse>(responseData)
})
