import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { hasPermission } from '@/lib/permissions/catalog'
import { requirePermission } from '@/lib/permissions/server'
import { validateOwnedTagIds } from '@/lib/tags/service'
import {
  accountUploadOptions,
  effectiveUploadRevision,
} from '@/lib/uploads/effective-settings'
import { profileMutationGuard } from '@/lib/uploads/profiles'
import { profileError, profileView } from '@/lib/uploads/profiles'
import {
  mergeUploadOptions,
  uploadProfileInputSchema,
  uploadProfileOptionsSchema,
  uploadRecipeSchema,
} from '@/lib/uploads/schema'

export async function GET() {
  const { user, response } = await requirePermission('uploadProfiles.manage')
  if (response) return response
  try {
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
    if (!account)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
  } catch (error) {
    return profileError(error)
  }
}

export async function POST(req: Request) {
  const { user, response } = await requirePermission('uploadProfiles.manage')
  if (response) return response
  const guarded = profileMutationGuard(req)
  if (guarded) return guarded
  try {
    const json = await req.json()
    const input = json?.format
      ? uploadRecipeSchema.parse(json).profile
      : uploadProfileInputSchema.parse(json)
    const profile = await prisma.$transaction(async (tx) => {
      // Serialize tag deletion and profile edits so saved selections stay valid.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
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
  } catch (error) {
    return profileError(error)
  }
}
