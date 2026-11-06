import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'
import { applyPendingOcrTags } from '@/lib/tags/ocr'

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
export function startOcrTagWorker() {
  return startIntervalWorker({
    key: 'ocr-tags',
    everyMs: 15_000,
    logger: loggers.ocr,
    failure: 'OCR tag retries unavailable; retrying on the next poll.',
    run: retryPendingOcrTags,
  })
}
