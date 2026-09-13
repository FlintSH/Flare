import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'

import { WorkspacePage } from '@/components/dashboard/page-shell'
import { UploadForm } from '@/components/file/upload-form'
import { Button } from '@/components/ui/button'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
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

  return (
    <WorkspacePage
      title="Upload files"
      description="Drop in your files, choose how to share them, and get a link for each one."
      actions={
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            File library
          </Link>
        </Button>
      }
    >
      <UploadForm
        user={user}
        maxSize={maxSizeBytes}
        formattedMaxSize={formatBytes(maxSizeBytes)}
      />
    </WorkspacePage>
  )
}
