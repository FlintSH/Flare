import { changeConfig } from '@/lib/config'
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
      },
    }))
    return saved.settings.customization
  })
}
