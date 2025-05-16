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
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const body = await request.json()
    const { section, data } =
      body as UpdateSettingSectionRequest<SettingSection>

    const config = await getConfig()

    // Handle theme customization
    if (section === 'appearance' && 'customColors' in data) {
      const customColors = data.customColors
      if (customColors) {
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
    return apiResponse<FlareConfig>(updatedConfig)
  } catch (error) {
    console.error('Failed to update config:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const config: FlareConfig = await req.json()

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
      invalidateStorageProvider()
    }

    const responseData: SettingsUpdateResponse = {
      message: 'Settings updated successfully',
    }

    return apiResponse<SettingsUpdateResponse>(responseData)
  } catch (error) {
    console.error('Error updating settings:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
