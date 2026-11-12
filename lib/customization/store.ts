import { changeConfig } from '@/lib/config'
import { CLASSIC_PALETTE } from '@/lib/customization/legacy-appearance'
import { prisma } from '@/lib/database/prisma'

import type { AppearanceCommand } from './schema'
import { transitionAppearance } from './state'

export async function saveAppearance(command: AppearanceCommand) {
  return prisma.$transaction(async (tx) => {
    const saved = await changeConfig(tx, (config) => ({
      ...config,
      settings: {
        ...config.settings,
        customization: transitionAppearance(
          config.settings.customization,
          command
        ),
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
    }))
    return saved.settings.customization
  })
}
