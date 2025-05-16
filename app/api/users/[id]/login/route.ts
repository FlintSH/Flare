import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { response } = await requireAdmin()
  if (response) return response

  try {
    const { id } = await params
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error('Error getting user:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
