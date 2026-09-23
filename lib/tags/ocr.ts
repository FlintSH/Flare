import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { applyAutomaticTags } from '@/lib/tags/service'

/** Finish only the work recorded with an OCR result; safe across concurrent workers. */
export async function applyPendingOcrTags(fileId: string): Promise<void> {
  let pendingAt: Date | null = null
  try {
    await prisma.$transaction(async (tx) => {
      // Serialize a background retry, an OCR request, and a newly saved result.
      await tx.$queryRaw`SELECT "id" FROM "File" WHERE "id" = ${fileId} FOR UPDATE`
      const file = await tx.file.findUnique({
        where: { id: fileId },
        select: { ocrTagsPendingAt: true },
      })
      pendingAt = file?.ocrTagsPendingAt ?? null
      if (!pendingAt) return

      await applyAutomaticTags(fileId, 'ocr', tx)
      await tx.file.update({
        where: { id: fileId },
        data: { ocrTagsPendingAt: null },
      })
    })
  } catch {
    loggers.ocr.warn('OCR tags are pending; they will be retried.', { fileId })
    if (pendingAt) {
      // The failed transaction has rolled back. Delay this attempt without
      // resurrecting completed work or postponing a newer OCR result.
      await prisma.file
        .updateMany({
          where: { id: fileId, ocrTagsPendingAt: pendingAt },
          data: { ocrTagsPendingAt: new Date(Date.now() + 60_000) },
        })
        .catch(() => {
          // A database outage leaves the original marker available for retry.
        })
    }
  }
}
