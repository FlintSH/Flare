import { NextResponse } from 'next/server'

import { setAuditTarget, withAuditRoute } from '@/lib/audit'
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

    // The click counter is not a separate change event; this request event
    // identifies which link was opened.
    setAuditTarget({ type: 'link', id: url.id, name: url.shortCode })

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
