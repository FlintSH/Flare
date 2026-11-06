import { requireSession } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { deleteRole, updateRole } from '@/lib/permissions/roles'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/roles/[id]', {
  failure: { message: 'Failed to update role' },
})

export const PATCH = api(async (request, { params }: Context) => {
  const { user } = await requireSession('roles.manage')
  const { id } = await params
  assertJsonMutation(request)
  return updateRole(user.id, id, await readJson(request, { limit: 32 * 1024 }))
})

export const DELETE = api(
  async (request, { params }: Context) => {
    const { user } = await requireSession('roles.manage')
    assertJsonMutation(request, { body: false })
    const { id } = await params
    await deleteRole(user.id, id)
    return { success: true }
  },
  { failure: { message: 'Failed to delete role' } }
)
