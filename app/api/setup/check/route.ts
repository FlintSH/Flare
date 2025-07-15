import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { checkSetupCompletion } from '@/lib/database/setup'

export async function GET() {
  const headersList = await headers()
  if (headersList.get('x-middleware-check') !== 'true') {
    const referer = headersList.get('referer') || ''
    if (referer.includes('/setup')) {
      return NextResponse.json({ completed: false })
    }
  }

  try {
    const completed = await checkSetupCompletion()
    return NextResponse.json({ completed })
  } catch (error) {
    console.error('Setup check error:', error)
    return NextResponse.json({ completed: false })
  }
}
