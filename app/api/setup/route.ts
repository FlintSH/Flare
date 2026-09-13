import { NextResponse } from 'next/server'

import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { z } from 'zod'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { rateLimit, setupLimiter } from '@/lib/security/rate-limit'
import { setupSchema } from '@/lib/setup/schema'
import { invalidateStorageProvider } from '@/lib/storage'
import { createUser } from '@/lib/users/create-user'

const logger = loggers.startup

class SetupAlreadyCompleteError extends Error {
  constructor() {
    super('Setup already completed')
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, setupLimiter)
  if (limited) return limited

  try {
    const data = await req.json()
    const validatedData = setupSchema.parse(data)

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
    const configValue = JSON.parse(
      JSON.stringify(initialConfig)
    ) as Prisma.InputJsonValue
    // Account and settings succeed together. Serializing bootstrap also prevents
    // simultaneous setup requests from creating multiple initial administrators.
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
      const userCount = await tx.user.count()
      if (userCount > 0) throw new SetupAlreadyCompleteError()
      const admin = await createUser(tx, {
        name: validatedData.admin.name,
        email: validatedData.admin.email,
        password: hashedPassword,
        role: 'ADMIN',
        emailExempt: true,
      })
      await tx.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value: configValue },
        update: { value: configValue },
      })
      return admin
    })

    // A public storage-type request can initialize local storage before setup.
    // The next upload must use the provider that was just saved.
    invalidateStorageProvider()

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    if (error instanceof SetupAlreadyCompleteError) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 400 }
      )
    }
    logger.error('Setup error', error as Error)
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]
      return NextResponse.json(
        {
          error: issue?.message || 'Validation failed',
          field: issue?.path?.join('.') || undefined,
        },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to complete setup' },
      { status: 500 }
    )
  }
}
