import { NextResponse } from 'next/server'

import type { InputJsonValue } from '@prisma/client/runtime/library'

import { getAccessSession } from '@/lib/auth'
import { appearanceMutationGuard } from '@/lib/customization/http'
import {
  personalAppearanceSchema,
  readPersonalAppearance,
} from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { requirePermission } from '@/lib/permissions/server'

export async function GET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to save preferences.' },
      { status: 401 }
    )
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  })
  return NextResponse.json(
    { data: readPersonalAppearance(user?.preferences) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function PATCH(request: Request) {
  const { session, response: permissionDenied } = await requirePermission(
    'appearance.personal'
  )
  if (permissionDenied) return permissionDenied
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to save preferences.' },
      { status: 401 }
    )
  const rejected = appearanceMutationGuard(request)
  if (rejected) return rejected
  try {
    const text = await request.text()
    if (text.length > 1024)
      return NextResponse.json(
        { error: 'Preference request is too large.' },
        { status: 413 }
      )
    const parsed = personalAppearanceSchema.safeParse(JSON.parse(text))
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Choose inherit, system, light, or dark.' },
        { status: 400 }
      )
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${session.user.id} FOR UPDATE`
      const user = await tx.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { preferences: true },
      })
      const previous =
        user.preferences &&
        typeof user.preferences === 'object' &&
        !Array.isArray(user.preferences)
          ? user.preferences
          : {}
      await tx.user.update({
        where: { id: session.user.id },
        data: {
          preferences: {
            ...previous,
            customization: parsed.data,
          } as InputJsonValue,
        },
      })
    })
    return NextResponse.json({ data: parsed.data })
  } catch {
    return NextResponse.json(
      { error: 'Preferences could not be saved.' },
      { status: 400 }
    )
  }
}
