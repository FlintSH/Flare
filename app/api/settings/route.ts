import {
  PublicSettings,
  SettingsUpdateResponse,
  UpdateSettingSectionRequest,
} from '@/types/dto/settings'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAdmin, requireAuth } from '@/lib/auth/api-auth'
import {
  FlareConfig,
  getConfig,
  updateConfig,
  updateConfigSection,
} from '@/lib/config'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'
import { invalidateStorageProvider } from '@/lib/storage'

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) {
      // Still return public settings
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

    // If not admin, return only public settings
    if (user.role !== 'ADMIN') {
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

    // Return full config for admin
    return apiResponse<FlareConfig>(config)
  } catch (error) {
    console.error('Failed to get config:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

// Settings section type
type SettingSection = keyof FlareConfig['settings']

export async function PATCH(request: Request) {
  const requestLogger = createRequestLogger(request)
  const context = await extractUserContext(request)
  const startTime = Date.now()

  try {
    const { user: adminUser, response } = await requireAdmin()
    if (response) {
      logger.warn('system', 'Unauthorized access attempt to settings', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
      })
      requestLogger.complete(403)
      return response
    }

    const body = await request.json()
    const { section, data } =
      body as UpdateSettingSectionRequest<SettingSection>

    logger.info('system', 'Admin updating settings section', {
      userId: adminUser.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        section,
        changedFields: Object.keys(data || {}),
      },
    })

    const config = await getConfig()

    // Log original values for audit trail
    const originalSectionConfig = config.settings[section]

    // Handle theme customization
    if (section === 'appearance' && data && 'customColors' in data) {
      const customColors = data.customColors
      if (customColors) {
        logger.info('system', 'Theme customization applied', {
          userId: adminUser.id,
          requestId: requestLogger.requestId,
          metadata: {
            customColors,
          },
        })

        // Update CSS variables in the custom CSS
        let cssContent = config.settings.advanced.customCSS

        // Remove any existing CSS variables
        cssContent = cssContent.replace(/:root\s*{[^}]*}/, '')

        // Add new CSS variables
        const cssVars = Object.entries(customColors)
          .map(
            ([key, value]) =>
              `  --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value};`
          )
          .join('\n')

        const newCssVars = `:root {\n${cssVars}\n}\n\n`
        config.settings.advanced.customCSS = newCssVars + cssContent
      }
    }

    await updateConfigSection(section, data)
    const updatedConfig = await getConfig()

    const responseTime = Date.now() - startTime

    logger.info('system', 'Settings section updated successfully', {
      userId: adminUser.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        section,
        originalConfig: originalSectionConfig,
        newConfig: updatedConfig.settings[section],
      },
    })

    requestLogger.complete(200, adminUser.id, {
      section,
      updatedFields: Object.keys(data || {}),
    })

    return apiResponse<FlareConfig>(updatedConfig)
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('system', 'Failed to update settings section', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, context.userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()

  try {
    const { user: adminUser, response } = await requireAdmin()
    if (response) {
      logger.warn(
        'system',
        'Unauthorized access attempt to update full settings',
        {
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: requestLogger.requestId,
        }
      )
      requestLogger.complete(403)
      return response
    }

    const config: FlareConfig = await req.json()

    logger.info('system', 'Admin updating full configuration', {
      userId: adminUser.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        configVersion: config.version,
        storageProvider: config.settings?.general?.storage?.provider,
        registrationsEnabled: config.settings?.general?.registrations?.enabled,
      },
    })

    // Clean up CSS if it exists
    if (config.settings.advanced.customCSS) {
      config.settings.advanced.customCSS = config.settings.advanced.customCSS
        .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
        .trim()
    }

    // Save the config
    await updateConfig(config)

    // Invalidate storage provider if storage settings changed
    if (config.settings?.general?.storage) {
      logger.info('system', 'Storage provider configuration changed', {
        userId: adminUser.id,
        requestId: requestLogger.requestId,
        metadata: {
          provider: config.settings.general.storage.provider,
          quotasEnabled: config.settings.general.storage.quotas.enabled,
        },
      })
      invalidateStorageProvider()
    }

    const responseTime = Date.now() - startTime

    logger.info('system', 'Full configuration updated successfully', {
      userId: adminUser.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(200, adminUser.id, {
      configVersion: config.version,
    })

    const responseData: SettingsUpdateResponse = {
      message: 'Settings updated successfully',
    }

    return apiResponse<SettingsUpdateResponse>(responseData)
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('system', 'Failed to update full configuration', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, context.userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
