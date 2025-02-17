import { NextRequest, NextResponse } from 'next/server'

import { FILE_URL_PATTERN, VIDEO_EXTENSIONS } from './constants'

export function isBotRequest(userAgent: string): boolean {
  userAgent = userAgent.toLowerCase()
  return (
    userAgent.includes('bot') ||
    userAgent.includes('discord') ||
    userAgent.includes('telegram') ||
    userAgent.includes('twitter') ||
    userAgent.includes('facebook') ||
    userAgent.includes('linkedin')
  )
}

export function handleBotRequest(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent')?.toLowerCase() || ''

  if (
    !isBotRequest(userAgent) ||
    !FILE_URL_PATTERN.test(request.nextUrl.pathname)
  ) {
    return null
  }

  // Don't redirect video files - let them get the OpenGraph metadata
  const fileExt = request.nextUrl.pathname.split('.').pop()?.toLowerCase()
  const isVideo = fileExt && VIDEO_EXTENSIONS.includes(fileExt)

  if (!isVideo && !request.nextUrl.pathname.endsWith('/raw')) {
    const url = new URL(request.url)
    url.pathname = `${url.pathname}/raw`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}
