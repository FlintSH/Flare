import { getConfig } from '@/lib/config'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { hasPermission } from '@/lib/permissions/catalog'
import { validateOwnedTagIds } from '@/lib/tags/service'
import {
  accountUploadOptions,
  effectiveUploadRevision,
} from '@/lib/uploads/effective-settings'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { profileView } from '@/lib/uploads/profiles'
import {
  mergeUploadOptions,
  uploadProfileInputSchema,
  uploadProfileOptionsSchema,
  uploadRecipeSchema,
} from '@/lib/uploads/schema'

const api = routes('/api/upload-profiles', uploadProfileRoutes)

export const GET = api(async () => {
  const { user } = await requireSession('uploadProfiles.manage')
  const [profiles, account] = await Promise.all([
    prisma.uploadProfile.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        defaultUploadProfileId: true,
        randomizeFileUrls: true,
        defaultFileExpiration: true,
        defaultFileExpirationAction: true,
      },
    }),
  ])
  if (!account) throw new HttpError(401, 'Unauthorized')
  const config = await getConfig()
  const accountOptions = accountUploadOptions(account, config)
  const canShare = hasPermission(user, 'files.share')
  const selected = profiles.find(
    (profile) => profile.id === account.defaultUploadProfileId
  )
  const effective = mergeUploadOptions(
    accountOptions,
    selected ? uploadProfileOptionsSchema.parse(selected.options) : {},
    {}
  )
  return Response.json({
    data: {
      profiles: profiles.map((profile) => {
        const view = profileView(profile)
        return {
          ...view,
          effectiveRevision: effectiveUploadRevision(
            user.id,
            profile.id,
            accountOptions,
            view.options,
            canShare
          ),
        }
      }),
      defaultProfileId: account.defaultUploadProfileId,
      accountOptions,
      canShare,
      effective,
    },
  })
})

export const POST = api(async (request) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request)
  const json = await readJson(request)
  const input =
    json && typeof json === 'object' && 'format' in json && json.format
      ? uploadRecipeSchema.parse(json).profile
      : uploadProfileInputSchema.parse(json)
  const profile = await prisma.$transaction(async (tx) => {
    // Serialize tag deletion and profile edits so saved selections stay valid.
    await lockUserRow(tx, user.id)
    if (input.options.tagIds)
      input.options.tagIds = await validateOwnedTagIds(
        user.id,
        input.options.tagIds,
        tx
      )
    return tx.uploadProfile.create({
      data: { userId: user.id, ...input },
    })
  })
  return Response.json({ data: profileView(profile) }, { status: 201 })
})
