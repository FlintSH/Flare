import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
})

// Generate a URL-safe ID that's 5 characters long
function generateUrlId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return nanoid(5)
    .split('')
    .map((char) => {
      // map to our custom one
      const index = Math.floor((alphabet.length * char.charCodeAt(0)) / 256)
      return alphabet[index]
    })
    .join('')
}

export async function POST(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()

  try {
    logger.authEvent('Registration attempt started', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
    })

    // Check if registrations are enabled
    const config = await getConfig()
    if (!config.settings.general.registrations.enabled) {
      logger.authEvent(
        'Registration attempt blocked - registrations disabled',
        {
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: requestLogger.requestId,
        }
      )
      requestLogger.complete(404)
      return new NextResponse(null, { status: 404 })
    }

    const json = await req.json()
    const body = registerSchema.parse(json)

    logger.debug('auth', 'Registration data parsed successfully', {
      requestId: requestLogger.requestId,
      metadata: {
        email: body.email,
        name: body.name,
      },
    })

    const exists = await prisma.user.findUnique({
      where: {
        email: body.email,
      },
    })

    if (exists) {
      logger.authEvent('Registration attempt failed - user already exists', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
        metadata: {
          email: body.email,
        },
      })
      requestLogger.complete(400)
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      )
    }

    let urlId = generateUrlId()
    let isUnique = false
    let urlIdAttempts = 0
    while (!isUnique) {
      urlIdAttempts++
      const existing = await prisma.user.findUnique({
        where: { urlId },
      })
      if (!existing) {
        isUnique = true
      } else {
        urlId = generateUrlId()
        if (urlIdAttempts > 10) {
          logger.error(
            'auth',
            'Failed to generate unique URL ID after 10 attempts',
            {
              requestId: requestLogger.requestId,
            }
          )
          throw new Error('Failed to generate unique user ID')
        }
      }
    }

    // Check if this is the first user
    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0

    logger.info('auth', 'Creating new user', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        email: body.email,
        name: body.name,
        isFirstUser,
        urlId,
      },
    })

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        password: await hash(body.password, 10),
        urlId,
        role: isFirstUser ? 'ADMIN' : 'USER',
        uploadToken: uuidv4(),
      },
    })

    const responseTime = Date.now() - startTime

    logger.authEvent('User registration successful', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        email: user.email,
        name: user.name,
        role: user.role,
        isFirstUser,
      },
    })

    logger.userAction('Account created', user.id, {
      ipAddress: context.ipAddress,
      responseTime,
      metadata: {
        email: user.email,
        role: user.role,
      },
    })

    requestLogger.complete(200, user.id, {
      role: user.role,
      isFirstUser,
    })

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    const responseTime = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.authEvent('Registration attempt failed - validation error', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        responseTime,
        requestId: requestLogger.requestId,
        metadata: {
          validationError: error.issues[0].message,
        },
      })
      requestLogger.complete(400, undefined, {
        validationError: error.issues[0].message,
      })
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    logError(
      'auth',
      'Registration failed with unexpected error',
      error as Error,
      {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        responseTime,
        requestId: requestLogger.requestId,
      }
    )

    requestLogger.complete(500, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
