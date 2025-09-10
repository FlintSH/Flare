import { ExpiryAction } from '@/types/events'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import {
  cancelFileExpiration,
  getFileExpirationInfo,
  scheduleFileExpiration,
} from '@/lib/events/handlers/file-expiry'
import { loggers } from '@/lib/logger'

const logger = loggers.files

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params

    const file = await prisma.file.findUnique({
      where: { id },
      select: { userId: true, name: true },
    })

    if (!file || file.userId !== user.id) {
      return apiError('File not found', HTTP_STATUS.NOT_FOUND)
    }

    const expiresAt = await getFileExpirationInfo(id)

    return apiResponse({ expiresAt })
  } catch (error) {
    logger.error('Error getting file expiry:', error as Error)
    return apiError(
      'Failed to get file expiry',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params
    const { expiresAt, action = ExpiryAction.DELETE } = await req.json()

    if (!expiresAt) {
      return apiError('Expiration date is required', HTTP_STATUS.BAD_REQUEST)
    }

    const expirationDate = new Date(expiresAt)
    if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
      return apiError(
        'Invalid expiration date. Must be in the future.',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const file = await prisma.file.findUnique({
      where: { id },
      select: { userId: true, name: true },
    })

    if (!file || file.userId !== user.id) {
      return apiError('File not found', HTTP_STATUS.NOT_FOUND)
    }

    await cancelFileExpiration(id)

    await scheduleFileExpiration(id, user.id, file.name, expirationDate, action)

    return apiResponse({
      message: 'File expiration scheduled successfully',
      expiresAt: expirationDate,
    })
  } catch (error) {
    logger.error('Error scheduling file expiry:', error as Error)
    return apiError(
      'Failed to schedule file expiry',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params

    const file = await prisma.file.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!file || file.userId !== user.id) {
      return apiError('File not found', HTTP_STATUS.NOT_FOUND)
    }

    const cancelled = await cancelFileExpiration(id)

    return apiResponse({
      message: cancelled ? 'File expiration cancelled' : 'No expiration found',
      cancelled,
    })
  } catch (error) {
    logger.error('Error cancelling file expiry:', error as Error)
    return apiError(
      'Failed to cancel file expiry',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
