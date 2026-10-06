import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import {
  emailAdminAccess,
  emailDiagnostics,
  emailSettingsError,
} from '@/lib/email/admin'
import { getEmailSettingsView, saveEmailConfig } from '@/lib/email/config'
import { startMailWorker } from '@/lib/email/worker'

async function handleGET(request: Request) {
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

async function handlePUT(request: Request) {
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

export async function GET(request: Request) {
  return withAuditRoute(async () => handleGET(request), {
    route: '/api/settings/email',
  })(request)
}

export async function PUT(request: Request) {
  return withAuditRoute(async () => handlePUT(request), {
    route: '/api/settings/email',
  })(request)
}
