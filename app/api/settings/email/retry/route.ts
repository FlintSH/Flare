import { NextResponse } from 'next/server'

import { z } from 'zod'

import { emailAdminAccess, emailSettingsError } from '@/lib/email/admin'
import { retryMail } from '@/lib/email/outbox'
import { startMailWorker } from '@/lib/email/worker'

export async function POST(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    const { id } = z
      .object({ id: z.string().min(1).max(100) })
      .parse(await request.json())
    const queued = await retryMail(id)
    if (!queued)
      return NextResponse.json(
        {
          error:
            'This message cannot be retried. Its account link may have expired or been replaced.',
        },
        { status: 400 }
      )
    startMailWorker()
    return NextResponse.json({ data: { message: 'Message queued for retry' } })
  } catch (error) {
    return emailSettingsError(error)
  }
}
