import { z } from 'zod'

import { emailRoutes } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import {
  USER_EMAIL_ACTIONS,
  userEmailAction,
  userEmailStatusFor,
} from '@/lib/email/user-actions'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/email', emailRoutes)

export const GET = api(async (request, { params }: Context) => {
  await requireSession(request, ADMIN_PERMISSIONS.manageUserEmail)
  const { id } = await params
  return userEmailStatusFor(id)
})

export const POST = api(async (request, { params }: Context) => {
  const { user: actor } = await requireSession(
    request,
    ADMIN_PERMISSIONS.manageUserEmail
  )
  const { id } = await params
  const { action } = await readJson(
    request,
    z.object({ action: z.enum(USER_EMAIL_ACTIONS) })
  )
  return userEmailAction(actor.id, id, action, (config, recipient) =>
    limitEmailRequest(request, config, recipient)
  )
})
