import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { applyPendingOcrTags } from '@/lib/tags/ocr'

const state = globalThis as typeof globalThis & {
  flareOcrTagWorker?: { timer: NodeJS.Timeout; busy: boolean }
}

export async function retryPendingOcrTags(): Promise<void> {
  const files = await prisma.file.findMany({
    where: { ocrTagsPendingAt: { lte: new Date() } },
    select: { id: true },
    orderBy: [{ ocrTagsPendingAt: 'asc' }, { id: 'asc' }],
    take: 20,
  })
  for (const file of files) await applyPendingOcrTags(file.id)
}

/** Database markers survive process restarts; row locks make multiple replicas safe. */
export function startOcrTagWorker(): void {
  if (state.flareOcrTagWorker) return
  const timer = setInterval(async () => {
    const worker = state.flareOcrTagWorker
    if (!worker || worker.busy) return
    worker.busy = true
    try {
      await retryPendingOcrTags()
    } catch {
      loggers.ocr.warn(
        'OCR tag retries unavailable; retrying on the next poll.'
      )
    } finally {
      worker.busy = false
    }
  }, 15_000)
  timer.unref()
  state.flareOcrTagWorker = { timer, busy: false }
}
