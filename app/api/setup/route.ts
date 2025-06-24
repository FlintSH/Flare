import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { updateConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'

// Generate a URL-safe ID that's 5 characters long
function generateUrlId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return Array.from({ length: 5 }, () => {
    return alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  }).join('')
}

// Setup data validation schema
const setupSchema = z.object({
  admin: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
  }),
  storage: z.object({
    provider: z.enum(['local', 's3']),
    s3: z.object({
      bucket: z.string(),
      region: z.string(),
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
      endpoint: z.string().optional(),
      forcePathStyle: z.boolean().default(false),
    }),
  }),
  registrations: z.object({
    enabled: z.boolean(),
    disabledMessage: z.string().optional(),
  }),
})

export async function POST(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()

  try {
    logger.systemEvent('Initial setup attempt started', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
    })

    // Check if setup is already complete
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      logger.systemEvent('Setup attempt blocked - already completed', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
      })
      requestLogger.complete(400)
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 400 }
      )
    }

    const data = await req.json()
    const validatedData = setupSchema.parse(data)

    logger.systemEvent('Setup data validated successfully', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        adminEmail: validatedData.admin.email,
        storageProvider: validatedData.storage.provider,
        registrationsEnabled: validatedData.registrations.enabled,
      },
    })

    // Generate a unique URL ID for the admin user
    let urlId = generateUrlId()
    let isUnique = false
    while (!isUnique) {
      const existing = await prisma.user.findUnique({
        where: { urlId },
      })
      if (!existing) {
        isUnique = true
      } else {
        urlId = generateUrlId()
      }
    }

    // Create admin user
    const hashedPassword = await hash(validatedData.admin.password, 10)
    const user = await prisma.user.create({
      data: {
        name: validatedData.admin.name,
        email: validatedData.admin.email,
        password: hashedPassword,
        role: 'ADMIN',
        emailVerified: new Date(), // Auto-verify admin email
        urlId, // Use the generated URL ID
        uploadToken: uuidv4(),
      },
    })

    logger.systemEvent('Creating admin user', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        adminEmail: validatedData.admin.email,
        adminName: validatedData.admin.name,
        urlId,
      },
    })

    // Update config with storage and registration settings
    await updateConfig({
      settings: {
        general: {
          setup: {
            completed: true,
            completedAt: new Date(),
          },
          storage: {
            provider: validatedData.storage.provider,
            s3: validatedData.storage.s3,
            quotas: {
              enabled: false,
              default: {
                value: 10,
                unit: 'GB',
              },
            },
            maxUploadSize: {
              value: 100,
              unit: 'MB',
            },
          },
          registrations: {
            enabled: validatedData.registrations.enabled,
            disabledMessage: validatedData.registrations.disabledMessage || '',
          },
          credits: {
            showFooter: true,
          },
          ocr: {
            enabled: true,
          },
        },
        appearance: {
          theme: 'dark',
          favicon: null,
          customColors: {},
        },
        advanced: {
          customCSS: '',
          customHead: '',
        },
      },
    })

    const responseTime = Date.now() - startTime

    logger.systemEvent('Initial setup completed successfully', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        adminId: user.id,
        adminEmail: user.email,
        storageProvider: validatedData.storage.provider,
        registrationsEnabled: validatedData.registrations.enabled,
      },
    })

    logger.authEvent('Admin account created during setup', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        email: user.email,
        name: user.name,
      },
    })

    requestLogger.complete(200, user.id, {
      setupComplete: true,
      adminCreated: true,
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    const responseTime = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.systemEvent('Setup failed - validation error', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        responseTime,
        requestId: requestLogger.requestId,
        metadata: {
          validationErrors: error.issues,
        },
      })
      requestLogger.complete(400, undefined, {
        validationError: true,
      })
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }

    logError('system', 'Initial setup failed', error as Error, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: 'Failed to complete setup' },
      { status: 500 }
    )
  }
}
