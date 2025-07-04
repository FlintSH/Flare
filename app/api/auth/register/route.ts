import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
})

function generateUrlId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return nanoid(5)
    .split('')
    .map((char) => {
      const index = Math.floor((alphabet.length * char.charCodeAt(0)) / 256)
      return alphabet[index]
    })
    .join('')
}

export async function POST(req: Request) {
  try {
    const config = await getConfig()
    if (!config.settings.general.registrations.enabled) {
      return new NextResponse(null, { status: 404 })
    }

    const json = await req.json()
    const body = registerSchema.parse(json)

    const exists = await prisma.user.findUnique({
      where: {
        email: body.email,
      },
    })

    if (exists) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      )
    }

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

    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0

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

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
