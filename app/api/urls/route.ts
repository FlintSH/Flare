import {
  CreateUrlResponse,
  CreateUrlSchema,
  UrlListResponse,
} from '@/types/dto/url'
import { nanoid } from 'nanoid'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

function generateShortCode() {
  return nanoid(6)
}

export async function POST(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const json = await req.json()

    const result = CreateUrlSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const { url } = result.data

    let shortCode = generateShortCode()
    let isUnique = false
    while (!isUnique) {
      const existing = await prisma.shortenedUrl.findUnique({
        where: { shortCode },
      })
      if (!existing) {
        isUnique = true
      } else {
        shortCode = generateShortCode()
      }
    }

    const shortenedUrl = await prisma.shortenedUrl.create({
      data: {
        shortCode,
        targetUrl: url,
        userId: user.id,
      },
    })

    return apiResponse<CreateUrlResponse>(shortenedUrl)
  } catch (error) {
    console.error('URL creation error:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const urls = await prisma.shortenedUrl.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return apiResponse<UrlListResponse>({ urls })
  } catch (error) {
    console.error('URL list error:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
