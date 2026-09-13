import { NextResponse } from 'next/server'

import {
  emailAdminAccess,
  emailDiagnostics,
  emailSettingsError,
} from '@/lib/email/admin'
import { getEmailSettingsView, saveEmailConfig } from '@/lib/email/config'
import { startMailWorker } from '@/lib/email/worker'

export async function GET(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    const view = await getEmailSettingsView()
    return NextResponse.json({
      data: {
        ...view,
        diagnostics: await emailDiagnostics(view.config.enabled),
      },
    })
  } catch (error) {
    return emailSettingsError(error)
  }
}

export async function PUT(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const view = await saveEmailConfig(body.config, {
      clearPassword: body.clearPassword === true,
      applyToExisting: body.applyToExisting === true,
    })
    if (view.config.enabled) startMailWorker()
    return NextResponse.json({
      data: {
        ...view,
        diagnostics: await emailDiagnostics(view.config.enabled),
      },
    })
  } catch (error) {
    return emailSettingsError(error)
  }
}
