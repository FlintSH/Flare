import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { ProfileClient } from '@/components/profile'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { formatFileSize } from '@/lib/utils'

import { LogoutButton } from './logout-button'

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
  const quotasEnabled = config.settings.general.storage.quotas.enabled
  const defaultQuota = config.settings.general.storage.quotas.default
  const quotaMB =
    defaultQuota.unit === 'GB' ? defaultQuota.value * 1024 : defaultQuota.value
  const formattedQuota = formatFileSize(quotaMB)
  const formattedUsed = formatFileSize(user.storageUsed)
  const usagePercentage = quotasEnabled ? (user.storageUsed / quotaMB) * 100 : 0

  return (
    <div className="container space-y-6">
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold">Profile</h1>
              <p className="text-muted-foreground mt-2">
                Manage your account settings, preferences, and usage statistics
              </p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <ProfileClient
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
              storageUsed: user.storageUsed,
              role: user.role,
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
            isAdmin={user.role === 'ADMIN'}
          />
        </div>
      </div>
    </div>
  )
}
