import { NextResponse } from 'next/server'

/** Browser-session writes must originate on this app, including uploads. */
export function appearanceMutationGuard(
  request: Request,
  kind: 'json' | 'image' = 'json'
) {
  const origin = request.headers.get('origin')
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return NextResponse.json(
      { error: 'Cross-origin changes are not allowed.' },
      { status: 403 }
    )
  }
  const expected = kind === 'image' ? 'multipart/form-data' : 'application/json'
  const contentType = request.headers
    .get('content-type')
    ?.split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType !== expected)
    return NextResponse.json({ error: `Use ${expected}.` }, { status: 415 })
  return null
}
