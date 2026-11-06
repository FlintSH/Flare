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

type Context = { params: Promise<{ id: string; fileId: string }> }

/** Moderation refuses unknown fields; the owner route has always ignored them. */
const settingsSchema = fileSettingsSchema.strict()

const api = routes('/api/users/[id]/files/[fileId]', {
  invalid: (error) =>
    new HttpError(400, filePasswordIssue(error) ?? 'Invalid file settings'),
  failure: { message: 'Internal Server Error' },
  logger: loggers.files,
})

export const DELETE = api(async (request, { params }: Context) => {
  await requireSession(request, 'content.delete')
  const { id, fileId } = await params
  await deleteFile({ as: 'moderator', accountId: id }, fileId)
  return new Response(null, { status: 204 })
})

export const PATCH = api(async (request, { params }: Context) => {
  await requireSession(request, 'content.update')
  const { id, fileId } = await params
  const settings = await readJson(request, settingsSchema)
  return updateFileSettings(
    { as: 'moderator', accountId: id },
    fileId,
    settings
  )
})
