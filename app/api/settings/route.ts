import { NextRequest, NextResponse } from 'next/server'

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
      return NextResponse.json({
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
      })
    }

    const config = await getConfig()

    // If not admin, return only public settings
    if (user.role !== 'ADMIN') {
      return NextResponse.json({
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
      })
    }

    // Return full config for admin
    return NextResponse.json(config)
  } catch (error) {
    console.error('Failed to get config:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

type SettingSection = keyof FlareConfig['settings']
type SettingData<T extends SettingSection> = Partial<FlareConfig['settings'][T]>

export async function PATCH(request: NextRequest) {
  const { response } = await requireAdmin()
  if (response) return response

  try {
    const { section, data } = (await request.json()) as {
      section: SettingSection
      data: SettingData<SettingSection>
    }

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
    return NextResponse.json(updatedConfig)
  } catch (error) {
    console.error('Failed to update config:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
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

    return new NextResponse('Settings updated successfully', { status: 200 })
  } catch (error) {
    console.error('Error updating settings:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
