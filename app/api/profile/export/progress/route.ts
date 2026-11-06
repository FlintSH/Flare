import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { clearProgress, getProgress } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const api = routes('/api/profile/export/progress', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async () => {
  const { session } = await requireSession('profile.export')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let lastProgress = -1
      let inactivityCounter = 0

      const interval = setInterval(() => {
        const progress = getProgress(session.user.id)

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

        if (progress === 100 || inactivityCounter > 100) {
          clearInterval(interval)

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
})
