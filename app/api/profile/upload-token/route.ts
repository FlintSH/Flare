import { NextResponse } from 'next/server'

import { randomUUID } from 'crypto'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { uploadToken: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ uploadToken: user.uploadToken })
  } catch (error) {
    console.error('Error fetching upload token:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Generate new upload token using UUID
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { uploadToken: randomUUID() },
      select: { uploadToken: true },
    })

    return NextResponse.json({ uploadToken: user.uploadToken })
  } catch (error) {
    console.error('Error refreshing upload token:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
