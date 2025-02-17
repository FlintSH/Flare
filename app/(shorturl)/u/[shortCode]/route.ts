import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shortCode: string }> }
) {
  try {
    const { shortCode } = await params

    // Find the URL
    const url = await prisma.shortenedUrl.findUnique({
      where: { shortCode },
    })

    if (!url) {
      return new NextResponse(null, { status: 404 })
    }

    // Update the click count for the URL
    await prisma.shortenedUrl.update({
      where: { id: url.id },
      data: { clicks: { increment: 1 } },
    })

    // Redirect to target URL
    return NextResponse.redirect(url.targetUrl)
  } catch (error) {
    console.error('URL redirect error:', error)
    return new NextResponse(null, { status: 500 })
  }
}
