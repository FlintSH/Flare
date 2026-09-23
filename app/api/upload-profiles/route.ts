import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { validateOwnedTagIds } from '@/lib/tags/service'
import { profileMutationGuard } from '@/lib/uploads/profiles'
import {
  profileError,
  profileSession,
  profileView,
} from '@/lib/uploads/profiles'
import {
  mergeUploadOptions,
  uploadProfileInputSchema,
  uploadProfileOptionsSchema,
  uploadRecipeSchema,
} from '@/lib/uploads/schema'

export async function GET() {
  const user = await profileSession()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
    const accountOptions = {
      shareStyle: config.settings.customization.published.sharing.defaultStyle,
      randomizeFileUrls: account.randomizeFileUrls,
      expiration: account.defaultFileExpiration,
      expiryAction: account.defaultFileExpirationAction,
    }
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
        profiles: profiles.map(profileView),
        defaultProfileId: account.defaultUploadProfileId,
        accountOptions,
        effective,
      },
    })
  } catch (error) {
    return profileError(error)
  }
}

export async function POST(req: Request) {
  const user = await profileSession()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
