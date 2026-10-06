import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getEmailCapabilities } from '@/lib/email/config'

async function handleGET() {
  try {
    return NextResponse.json(await getEmailCapabilities())
  } catch {
    return NextResponse.json(
      { error: 'Email settings are temporarily unavailable' },
      { status: 503 }
    )
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/auth/email/capabilities',
  })()
}
