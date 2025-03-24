import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { ProfileClient } from '@/components/profile/profile-client'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { formatFileSize } from '@/lib/utils'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)

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
      role: true,
      randomizeFileUrls: true,
    },
  })

  if (!user) {
    redirect('/auth/login')
  }

  const config = await getConfig()
  const quotasEnabled = config.settings.general.storage.quotas.enabled
  const defaultQuota = config.settings.general.storage.quotas.default
  // Convert quota to megabytes for consistency
  const quotaMB =
    defaultQuota.unit === 'GB' ? defaultQuota.value * 1024 : defaultQuota.value
  const formattedQuota = formatFileSize(quotaMB)
  const formattedUsed = formatFileSize(user.storageUsed)
  const usagePercentage = quotasEnabled ? (user.storageUsed / quotaMB) * 100 : 0

  return (
    <ProfileClient
      user={user}
      quotasEnabled={quotasEnabled}
      formattedQuota={formattedQuota}
      formattedUsed={formattedUsed}
      usagePercentage={usagePercentage}
      isAdmin={user.role === 'ADMIN'}
    />
  )
}
