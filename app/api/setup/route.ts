import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { updateConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

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
  try {
    // Check if setup is already complete
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 400 }
      )
    }

    const data = await req.json()
    const validatedData = setupSchema.parse(data)

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

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    console.error('Setup error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Failed to complete setup' },
      { status: 500 }
    )
  }
}
