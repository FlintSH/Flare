import { NextResponse } from 'next/server'

import { getConfig } from '@/lib/config'

export async function GET() {
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
