import { changeConfig } from '@/lib/config'
import { CLASSIC_PALETTE } from '@/lib/customization/legacy-appearance'
import { prisma } from '@/lib/database/prisma'

import type { AppearanceCommand, CustomizationState } from './schema'
import { transitionAppearance } from './state'

export interface SaveAppearanceOptions {
  /**
   * A caller's own refusal, given the studio state as saved and as the
   * command leaves it, under the settings lock and before anything is saved.
   */
  check?: (current: CustomizationState, next: CustomizationState) => void
}

export async function saveAppearance(
  command: AppearanceCommand,
  options: SaveAppearanceOptions = {}
) {
  return prisma.$transaction(async (tx) => {
    const saved = await changeConfig(tx, (config) => {
      const customization = transitionAppearance(
        config.settings.customization,
        command
      )
      options.check?.(config.settings.customization, customization)
      return {
        ...config,
        settings: {
          ...config.settings,
          customization,
          // The classic colors apply while the studio theme is off, so a reset
          // returns them to Flare's defaults as well.
          appearance:
            command.action === 'reset-theme'
              ? {
                  ...config.settings.appearance,
                  theme: 'dark',
                  customColors: { ...CLASSIC_PALETTE },
                }
              : config.settings.appearance,
        },
      }
    })
    return saved.settings.customization
  })
}
