import { NextResponse } from 'next/server'

import { routes } from '@/lib/http/route'
import { followShortLink } from '@/lib/links/service'

type Context = { params: Promise<{ shortCode: string }> }

const api = routes('/u/[shortCode]', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (_request, { params }: Context) => {
  const { shortCode } = await params
  const target = await followShortLink(shortCode)
  return target
    ? NextResponse.redirect(target)
    : new NextResponse(null, { status: 404 })
})
