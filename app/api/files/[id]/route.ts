import {
  deleteFile,
  fileSettingsSchema,
  updateFileSettings,
} from '@/lib/files/manage'
import { filePasswordIssue } from '@/lib/files/password-policy'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]', {
  invalid: (error) =>
    new HttpError(400, filePasswordIssue(error) ?? 'Invalid request body'),
  failure: { message: 'Failed to update file' },
  logger: loggers.files,
})

export const PATCH = api(async (request, { params }: Context) => {
  const { user } = await requireSession(request, 'files.share')
  const { id } = await params
  const settings = await readJson(request, fileSettingsSchema)
  return updateFileSettings({ as: 'owner', userId: user.id }, id, settings)
})

export const DELETE = api(
  async (request, { params }: Context) => {
    const { user } = await requireSession(request, 'files.delete')
    const { id } = await params
    await deleteFile({ as: 'owner', userId: user.id }, id)
    return { success: true }
  },
  { failure: { message: 'Failed to delete file' } }
)
