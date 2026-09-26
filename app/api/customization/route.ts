import { NextResponse } from 'next/server'

import { ZodError } from 'zod'

import { getAccessSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { appearanceMutationGuard } from '@/lib/customization/http'
import { appearanceCommandSchema } from '@/lib/customization/schema'
import { CustomizationError } from '@/lib/customization/state'
import { saveAppearance } from '@/lib/customization/store'
import { hasPermission } from '@/lib/permissions/catalog'
import { requirePermission } from '@/lib/permissions/server'

export async function GET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to customize Flare.' },
      { status: 401 }
    )
  const { customization } = (await getConfig()).settings
  return NextResponse.json(
    {
      data: hasPermission(session.user, 'appearance.manage')
        ? customization
        : { published: customization.published },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function POST(request: Request) {
  const { session, response: permissionDenied } =
    await requirePermission('appearance.manage')
  if (permissionDenied) return permissionDenied
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to customize Flare.' },
      { status: 401 }
    )
  const rejected = appearanceMutationGuard(request)
  if (rejected) return rejected
  try {
    const text = await request.text()
    if (text.length > 1_000_000)
      return NextResponse.json(
        { error: 'Appearance packs must be smaller than 1 MB.' },
        { status: 413 }
      )
    const command = appearanceCommandSchema.parse(JSON.parse(text))
    const state = await saveAppearance(command)
    return NextResponse.json({ data: state })
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        },
        { status: 400 }
      )
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Upload a valid JSON appearance pack.' },
        { status: 400 }
      )
    if (error instanceof CustomizationError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    return NextResponse.json(
      {
        error:
          'Appearance could not be saved. Your live appearance is unchanged.',
      },
      { status: 500 }
    )
  }
}
