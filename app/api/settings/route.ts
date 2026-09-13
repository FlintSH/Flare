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
import { redactEmailConfig } from '@/lib/email/config'
import { loggers } from '@/lib/logger'
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

    return apiResponse<FlareConfig>({
      ...config,
      settings: {
        ...config.settings,
        email: redactEmailConfig(config.settings.email),
      },
    })
  } catch (error) {
    logger.error('Failed to get config', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

type SettingSection = keyof FlareConfig['settings']

export async function PATCH(request: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const body = await request.json()
    const { section, data } =
      body as UpdateSettingSectionRequest<SettingSection>

    if (section === 'email' || section === 'customization')
      return apiError(
        `Use the ${section} settings endpoint`,
        HTTP_STATUS.BAD_REQUEST
      )

    const config = await getConfig()

    if (section === 'appearance' && 'customColors' in data) {
      const customColors = data.customColors
      if (customColors) {
        let cssContent = config.settings.advanced.customCSS

        cssContent = cssContent.replace(/:root\s*{[^}]*}/, '')

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

    await updateConfigSection(
      section,
      data as Partial<
        FlareConfig['settings'][Exclude<
          SettingSection,
          'email' | 'customization'
        >]
      >
    )
    const updatedConfig = await getConfig()
    return apiResponse<FlareConfig>({
      ...updatedConfig,
      settings: {
        ...updatedConfig.settings,
        email: redactEmailConfig(updatedConfig.settings.email),
      },
    })
  } catch (error) {
    logger.error('Failed to update config', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

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

    await updateConfig(config)

    if (config.settings?.general?.storage) {
      invalidateStorageProvider()
    }

    const responseData: SettingsUpdateResponse = {
      message: 'Settings updated successfully',
    }

    return apiResponse<SettingsUpdateResponse>(responseData)
  } catch (error) {
    logger.error('Error updating settings', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
