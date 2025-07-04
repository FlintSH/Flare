import { NextResponse } from 'next/server'

import { randomUUID } from 'crypto'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { uploadToken: true },
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ uploadToken: userData.uploadToken })
  } catch (error) {
    console.error('Error fetching upload token:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const userData = await prisma.user.update({
      where: { id: user.id },
      data: { uploadToken: randomUUID() },
      select: { uploadToken: true },
    })

    return NextResponse.json({ uploadToken: userData.uploadToken })
  } catch (error) {
    console.error('Error refreshing upload token:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
