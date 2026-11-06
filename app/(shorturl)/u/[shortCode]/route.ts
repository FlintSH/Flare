import { NextResponse } from 'next/server'

import { setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ shortCode: string }> }

const api = routes('/u/[shortCode]', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request, { params }: Context) => {
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
})
