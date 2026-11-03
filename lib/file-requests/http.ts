import { NextResponse } from 'next/server'

import { z } from 'zod'

import { loggers } from '@/lib/logger'
import { PermissionError } from '@/lib/permissions/server'
import { UploadError } from '@/lib/uploads/options'

import { FileRequestError } from './service'
import { senderError } from './uploads'

export const noStore = { 'Cache-Control': 'private, no-store' }
/** Senders prove which batch an upload belongs to with this header. */
export const SUBMISSION_KEY_HEADER = 'x-flare-submission-key'

function zodMessage(error: z.ZodError) {
  return error.issues[0]?.message || 'Check the request and try again.'
}

/** Owner routes: validation, permission, and not-found errors keep their status. */
export function ownerErrorResponse(error: unknown, fallback: string) {
  if (error instanceof FileRequestError || error instanceof PermissionError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: noStore }
    )
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: zodMessage(error) },
      { status: 400, headers: noStore }
    )
  loggers.files.error(fallback, error as Error)
  return NextResponse.json(
    { error: fallback },
    { status: 500, headers: noStore }
  )
}

/** Public routes: every failure has a stable `code` and sender-safe wording. */
export function senderErrorResponse(error: unknown) {
  const mapped = senderError(error)
  if (mapped instanceof FileRequestError)
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status, headers: noStore }
    )
  if (mapped instanceof z.ZodError)
    return NextResponse.json(
      { error: zodMessage(mapped), code: 'invalid_request' },
      { status: 400, headers: noStore }
    )
  if (mapped instanceof UploadError)
    return NextResponse.json(
      { error: mapped.message, code: 'upload_failed' },
      { status: mapped.status, headers: noStore }
    )
  loggers.files.error('File request upload failed', mapped as Error)
  return NextResponse.json(
    {
      error: 'The upload couldn’t be completed. Try again.',
      code: 'server_error',
    },
    { status: 500, headers: noStore }
  )
}
