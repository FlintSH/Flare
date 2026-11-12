import { redirect } from 'next/navigation'

import { ProfileClient } from '@/components/profile'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { readPersonalAppearance } from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { readPersonalEmbed } from '@/lib/embeds/schema'
import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_ALIASES,
  readPreferenceSection,
} from '@/lib/preferences/navigation'
import { storageQuotaBytes } from '@/lib/uploads/capacity'
import { bytesToMB, formatFileSize } from '@/lib/utils'

import { requireDashboardPage } from '../page-access'

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
  const session = await requireDashboardPage('/dashboard/profile')

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
    redirect(SIGN_IN_PATH)
  }

  const config = await getConfig()
  const { brand, sharing } = config.settings.customization.published
  const quota = storageQuotaBytes(config, session.user)
  const quotasEnabled = quota !== null
  const quotaMB = bytesToMB(quota ?? 0)
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
      initialEmbed={readPersonalEmbed(user.preferences)}
      // The embed preview names the instance. Its logos, which the layout
      // already sends, stay out of this page.
      appearance={{
        brand: { ...brand, logoLight: '', logoDark: '' },
        sharing,
      }}
    />
  )
}
