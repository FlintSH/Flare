import { NextResponse } from 'next/server'

import { getEmailCapabilities } from '@/lib/email/config'

export async function GET() {
  try {
    return NextResponse.json(await getEmailCapabilities())
  } catch {
    return NextResponse.json(
      { error: 'Email settings are temporarily unavailable' },
      { status: 503 }
    )
  }
}
