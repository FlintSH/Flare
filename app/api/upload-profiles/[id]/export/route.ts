import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { profileView } from '@/lib/uploads/profiles'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/upload-profiles/[id]/export', uploadProfileRoutes)

export const GET = api(async (request, { params }: Context) => {
  const { user } = await requireSession('uploadProfiles.manage')
  const { id } = await params
  const profile = await prisma.uploadProfile.findFirst({
    where: { id, userId: user.id },
  })
  if (!profile) throw new HttpError(404, 'Profile not found.')
  const { name, options } = profileView(profile)
  return new Response(
    JSON.stringify(
      {
        format: 'flare-upload-profile',
        version: 1,
        profile: { name, options },
      },
      null,
      2
    ),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition':
          'attachment; filename="flare-upload-profile.json"',
        'Cache-Control': 'no-store',
      },
    }
  )
})
