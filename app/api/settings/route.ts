import { PublicSettings, SettingsUpdateResponse } from '@/types/dto/settings'

import { getAccessSession } from '@/lib/auth'
import {
  ConfigValidationError,
  FlareConfig,
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
import { assertJsonMutation, readJson } from '@/lib/http/request'
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
import { invalidateStorageProvider } from '@/lib/storage'

const patchFailure =
  'Could not update settings. Check the values and try again.'

const api = routes('/api/settings', {
  envelope: 'api',
  translate: (error) =>
    error instanceof ConfigValidationError
      ? new HttpError(400, error.message)
      : undefined,
  // Settings the schema rejects on save were answered like any other failure.
  invalid: () => new HttpError(500, 'Internal server error'),
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
    user.apiToken ||
    !(await getAccessSession())
  )
    return apiResponse<PublicSettings>(publicSettings(config))
  return apiResponse<FlareConfig>(redactSettings(config))
})

export const PATCH = api(
  async (request) => {
    const { user } = await requireSession()
    assertJsonMutation(request)
    const body = (await readJson(request)) as {
      settings?: Partial<FlareConfig['settings']>
      section?: string
      data?: unknown
    }
    const settings =
      body.settings ??
      (body.section
        ? ({ [body.section]: body.data } as Partial<FlareConfig['settings']>)
        : null)
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
    if (settings.general?.storage) invalidateStorageProvider()
    return apiResponse({ message: 'Settings updated successfully' })
  },
  {
    invalid: () => new HttpError(400, patchFailure),
    failure: { status: 400, message: patchFailure },
  }
)

export const POST = api(async (request) => {
  const { user } = await requireSession('administrator')
  assertJsonMutation(request)
  const config = (await readJson(request)) as FlareConfig
  // The Email tab owns this section. A stale whole-settings form must not
  // overwrite its policy or submit masked SMTP credentials as a password.
  if (config.settings)
    delete (config.settings as Partial<FlareConfig['settings']>).email
  if (config.settings)
    delete (config.settings as Partial<FlareConfig['settings']>).customization

  keepSavedCredentials(config.settings)
  if (config.settings.advanced.customCSS) {
    config.settings.advanced.customCSS = config.settings.advanced.customCSS
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, user.id, 'administrator')
    await applyConfigUpdate(tx, config)
    await assertAccessibleAdministrator(tx)
  })

  if (config.settings?.general?.storage) {
    invalidateStorageProvider()
  }

  const responseData: SettingsUpdateResponse = {
    message: 'Settings updated successfully',
  }

  return apiResponse<SettingsUpdateResponse>(responseData)
})
