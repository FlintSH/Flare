import { redirect } from 'next/navigation'

import { CustomizationStudio } from '@/components/customization/customization-studio'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { readPersonalAppearance } from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'

export default async function CustomizePage() {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  const [config, user] = await Promise.all([
    getConfig(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
  ])
  const isAdmin = session.user.role === 'ADMIN'
  return (
    <CustomizationStudio
      isAdmin={isAdmin}
      recovery={await isAppearanceRecovery()}
      initialState={isAdmin ? config.settings.customization : null}
      initialPreference={readPersonalAppearance(user?.preferences)}
    />
  )
}
