import { NextResponse } from 'next/server'

import { isSameOriginRequest } from '@/lib/security/request-origin'

export function roleMutationGuard(request: Request) {
  if (!isSameOriginRequest(request))
    return NextResponse.json(
      { error: 'Cross-origin requests are not allowed' },
      { status: 403 }
    )
  if (
    request.method !== 'DELETE' &&
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
  )
    return NextResponse.json({ error: 'Use application/json' }, { status: 415 })
  return null
}

/** Bound streamed input as well as Content-Length; role commands are small. */
export async function readRoleJson(
  request: Request
): Promise<
  { data: unknown; response: null } | { data: null; response: NextResponse }
> {
  const limit = 32 * 1024
  if (Number(request.headers.get('content-length')) > limit)
    return {
      data: null,
      response: NextResponse.json(
        { error: 'Role request exceeds 32 KB' },
        { status: 413 }
      ),
    }
  try {
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) {
          await reader.cancel()
          return {
            data: null,
            response: NextResponse.json(
              { error: 'Role request exceeds 32 KB' },
              { status: 413 }
            ),
          }
        }
        chunks.push(value)
      }
    }
    return {
      data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      response: null,
    }
  } catch {
    return {
      data: null,
      response: NextResponse.json(
        { error: 'Provide valid JSON' },
        { status: 400 }
      ),
    }
  }
}
