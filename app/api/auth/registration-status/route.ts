import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getConfig } from '@/lib/config'

async function handleGET() {
  try {
    const config = await getConfig()
    return NextResponse.json({
      enabled: config.settings.general.registrations.enabled,
      message: config.settings.general.registrations.disabledMessage,
    })
  } catch {
    return NextResponse.json({
      enabled: false,
      message: 'Registration is currently unavailable.',
    })
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/auth/registration-status',
  })()
}
