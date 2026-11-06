import { hash } from 'bcryptjs'

import { DEFAULT_CONFIG, configSchema, replaceConfig } from '@/lib/config'
import { lockSettings } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { rateLimit, setupLimiter } from '@/lib/security/rate-limit'
import { setupSchema } from '@/lib/setup/schema'
import { invalidateStorageProvider } from '@/lib/storage'
import { createUser } from '@/lib/users/create-user'

const api = routes('/api/setup', {
  invalid: (error) => {
    const issue = error.issues[0]
    return new HttpError(400, issue?.message || 'Validation failed', {
      body: { field: issue?.path?.join('.') || undefined },
    })
  },
  failure: { message: 'Failed to complete setup' },
  logger: loggers.startup,
})

export const POST = api(async (request) => {
  const limited = await rateLimit(request, setupLimiter)
  if (limited) return limited

  const validatedData = setupSchema.parse(await readJson(request))

  const hashedPassword = await hash(validatedData.admin.password, 10)

  const initialConfig = configSchema.parse({
    ...DEFAULT_CONFIG,
    settings: {
      ...DEFAULT_CONFIG.settings,
      general: {
        ...DEFAULT_CONFIG.settings.general,
        setup: { completed: true, completedAt: new Date() },
        storage: {
          ...DEFAULT_CONFIG.settings.general.storage,
          provider: validatedData.storage.provider,
          s3: validatedData.storage.s3,
        },
        registrations: {
          enabled: validatedData.registrations.enabled,
          disabledMessage: validatedData.registrations.disabledMessage || '',
        },
      },
    },
  })
  // Account and settings succeed together. Serializing bootstrap also prevents
  // simultaneous setup requests from creating multiple initial administrators.
  const user = await prisma.$transaction(async (tx) => {
    await lockSettings(tx)
    const userCount = await tx.user.count()
    if (userCount > 0) throw new HttpError(400, 'Setup already completed')
    const admin = await createUser(tx, {
      name: validatedData.admin.name,
      email: validatedData.admin.email,
      password: hashedPassword,
      emailExempt: true,
    })
    await replaceConfig(tx, initialConfig)
    return admin
  })

  // A public storage-type request can initialize local storage before setup.
  // The next upload must use the provider that was just saved.
  invalidateStorageProvider()

  return {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  }
})
