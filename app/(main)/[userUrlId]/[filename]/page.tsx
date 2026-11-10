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
import { EncryptedFile } from '@/components/file/encrypted-file'
import { EncryptedFileTitle } from '@/components/file/encrypted-title'
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
import {
  ENCRYPTED_FILE_LABEL,
  auditFileName,
  encryptedRecordSelect,
  encryptedRecordsWire,
} from '@/lib/files/encrypted'
import { fileKind } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { sharedFolderBackLink } from '@/lib/folders/shared'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'
import { mbToBytes } from '@/lib/utils/size'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

async function passwordParam(searchParams: FilePageProps['searchParams']) {
  const { password } = await searchParams
  return Array.isArray(password) ? password[0] : password
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
  ...encryptedRecordSelect,
  user: { select: { name: true, image: true } },
} satisfies Prisma.FileSelect

/** The fixed text of every encrypted file's link preview (docs/e2ee-spec.md, section 11.3). */
const ENCRYPTED_PREVIEW_DESCRIPTION = 'Open the link to view this file.'

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
  const providedPassword = await passwordParam(searchParams)

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

  const host = headersList.get('host') || 'localhost:3000'
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const baseUrl = `${protocol}://${host}`

  // The server has no name, no type and no readable content for an
  // encrypted file, and a crawler never has the key. The preview is the
  // same for every encrypted file: the instance, two fixed lines and the
  // instance's own image. It names no address of the file's bytes.
  if (file.encrypted) {
    const title = ENCRYPTED_FILE_LABEL
    return {
      title: `${title} - ${appearance.brand.name}`,
      description: ENCRYPTED_PREVIEW_DESCRIPTION,
      metadataBase: new URL(baseUrl),
      robots: { index: false, follow: false },
      openGraph: {
        siteName: appearance.brand.name,
        title,
        description: ENCRYPTED_PREVIEW_DESCRIPTION,
        type: 'website',
        images: [{ url: `${baseUrl}/icon.svg`, alt: appearance.brand.name }],
      },
      twitter: {
        card: 'summary',
        title,
        description: ENCRYPTED_PREVIEW_DESCRIPTION,
      },
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
  const providedPassword = await passwordParam(searchParams)

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
    targetName: auditFileName(file),
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

  const backLink = await sharedFolderBackLink(
    file,
    (await headers()).get('referer')
  )

  if (file.encrypted) {
    const isOwner = session?.user?.id === file.userId
    // Checked above: `records` is null only for a plain file.
    const records = encryptedRecordsWire(file, { forOwner: isOwner })!
    return (
      <ShareLayout
        appearance={appearance}
        style={resolveShareStyle(
          file.uploadOptions,
          appearance.sharing.defaultStyle
        )}
        filename={<EncryptedFileTitle fallback={ENCRYPTED_FILE_LABEL} />}
        size={formatFileSize(file.size)}
        uploader={{
          name: file.user?.name || 'Anonymous',
          image: file.user?.image || undefined,
        }}
        isMedia={false}
        showFooter={showFooter}
        backLink={backLink}
      >
        <EncryptedFile
          file={{
            id: file.id,
            urlPath: file.urlPath,
            sizeBytes: Math.round(mbToBytes(file.size)),
            records,
            isOwner,
            isModerator: !isOwner && access.canModerate,
            showFilename: appearance.sharing.showFilename,
          }}
        />
      </ShareLayout>
    )
  }

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
