import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { PublicState } from '@/components/auth/public-state'
import { ShareLayout } from '@/components/customization/share-layout'
import { ProtectedFile } from '@/components/file/protected-file'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getAccessSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { resolveShareStyle } from '@/lib/customization/schema'
import { shareMetadataText } from '@/lib/customization/sharing'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { resolveFileUrlPath } from '@/lib/files/resolve'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

interface PrismaFile {
  id: string
  name: string
  urlPath: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  userId: string
  mimeType: string
  size: number
  uploadedAt: Date
  path: string
  user?: {
    name: string | null
    image: string | null
    urlId: string
  } | null
}

function prepareFileProps(file: PrismaFile) {
  const plainFile = JSON.parse(
    JSON.stringify({
      id: file.id,
      name: file.name,
      urlPath: file.urlPath,
      visibility: file.visibility,
      password: file.password,
      userId: file.userId,
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: file.uploadedAt,
      path: file.path,
      user: {
        name: file.user?.name || '',
        image: file.user?.image || undefined,
        urlId: file.user?.urlId || '',
      },
    })
  )

  return {
    id: plainFile.id,
    name: plainFile.name,
    urlPath: plainFile.urlPath,
    visibility: plainFile.visibility,
    password: plainFile.password,
    userId: plainFile.userId,
    mimeType: plainFile.mimeType,
    size: plainFile.size,
    uploadedAt: plainFile.uploadedAt,
    path: plainFile.path,
    user: plainFile.user,
  }
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

  const path = headersList.get('x-invoke-path') || ''
  if (path.endsWith('/raw')) {
    return {}
  }

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

  const access = await checkFileAccess(file, session, providedPassword)
  if (!access.allowed) {
    return {
      title: `Protected File - ${appearance.brand.name}`,
      description: 'This file is protected',
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
        | 'video.other'
        | 'article'
        | 'website',
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

  const serializedFile = prepareFileProps(file)

  const access = await checkFileAccess(
    serializedFile,
    session,
    providedPassword
  )

  if (!access.allowed) {
    if (access.reason === 'private') {
      notFound()
    }

    const title =
      access.reason === 'password_invalid'
        ? 'Incorrect Password'
        : 'Password Protected File'
    const description =
      access.reason === 'password_invalid'
        ? 'The password you entered is incorrect'
        : 'This file requires a password to access'
    const buttonText =
      access.reason === 'password_invalid' ? 'Try Again' : 'Access File'

    return (
      <PublicState
        compact
        title={title}
        description={description}
        footer={showFooter ? <Footer /> : undefined}
      >
        <form className="space-y-4" action={urlPath}>
          <div className="space-y-2">
            <Label htmlFor="share-password">File password</Label>
            <Input
              id="share-password"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Enter the password from the sender"
              className="h-11"
              aria-invalid={access.reason === 'password_invalid'}
              aria-describedby={
                access.reason === 'password_invalid'
                  ? 'share-password-error'
                  : undefined
              }
              required
              autoFocus
            />
            {access.reason === 'password_invalid' && (
              <p
                id="share-password-error"
                role="alert"
                className="text-sm text-foreground"
              >
                That password didn’t match. Check with the sender and try again.
              </p>
            )}
          </div>
          <Button type="submit" className="h-11 w-full">
            {buttonText}
          </Button>
        </form>
      </PublicState>
    )
  }

  const isImage = serializedFile.mimeType.startsWith('image/')
  const isVideo = serializedFile.mimeType.startsWith('video/')
  const isPdf = serializedFile.mimeType === 'application/pdf'
  const isMediaFile = isImage || isVideo || isPdf

  // Send only viewer fields to the client. In particular, never serialize the
  // uploader profile or the stored password hash into a public page.
  const viewerFile = {
    id: file.id,
    name: appearance.sharing.showFilename ? file.name : 'Shared file',
    urlPath: file.urlPath,
    visibility: file.visibility,
    password:
      file.password && !access.isOwner && !access.isAdmin ? 'protected' : null,
    userId: access.isOwner ? file.userId : '',
    mimeType: file.mimeType,
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
    >
      <ProtectedFile file={viewerFile} verifiedPassword={providedPassword} />
    </ShareLayout>
  )
}
