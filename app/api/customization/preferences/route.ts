import { NextResponse } from 'next/server'

import type { InputJsonValue } from '@prisma/client/runtime/library'

import {
  personalAppearanceSchema,
  readPersonalAppearance,
} from '@/lib/customization/schema'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/customization/preferences', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  const { session } = await requireSession(request)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  })
  return NextResponse.json(
    { data: readPersonalAppearance(user?.preferences) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = api(
  async (request) => {
    const { session } = await requireSession(request, 'appearance.personal')
    const parsed = personalAppearanceSchema.safeParse(
      await readJson(request, { limit: 1024 })
    )
    if (!parsed.success)
      throw new HttpError(400, 'Choose inherit, system, light, or dark.')
    await prisma.$transaction(async (tx) => {
      await lockUserRow(tx, session.user.id)
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
    return { data: parsed.data }
  },
  { failure: { status: 400, message: 'Preferences could not be saved.' } }
)
