import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'

export async function GET() {
  // Prevent infinite loop from middleware
  const headersList = await headers()
  if (headersList.get('x-middleware-check') !== 'true') {
    // If not called from middleware, check if we're in a setup route
    const referer = headersList.get('referer') || ''
    if (referer.includes('/setup')) {
      return NextResponse.json({ completed: false })
    }
  }

  try {
    // Check if any users exist
    const userCount = await prisma.user.count()
    return NextResponse.json({ completed: userCount > 0 })
  } catch (error) {
    console.error('Setup check error:', error)
    return NextResponse.json({ completed: false })
  }
}
