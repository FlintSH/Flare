import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

import { apiError } from '@/lib/api/response'
import { loggers } from '@/lib/logger'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { TagError } from '@/lib/tags/service'

export function tagMutationGuard(request: Request, json = true) {
  if (!isSameOriginRequest(request)) return apiError('Forbidden', 403)
  if (
    json &&
    !request.headers.get('content-type')?.includes('application/json')
  )
    return apiError('Content-Type must be application/json.', 415)
  return null
}

export function tagErrorResponse(error: unknown) {
  if (error instanceof TagError) return apiError(error.message, error.status)
  if (error instanceof ZodError)
    return apiError(error.issues[0]?.message ?? 'Invalid tag.')
  if (error instanceof SyntaxError) return apiError('Invalid JSON.')
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return apiError('You already have a tag with that name.', 409)
    if (error.code === 'P2025' || error.code === 'P2003')
      return apiError('The tag or file is no longer available.', 404)
  }
  loggers.files.error('Tag operation failed', error as Error)
  return apiError('Unable to update tags. Please try again.', 500)
}
