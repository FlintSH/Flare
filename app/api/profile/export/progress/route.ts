import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { clearProgress, getProgress } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let lastProgress = -1
      let inactivityCounter = 0

      const interval = setInterval(() => {
        const progress = getProgress(session.user.id)

        // Only send updates when progress changes or heartbeat (every ~2 seconds)
        if (progress !== lastProgress || inactivityCounter >= 20) {
          const data = encoder.encode(
            `data: ${JSON.stringify({ progress })}\n\n`
          )
          controller.enqueue(data)
          lastProgress = progress
          inactivityCounter = 0
        } else {
          inactivityCounter++
        }

        // If progress is 100 or we haven't seen progress in 10 seconds, close the stream
        if (progress === 100 || inactivityCounter > 100) {
          clearInterval(interval)

          // Send final 100% if needed
          if (lastProgress !== 100) {
            const finalData = encoder.encode(
              `data: ${JSON.stringify({ progress: 100 })}\n\n`
            )
            controller.enqueue(finalData)
          }

          controller.close()
          clearProgress(session.user.id)
        }
      }, 100)
    },
  })

  const headers = new Headers()
  headers.set('Content-Type', 'text/event-stream')
  headers.set('Cache-Control', 'no-cache, no-transform')
  headers.set('Connection', 'keep-alive')

  return new Response(stream, { headers })
}
