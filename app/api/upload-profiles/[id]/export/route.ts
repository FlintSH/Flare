import { prisma } from '@/lib/database/prisma'
import { requirePermission } from '@/lib/permissions/server'
import { profileView } from '@/lib/uploads/profiles'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requirePermission('uploadProfiles.manage')
  if (response) return response
  const { id } = await params
  const profile = await prisma.uploadProfile.findFirst({
    where: { id, userId: user.id },
  })
  if (!profile)
    return Response.json({ error: 'Profile not found.' }, { status: 404 })
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
}
