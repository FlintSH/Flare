import { redirect } from 'next/navigation'

import { ProfileClient } from '@/components/profile'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { readPersonalAppearance } from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { hasPermission } from '@/lib/permissions/catalog'
import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_ALIASES,
  readPreferenceSection,
} from '@/lib/preferences/navigation'
import { formatFileSize } from '@/lib/utils'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const params = await searchParams
  const initialSection = readPreferenceSection(
    params.section,
    PROFILE_SECTIONS,
    'account',
    PROFILE_SECTION_ALIASES
  )
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      storageUsed: true,
      preferences: true,
      randomizeFileUrls: true,
      defaultFileExpirationAction: true,
      defaultFileExpiration: true,
      urlId: true,
      vanityId: true,
      _count: {
        select: { files: true, shortenedUrls: true },
      },
    },
  })

  if (!user) {
    redirect('/auth/login')
  }

  const config = await getConfig()
  const quotasEnabled =
    config.settings.general.storage.quotas.enabled &&
    !hasPermission(session.user, 'quotas.bypass')
  const defaultQuota = config.settings.general.storage.quotas.default
  const quotaMB =
    defaultQuota.unit === 'GB' ? defaultQuota.value * 1024 : defaultQuota.value
  const formattedQuota = formatFileSize(quotaMB)
  const formattedUsed = formatFileSize(user.storageUsed)
  const usagePercentage =
    quotasEnabled && quotaMB > 0 ? (user.storageUsed / quotaMB) * 100 : 0

  return (
    <ProfileClient
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        storageUsed: user.storageUsed,
        roles: session.user.roles,
        permissions: session.user.permissions,
        randomizeFileUrls: user.randomizeFileUrls,
        urlId: user.urlId,
        vanityId: user.vanityId,
        fileCount: user._count.files,
        shortUrlCount: user._count.shortenedUrls,
        defaultFileExpiration: user.defaultFileExpiration,
        defaultFileExpirationAction: user.defaultFileExpirationAction,
      }}
      quotasEnabled={quotasEnabled}
      formattedQuota={formattedQuota}
      formattedUsed={formattedUsed}
      usagePercentage={usagePercentage}
      initialSection={initialSection}
      initialPreference={readPersonalAppearance(user.preferences)}
    />
  )
}
