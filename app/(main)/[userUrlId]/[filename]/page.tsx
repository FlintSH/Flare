import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import {
  FILE_PASSWORD_DESCRIPTION,
  FILE_PASSWORD_TITLE,
  FilePasswordForm,
  filePasswordProblem,
} from '@/components/auth/file-password-form'
import { PublicState } from '@/components/auth/public-state'
import { ShareLayout } from '@/components/customization/share-layout'
import { ProtectedFile } from '@/components/file/protected-file'
import { Footer } from '@/components/layout/footer'

import { detectArchiveFormat } from '@/lib/archives/shared'
import { recordAudit } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { requestIp } from '@/lib/auth/security/shared'
import { getConfig } from '@/lib/config'
import { resolveShareStyle } from '@/lib/customization/schema'
import { shareMetadataText } from '@/lib/customization/sharing'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { resolveFileUrlPath } from '@/lib/files/resolve'
import { languageFromFilename } from '@/lib/files/text-language'
import { sharedFolderBackLink } from '@/lib/folders/shared'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata({
  params,
  searchParams,
}: FilePageProps): Promise<Metadata> {
  const { userUrlId, filename } = await params
  const appearance = (await getConfig()).settings.customization.published
  const headersList = await headers()
  const session = await getAccessSession()
  const providedPassword = (await searchParams).password as string | undefined

  const urlPath = await resolveFileUrlPath(userUrlId, filename)

  if (!urlPath) {
    return {}
  }

  const file = await prisma.file.findUnique({
    where: { urlPath },
    include: { user: true },
  })

  if (!file || !file.user) {
    return {}
  }

  const access = await checkFileAccess(file, session, providedPassword, {
    requester: requestIp(headersList),
  })
  if (!access.allowed) {
    return {
      title: `Protected file - ${appearance.brand.name}`,
      description: 'This file is protected.',
    }
  }

  const cleanFile = {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
  }

  const cleanUser = {
    name: file.user.name || 'Anonymous',
  }

  const isImage = cleanFile.mimeType.startsWith('image/')
  const isVideo = cleanFile.mimeType.startsWith('video/')
  const isAudio = cleanFile.mimeType.startsWith('audio/')
  const isMediaFile = isImage || isVideo || isAudio
  const formattedSize = formatFileSize(cleanFile.size)

  const {
    title: ogTitle,
    description: ogDescription,
    alt,
  } = shareMetadataText(appearance, {
    name: cleanFile.name,
    formattedSize,
    uploader: cleanUser.name,
    isMedia: isMediaFile,
  })

  const host = headersList.get('host') || 'localhost:3000'
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const baseUrl = `${protocol}://${host}`
  const rawUrl = `${baseUrl}${urlPath}/raw`

  let videoUrl = rawUrl
  if (isVideo) {
    const storageProvider = await getStorageProvider()
    const publicUrl = await storageProvider.getPublicUrl(file.path)
    videoUrl = publicUrl ?? `${baseUrl}${urlPath}/raw`
  }

  const metadata: Metadata = {
    title: ogTitle,
    description: ogDescription,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: rawUrl,
      type: (isVideo ? 'video.other' : isImage ? 'article' : 'website') as
        'video.other' | 'article' | 'website',
      images: isImage
        ? [
            {
              url: rawUrl,
              width: 1200,
              height: 630,
              alt,
              type: cleanFile.mimeType,
            },
          ]
        : undefined,
      videos: isVideo
        ? [
            {
              url: videoUrl,
              width: 1920,
              height: 1080,
              type: cleanFile.mimeType,
              secureUrl: videoUrl,
            },
          ]
        : undefined,
    },
    twitter: isImage
      ? {
          card: 'summary_large_image',
          title: ogTitle,
          description: ogDescription,
          images: [rawUrl],
        }
      : undefined,
  }

  return metadata
}

export default async function FilePage({
  params,
  searchParams,
}: FilePageProps) {
  const session = await getAccessSession()
  const config = await getConfig()
  const appearance = config.settings.customization.published
  const showFooter =
    appearance.sharing.showFooter ?? config.settings.general.credits.showFooter
  const { userUrlId, filename } = await params
  const providedPassword = (await searchParams).password as string | undefined

  const urlPath = await resolveFileUrlPath(userUrlId, filename)

  if (!urlPath) {
    notFound()
  }

  const file = await prisma.file.findUnique({
    where: { urlPath },
    include: { user: true },
  })

  if (!file) {
    notFound()
  }

  await prisma.file.update({
    where: { id: file.id },
    data: { views: { increment: 1 } },
  })

  const requestHeaders = await headers()
  const access = await checkFileAccess(file, session, providedPassword, {
    requester: requestIp(requestHeaders),
  })

  await recordAudit({
    action: 'file.view',
    category: 'files',
    outcome: access.allowed ? 'success' : 'denied',
    actorId: session?.user?.id,
    actorName: session?.user?.name || 'Anonymous',
    targetType: 'file',
    targetId: file.id,
    targetName: file.name,
    route: '/[userUrlId]/[filename]',
    method: 'GET',
    details: access.allowed ? {} : { reason: access.reason },
  })

  if (!access.allowed) {
    if (access.reason === 'private') {
      notFound()
    }

    return (
      <PublicState
        title={FILE_PASSWORD_TITLE}
        description={FILE_PASSWORD_DESCRIPTION}
        footer={showFooter ? <Footer /> : undefined}
      >
        <FilePasswordForm
          action={urlPath}
          problem={filePasswordProblem(access)}
        />
      </PublicState>
    )
  }

  const isImage = file.mimeType.startsWith('image/')
  const isVideo = file.mimeType.startsWith('video/')
  const isPdf = file.mimeType === 'application/pdf'
  const isMediaFile = isImage || isVideo || isPdf

  // Send only viewer fields to the client. In particular, never serialize the
  // uploader profile or the stored password hash into a public page.
  const viewerFile = {
    id: file.id,
    name: appearance.sharing.showFilename ? file.name : 'Shared file',
    urlPath: file.urlPath,
    visibility: file.visibility,
    password:
      file.password && !access.isOwner && !access.canModerate
        ? 'protected'
        : null,
    userId: access.isOwner ? file.userId : '',
    mimeType: file.mimeType,
    // Detect using the real name while keeping the filename presentation setting.
    archiveFormat: detectArchiveFormat(file.name, file.mimeType),
    textLanguage: languageFromFilename(file.name),
  }

  const backLink = await sharedFolderBackLink(
    file,
    requestHeaders.get('referer')
  )

  return (
    <ShareLayout
      appearance={appearance}
      style={resolveShareStyle(
        file.uploadOptions,
        appearance.sharing.defaultStyle
      )}
      filename={file.name}
      size={formatFileSize(file.size)}
      uploader={{
        name: file.user?.name || 'Anonymous',
        image: file.user?.image || undefined,
      }}
      isMedia={isMediaFile}
      showFooter={showFooter}
      backLink={backLink}
    >
      <ProtectedFile file={viewerFile} verifiedPassword={providedPassword} />
    </ShareLayout>
  )
}
