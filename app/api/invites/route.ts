import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { inviteCreateSchema } from '@/lib/invites/policy'
import {
  createInvite,
  inviteListQuerySchema,
  listInvites,
} from '@/lib/invites/service'
import { getUserAccess } from '@/lib/permissions/server'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

const api = routes('/api/invites', {
  failure: { message: 'Could not load invites' },
})

export const GET = api(async (request) => {
  const { user } = await requireSession(request, [
    'invites.create',
    'invites.manage',
  ])
  const parsed = inviteListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!parsed.success)
    throw new HttpError(400, 'Choose a valid scope, status, page, and limit')
  const access = await getUserAccess(user.id)
  return listInvites(user.id, access, parsed.data)
})

export const POST = api(
  async (request) => {
    const limited = await rateLimit(request, generalLimiter)
    if (limited) return limited
    const { user } = await requireSession(request, 'invites.create')
    const parsed = inviteCreateSchema.safeParse(
      await readJson(request, { limit: 32 * 1024 })
    )
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message || 'Invalid invite',
        { body: { details: parsed.error.flatten() } }
      )
    const invite = await createInvite(user.id, parsed.data)
    return NextResponse.json({ invite }, { status: 201 })
  },
  { failure: { message: 'Could not create the invite' } }
)
