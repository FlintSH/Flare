import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { clearProgress, getProgress } from '@/lib/utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        const progress = getProgress(session.user.id)
        const data = encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
        controller.enqueue(data)

        if (progress === 100) {
          clearInterval(interval)
          controller.close()
          clearProgress(session.user.id)
        }
      }, 100)
    },
  })

  const headers = new Headers()
  headers.set('Content-Type', 'text/event-stream')
  headers.set('Cache-Control', 'no-cache')
  headers.set('Connection', 'keep-alive')

  return new Response(stream, { headers })
}
