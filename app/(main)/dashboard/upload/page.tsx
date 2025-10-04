import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { UploadForm } from '@/components/file/upload-form'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { formatBytes } from '@/lib/utils'

export default async function UploadPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      defaultFileExpirationAction: true,
      defaultFileExpiration: true,
    },
  })

  if (!user) {
    redirect('/auth/login')
  }

  const config = await getConfig()
  const { value, unit } = config.settings.general.storage.maxUploadSize
  const maxSizeBytes =
    value * (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
  const formattedMaxSize = formatBytes(maxSizeBytes)

  return (
    <div className="container space-y-6">
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <h1 className="text-3xl font-bold">Upload Files</h1>
          <p className="text-muted-foreground mt-2">
            Upload and share files with optional password protection
          </p>
        </div>
      </div>

      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <UploadForm
            user={user}
            maxSize={maxSizeBytes}
            formattedMaxSize={formattedMaxSize}
          />
        </div>
      </div>
    </div>
  )
}
