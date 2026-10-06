import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'

async function handleGET(
  req: Request,
  { params }: { params: Promise<{ shortCode: string }> }
) {
  try {
    const { shortCode } = await params

    const url = await prisma.shortenedUrl.findUnique({
      where: { shortCode },
    })

    if (!url) {
      return new NextResponse(null, { status: 404 })
    }

    await prisma.shortenedUrl.update({
      where: { id: url.id },
      data: { clicks: { increment: 1 } },
    })

    return NextResponse.redirect(url.targetUrl)
  } catch (error) {
    console.error('URL redirect error:', error)
    return new NextResponse(null, { status: 500 })
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shortCode: string }> }
) {
  return withAuditRoute(async () => handleGET(req, { params }), {
    route: '/u/[shortCode]',
  })(req)
}
