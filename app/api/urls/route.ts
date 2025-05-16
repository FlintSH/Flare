import { NextResponse } from 'next/server'

import { nanoid } from 'nanoid'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

const urlSchema = z.object({
  url: z.string().url(),
})

// Generate a 6-character random code
function generateShortCode() {
  return nanoid(6)
}

export async function POST(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const json = await req.json()
    const { url } = urlSchema.parse(json)

    // Generate a unique short code
    let shortCode = generateShortCode()
    let isUnique = false
    while (!isUnique) {
      const existing = await prisma.shortenedUrl.findUnique({
        where: { shortCode },
      })
      if (!existing) {
        isUnique = true
      } else {
        shortCode = generateShortCode()
      }
    }

    const shortenedUrl = await prisma.shortenedUrl.create({
      data: {
        shortCode,
        targetUrl: url,
        userId: user.id,
      },
    })

    return NextResponse.json(shortenedUrl)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    console.error('URL creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const urls = await prisma.shortenedUrl.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(urls)
  } catch (error) {
    console.error('URL list error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
