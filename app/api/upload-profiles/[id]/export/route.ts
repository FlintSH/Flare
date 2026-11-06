import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { profileRecipe } from '@/lib/uploads/profiles'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/upload-profiles/[id]/export', uploadProfileRoutes)

export const GET = api(async (request, { params }: Context) => {
  const { user } = await requireSession(request, 'uploadProfiles.manage')
  const { id } = await params
  return new Response(
    JSON.stringify(await profileRecipe(user.id, id), null, 2),
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
