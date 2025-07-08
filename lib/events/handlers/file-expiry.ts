import type { EventPayload } from '@/types/events'
import { EventStatus, ExpiryAction } from '@/types/events'

import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

import { events } from '../index'

export async function registerFileExpiryHandlers() {
  await events.on(
    'file.schedule-expiration',
    'queue-deletion',
    async (payload: EventPayload<'file.schedule-expiration'>) => {
      console.log(
        `Scheduling file ${payload.action.toLowerCase()}: ${payload.fileName} at ${payload.expiresAt}`
      )

      await events.schedule(
        'file.expired',
        {
          fileId: payload.fileId,
          userId: payload.userId,
          fileName: payload.fileName,
          filePath: '',
          size: 0,
          action: payload.action,
        },
        payload.expiresAt
      )
    }
  )

  await events.on(
    'file.expired',
    'process-expired-file',
    async (payload: EventPayload<'file.expired'>) => {
      try {
        console.log(
          `Processing file expiration: ${payload.fileName} (${payload.fileId}) - Action: ${payload.action}`
        )

        const file = await prisma.file.findUnique({
          where: { id: payload.fileId },
        })

        if (!file) {
          console.warn(`File not found for expiration: ${payload.fileId}`)
          return
        }

        if (payload.action === ExpiryAction.DELETE) {
          const storageProvider = await getStorageProvider()
          await storageProvider.deleteFile(file.path)
          console.log(`Deleted file from storage: ${file.path}`)

          await prisma.user.update({
            where: { id: file.userId },
            data: {
              storageUsed: {
                decrement: file.size,
              },
            },
          })
          console.log(
            `Updated storage quota for user ${file.userId}: -${file.size} bytes`
          )

          await prisma.file.delete({
            where: { id: payload.fileId },
          })
          console.log(`Deleted file from database: ${payload.fileId}`)
        } else if (payload.action === ExpiryAction.SET_PRIVATE) {
          await prisma.file.update({
            where: { id: payload.fileId },
            data: {
              visibility: 'PRIVATE',
            },
          })
          console.log(`Set file to private: ${payload.fileId}`)
        }
      } catch (error) {
        console.error(
          `Failed to process expired file ${payload.fileId}:`,
          error
        )
        throw error
      }
    }
  )

  console.log('File expiry event handlers registered')
}

export async function scheduleFileExpiration(
  fileId: string,
  userId: string,
  fileName: string,
  expiresAt: Date,
  action: ExpiryAction = ExpiryAction.DELETE
): Promise<void> {
  await events.schedule(
    'file.schedule-expiration',
    {
      fileId,
      userId,
      fileName,
      expiresAt,
      action,
    },
    expiresAt
  )
}

export async function cancelFileExpiration(fileId: string): Promise<boolean> {
  const scheduledEvents = await events.getEvents({
    type: 'file.schedule-expiration',
    status: EventStatus.SCHEDULED,
  })

  const fileEvents = scheduledEvents.filter(
    (event) => (event.payload as Record<string, unknown>)?.fileId === fileId
  )

  let cancelled = false
  for (const event of fileEvents) {
    await events.deleteEvent(event.id)
    cancelled = true
  }

  return cancelled
}

export async function getFileExpirationInfo(
  fileId: string
): Promise<Date | null> {
  const scheduledEvents = await events.getEvents({
    type: 'file.schedule-expiration',
    status: EventStatus.SCHEDULED,
  })

  const fileEvent = scheduledEvents.find(
    (event) => (event.payload as Record<string, unknown>)?.fileId === fileId
  )

  return fileEvent?.scheduledAt || null
}
