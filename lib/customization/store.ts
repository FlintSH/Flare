import type { InputJsonValue } from '@prisma/client/runtime/library'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import type { AppearanceCommand } from './schema'
import { transitionAppearance } from './state'

export async function saveAppearance(command: AppearanceCommand) {
  return prisma.$transaction(async (tx) => {
    // Share the configuration writer lock so existing settings saves preserve us.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
    const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
    const config = row
      ? configSchema.parse(row.value)
      : structuredClone(DEFAULT_CONFIG)
    const next = transitionAppearance(config.settings.customization, command)
    config.settings.customization = next
    await tx.config.upsert({
      where: { key: 'flare_config' },
      create: { key: 'flare_config', value: config as InputJsonValue },
      update: { value: config as InputJsonValue },
    })
    return next
  })
}
