import { redirect } from 'next/navigation'

import { UploadForm } from '@/components/file/upload-form'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { hasPermission } from '@/lib/permissions/catalog'
import { formatBytes } from '@/lib/utils'

export default async function UploadPage() {
  const session = await getPageSession()

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

  if (!hasPermission(session.user, 'files.upload'))
    redirect('/dashboard/profile')

  return (
    <div className="container space-y-7">
      <PageHeader
        eyebrow="Your files"
        title="Upload files"
        description="Upload and share files, with optional password protection."
      />
      <div className={pagePanelClassName}>
        <UploadForm
          user={user}
          maxSize={maxSizeBytes}
          formattedMaxSize={formatBytes(maxSizeBytes)}
        />
      </div>
    </div>
  )
}
