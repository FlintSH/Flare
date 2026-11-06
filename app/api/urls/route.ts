import {
  CreateUrlResponse,
  CreateUrlSchema,
  UrlListResponse,
} from '@/types/dto/url'
import { nanoid } from 'nanoid'

import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

function generateShortCode() {
  return nanoid(6)
}

const api = routes('/api/urls', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.api,
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)

  const { url } = CreateUrlSchema.parse(await readJson(request))

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
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)

  const urls = await prisma.shortenedUrl.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return apiResponse<UrlListResponse>({ urls })
})
