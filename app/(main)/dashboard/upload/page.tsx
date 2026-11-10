import { redirect } from 'next/navigation'

import { UploadForm } from '@/components/file/upload-form'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'
import { prisma } from '@/lib/database/prisma'
import { plainUploadsForbidden } from '@/lib/uploads/encryption-policy'
import { formatBytes } from '@/lib/utils'

import { requireDashboardPage } from '../page-access'

export default async function UploadPage() {
  const session = await requireDashboardPage('/dashboard/upload')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      defaultFileExpirationAction: true,
      defaultFileExpiration: true,
    },
  })

  if (!user) {
    redirect(SIGN_IN_PATH)
  }

  const config = await getConfig()
  const maxSizeBytes = maxUploadBytes(config)

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
          plainUploadsForbidden={plainUploadsForbidden(config)}
        />
      </div>
    </div>
  )
}
