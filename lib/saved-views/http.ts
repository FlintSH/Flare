import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

import { apiError, apiResponse } from '@/lib/api/response'
import { getAccessSession } from '@/lib/auth'
import { loggers } from '@/lib/logger'
import { SavedViewError } from '@/lib/saved-views/service'
import { isSameOriginRequest } from '@/lib/security/request-origin'

const MAX_REQUEST_BYTES = 16 * 1024

export async function savedViewUser(request: Request) {
  // Bearer credentials must never gain extra authority from coexisting cookies.
  if (request.headers.has('authorization')) return null
  const session = await getAccessSession()
  return session?.user ?? null
}

export function savedViewMutationGuard(request: Request) {
  if (!isSameOriginRequest(request))
    return apiError('Cross-origin changes are not allowed.', 403)
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    return apiError('Content-Type must be application/json.', 415)
  return null
}

export async function readSavedViewBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES)
    throw new SavedViewError('Saved view request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('Missing JSON')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel()
        throw new SavedViewError('Saved view request is too large.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function savedViewResponse<T>(data: T) {
  const response = apiResponse(data)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export function savedViewErrorResponse(error: unknown) {
  if (error instanceof SavedViewError)
    return error.code
      ? NextResponse.json(
          { error: error.message, success: false, code: error.code },
          { status: error.status }
        )
      : apiError(error.message, error.status)
  if (error instanceof ZodError)
    return apiError(error.issues[0]?.message ?? 'Invalid saved view.')
  if (error instanceof SyntaxError) return apiError('Invalid JSON.')
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  )
    return apiError('Saved view not found.', 404)
  loggers.files.error('Saved view operation failed', error as Error)
  return apiError('Unable to update saved views. Please try again.', 500)
}
