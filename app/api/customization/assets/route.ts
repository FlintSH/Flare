import { NextResponse } from 'next/server'

import { fileTypeFromBuffer } from 'file-type'

import { appearanceMutationGuard } from '@/lib/customization/http'
import { requirePermission } from '@/lib/permissions/server'

export async function POST(request: Request) {
  const { session, response: permissionDenied } =
    await requirePermission('appearance.manage')
  if (permissionDenied) return permissionDenied
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to upload a logo.' },
      { status: 401 }
    )
  const rejected = appearanceMutationGuard(request, 'image')
  if (rejected) return rejected
  try {
    if (Number(request.headers.get('content-length') || 0) > 300_000)
      return NextResponse.json(
        { error: 'Logos must be smaller than 256 KB.' },
        { status: 413 }
      )
    const data = await request.formData()
    const file = data.get('file')
    if (!(file instanceof File) || file.size > 256 * 1024)
      return NextResponse.json(
        { error: 'Choose a PNG, JPEG, or WebP logo smaller than 256 KB.' },
        { status: 400 }
      )
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = await fileTypeFromBuffer(buffer)
    if (!type || !['image/png', 'image/jpeg', 'image/webp'].includes(type.mime))
      return NextResponse.json(
        { error: 'Only PNG, JPEG, and WebP images are supported.' },
        { status: 400 }
      )
    return NextResponse.json({
      data: { url: `data:${type.mime};base64,${buffer.toString('base64')}` },
    })
  } catch {
    return NextResponse.json(
      { error: 'This image could not be read.' },
      { status: 400 }
    )
  }
}
