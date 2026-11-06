import { cache } from 'react'

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import type { Prisma } from '@prisma/client'

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

import { recordAudit } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { resolveShareStyle } from '@/lib/customization/schema'
import {
  shareMetadataText,
  showsShareFooter,
} from '@/lib/customization/sharing'
import { checkPageAccess, countView, findFile } from '@/lib/files/delivery'
import { fileKind } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { sharedFolderBackLink } from '@/lib/folders/shared'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const sharedFileFields = {
  id: true,
  name: true,
  urlPath: true,
  path: true,
  mimeType: true,
  size: true,
  visibility: true,
  password: true,
  userId: true,
  uploadOptions: true,
  folderId: true,
  user: { select: { name: true, image: true } },
} satisfies Prisma.FileSelect

// The metadata and the page read the file once per request.
const findSharedFile = cache((userUrlId: string, filename: string) =>
  findFile({ userUrlId, filename }, sharedFileFields)
)

export async function generateMetadata({
  params,
  searchParams,
}: FilePageProps): Promise<Metadata> {
  const { userUrlId, filename } = await params
  const appearance = (await getConfig()).settings.customization.published
  const headersList = await headers()
  const providedPassword = (await searchParams).password as string | undefined

  const file = await findSharedFile(userUrlId, filename)

  if (!file) {
    return {}
  }

  const { access } = await checkPageAccess(file, providedPassword)
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

  const { kind } = fileKind(file)
  const isImage = kind === 'image'
  const isVideo = kind === 'video'
  const isMediaFile = isImage || isVideo || kind === 'audio'
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
  const rawUrl = fileUrls(file, { origin: baseUrl }).raw

  let videoUrl = rawUrl
  if (isVideo) {
    const storageProvider = await getStorageProvider()
    const publicUrl = await storageProvider.getPublicUrl(file.path)
    videoUrl = publicUrl ?? rawUrl
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
  const config = await getConfig()
  const appearance = config.settings.customization.published
  const showFooter = showsShareFooter(
    appearance,
    config.settings.general.credits.showFooter
  )
  const { userUrlId, filename } = await params
  const providedPassword = (await searchParams).password as string | undefined

  const file = await findSharedFile(userUrlId, filename)

  if (!file) {
    notFound()
  }

  const { session, access } = await checkPageAccess(file, providedPassword)

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
          action={fileUrls(file).page}
          problem={filePasswordProblem(access)}
        />
      </PublicState>
    )
  }

  // Only a visitor who may see the file adds a view; refusals never count.
  await countView(file.id)

  // From the real name, which the page may hide.
  const type = fileKind(file)
  const isMediaFile = ['image', 'video', 'pdf'].includes(type.kind)

  // Send only viewer fields to the client. In particular, never serialize the
  // uploader profile or the stored password hash into a public page.
  const viewerFile = {
    id: file.id,
    name: appearance.sharing.showFilename ? file.name : 'Shared file',
    urlPath: file.urlPath,
    visibility: file.visibility,
    mimeType: file.mimeType,
    ...type,
  }

  const backLink = await sharedFolderBackLink(
    file,
    (await headers()).get('referer')
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
