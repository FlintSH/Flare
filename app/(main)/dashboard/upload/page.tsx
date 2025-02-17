import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { UploadForm } from '@/components/file/upload-form'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { formatBytes } from '@/lib/utils'

export default async function UploadPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  const config = await getConfig()
  const { value, unit } = config.settings.general.storage.maxUploadSize
  const maxSizeBytes =
    value * (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
  const formattedMaxSize = formatBytes(maxSizeBytes)

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Upload Files</h1>
        <UploadForm
          maxSize={maxSizeBytes}
          formattedMaxSize={formattedMaxSize}
        />
      </div>
    </div>
  )
}
