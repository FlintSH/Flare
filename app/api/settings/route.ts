import { PublicSettings, SettingsUpdateResponse } from '@/types/dto/settings'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { getAccessSession } from '@/lib/auth'
import { requireAuth, requirePermission } from '@/lib/auth/api-auth'
import { FlareConfig, getConfig, updateConfig } from '@/lib/config'
import { redactEmailConfig } from '@/lib/email/config'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
import {
  PermissionError,
  assertAccessibleAdministrator,
  getUserAccess,
  lockRoleChanges,
  requireActorPermission,
} from '@/lib/permissions/server'
import { settingsPatchAllowed } from '@/lib/permissions/settings'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { invalidateStorageProvider } from '@/lib/storage'

const logger = loggers.config

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) {
      const config = await getConfig()
      const publicSettings: PublicSettings = {
        version: config.version,
        settings: {
          general: {
            registrations: {
              enabled: config.settings.general.registrations.enabled,
              disabledMessage:
                config.settings.general.registrations.disabledMessage,
            },
          },
          appearance: {
            theme: config.settings.appearance.theme,
            favicon: config.settings.appearance.favicon,
            customColors: config.settings.appearance.customColors,
          },
          advanced: {
            customCSS: config.settings.advanced.customCSS,
            customHead: config.settings.advanced.customHead,
          },
        },
      }
      return apiResponse<PublicSettings>(publicSettings)
    }

    const config = await getConfig()

    if (
      !hasPermission(user, 'settings.read') ||
      user.apiToken ||
      !(await getAccessSession())
    ) {
      const publicSettings: PublicSettings = {
        version: config.version,
        settings: {
          general: {
            registrations: {
              enabled: config.settings.general.registrations.enabled,
              disabledMessage:
                config.settings.general.registrations.disabledMessage,
            },
          },
          appearance: {
            theme: config.settings.appearance.theme,
            favicon: config.settings.appearance.favicon,
            customColors: config.settings.appearance.customColors,
          },
          advanced: {
            customCSS: config.settings.advanced.customCSS,
            customHead: config.settings.advanced.customHead,
          },
        },
      }
      return apiResponse<PublicSettings>(publicSettings)
    }

    return apiResponse<FlareConfig>({
      ...config,
      settings: {
        ...config.settings,
        general: {
          ...config.settings.general,
          oidc: { ...config.settings.general.oidc, clientSecret: '' },
          storage: {
            ...config.settings.general.storage,
            s3: {
              ...config.settings.general.storage.s3,
              secretAccessKey: '',
              accessKeyId: '',
            },
          },
        },
        email: redactEmailConfig(config.settings.email),
      },
    })
  } catch (error) {
    logger.error('Failed to get config', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function PATCH(request: Request) {
  const session = await getAccessSession()
  if (!session?.user) return apiError('Unauthorized', 401)
  if (!isSameOriginRequest(request))
    return apiError('Invalid request origin', 403)
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    return apiError('Use application/json', 415)
  try {
    const body = await request.json()
    const settings =
      body.settings ?? (body.section ? { [body.section]: body.data } : null)
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      return apiError('Choose settings to update', 400)
    if (!settingsPatchAllowed(session.user, settings))
      return apiError(
        'You do not have permission to change these settings.',
        403
      )
    // Blank password fields represent the redacted saved secret, never a clear action.
    if (settings.general?.oidc?.clientSecret === '')
      delete settings.general.oidc.clientSecret
    if (settings.general?.storage?.s3?.secretAccessKey === '')
      delete settings.general.storage.s3.secretAccessKey
    if (settings.general?.storage?.s3?.accessKeyId === '')
      delete settings.general.storage.s3.accessKeyId
    await updateConfig(
      { settings },
      async (tx) => {
        await lockRoleChanges(tx)
        const access = await getUserAccess(session.user.id, tx)
        if (!settingsPatchAllowed(access, settings))
          throw new PermissionError(
            'You no longer have permission to change these settings.'
          )
        // Validate current email access as well as authority before committing.
        const permission = access.permissions[0]
        if (!permission) throw new PermissionError('Permission denied')
        await requireActorPermission(tx, session.user.id, permission)
      },
      assertAccessibleAdministrator
    )
    if (settings.general?.storage) invalidateStorageProvider()
    return apiResponse({ message: 'Settings updated successfully' })
  } catch (error) {
    if (error instanceof PermissionError)
      return apiError(error.message, error.status)
    return apiError(
      'Could not update settings. Check the values and try again.',
      400
    )
  }
}

export async function POST(req: Request) {
  try {
    const { user, response } = await requirePermission('administrator')
    if (response) return response

    if (!isSameOriginRequest(req))
      return apiError('Invalid request origin', 403)
    if (
      req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
    )
      return apiError('Use application/json', 415)
    const config: FlareConfig = await req.json()
    // The Email tab owns this section. A stale whole-settings form must not
    // overwrite its policy or submit masked SMTP credentials as a password.
    if (config.settings)
      delete (config.settings as Partial<FlareConfig['settings']>).email
    if (config.settings)
      delete (config.settings as Partial<FlareConfig['settings']>).customization

    if (config.settings.advanced.customCSS) {
      config.settings.advanced.customCSS = config.settings.advanced.customCSS
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }

    await updateConfig(
      config,
      async (tx) => {
        await lockRoleChanges(tx)
        await requireActorPermission(tx, user.id, 'administrator')
      },
      assertAccessibleAdministrator
    )

    if (config.settings?.general?.storage) {
      invalidateStorageProvider()
    }

    const responseData: SettingsUpdateResponse = {
      message: 'Settings updated successfully',
    }

    return apiResponse<SettingsUpdateResponse>(responseData)
  } catch (error) {
    if (error instanceof PermissionError)
      return apiError(error.message, error.status)
    if (error instanceof SyntaxError) return apiError('Provide valid JSON', 400)
    logger.error('Error updating settings', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
