import type { BaseEvent, EventPayload } from '@/types/events'
import { ExpiryAction } from '@/types/events'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

import { events } from '../index'

const logger = loggers.events.getChildLogger('file-expiry')
const expiryTypes = ['file.schedule-expiration', 'file.expired']
const activeStatuses = ['SCHEDULED', 'PENDING', 'PROCESSING'] as const
const payloadFilter = (fileId: string) => ({ path: ['fileId'], equals: fileId })

async function expireFile(
  payload: { fileId: string; userId: string; action: ExpiryAction },
  event: BaseEvent
) {
  // Lazy provider initialization reads config; resolve before consuming the
  // transaction connection so a cold worker also supports a one-connection pool.
  const storage =
    payload.action === ExpiryAction.DELETE ? await getStorageProvider() : null
  await prisma.$transaction(
    async (tx) => {
      // Retry and multi-process delivery may execute this twice. Serialize with
      // account quota changes and only mutate a still-existing file once.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${payload.userId} FOR UPDATE`
      const currentEvent = await tx.event.findUnique({
        where: { id: event.id },
      })
      if (!currentEvent || currentEvent.status === 'COMPLETED') return
      const file = await tx.file.findUnique({ where: { id: payload.fileId } })
      if (!file || file.userId !== payload.userId) return
      const options =
        file.uploadOptions &&
        typeof file.uploadOptions === 'object' &&
        !Array.isArray(file.uploadOptions)
          ? file.uploadOptions
          : {}
      if (options.lastAppliedExpiryEvent === event.id) return
      // A cancellation or replacement may race a worker holding an old snapshot.
      if (
        'expiresAt' in options &&
        options.expiresAt !== currentEvent.scheduledAt?.toISOString()
      )
        return
      if (payload.action === ExpiryAction.DELETE) {
        try {
          await storage!.deleteFile(file.path)
        } catch (error) {
          const code =
            (error as { code?: string; name?: string }).code ||
            (error as Error).name
          if (!['ENOENT', 'NoSuchKey', 'NotFound'].includes(code || ''))
            throw error
        }
        await tx.file.delete({ where: { id: file.id } })
        await tx.user.update({
          where: { id: file.userId },
          data: { storageUsed: { decrement: file.size } },
        })
      } else if (payload.action === ExpiryAction.SET_PRIVATE) {
        await tx.file.update({
          where: { id: file.id },
          data: {
            visibility: 'PRIVATE',
            uploadOptions: { ...options, lastAppliedExpiryEvent: event.id },
          },
        })
      } else throw new Error('Invalid file expiration action.')
      logger.info('File expiration applied', {
        fileId: file.id,
        action: payload.action,
      })
    },
    { timeout: 15000 }
  )
}

export async function registerFileExpiryHandlers() {
  // Retain both event types for already scheduled work. New schedules complete
  // directly rather than creating a second event after the deadline.
  await events.on(
    'file.schedule-expiration',
    'queue-deletion',
    async (payload: EventPayload<'file.schedule-expiration'>, event) =>
      expireFile(payload, event)
  )
  await events.on(
    'file.expired',
    'process-expired-file',
    async (payload: EventPayload<'file.expired'>, event) =>
      expireFile(payload, event)
  )
}

async function clearSchedules(tx: Prisma.TransactionClient, fileId: string) {
  const where = { type: { in: expiryTypes }, payload: payloadFilter(fileId) }
  const pending = await tx.event.deleteMany({
    where: { ...where, status: { in: ['SCHEDULED', 'PENDING'] } },
  })
  // The worker still owns processing rows. Mark them complete so a handler that
  // was waiting for the user lock observes cancellation without a missing-row race.
  const processing = await tx.event.updateMany({
    where: { ...where, status: 'PROCESSING' },
    data: { status: 'COMPLETED', processedAt: new Date() },
  })
  return pending.count + processing.count
}

export async function scheduleFileExpiration(
  fileId: string,
  userId: string,
  fileName: string,
  expiresAt: Date,
  action: ExpiryAction = ExpiryAction.DELETE
): Promise<void> {
  if (
    ![ExpiryAction.DELETE, ExpiryAction.SET_PRIVATE].includes(action) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= new Date()
  )
    throw new Error('Invalid file expiration.')
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const file = await tx.file.findFirst({ where: { id: fileId, userId } })
    if (!file) throw new Error('File not found.')
    await clearSchedules(tx, fileId)
    await tx.event.create({
      data: {
        type: 'file.schedule-expiration',
        status: 'SCHEDULED',
        scheduledAt: expiresAt,
        payload: {
          fileId,
          userId,
          fileName,
          expiresAt: expiresAt.toISOString(),
          action,
        },
      },
    })
    const options =
      file.uploadOptions &&
      typeof file.uploadOptions === 'object' &&
      !Array.isArray(file.uploadOptions)
        ? file.uploadOptions
        : {}
    await tx.file.update({
      where: { id: fileId },
      data: {
        uploadOptions: {
          ...options,
          expiresAt: expiresAt.toISOString(),
          expiryAction: action,
        },
      },
    })
  })
}

export async function cancelFileExpiration(fileId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const file = await tx.file.findUnique({ where: { id: fileId } })
    if (!file) return false
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${file.userId} FOR UPDATE`
    const count = await clearSchedules(tx, fileId)
    const options =
      file.uploadOptions &&
      typeof file.uploadOptions === 'object' &&
      !Array.isArray(file.uploadOptions)
        ? file.uploadOptions
        : {}
    await tx.file.updateMany({
      where: { id: fileId },
      data: { uploadOptions: { ...options, expiresAt: null } },
    })
    return count > 0
  })
}

export async function getFileExpirationInfo(
  fileId: string
): Promise<Date | null> {
  const event = await prisma.event.findFirst({
    where: {
      type: { in: expiryTypes },
      status: { in: [...activeStatuses] },
      payload: payloadFilter(fileId),
    },
    orderBy: { scheduledAt: 'asc' },
  })
  return event?.scheduledAt ?? null
}
