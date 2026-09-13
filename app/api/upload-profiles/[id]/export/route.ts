import { prisma } from '@/lib/database/prisma'
import { profileSession, profileView } from '@/lib/uploads/profiles'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await profileSession()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
