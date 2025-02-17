import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get unique mime types for the user
    const files = await prisma.file.findMany({
      where: { userId: session.user.id },
      select: { mimeType: true },
      distinct: ['mimeType'],
    })

    const types = files.map((file) => file.mimeType).sort()

    return NextResponse.json({ types })
  } catch (error) {
    console.error('Error fetching file types:', error)
    return NextResponse.json(
      { error: 'Failed to fetch file types' },
      { status: 500 }
    )
  }
}
