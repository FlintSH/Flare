import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { ShareLayout } from '@/components/customization/share-layout'
import { ProtectedFile } from '@/components/file/protected-file'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
      <div className="flex-1 relative min-h-screen overflow-hidden">
        <DynamicBackground />
        <div className="absolute top-6 left-6 z-20">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-xl" />
            <div className="relative bg-background/60 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2 shadow-lg shadow-black/5">
              <Link href="/dashboard" className="flex items-center space-x-2.5">
                <InstanceBrand />
              </Link>
            </div>
          </div>
        </div>
        <main className="flex items-center justify-center p-6 relative z-10 min-h-screen">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-2xl" />
            <Card className="relative w-full max-w-md bg-background/60 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
              <div className="p-6">
                <h1 className="text-xl font-medium text-center mb-4">
                  {title}
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                  {description}
                </p>
                <form className="space-y-4" action={urlPath}>
                  <div className="space-y-2">
                    <Input
                      type="password"
                      name="password"
                      placeholder="Enter password"
                      className="bg-background/60 backdrop-blur-sm border-border/50"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    {buttonText}
                  </Button>
                </form>
              </div>
            </Card>
          </div>
          {showFooter && (
            <div className="fixed bottom-0 left-0 right-0 z-10">
              <Footer />
            </div>
          )}
        </main>
      </div>
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
